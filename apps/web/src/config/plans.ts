/**
 * plans — THE single source of truth for subscription tiers, caps, and the
 * Twilio budget each tier funds. Consumed by BOTH the marketing /pricing page
 * (display) AND the server-side entitlement gate (enforcement). There is no
 * second copy of prices or limits anywhere — if you need a plan number, import
 * it from here.
 *
 * The SMS allowance per tier is DERIVED, not typed by hand: each tier declares
 * the Twilio budget its fee funds (`smsBudgetCents`) and a markup (2x–3x). The
 * included segment allowance is `includedSegmentsForBudget(budget, markup,
 * cost)`, which floors the allowance so realized Twilio spend at the cap can
 * never exceed the funded budget (the owner's "cap them out before the Twilio
 * cost" rule). plans.test.ts proves that invariant for every tier.
 */
import {
  DEFAULT_TWILIO_COST_PER_SEGMENT_CENTS,
  includedSegmentsForBudget,
  retailForTrueCost,
  retainedMarginCents,
} from './billing-math';

export type PlanId = 'starter' | 'professional' | 'enterprise';
export const PLAN_IDS: readonly PlanId[] = ['starter', 'professional', 'enterprise'] as const;

/** Twilio all-in cost per segment (cents). Env override lets the model react to
 *  carrier price changes without a code change; read at call time. */
export function twilioCostPerSegmentCents(): number {
  const raw = process.env.TWILIO_COST_PER_SEGMENT_CENTS;
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_TWILIO_COST_PER_SEGMENT_CENTS;
}

/** Per-metric usage caps. null === unlimited (enterprise). */
export interface PlanLimits {
  leadsPerMonth: number | null;
  campaignsActiveMax: number | null;
  aiRepliesPerMonth: number | null;
  contactsStored: number | null; // "memory": how many contacts you can retain
  aiMemoryDays: number | null; // "memory rate": conversation-context retention window
  storageMb: number | null;
}

export interface PlanDef {
  id: PlanId;
  name: string;
  tagline: string;
  /** Monthly price in cents. null === custom / contact-sales (enterprise). */
  priceMonthlyCents: number | null;
  trialDays: number;
  /** Portion of the fee that funds Twilio SMS. null === unmetered (enterprise). */
  smsBudgetCents: number | null;
  /** Markup multiple applied to true Twilio cost (owner rule: 2x–3x). */
  smsMarkup: number;
  limits: PlanLimits;
  /** May the customer connect their OWN Claude/Anthropic key for higher accuracy? */
  byoAiKeyAllowed: boolean;
  /** Ollama self-host is free for everyone. */
  ollamaAllowed: boolean;
  /** Display bullet points on /pricing. */
  featureBullets: string[];
  cta: { label: string; href: string };
}

// smsMarkup within [2,3] per the owner rule; higher-volume tiers get the lower
// (still >=2x) markup. Budgets are the SMS-funding portion of each fee.
const PLANS: Record<PlanId, PlanDef> = {
  starter: {
    id: 'starter',
    name: 'Starter',
    tagline: 'Solo wholesaler getting the first deals moving.',
    priceMonthlyCents: 9900,
    trialDays: 30,
    smsBudgetCents: 6000, // $60 of the $99 fee funds SMS
    smsMarkup: 3,
    limits: {
      leadsPerMonth: 1000,
      campaignsActiveMax: 1,
      aiRepliesPerMonth: 3000,
      contactsStored: 2500,
      aiMemoryDays: 30,
      storageMb: 512,
    },
    byoAiKeyAllowed: false,
    ollamaAllowed: true,
    featureBullets: [
      'AI SMS outreach + negotiation (owner-bounded)',
      'STOP/HELP + quiet-hours compliance built in',
      'Free self-hosted Ollama AI included',
      'Email support',
    ],
    cta: { label: 'Start 30-day trial', href: '/account/signup?plan=starter' },
  },
  professional: {
    id: 'professional',
    name: 'Professional',
    tagline: 'Scaling operators running multiple markets.',
    priceMonthlyCents: 24900,
    trialDays: 30,
    smsBudgetCents: 17000, // $170 of the $249 fee funds SMS
    smsMarkup: 2.5,
    limits: {
      leadsPerMonth: 10000,
      campaignsActiveMax: null,
      aiRepliesPerMonth: 25000,
      contactsStored: 30000,
      aiMemoryDays: 180,
      storageMb: 5120,
    },
    byoAiKeyAllowed: true,
    ollamaAllowed: true,
    featureBullets: [
      'Everything in Starter, unlimited active campaigns',
      'Connect your OWN Claude key for higher close quality',
      'Advanced approval workflows',
      'Priority support',
    ],
    cta: { label: 'Start 30-day trial', href: '/account/signup?plan=professional' },
  },
  enterprise: {
    id: 'enterprise',
    name: 'Enterprise',
    tagline: 'Teams needing dedicated infrastructure + SLAs.',
    priceMonthlyCents: null, // custom
    trialDays: 30,
    smsBudgetCents: null, // unmetered / negotiated
    smsMarkup: 2,
    limits: {
      leadsPerMonth: null,
      campaignsActiveMax: null,
      aiRepliesPerMonth: null,
      contactsStored: null,
      aiMemoryDays: null,
      storageMb: null,
    },
    byoAiKeyAllowed: true,
    ollamaAllowed: true,
    featureBullets: [
      'Unlimited leads, campaigns, and AI',
      'Bring your own Claude key or dedicated Ollama',
      'SOC 2 reports, SLA + 24/7 support',
      'Custom integrations',
    ],
    cta: { label: 'Contact sales', href: '/contact?topic=enterprise' },
  },
};

export function getPlan(id: PlanId): PlanDef {
  const p = PLANS[id];
  if (!p) throw new Error(`unknown plan: ${id}`);
  return p;
}

export function isPlanId(v: unknown): v is PlanId {
  return typeof v === 'string' && (PLAN_IDS as readonly string[]).includes(v);
}

/** Derived included SMS allowance (whole segments) for a tier at current cost.
 *  null === unmetered (enterprise). */
export function includedSmsSegments(id: PlanId, costPerSegmentCents = twilioCostPerSegmentCents()): number | null {
  const p = getPlan(id);
  if (p.smsBudgetCents === null) return null;
  return includedSegmentsForBudget(p.smsBudgetCents, p.smsMarkup, costPerSegmentCents);
}

/** Display-safe plan data for the /pricing page — no server-only fields. */
export interface PublicPlan {
  id: PlanId;
  name: string;
  tagline: string;
  priceMonthly: number | null; // dollars, for display
  trialDays: number;
  includedSmsSegments: number | null;
  limits: PlanLimits;
  byoAiKeyAllowed: boolean;
  featureBullets: string[];
  cta: { label: string; href: string };
}

export function getPublicPlans(costPerSegmentCents = twilioCostPerSegmentCents()): PublicPlan[] {
  return PLAN_IDS.map((id) => {
    const p = getPlan(id);
    return {
      id: p.id,
      name: p.name,
      tagline: p.tagline,
      priceMonthly: p.priceMonthlyCents === null ? null : p.priceMonthlyCents / 100,
      trialDays: p.trialDays,
      includedSmsSegments: includedSmsSegments(id, costPerSegmentCents),
      limits: p.limits,
      byoAiKeyAllowed: p.byoAiKeyAllowed,
      featureBullets: p.featureBullets,
      cta: p.cta,
    };
  });
}

/** The retail value of the included SMS allowance at the tier markup — used to
 *  show customers what their bundled messaging would cost at pay-as-you-go. */
export function includedSmsRetailValueCents(id: PlanId, costPerSegmentCents = twilioCostPerSegmentCents()): number | null {
  const seg = includedSmsSegments(id, costPerSegmentCents);
  if (seg === null) return null;
  return retailForTrueCost(seg * costPerSegmentCents, getPlan(id).smsMarkup);
}

/** Margin (cents) retained if a tier's SMS allowance is fully consumed. Proves
 *  the fee out-covers the Twilio cost. null === unmetered. */
export function tierRetainedMarginCents(id: PlanId, costPerSegmentCents = twilioCostPerSegmentCents()): number | null {
  const p = getPlan(id);
  const seg = includedSmsSegments(id, costPerSegmentCents);
  if (p.smsBudgetCents === null || seg === null) return null;
  return retainedMarginCents(p.smsBudgetCents, seg, costPerSegmentCents);
}

// ── metric → cap resolution (pure; consumed by the DB entitlement gate) ───────

/** The meterable usage metrics. Period-scoped unless noted. */
export const USAGE_METRICS = [
  'sms_segments', // period-scoped; DERIVED from the Twilio budget (cap-before-spend)
  'leads', // period-scoped
  'ai_replies', // period-scoped
  'campaigns_active', // point-in-time count of active campaigns
  'contacts_stored', // point-in-time count of stored contacts ("memory")
] as const;
export type UsageMetric = (typeof USAGE_METRICS)[number];

export function isUsageMetric(v: unknown): v is UsageMetric {
  return typeof v === 'string' && (USAGE_METRICS as readonly string[]).includes(v);
}

/** True if a metric resets each billing period (vs. a point-in-time total). */
export function isPeriodMetric(metric: UsageMetric): boolean {
  return metric === 'sms_segments' || metric === 'leads' || metric === 'ai_replies';
}

/** The cap for a plan+metric. null === unlimited. For sms_segments the cap is
 *  the margin-safe derived allowance, so the same "cap before the Twilio cost"
 *  rule governs enforcement as governs pricing. */
export function capForMetric(
  id: PlanId,
  metric: UsageMetric,
  costPerSegmentCents = twilioCostPerSegmentCents()
): number | null {
  const p = getPlan(id);
  switch (metric) {
    case 'sms_segments':
      return includedSmsSegments(id, costPerSegmentCents);
    case 'leads':
      return p.limits.leadsPerMonth;
    case 'ai_replies':
      return p.limits.aiRepliesPerMonth;
    case 'campaigns_active':
      return p.limits.campaignsActiveMax;
    case 'contacts_stored':
      return p.limits.contactsStored;
    default: {
      const _exhaustive: never = metric;
      return _exhaustive;
    }
  }
}
