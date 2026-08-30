import { logEvent } from './logger';
import { buildSupervisorPrompt } from './ai-sales-prompt';
import {
  callAI,
  AnthropicClientError,
  type AnthropicMessage,
} from './ai-provider';

// High-risk topics that ALWAYS require human approval before any outbound send,
// regardless of what the model returns. This is the server-side safety net for
// the "human approval required before offers/contracts/assignments" rule.
const HIGH_RISK_PATTERNS: RegExp[] = [
  /\boffers?\b/i,
  /\bprice\b/i,
  /\bpricing\b/i,
  /\bcontract\b/i,
  /\bsign(ed|ing)?\b/i,
  /\bassign(ment|ed|ing)?\b/i,
  /\bpurchase\b/i,
  /\bclosing\b/i,
  /\bearnest\b/i,
  /\bdeposit\b/i,
  /\$\s?\d/,
  /\b\d+\s?%/,
  // P3 escalation-invariant corpus classes (owner-mandated). Price talk that
  // carries NO digits must escalate too — the dangerous classes are spelled-out
  // amounts ("ninety grand"), k-suffix ("87.5k"), bare figures ("87500"),
  // contract talk with zero digits ("send the paperwork, let's close"), and
  // confirmation-extraction ("so we're agreed at $87,500, right?").
  // Posture: false positives escalate to a human (safe); false negatives let
  // the AI negotiate (never). Loosen deliberately, not by accident.
  // Match 4-7 digit numbers but exclude common address patterns (e.g., "12345 Main St")
  // Negative lookahead excludes numbers followed by common street suffixes
  /\b\d{4,7}(?!\s*(?:st|street|ave|avenue|rd|road|dr|drive|blvd|boulevard|ct|court|ln|lane|way|pl|place|cir|circle)\b)/i,
  /\b\d+(?:\.\d+)?\s?k\b/i, // "90k", "87.5k"
  /\b(?:grand|figures?)\b/i, // "ninety grand", "six figures"
  /\b(?:take|pay|accept|want|give|offer(?:ing)?|asking|settle\s+for)\s+(?:(?:about|around|at\s+least|less\s+than|more\s+than|under|over|maybe|like)\s+)*(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million)\b/i, // "I'd take ninety", "take less than one hundred"
  // Spelled tens-and-up number words escalate ANYWHERE — the P3 fuzz found
  // verb-anchored patterns miss "give me seventy five", "meet me at ninety",
  // "lock it in at ninety five". Ones-words (one..ten) stay out: "one thing",
  // "call you in two" are everyday speech; tens-words in seller texts are
  // near-always money. Over-escalation is the safe direction.
  /\b(?:twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million)\b/i,
  /\b(?:paperwork|papers|documents?|docs)\b/i, // "send the paperwork"
  /\bclose\b/i, // "let's close" (the old \bclosing\b missed it)
  /\bagreed?\b/i, // "so we're agreed at ..., right?"
];

export function detectHighRisk(text: unknown): boolean {
  if (typeof text !== 'string' || text.length === 0) return false;
  return HIGH_RISK_PATTERNS.some((re) => re.test(text));
}

export interface AIDecision {
  response_text: string;
  confidence_score: number;
  requires_human: boolean;
  suggested_action: string;
  internal_reasoning: string;
}

function clampConfidence(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

/**
 * Call the Anthropic Messages API (Claude) to orchestrate the next AI reply.
 *
 * Uses native fetch against https://api.anthropic.com/v1/messages — no SDK
 * dependency. The API key is read from ANTHROPIC_API_KEY (server-side only,
 * never NEXT_PUBLIC_*). When the key is missing the function throws immediately
 * rather than silently falling through to a 401 from Anthropic.
 *
 * The conversation history is forwarded as-is; the system prompt instructs
 * Claude to return a JSON object matching the AIDecision interface.
 */
export async function orchestrateAIResponse(leadId: number, history: any[]): Promise<AIDecision> {
  // Sales-optimized supervisor prompt (rapport + objection handling + closing),
  // a strict superset of the original guardrails. The server-side detectHighRisk
  // net + confidence gate below remain the hard escalation controls regardless
  // of what the model returns.
  const systemPrompt = buildSupervisorPrompt();

  // Filter history to only user/assistant roles the Messages API accepts.
  const messages: AnthropicMessage[] = history
    .filter((m: any) => m.role === 'user' || m.role === 'assistant')
    .map((m: any) => ({ role: m.role, content: m.content }));

  try {
    const result = await callAI({
      messages,
      system: systemPrompt,
      json: true, // orchestrator always expects a strict JSON decision (forces Ollama format:json)
    });

    // Parse the JSON decision from the model's text output.
    let parsed: any;
    try {
      // Strip markdown code fences if the model wraps in ```json ... ```
      const cleaned = result.text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
      parsed = JSON.parse(cleaned);
    } catch {
      throw new Error('AI Orchestration returned non-JSON content');
    }

    // Validate + normalize the model output so downstream code can trust it.
    const responseText = typeof parsed.response_text === 'string' ? parsed.response_text : '';
    if (responseText.trim().length === 0) {
      throw new Error('AI Orchestration returned an empty response_text');
    }

    const confidence = clampConfidence(parsed.confidence_score);
    const modelRequiresHuman = parsed.requires_human === true;

    const decision: AIDecision = {
      response_text: responseText,
      confidence_score: confidence,
      // Force human review if the model is unsure or asked for it.
      // Threshold raised from 0.8 to 0.85 for negotiation contexts where
      // bad responses damage deals. At 0.85, only 15% of AI decisions may be
      // uncertain vs 20% at 0.8 - significant for deal-sensitive contexts.
      requires_human: modelRequiresHuman || confidence < 0.85,
      suggested_action:
        typeof parsed.suggested_action === 'string' ? parsed.suggested_action : 'reply',
      internal_reasoning:
        typeof parsed.internal_reasoning === 'string' ? parsed.internal_reasoning : '',
    };

    await logEvent('ai_orchestration', 'lead', leadId.toString(), {
      confidence: decision.confidence_score,
      requiresHuman: decision.requires_human,
      historyLength: history.length,
    });

    return decision;
  } catch (error: any) {
    const message = error instanceof AnthropicClientError ? error.message : String(error.message);
    await logEvent('ai_orchestration_error', 'lead', leadId.toString(), { error: message });
    throw error;
  }
}
