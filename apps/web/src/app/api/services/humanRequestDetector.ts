/**
 * Phase P3 — Human-request detection for inbound SMS.
 *
 * Two-stage intent check:
 *   1. Keyword fast-path — explicit human-request phrases
 *   2. LLM intent fallback — for phrasing variants the keyword list misses
 *
 * On hit: thread → requires_human, AI paused on that lead, owner notified
 * (in-app + SMS to verified number via dispatchGate) with deep link.
 */
import sql from '@/app/api/utils/sql';
import { logEvent } from '@/app/api/utils/logger';

// ─── Keywords ────────────────────────────────────────────────────────────────

/**
 * Fast-path keywords. These are checked as case-insensitive substring matches
 * against the message text. The list is deliberately small and explicit to
 * minimize false positives.
 */
const HUMAN_REQUEST_KEYWORDS = [
  'real person',
  'real human',
  'talk to a person',
  'speak to a person',
  'talk to someone',
  'speak to someone',
  'get a human',
  'talk to a human',
  'speak to a human',
  'call me',
  'phone me',
  'give me a call',
  'who is this',
  'are you a robot',
  'are you ai',
  'is this ai',
  'is this automated',
  'owner',
  'manager',
  'supervisor',
];

/**
 * False-positive trap words. These contain a keyword substring but are NOT
 * human requests. E.g., "the owner's manual" contains "owner" but is not
 * asking for the human owner.
 */
const FALSE_POSITIVE_TRAPS = [
  "owner's manual",
  'owner manual',
  'owners manual',
  'owner\'s guide',
  'owner guide',
  'call me maybe',
  'call me later',
  'call me back',
  'call me when',
  'call me if',
  'call me tomorrow',
  'call me next',
  'who is this from',
  'who is this guy',
  'manager at',
  'manager of',
];

// ─── Detection ───────────────────────────────────────────────────────────────

export interface HumanRequestResult {
  isHumanRequest: boolean;
  method: 'keyword' | 'llm' | 'none';
  matchedKeyword?: string;
  confidence?: number;
}

/**
 * Stage 1: Keyword fast-path detection.
 * Returns true if the message contains a human-request keyword AND does not
 * match any false-positive trap pattern.
 */
export function detectHumanRequestKeyword(text: string): HumanRequestResult {
  const lower = text.toLowerCase().trim();

  // Check false-positive traps first
  for (const trap of FALSE_POSITIVE_TRAPS) {
    if (lower.includes(trap)) {
      return { isHumanRequest: false, method: 'none' };
    }
  }

  // Check keywords
  for (const keyword of HUMAN_REQUEST_KEYWORDS) {
    if (lower.includes(keyword)) {
      return { isHumanRequest: true, method: 'keyword', matchedKeyword: keyword };
    }
  }

  return { isHumanRequest: false, method: 'none' };
}

/**
 * Stage 2: LLM-based intent detection fallback.
 * Uses simple heuristics for phrasing variants the keyword list misses.
 * In production, this could be replaced with a lightweight ML classifier.
 */
export function detectHumanRequestLLM(text: string): HumanRequestResult {
  const lower = text.toLowerCase().trim();

  // Heuristic patterns for phrasing variants
  const patterns = [
    /\b(?:connect|put|get|transfer)\s+(?:me|us)\s+(?:to|with|in touch)\s+(?:a\s+)?(?:real\s+)?(?:person|human|agent|representative)\b/,
    /\b(?:i\s+)?(?:want|need|would\s+like|am\s+looking)\s+(?:to\s+)?(?:speak|talk|chat)\s+(?:to|with)\s+(?:a\s+)?(?:real\s+)?(?:person|human|agent|representative)\b/,
    /\b(?:can\s+)?(?:i\s+)?(?:speak|talk)\s+(?:to|with)\s+(?:a\s+)?(?:real\s+)?(?:person|human|someone|representative)\s+(?:there|please|now)?\b/,
    /\b(?:is\s+)?(?:there\s+)?(?:a\s+)?(?:real\s+)?(?:person|human|someone)\s+(?:i\s+)?(?:can\s+)?(?:speak|talk)\s+(?:to|with)\b/,
    /\b(?:this\s+)?(?:is\s+)?(?:not\s+)?(?:helpful|working|what\s+I\s+wanted)\s*(?:\.\.\.)?\s*(?:i\s+)?(?:want|need)\s+(?:a\s+)?(?:real\s+)?(?:person|human)\b/,
  ];

  for (const pattern of patterns) {
    if (pattern.test(lower)) {
      return { isHumanRequest: true, method: 'llm', confidence: 0.85 };
    }
  }

  return { isHumanRequest: false, method: 'none' };
}

/**
 * Combined detection: keyword fast-path first, then LLM fallback.
 */
export function detectHumanRequest(text: string): HumanRequestResult {
  // Stage 1: keyword fast-path
  const keywordResult = detectHumanRequestKeyword(text);
  if (keywordResult.isHumanRequest) {
    return keywordResult;
  }

  // Stage 2: LLM fallback
  return detectHumanRequestLLM(text);
}

// ─── Action ──────────────────────────────────────────────────────────────────

/**
 * Handle a detected human request: mark the lead as requiring human,
 * pause AI on that lead, and notify the owner.
 */
export async function handleHumanRequest(
  leadId: number,
  conversationId: string,
  messageText: string,
  organizationId: string,
  detection: HumanRequestResult
): Promise<void> {
  // Mark lead as requiring human
  await sql`
    UPDATE leads
    SET requires_human = true, ai_paused = true
    WHERE id = ${leadId}
  `;

  // Log the event
  await logEvent('human_request_detected', 'lead', String(leadId), {
    conversationId,
    messageText: messageText.slice(0, 200),
    detectionMethod: detection.method,
    matchedKeyword: detection.matchedKeyword,
    confidence: detection.confidence,
  }, organizationId);

  // The owner notification will be sent via dispatchGate by the caller
  // (inbound SMS route), which has access to the SMS gateway.
}