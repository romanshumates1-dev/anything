/**
 * Pure, testable ingestion logic for bulk lead import.
 * No DB access here — this module only parses, validates, and dedupes so it
 * can be unit-tested deterministically.
 */

export const MAX_IMPORT_ROWS = 10000;
export const INSERT_CHUNK_SIZE = 500;

export type LeadType = 'seller' | 'buyer';

export type ParsedLead = {
  name: string;
  type: LeadType;
  phone: string | null;
  email: string | null;
  source: string;
  dedupeHash: string;
  rowNumber: number;
};

export type ImportFailure = {
  rowNumber: number;
  raw: Record<string, string>;
  reason: string;
};

export type ParseResult = {
  valid: ParsedLead[];
  failures: ImportFailure[];
  totalRows: number;
};

const HEADER_ALIASES: Record<string, string> = {
  name: 'name',
  'full name': 'name',
  'lead name': 'name',
  company: 'name',
  type: 'type',
  'lead type': 'type',
  phone: 'phone',
  'phone number': 'phone',
  mobile: 'phone',
  cell: 'phone',
  email: 'email',
  'email address': 'email',
  source: 'source',
};

/** Normalize a phone to digits only (keeps a leading +). Returns '' if none. */
export function normalizePhone(phone: string | null | undefined): string {
  if (!phone) return '';
  const trimmed = String(phone).trim();
  const hasPlus = trimmed.startsWith('+');
  const digits = trimmed.replace(/[^0-9]/g, '');
  if (!digits) return '';
  return (hasPlus ? '+' : '') + digits;
}

export function normalizeEmail(email: string | null | undefined): string {
  if (!email) return '';
  return String(email).trim().toLowerCase();
}

/**
 * Deterministic dedupe hash. Prefers phone, falls back to email. This is an
 * identity key (not cryptographic) — equal contacts produce equal hashes.
 */
export function dedupeHash(phone: string | null, email: string | null): string {
  const p = normalizePhone(phone);
  if (p) return `phone:${p}`;
  const e = normalizeEmail(email);
  if (e) return `email:${e}`;
  return '';
}

/** Parse a single CSV line, honoring double-quoted fields with embedded commas. */
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

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/**
 * Parse CSV (or pasted) text into validated leads + per-row failures.
 * Enforces MAX_IMPORT_ROWS. A header row is auto-detected.
 */
export function parseLeadsCsv(text: string, defaultType: LeadType = 'seller'): ParseResult {
  const failures: ImportFailure[] = [];
  const valid: ParsedLead[] = [];

  const lines = String(text || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length === 0) {
    return { valid, failures, totalRows: 0 };
  }

  // Detect header: first line contains a known header token and no digits-only phone.
  const firstCols = parseCsvLine(lines[0]).map((c) => c.toLowerCase());
  const hasHeader = firstCols.some((c) => c in HEADER_ALIASES);

  let columnMap: Record<number, string> = {};
  let startIndex = 0;
  if (hasHeader) {
    firstCols.forEach((c, i) => {
      if (c in HEADER_ALIASES) columnMap[i] = HEADER_ALIASES[c];
    });
    startIndex = 1;
  } else {
    // No header: assume name,phone,email,type ordering.
    columnMap = { 0: 'name', 1: 'phone', 2: 'email', 3: 'type' };
  }

  const dataLines = lines.slice(startIndex);
  const totalRows = dataLines.length;

  if (totalRows > MAX_IMPORT_ROWS) {
    // Caller decides what to do; we still report the overflow as a single failure.
    failures.push({
      rowNumber: 0,
      raw: {},
      reason: `Import exceeds ${MAX_IMPORT_ROWS} row limit (${totalRows} rows)`,
    });
    return { valid, failures, totalRows };
  }

  dataLines.forEach((line, i) => {
    const rowNumber = startIndex + i + 1;
    const cols = parseCsvLine(line);
    const raw: Record<string, string> = {};
    Object.entries(columnMap).forEach(([idx, field]) => {
      raw[field] = cols[Number(idx)] ?? '';
    });

    const name = (raw.name || '').trim();
    const phone = normalizePhone(raw.phone) || null;
    const email = normalizeEmail(raw.email) || null;
    let type = (raw.type || '').trim().toLowerCase();
    if (type !== 'seller' && type !== 'buyer') type = defaultType;

    if (!name) {
      failures.push({ rowNumber, raw, reason: 'Missing name' });
      return;
    }
    if (!phone && !email) {
      failures.push({ rowNumber, raw, reason: 'Missing both phone and email' });
      return;
    }
    if (email && !isValidEmail(email)) {
      failures.push({ rowNumber, raw, reason: `Invalid email: ${email}` });
      return;
    }

    valid.push({
      name,
      type: type as LeadType,
      phone,
      email,
      source: 'import',
      dedupeHash: dedupeHash(phone, email),
      rowNumber,
    });
  });

  return { valid, failures, totalRows };
}

/** Remove rows that collide on dedupeHash within the same batch (keep first). */
export function dedupeInBatch(leads: ParsedLead[]): {
  unique: ParsedLead[];
  duplicates: ParsedLead[];
} {
  const seen = new Set<string>();
  const unique: ParsedLead[] = [];
  const duplicates: ParsedLead[] = [];
  for (const lead of leads) {
    if (lead.dedupeHash && seen.has(lead.dedupeHash)) {
      duplicates.push(lead);
    } else {
      if (lead.dedupeHash) seen.add(lead.dedupeHash);
      unique.push(lead);
    }
  }
  return { unique, duplicates };
}

/** Split an array into chunks of `size` for batch DB insertion. */
export function chunk<T>(arr: T[], size: number = INSERT_CHUNK_SIZE): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}
