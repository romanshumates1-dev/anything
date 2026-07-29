/**
 * emailReply — strip the quoted original from an inbound email reply.
 *
 * WHY THIS IS NOT COSMETIC
 * Every mail client appends the message being replied to. If that quoted block
 * reaches the conversation thread, two concrete failures follow:
 *
 *  1. OUR OWN WORDS become the prospect's turn. The negotiator then reads its
 *     previous message back as if the seller had said it, and reasons against
 *     a fabricated statement.
 *  2. Keyword detection fires on OUR footer. Every compliant outbound email
 *     ends with "reply STOP to opt out" — quoted back, an opt-out detector sees
 *     "STOP" and unsubscribes someone who was actually replying with interest.
 *     That is a silent, permanent loss of a warm lead.
 *
 * So this runs BEFORE opt-out detection and before anything is persisted.
 *
 * Deliberately heuristic, and deliberately conservative: there is no reliable
 * standard for reply delimiters (RFC 5322 says nothing about them), so each
 * pattern here is one observed in the wild. When no marker is found the text is
 * returned UNCHANGED — over-stripping would delete a real reply, which is worse
 * than under-stripping, where the cost is only noise.
 */

/**
 * Ordered by confidence. The earliest match in the text wins, so a reply that
 * happens to contain several markers is cut at the first one.
 */
const QUOTE_MARKERS: RegExp[] = [
  // Gmail / Apple Mail / Outlook English: "On <date>, <someone> wrote:"
  /^\s*On .{5,120}\bwrote:\s*$/im,
  // Outlook block header
  /^\s*-{2,}\s*Original Message\s*-{2,}\s*$/im,
  /^\s*_{5,}\s*$/m,
  // Outlook field header ("From: x  Sent: y  To: z")
  /^\s*From:\s.+$/im,
  // Common client separators
  /^\s*-{2,}\s*Forwarded message\s*-{2,}\s*$/im,
  /^\s*Sent from my \w+/im,
  // Our own CAN-SPAM footer separator (mailDriver/emailDriver emit "---")
  /^\s*-{3,}\s*$/m,
];

/** Lines beginning with '>' are quoted material in every client that uses them. */
function stripLeadingQuoteChars(text: string): string {
  const lines = text.split(/\r?\n/);
  const kept: string[] = [];
  for (const line of lines) {
    if (/^\s*>/.test(line)) continue;
    kept.push(line);
  }
  return kept.join('\n');
}

/**
 * Return only the newly-written portion of a reply.
 *
 * Returns the input unchanged when nothing looks like a quote — see the module
 * note on why under-stripping is the safe failure.
 */
export function stripQuotedReply(raw: string | null | undefined): string {
  if (!raw) return '';
  let text = String(raw).replace(/\r\n/g, '\n');

  // Cut at the earliest recognised marker.
  let cutAt = -1;
  for (const re of QUOTE_MARKERS) {
    const m = re.exec(text);
    if (m && m.index !== undefined) {
      cutAt = cutAt === -1 ? m.index : Math.min(cutAt, m.index);
    }
  }
  if (cutAt > -1) text = text.slice(0, cutAt);

  text = stripLeadingQuoteChars(text);

  // Collapse the trailing blank lines a cut leaves behind, but preserve
  // internal structure — a multi-paragraph reply is still one reply.
  return text.replace(/\n{3,}/g, '\n\n').trim();
}
