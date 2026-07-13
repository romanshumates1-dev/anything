/**
 * Lead Finder — normalize + score (pure logic, no I/O).
 *
 * COMPLIANCE: this module NEVER emits phone/email/contact data. Any column in
 * an uploaded file whose header looks like contact info is stripped BEFORE it
 * reaches raw_fields, so contact data is never persisted. Phones are resolved
 * only downstream by the owner's existing skip-trace step.
 *
 * Scoring produces SIGNAL-BASED ESTIMATES from signals already present in the
 * public record (never fabricated), plus a human-readable "why".
 */

export type SourcedCategory = 'seller' | 'buyer';

export interface NormalizedSourcedLead {
  ownerName: string | null;
  propertyAddress: string | null;
  mailingAddress: string | null;
  parcelId: string | null;
  county: string | null;
  assessedValueCents: number | null;
  signals: string[];
  rawFields: Record<string, string>;
  dedupeKey: string;
}

export interface SourcedParseFailure {
  rowNumber: number;
  raw: Record<string, string>;
  reason: string;
}

export interface SourcedParseResult {
  rows: NormalizedSourcedLead[];
  failures: SourcedParseFailure[];
  totalRows: number;
}

// Contact tokens we refuse to persist. Matched against the header with all
// non-letters removed, so snake_case/compound headers (phone_number,
// EmailAddress, Cell Phone, Home Telephone) are caught — a \b-boundary regex
// missed those and leaked the value into raw_fields / mailing_address.
// 'email' (not 'mail') is used so a legitimate "Mailing Address" survives.
const CONTACT_TOKENS = ['phone', 'mobile', 'telephone', 'fax', 'email', 'contact'];
function isContactHeader(header: string): boolean {
  const norm = header.toLowerCase().replace(/[^a-z]/g, '');
  if (!norm) return false;
  if (CONTACT_TOKENS.some((t) => norm.includes(t))) return true;
  // 'cell' / 'cellphone' / 'cellnumber' but NOT 'parcel'.
  if (norm === 'cell' || norm.startsWith('cell')) return true;
  if (norm === 'tel') return true;
  return false;
}

// Fuzzy header → field matchers (first match wins).
const FIELD_MATCHERS: Array<{ field: keyof NormalizedSourcedLead | 'recordType'; re: RegExp }> = [
  { field: 'mailingAddress', re: /mail/i },
  { field: 'propertyAddress', re: /(prop|situs|site|location|premise).*(addr|street|loc)|^address$|property/i },
  { field: 'ownerName', re: /owner|grantee|taxpayer|deed.*name|^name$/i },
  { field: 'parcelId', re: /parcel|pidn|\bpin\b|\bpid\b|account|tax\s*id|map\s*no/i },
  { field: 'assessedValueCents', re: /assess|market\s*value|apprais|total\s*value|land\s*value/i },
  { field: 'county', re: /county/i },
  { field: 'recordType', re: /record\s*type|case\s*type|filing\s*type|status\s*type/i },
];

export function normalizeWhitespace(v: string | null | undefined): string {
  return (v ?? '').replace(/\s+/g, ' ').trim();
}

// Defense-in-depth: even after contact COLUMNS are stripped, a phone/email can
// hide inside a freeform cell (e.g. a "Notes" column). Redact those VALUE
// patterns from anything persisted so contact data never lands in raw_fields.
const EMAIL_VALUE_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const PHONE_VALUE_RE = /(\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g;
export function scrubContactValues(v: string): string {
  return v.replace(EMAIL_VALUE_RE, '[redacted-email]').replace(PHONE_VALUE_RE, '[redacted-phone]');
}

/** Parse a currency-ish string ("$120,000", "120000.00") to integer cents. */
export function parseMoneyCents(v: string | null | undefined): number | null {
  if (!v) return null;
  const cleaned = v.replace(/[^0-9.]/g, '');
  if (!cleaned) return null;
  const dollars = Number(cleaned);
  if (!Number.isFinite(dollars) || dollars < 0) return null;
  return Math.round(dollars * 100);
}

/**
 * Stable dedupe key: county|parcel|normalized-address|owner (lowercased).
 * owner_name is included so distinct owner-only rows (no parcel/address — e.g.
 * some probate lists) don't all collapse to `<county>||` and get dropped.
 */
export function buildDedupeKey(
  county: string | null,
  parcelId: string | null,
  propertyAddress: string | null,
  ownerName: string | null = null
): string {
  const parts = [
    normalizeWhitespace(county).toLowerCase(),
    normalizeWhitespace(parcelId).toLowerCase(),
    normalizeWhitespace(propertyAddress).toLowerCase().replace(/[.,]/g, ''),
    normalizeWhitespace(ownerName).toLowerCase(),
  ];
  return parts.join('|');
}

/** Split one CSV line honoring double-quoted fields. */
export function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

interface HeaderMap {
  byField: Partial<Record<string, number>>;
  contactCols: Set<number>;
  headers: string[];
}

function mapHeaders(headerCells: string[]): HeaderMap {
  const byField: Partial<Record<string, number>> = {};
  const contactCols = new Set<number>();
  headerCells.forEach((h, idx) => {
    if (isContactHeader(h)) {
      contactCols.add(idx); // never persisted
      return;
    }
    for (const m of FIELD_MATCHERS) {
      if (m.re.test(h) && byField[m.field] === undefined) {
        byField[m.field] = idx;
        break;
      }
    }
  });
  return { byField, contactCols, headers: headerCells };
}

export interface ParseOptions {
  sourceRecordType: string; // from the registry (e.g. 'probate')
  sourceCategory: SourcedCategory;
  fallbackCounty?: string | null;
}

/**
 * Parse an uploaded MANUAL_ONLY county file into normalized sourced leads.
 * Contact columns are dropped entirely (compliance). A row with neither an
 * owner name nor any address is a failure (nothing to act on).
 */
export function parseSourcedCsv(text: string, opts: ParseOptions): SourcedParseResult {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const failures: SourcedParseFailure[] = [];
  const rows: NormalizedSourcedLead[] = [];
  if (lines.length < 2) {
    return { rows, failures, totalRows: Math.max(0, lines.length - 1) };
  }

  const headerCells = parseCsvLine(lines[0]);
  const hm = mapHeaders(headerCells);
  const totalRows = lines.length - 1;

  for (let i = 1; i < lines.length; i++) {
    const cells = parseCsvLine(lines[i]);
    const rawFields: Record<string, string> = {};
    headerCells.forEach((h, idx) => {
      if (hm.contactCols.has(idx)) return; // strip contact columns from raw_fields
      const val = scrubContactValues(normalizeWhitespace(cells[idx]));
      if (val) rawFields[h || `col${idx}`] = val;
    });

    const get = (field: string): string | null => {
      const idx = hm.byField[field];
      return idx === undefined ? null : normalizeWhitespace(cells[idx]) || null;
    };

    const ownerName = get('ownerName');
    const propertyAddress = get('propertyAddress');
    const mailingAddress = get('mailingAddress');
    const parcelId = get('parcelId');
    const county = get('county') || (opts.fallbackCounty ? normalizeWhitespace(opts.fallbackCounty) : null);
    const assessedValueCents = parseMoneyCents(get('assessedValueCents'));

    if (!ownerName && !propertyAddress && !parcelId) {
      failures.push({ rowNumber: i, raw: rawFields, reason: 'No owner name, property address, or parcel id' });
      continue;
    }

    const signals = deriveSignals({
      recordType: opts.sourceRecordType,
      category: opts.sourceCategory,
      mailingAddress,
      propertyAddress,
      rawFields,
    });

    rows.push({
      ownerName,
      propertyAddress,
      mailingAddress,
      parcelId,
      county,
      assessedValueCents,
      signals,
      rawFields,
      dedupeKey: buildDedupeKey(county, parcelId, propertyAddress, ownerName),
    });
  }

  return { rows, failures, totalRows };
}

/** Remove rows colliding on dedupeKey within the batch (keep first). */
export function dedupeInBatch(rows: NormalizedSourcedLead[]): {
  unique: NormalizedSourcedLead[];
  duplicates: number;
} {
  const seen = new Set<string>();
  const unique: NormalizedSourcedLead[] = [];
  let duplicates = 0;
  for (const r of rows) {
    if (seen.has(r.dedupeKey)) {
      duplicates++;
    } else {
      seen.add(r.dedupeKey);
      unique.push(r);
    }
  }
  return { unique, duplicates };
}

// ── Signals + scoring ───────────────────────────────────────────────────────

interface SignalCtx {
  recordType: string;
  category: SourcedCategory;
  mailingAddress: string | null;
  propertyAddress: string | null;
  rawFields: Record<string, string>;
}

/** Distress/opportunity signal tags present in the public record (never fabricated). */
export function deriveSignals(ctx: SignalCtx): string[] {
  const signals: string[] = [];
  const rt = ctx.recordType.toLowerCase();
  const blob = Object.values(ctx.rawFields).join(' ').toLowerCase();

  // Motivation stack (sellers)
  if (rt.includes('probate') || /probate|estate|deceased|heir/.test(blob)) signals.push('probate');
  if (rt.includes('tax_delinquent') || /delinquent|tax\s*lien|certificate of delinquency/.test(blob)) signals.push('tax_delinquent');
  if (rt.includes('pre_foreclosure') || rt.includes('foreclosure') || /lis pendens|foreclosure|notice of default/.test(blob)) signals.push('pre_foreclosure');
  if (rt.includes('code') || rt.includes('vacant') || /vacant|condemn|abandon|code violation|nuisance/.test(blob)) signals.push('vacant_or_code');

  // Absentee (mailing ≠ situs) — medium motivation, applies to sellers + buyers
  if (
    ctx.mailingAddress &&
    ctx.propertyAddress &&
    normalizeWhitespace(ctx.mailingAddress).toLowerCase().replace(/[.,]/g, '') !==
      normalizeWhitespace(ctx.propertyAddress).toLowerCase().replace(/[.,]/g, '')
  ) {
    signals.push('absentee');
  }

  // Buyer signals
  if (ctx.category === 'buyer') {
    if (rt.includes('cash') || /cash|no mortgage|no lien/.test(blob)) signals.push('cash_purchase');
    if (rt.includes('repeat') || /llc|holdings|capital|properties|investments/.test(blob)) signals.push('investor_entity');
    if (rt.includes('portfolio') || rt.includes('multi')) signals.push('multi_parcel');
  }

  return signals;
}

const SIGNAL_POINTS: Record<string, number> = {
  probate: 35,
  tax_delinquent: 35,
  pre_foreclosure: 40,
  vacant_or_code: 30,
  absentee: 15,
  cash_purchase: 35,
  investor_entity: 25,
  multi_parcel: 25,
};

const SIGNAL_LABEL: Record<string, string> = {
  probate: 'Probate/estate filing (inherited property)',
  tax_delinquent: 'Tax-delinquent',
  pre_foreclosure: 'Pre-foreclosure / lis pendens',
  vacant_or_code: 'Vacant / code-violation / condemned',
  absentee: 'Absentee owner (mailing ≠ property)',
  cash_purchase: 'Recent cash purchase (no mortgage lien)',
  investor_entity: 'Investor entity (LLC/holdings)',
  multi_parcel: 'Owns multiple parcels (portfolio)',
};

export interface ScoreInput {
  signals: string[];
  assessedValueCents: number | null;
  sourceWeight: number; // 0–100 registry distress_weight
}

export interface ScoreResult {
  score: number; // 0–100 SIGNAL-BASED ESTIMATE
  reasons: string[];
}

/**
 * 0–100 signal-based score. Distinct distress signals COMPOUND (stacking gives
 * diminishing but additive lift); the source's distress_weight scales the base;
 * assessed value is surfaced as an equity/margin proxy (deal room).
 */
export function scoreSourcedLead(input: ScoreInput): ScoreResult {
  const reasons: string[] = [];
  // Order-independent: rank distinct signals by strength so the STRONGEST always
  // gets full value and weaker ones stack at 70% — regardless of array order.
  const distinct = Array.from(new Set(input.signals))
    .filter((s) => (SIGNAL_POINTS[s] ?? 0) > 0)
    .sort((a, b) => (SIGNAL_POINTS[b] ?? 0) - (SIGNAL_POINTS[a] ?? 0));

  let base = 0;
  distinct.forEach((s, i) => {
    const pts = SIGNAL_POINTS[s] ?? 0;
    // Strongest signal full value; each additional stacked signal at 70% (compounding motivation).
    const weighted = i === 0 ? pts : Math.round(pts * 0.7);
    base += weighted;
    if (SIGNAL_LABEL[s]) reasons.push(SIGNAL_LABEL[s]);
  });

  // Scale by source distress weight (registry): a probate source (w90) lifts,
  // a low-signal source (w60) tempers. Weight 80 ≈ neutral.
  const weightFactor = 0.6 + (input.sourceWeight / 100) * 0.5; // 0.6–1.1
  let score = Math.round(base * weightFactor);

  // Equity/margin proxy: having an assessed value = quantifiable deal room.
  if (input.assessedValueCents && input.assessedValueCents > 0) {
    score += 5;
    reasons.push(
      `Assessed value $${(input.assessedValueCents / 100).toLocaleString()} — equity/margin room (est.)`
    );
  }

  if (distinct.length >= 2) {
    reasons.unshift(`Stacked distress: ${distinct.length} signals compound motivation`);
  }

  score = Math.max(0, Math.min(100, score));
  return { score, reasons };
}
