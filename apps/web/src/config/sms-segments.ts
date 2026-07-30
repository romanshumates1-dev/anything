/**
 * SMS segment counting (Gap G-5) — how many billable segments a message body is.
 *
 * GSM-7 packs 160 chars into a single segment, 153 per segment when concatenated
 * (7 chars of the multipart header). A handful of GSM chars (^{}\[~]|€) take two
 * septets. Any character outside GSM-7 forces UCS-2: 70 per single segment, 67
 * when concatenated. This is the count carriers bill and the number we meter.
 */
const GSM7_BASIC =
  '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞ ÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?' +
  '¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà';
const GSM7_EXTENSION = '^{}\\[~]|€';

function isGsm7(text: string): boolean {
  for (const ch of text) {
    if (!GSM7_BASIC.includes(ch) && !GSM7_EXTENSION.includes(ch)) return false;
  }
  return true;
}

function gsm7Septets(text: string): number {
  let n = 0;
  for (const ch of text) n += GSM7_EXTENSION.includes(ch) ? 2 : 1;
  return n;
}

export interface SegmentInfo {
  encoding: 'GSM-7' | 'UCS-2';
  units: number; // septets (GSM-7) or UTF-16 code units (UCS-2)
  segments: number;
}

export function smsSegmentInfo(text: string): SegmentInfo {
  if (text.length === 0) return { encoding: 'GSM-7', units: 0, segments: 0 };
  if (isGsm7(text)) {
    const units = gsm7Septets(text);
    const segments = units <= 160 ? 1 : Math.ceil(units / 153);
    return { encoding: 'GSM-7', units, segments };
  }
  // UCS-2: count UTF-16 code units (JS string length), which is what carriers bill.
  const units = text.length;
  const segments = units <= 70 ? 1 : Math.ceil(units / 67);
  return { encoding: 'UCS-2', units, segments };
}

/** Billable segment count for a message body (min 1 for any non-empty text). */
export function smsSegmentCount(text: string): number {
  return smsSegmentInfo(text).segments;
}
