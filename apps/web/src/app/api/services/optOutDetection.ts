/**
 * TCPA compliance: STOP-keyword detection.
 * Must run BEFORE any other inbound processing, on every inbound message.
 */
export const OPT_OUT_PATTERNS = [
  /^stop$/i, /^stopall$/i, /^unsubscribe$/i, /^cancel$/i, /^end$/i, /^quit$/i,
  /^remove me$/i, /^take me off/i, /^do not (text|contact|message)/i,
  /^no thanks?$/i, /^not interested$/i, /^wrong number$/i,
];

export function isOptOutMessage(body: string): boolean {
  return OPT_OUT_PATTERNS.some((p) => p.test(body.trim()));
}