/**
 * mailExport — print-ready batch generation + per-piece tracking codes.
 *
 * Direct mail has no delivery receipt and no reply-to. A postcard that lands
 * is indistinguishable from one that never printed, so attribution has to be
 * MANUFACTURED: a unique code printed on each piece, quoted back by the
 * prospect or carried in a per-campaign short URL.
 *
 * Without this, a mail run is unmeasurable — you learn that N pieces cost $X
 * and that some calls arrived, with no way to connect the two. That is the
 * difference between a campaign and an expense.
 */

/**
 * Unambiguous-when-read-aloud alphabet. Excludes 0/O, 1/I/L, 2/Z, 5/S, 8/B.
 *
 * This is not fussiness: the code's entire job is to survive being read off a
 * postcard by a stranger and typed or spoken back. A code containing both O
 * and 0 fails at exactly the moment it is supposed to work, and the failure is
 * invisible — the lookup just misses and the response is attributed to nothing.
 */
const CODE_ALPHABET = '34679ACDEFGHJKMNPQRTUVWXY';
const CODE_LEN = 6;

/**
 * Generate a tracking code. `rand` is injectable so tests are deterministic
 * without stubbing globals.
 *
 * 25^6 ≈ 244M combinations. Collisions are still possible, so the DB carries a
 * UNIQUE constraint and the caller retries — this function is not the
 * uniqueness guarantee, the index is.
 */
export function generateTrackingCode(rand: () => number = Math.random): string {
  let out = '';
  for (let i = 0; i < CODE_LEN; i++) {
    out += CODE_ALPHABET[Math.floor(rand() * CODE_ALPHABET.length)];
  }
  return out;
}

/** Normalise user-quoted codes: strip spacing/dashes, upper-case, map look-alikes. */
export function normalizeTrackingCode(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const cleaned = String(raw)
    .toUpperCase()
    .replace(/[\s-]/g, '')
    // Map the characters a human most plausibly substitutes for excluded ones.
    .replace(/[O]/g, '0')
    .replace(/[IL]/g, '1')
    .replace(/0/g, 'Q') // 0 is not in the alphabet; nearest visual is Q
    .replace(/1/g, 'J')
    .replace(/[SZ]/g, '5')
    .replace(/5/g, 'X')
    .replace(/B/g, '6');
  const onlyValid = cleaned.split('').filter((c) => CODE_ALPHABET.includes(c)).join('');
  return onlyValid.length === CODE_LEN ? onlyValid : null;
}

export interface MailPieceRow {
  trackingCode: string;
  recipientName: string;
  mailingAddress: string;
  leadId: number | null;
  unitCostCents: number;
}

/**
 * RFC 4180 CSV field. Print vendors reject malformed rows for a whole batch,
 * so quoting is unconditional rather than only-when-needed — a comma inside an
 * address is the common case here, not an edge case.
 */
function csvField(v: string | number | null | undefined): string {
  const s = v === null || v === undefined ? '' : String(v);
  return `"${s.replace(/"/g, '""')}"`;
}

export const MAIL_CSV_HEADERS = [
  'tracking_code',
  'recipient_name',
  'mailing_address',
  'lead_id',
  'unit_cost_cents',
  'cta',
] as const;

/**
 * Build the print-ready CSV.
 *
 * The CTA column carries the per-campaign call-to-action with the piece's own
 * code already interpolated, so the print vendor merges ONE field rather than
 * assembling it — every assembly step at the vendor is a place the code and
 * the address can desynchronise across rows.
 */
export function buildMailCsv(
  pieces: MailPieceRow[],
  opts: { ctaTemplate?: string } = {}
): string {
  const template = opts.ctaTemplate ?? 'Call 555-0100 and mention code {CODE}';
  const lines = [MAIL_CSV_HEADERS.join(',')];
  for (const p of pieces) {
    lines.push(
      [
        csvField(p.trackingCode),
        csvField(p.recipientName),
        csvField(p.mailingAddress),
        csvField(p.leadId),
        csvField(p.unitCostCents),
        csvField(template.replace(/\{CODE\}/g, p.trackingCode)),
      ].join(',')
    );
  }
  // Trailing newline: some vendor parsers drop the final record without it.
  return lines.join('\n') + '\n';
}

export interface BatchSummary {
  pieces: number;
  totalCostCents: number;
  totalCostUsd: number;
  duplicateCodes: number;
}

/**
 * Summarise a batch for the operator before it is sent to print.
 *
 * duplicateCodes must be zero. A duplicate silently merges two prospects into
 * one attribution bucket, and the error is undetectable after the fact — the
 * response looks legitimate and is credited to the wrong piece.
 */
export function summarizeBatch(pieces: MailPieceRow[]): BatchSummary {
  const seen = new Set<string>();
  let duplicateCodes = 0;
  let totalCostCents = 0;
  for (const p of pieces) {
    if (seen.has(p.trackingCode)) duplicateCodes++;
    seen.add(p.trackingCode);
    totalCostCents += p.unitCostCents;
  }
  return {
    pieces: pieces.length,
    totalCostCents,
    totalCostUsd: Math.round(totalCostCents) / 100,
    duplicateCodes,
  };
}
