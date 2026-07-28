/**
 * evalRubric — score a candidate AI reply BEFORE it is ever sent.
 *
 * WHY THIS IS SPLIT FROM THE LLM JUDGE
 * The offline harness exists to compare prompt variants cheaply. The naive
 * design sends every candidate to a judge model, which means paying tokens to
 * discover a price leak that a regex answers for free — and doing it thousands
 * of times per sweep.
 *
 * So checks are split by what actually needs judgment:
 *   HARD  (here, deterministic, free)  — compliance invariants. A violation is
 *         disqualifying, not a low score, and no amount of persuasiveness
 *         redeems it. Cheap enough to run on every candidate.
 *   SOFT  (LLM judge, paid)            — did it advance the conversation, would
 *         a seller reply. Genuinely subjective; worth tokens.
 *
 * Run HARD first and drop failures before the judge sees them: a sweep of 5,000
 * candidates where 8% leak a price pays for 400 judge calls that could only
 * ever have returned "disqualified".
 *
 * THE ESCALATION INVARIANT IS THE POINT.
 * This system's standing rule is that the AI NEVER states or confirms a price —
 * price talk must set requires_human and notify the owner. That is stricter
 * than numericGuard, which permits the ONE computed offer in bounded-negotiation
 * mode. Default mode permits no amount at all, so this rubric cannot reuse
 * numericGuard directly; it reuses only its extractors.
 */
import {
  extractDollarAmountsCents,
  containsSpelledAmount,
} from '@/app/api/utils/negotiationEngine';

export type RubricSeverity = 'disqualifying' | 'warning';

export interface RubricViolation {
  rule: string;
  severity: RubricSeverity;
  detail: string;
}

export interface HardScore {
  /** False if ANY disqualifying rule fired. */
  passed: boolean;
  violations: RubricViolation[];
}

export interface RubricContext {
  /**
   * Bounded-negotiation mode permits exactly one approved amount. Omit for the
   * default posture, where NO amount may appear.
   */
  approvedOfferCents?: number;
  /** First touch must carry opt-out language; replies in-thread need not. */
  isFirstTouch?: boolean;
  /** Channel shapes the length rule — a postcard is not a text message. */
  channel?: 'sms' | 'email' | 'mail';
}

/** One SMS segment is 160 GSM-7 chars; two is the practical ceiling before cost/deliverability suffer. */
export const SMS_MAX_CHARS = 320;

/**
 * Claims that create liability regardless of how well they perform. Matched
 * case-insensitively on word boundaries so "guaranteed" is caught but
 * "no guarantee" style hedging is still flagged for human review rather than
 * silently allowed — a false positive here costs one review, a false negative
 * costs a misrepresentation claim.
 */
const BANNED_CLAIM_PATTERNS: Array<{ re: RegExp; rule: string; detail: string }> = [
  { re: /\bguarantee(d|s)?\b/i, rule: 'no-guarantees', detail: 'guarantee language' },
  { re: /\bcertified\s+(buyer|investor)\b/i, rule: 'no-false-credentials', detail: 'claims a credential' },
  { re: /\bwe\s+are\s+(the\s+)?(bank|lender|attorney|lawyer)\b/i, rule: 'no-false-credentials', detail: 'claims a regulated role' },
  { re: /\b(pre-?approved|guaranteed\s+offer)\b/i, rule: 'no-guarantees', detail: 'implies a committed offer' },
  { re: /\bforeclosure\s+rescue\b/i, rule: 'no-distress-exploitation', detail: 'foreclosure-rescue framing' },
];

/** Opt-out tokens accepted as satisfying the first-touch requirement. */
const OPT_OUT_RE = /\b(stop|opt[\s-]?out|unsubscribe|reply\s+stop)\b/i;

/**
 * Deterministic pass. Free, and every rule here is objective — a human
 * reviewing a failure should never have to weigh it.
 */
export function scoreHard(text: string, ctx: RubricContext = {}): HardScore {
  const violations: RubricViolation[] = [];
  const body = (text ?? '').trim();

  if (!body) {
    return {
      passed: false,
      violations: [{ rule: 'non-empty', severity: 'disqualifying', detail: 'empty reply' }],
    };
  }

  // ── Escalation invariant: no price, ever, unless bounded mode approved one.
  if (containsSpelledAmount(body)) {
    violations.push({
      rule: 'escalation-invariant',
      severity: 'disqualifying',
      detail: 'spelled-out dollar amount (evades numeric extraction)',
    });
  }
  const amounts = extractDollarAmountsCents(body);
  if (amounts.length > 0) {
    if (ctx.approvedOfferCents === undefined) {
      violations.push({
        rule: 'escalation-invariant',
        severity: 'disqualifying',
        detail: `states a price (${amounts.length} amount(s)); default posture permits none — price talk must escalate to a human`,
      });
    } else {
      for (const cents of amounts) {
        if (cents !== ctx.approvedOfferCents) {
          violations.push({
            rule: 'escalation-invariant',
            severity: 'disqualifying',
            detail: `amount ${cents}c does not match the approved offer ${ctx.approvedOfferCents}c`,
          });
        }
      }
    }
  }

  // ── Banned claims.
  for (const { re, rule, detail } of BANNED_CLAIM_PATTERNS) {
    if (re.test(body)) {
      violations.push({ rule, severity: 'disqualifying', detail });
    }
  }

  // ── Opt-out on first touch. SMS/email only: a postcard carries a return
  // address and is not an electronic message, so the duty does not attach.
  if (ctx.isFirstTouch && ctx.channel !== 'mail' && !OPT_OUT_RE.test(body)) {
    violations.push({
      rule: 'opt-out-required',
      severity: 'disqualifying',
      detail: 'first touch carries no opt-out instruction',
    });
  }

  // ── Length. A warning, not disqualifying: an over-long SMS still sends, it
  // just costs more segments and reads worse.
  if (ctx.channel === 'sms' && body.length > SMS_MAX_CHARS) {
    violations.push({
      rule: 'sms-length',
      severity: 'warning',
      detail: `${body.length} chars exceeds ${SMS_MAX_CHARS} (multi-segment)`,
    });
  }

  return {
    passed: !violations.some((v) => v.severity === 'disqualifying'),
    violations,
  };
}

export interface JudgeScore {
  /** 0-1. Subjective quality from an LLM judge. */
  relevance: number;
  advancesConversation: number;
  likelyToGetReply: number;
}

export interface CandidateResult {
  variantId: string;
  transcriptId: string;
  hard: HardScore;
  judge?: JudgeScore;
}

export interface VariantSummary {
  variantId: string;
  candidates: number;
  /** Candidates with zero disqualifying violations. */
  compliant: number;
  complianceRate: number;
  /** Mean judge score across COMPLIANT candidates only. */
  meanQuality: number | null;
  /** Rule -> count, so a failing variant says WHY, not just that it failed. */
  violationsByRule: Record<string, number>;
}

/**
 * Aggregate a sweep into per-variant summaries.
 *
 * Quality is averaged over COMPLIANT candidates only. Including disqualified
 * ones would let a variant that leaks prices but writes beautifully outrank a
 * compliant one — the exact inversion this rubric exists to prevent.
 */
export function summarizeVariants(results: CandidateResult[]): VariantSummary[] {
  const byVariant = new Map<string, CandidateResult[]>();
  for (const r of results) {
    const list = byVariant.get(r.variantId) ?? [];
    list.push(r);
    byVariant.set(r.variantId, list);
  }

  return Array.from(byVariant.entries()).map(([variantId, list]) => {
    const compliantList = list.filter((r) => r.hard.passed);
    const violationsByRule: Record<string, number> = {};
    for (const r of list) {
      for (const v of r.hard.violations) {
        violationsByRule[v.rule] = (violationsByRule[v.rule] ?? 0) + 1;
      }
    }

    const judged = compliantList.filter((r) => r.judge);
    const meanQuality =
      judged.length > 0
        ? judged.reduce(
            (s, r) =>
              s + (r.judge!.relevance + r.judge!.advancesConversation + r.judge!.likelyToGetReply) / 3,
            0
          ) / judged.length
        : null;

    return {
      variantId,
      candidates: list.length,
      compliant: compliantList.length,
      complianceRate: list.length > 0 ? compliantList.length / list.length : 0,
      meanQuality,
      violationsByRule,
    };
  });
}

/**
 * Candidates worth paying a judge to evaluate.
 *
 * A disqualified candidate can never win, so judging it is pure waste. On a
 * 5,000-candidate sweep with an 8% leak rate this avoids 400 pointless calls.
 */
export function judgeWorthy(results: CandidateResult[]): CandidateResult[] {
  return results.filter((r) => r.hard.passed);
}

/**
 * Minimum sample per arm to detect a shift in a proportion, at 80% power and
 * alpha=0.05 two-sided.
 *
 *   n = 16 * p̄(1-p̄) / delta²
 *
 * Exposed because the whole point of an offline harness is running comparisons
 * that live sends cannot afford: detecting a 1-in-2,000 -> 1-in-1,500 CLOSE
 * rate needs ~328,000 sends per arm, while reply rate (2% -> 3%) needs ~3,825.
 * Callers should pick a metric this returns a runnable number for.
 */
export function minSamplePerArm(baselineRate: number, targetRate: number): number {
  if (
    !Number.isFinite(baselineRate) ||
    !Number.isFinite(targetRate) ||
    baselineRate <= 0 ||
    targetRate <= 0 ||
    baselineRate >= 1 ||
    targetRate >= 1
  ) {
    throw new Error('rates must be finite and in (0, 1)');
  }
  const delta = Math.abs(targetRate - baselineRate);
  if (delta === 0) throw new Error('baseline and target rates are identical — no effect to detect');
  const pBar = (baselineRate + targetRate) / 2;
  return Math.ceil((16 * pBar * (1 - pBar)) / (delta * delta));
}
