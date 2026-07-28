/**
 * evalHarness — replay real transcripts against prompt variants, offline.
 *
 * This is the loop that improves the negotiator while carrier registration is
 * pending. It needs no A2P, no campaign approval, and no recipient: every
 * comparison happens against transcripts already in the database.
 *
 * COST DISCIPLINE IS THE DESIGN, not an optimisation.
 *   1. Generate a candidate per (transcript × variant).
 *   2. Score HARD, free — drop disqualified candidates.
 *   3. Judge only survivors.
 * A sweep of 40 transcripts × 5 variants is 200 candidates; at an 8% leak rate
 * step 2 removes 16 judge calls that could only ever return "disqualified".
 * The saving compounds with every variant added, which is exactly when a sweep
 * gets expensive.
 *
 * SEAM, NOT A PROVIDER. Both generation and judging go through callAnthropic,
 * the client the product already uses. Pointing AI_PROVIDER/ANTHROPIC_BASE_URL
 * at Bedrock moves this whole harness onto credits with no change here —
 * consistent with the mail/email provider seams.
 *
 * THE JUDGE NEVER SEES THE VARIANT ID. Prompt-variant labels are stripped
 * before judging so the judge cannot prefer "v2-improved" over "v1-baseline"
 * on the name alone. Blind comparison is the whole point of an offline sweep.
 */
import { callAnthropic } from '@/app/api/utils/anthropic-client';
import {
  scoreHard,
  judgeWorthy,
  summarizeVariants,
  type CandidateResult,
  type JudgeScore,
  type RubricContext,
  type VariantSummary,
} from '@/app/api/utils/evalRubric';

export interface PromptVariant {
  id: string;
  /** System prompt under test. */
  system: string;
}

export interface EvalTranscript {
  id: string;
  /** Conversation so far, oldest first. */
  history: Array<{ role: 'user' | 'assistant'; content: string }>;
}

export interface SweepOptions extends RubricContext {
  /** Hard ceiling on judge calls, so a sweep cannot run away with spend. */
  maxJudgeCalls?: number;
  /** Skip the paid judge entirely — compliance-only sweep. Free. */
  hardOnly?: boolean;
}

export interface SweepReport {
  candidates: number;
  judged: number;
  skippedAsDisqualified: number;
  judgeCallsSaved: number;
  summaries: VariantSummary[];
  /** Best COMPLIANT variant by mean quality; null when nothing qualified. */
  winner: string | null;
}

const JUDGE_SYSTEM = `You score a single candidate reply from a real-estate acquisition assistant.
Return ONLY compact JSON: {"relevance":0-1,"advancesConversation":0-1,"likelyToGetReply":0-1}.
Score the reply on its merits alone. Do not reward or penalise length, and do
not comment. No prose, no markdown fences.`;

/** Parse the judge's JSON defensively — a malformed score must not abort a sweep. */
export function parseJudgeScore(text: string): JudgeScore | null {
  if (!text) return null;
  // Tolerate a fenced or prose-wrapped payload by taking the first JSON object.
  const match = text.match(/\{[\s\S]*?\}/);
  if (!match) return null;
  try {
    const raw = JSON.parse(match[0]) as Record<string, unknown>;
    const num = (v: unknown): number | null => {
      const n = typeof v === 'number' ? v : Number(v);
      return Number.isFinite(n) && n >= 0 && n <= 1 ? n : null;
    };
    const relevance = num(raw.relevance);
    const advancesConversation = num(raw.advancesConversation);
    const likelyToGetReply = num(raw.likelyToGetReply);
    if (relevance === null || advancesConversation === null || likelyToGetReply === null) {
      return null;
    }
    return { relevance, advancesConversation, likelyToGetReply };
  } catch {
    return null;
  }
}

/** Generate one candidate reply for a transcript under a variant's system prompt. */
export async function generateCandidate(
  variant: PromptVariant,
  transcript: EvalTranscript
): Promise<string> {
  const res = await callAnthropic({
    system: variant.system,
    messages: transcript.history.map((m) => ({ role: m.role, content: m.content })),
    maxTokens: 512,
  });
  return (res.text ?? '').trim();
}

/** Judge one candidate. Returns null on any malformed or failed response. */
export async function judgeCandidate(candidateText: string): Promise<JudgeScore | null> {
  try {
    const res = await callAnthropic({
      system: JUDGE_SYSTEM,
      // No variant id, no transcript id — the judge scores text, blind.
      messages: [{ role: 'user', content: candidateText }],
      maxTokens: 128,
    });
    return parseJudgeScore(res.text ?? '');
  } catch {
    return null;
  }
}

/**
 * Run a full sweep.
 *
 * A generation failure yields an empty candidate, which the hard rubric
 * disqualifies as empty — so a flaky model degrades the variant's compliance
 * rate rather than throwing away the entire sweep. That is deliberate: losing
 * 199 good results to one bad call is the worse failure.
 */
export async function runSweep(
  variants: PromptVariant[],
  transcripts: EvalTranscript[],
  opts: SweepOptions = {}
): Promise<SweepReport> {
  if (variants.length === 0 || transcripts.length === 0) {
    return {
      candidates: 0,
      judged: 0,
      skippedAsDisqualified: 0,
      judgeCallsSaved: 0,
      summaries: [],
      winner: null,
    };
  }

  const rubricCtx: RubricContext = {
    approvedOfferCents: opts.approvedOfferCents,
    isFirstTouch: opts.isFirstTouch,
    channel: opts.channel,
  };

  // ── 1-2. Generate + hard-score. Free after generation.
  const results: CandidateResult[] = [];
  const textById = new Map<string, string>();
  for (const variant of variants) {
    for (const transcript of transcripts) {
      let text = '';
      try {
        text = await generateCandidate(variant, transcript);
      } catch {
        text = ''; // disqualified as empty below, sweep continues
      }
      const key = `${variant.id}::${transcript.id}`;
      textById.set(key, text);
      results.push({
        variantId: variant.id,
        transcriptId: transcript.id,
        hard: scoreHard(text, rubricCtx),
      });
    }
  }

  // ── 3. Judge survivors only.
  const survivors = judgeWorthy(results);
  const skippedAsDisqualified = results.length - survivors.length;

  let judged = 0;
  if (!opts.hardOnly) {
    const cap = opts.maxJudgeCalls ?? survivors.length;
    for (const r of survivors.slice(0, Math.max(0, cap))) {
      const text = textById.get(`${r.variantId}::${r.transcriptId}`) ?? '';
      const score = await judgeCandidate(text);
      if (score) {
        r.judge = score;
        judged++;
      }
    }
  }

  const summaries = summarizeVariants(results);

  // Winner must be COMPLIANT first. A variant with a higher mean quality but a
  // worse compliance rate is not better — it is disqualified more often.
  let winner: string | null = null;
  let best = -1;
  for (const s of summaries) {
    if (s.meanQuality === null || s.compliant === 0) continue;
    if (s.meanQuality > best) {
      best = s.meanQuality;
      winner = s.variantId;
    }
  }

  return {
    candidates: results.length,
    judged,
    skippedAsDisqualified,
    judgeCallsSaved: skippedAsDisqualified,
    summaries,
    winner,
  };
}
