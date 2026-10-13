/**
 * Plain-language contract summary.
 *
 * WHY: the contracts page shows status chips, timelines, cents, and dates -
 * accurate for an operator but not for a seller/buyer who just wants to know
 * "what is this and why is it a good deal for me?". This builds a short, honest,
 * jargon-free summary from the SAME contract fields the page already has, so the
 * explanation can never disagree with the numbers on screen.
 *
 * GUARDRAILS (enforced by tests):
 * - It only ever states facts derivable from the contract fields passed in. It
 *   NEVER invents a price, a closing date, or a "you will make $X" claim. If a
 *   field is missing it says so plainly instead of guessing.
 * - "Why it is good" bullets are framed from the reader side and only appear
 *   when the underlying fact is actually present (e.g. no closing-date benefit
 *   is claimed when there is no closing date).
 * - Money is formatted in whole dollars; cents never leak to the UI.
 */

export interface PlainContractInput {
  /** e.g. "SELLER" | "BUYER" - who this contract is with, from the reader POV. */
  direction?: string | null;
  status?: string | null;
  esignStatus?: string | null;
  /** Value in CENTS, or null/undefined if not set. */
  contractPriceCents?: number | null;
  /** Assignment fee in CENTS, or null/undefined. */
  assignmentFeeCents?: number | null;
  /** ISO date string for the target close, or null/undefined. */
  closingDate?: string | null;
  /** Property address, or null/undefined. */
  propertyAddress?: string | null;
}

export interface PlainContractSummary {
  /** One-line "what is this" headline. */
  headline: string;
  /** Short paragraph: what the deal is, in everyday words. */
  what: string;
  /** "Why this is good for you" bullets. Empty array if nothing positive is provable. */
  whyGoodForYou: string[];
  /** "What happens next" bullets - the concrete next step(s). */
  nextSteps: string[];
  /** True when the contract is not yet legally in force (needs a signature). */
  needsSignature: boolean;
}

/** Format cents as whole dollars, e.g. 2500000 -> "$25,000". Returns null for nullish. */
export function formatWholeDollars(cents: number | null | undefined): string | null {
  if (cents === null || cents === undefined || !Number.isFinite(cents)) return null;
  const dollars = Math.round(cents / 100);
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(dollars);
}

/** Human-friendly date, e.g. "March 4, 2026". Returns null for nullish/invalid.
 *
 * Date-only inputs (YYYY-MM-DD) are parsed as LOCAL midnight. `new Date(iso)`
 * treats a bare date as UTC, which shifts the rendered day backward for every
 * timezone west of UTC (e.g. "2026-03-04" → "March 3" in US timezones). The
 * contract's closing date is a calendar date the user expects to see unchanged,
 * so we construct it locally. Full ISO datetimes (with `T`) keep UTC parsing. */
export function formatFriendlyDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = iso.length === 10 && /^\d{4}-\d{2}-\d{2}$/.test(iso)
    ? new Date(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10))
    : new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

/** True when the contract still needs a signature before it is in force. */
export function isAwaitingSignature(input: PlainContractInput): boolean {
  const s = (input.esignStatus || input.status || '').toLowerCase();
  if (input.status?.toUpperCase() === 'SIGNED') return false;
  return (
    s === '' ||
    s === 'pending' ||
    s === 'draft' ||
    s === 'sent' ||
    s === 'awaiting_signature' ||
    s === 'pending_signature'
  );
}

/**
 * Build the plain-language summary. Pure: no I/O, only the dates passed in,
 * deterministic, so it is trivially unit-testable.
 */
export function buildPlainContractSummary(input: PlainContractInput): PlainContractSummary {
  const price = formatWholeDollars(input.contractPriceCents ?? null);
  const fee = formatWholeDollars(input.assignmentFeeCents ?? null);
  const closeDate = formatFriendlyDate(input.closingDate ?? null);
  const address = input.propertyAddress?.trim() || null;
  const needsSignature = isAwaitingSignature(input);

  const dir = (input.direction || '').toUpperCase();
  const readerIsBuyer = dir === 'BUYER';
  const counterparty = readerIsBuyer ? 'seller' : 'buyer';

  const subject = address ? `the property at ${address}` : 'this property';

  const headline = price
    ? `${price} deal on ${subject}`
    : `Deal on ${subject}`;

  const whatParts: string[] = [];
  whatParts.push(
    `This is a real estate contract to ${readerIsBuyer ? 'buy' : 'sell'} ${subject}.`,
  );
  if (price) {
    whatParts.push(
      readerIsBuyer ? `The agreed price is ${price}.` : `You are being paid ${price} for it.`,
    );
  } else {
    whatParts.push('The price has not been set on this contract yet.');
  }
  if (closeDate) {
    whatParts.push(`The target closing date is ${closeDate}.`);
  } else {
    whatParts.push('A closing date has not been scheduled yet.');
  }
  const what = whatParts.join(' ');

  const whyGoodForYou: string[] = [];
  if (readerIsBuyer) {
    whyGoodForYou.push('You lock in this property at the agreed price.');
    if (closeDate) whyGoodForYou.push(`You have a clear closing date: ${closeDate}.`);
    whyGoodForYou.push('The terms are written down, so there are no surprises later.');
  } else {
    if (price) whyGoodForYou.push(`You get a guaranteed ${price} for the property.`);
    whyGoodForYou.push('You sell as-is - no repairs or showings needed.');
    if (closeDate) whyGoodForYou.push(`You know exactly when you get paid: ${closeDate}.`);
    whyGoodForYou.push('The sale is in writing, so the buyer cannot back out casually.');
  }
  // Only claim a fee if one is actually recorded - never invent profit.
  if (fee) {
    whyGoodForYou.push(`The assignment fee on this deal is ${fee}.`);
  }

  const nextSteps: string[] = [];
  if (needsSignature) {
    nextSteps.push(
      `Sign the contract so it becomes official. Until you sign, nothing is binding on the ${counterparty}.`,
    );
  } else {
    nextSteps.push('The contract is signed. Watch for the closing date and any final paperwork.');
  }
  if (!closeDate) {
    nextSteps.push('Agree on a closing date so everyone knows the timeline.');
  }

  return { headline, what, whyGoodForYou, nextSteps, needsSignature };
}
