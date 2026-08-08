/**
 * High-Volume Campaign Configuration
 * AWS SES 150k/day campaign settings with warmup and quality gates.
 */

export interface CampaignConfig {
  awsCreditId: string;
  dailyTarget: number;
  maxDailyCap: number;
  pacingPerHour: number;
  pacingPerMinute: number;
  burstLimit: number;
  burstWindowSeconds: number;
  warmupSchedule: WarmupDay[];
  qualityGates: QualityGates;
  provider: 'aws_ses';
  estimatedCostPer150k: number;
}

export interface WarmupDay {
  day: number;
  target: number;
}

export interface QualityGates {
  maxBounceRate: number;
  maxComplaintRate: number;
  maxUnsubscribeRate: number;
}

export interface CampaignMetrics {
  sent: number;
  delivered: number;
  bounced: number;
  complaints: number;
  unsubscribes: number;
  opens: number;
  clicks: number;
}

// ── main config ──────────────────────────────────────────────────────────────

export const HIGH_VOLUME_CONFIG: CampaignConfig = {
  awsCreditId: '10064436819',
  dailyTarget: 150_000,
  maxDailyCap: 250_000,
  pacingPerHour: 6_250, // 150k / 24 = 6,250
  pacingPerMinute: 104, // 6,250 / 60 = ~104
  burstLimit: 500,
  burstWindowSeconds: 5,

  // FIX: Adjusted warmup schedule to follow AWS SES best practice of 20-50% daily increase.
  // Previous schedule had aggressive jumps (150% and 100% daily increases).
  // New schedule: ~50% daily increase to protect sender reputation.
  warmupSchedule: [
    { day: 1, target: 10_000 },
    { day: 2, target: 15_000 },   // +50%
    { day: 3, target: 22_000 },   // +47%
    { day: 4, target: 33_000 },   // +50%
    { day: 5, target: 50_000 },   // +52%
    { day: 6, target: 75_000 },   // +50%
    { day: 7, target: 110_000 },  // +47%
    { day: 8, target: 150_000 },  // +36%
  ],

  qualityGates: {
    maxBounceRate: 0.05, // 5%
    maxComplaintRate: 0.001, // 0.1%
    maxUnsubscribeRate: 0.02, // 2%
  },

  provider: 'aws_ses',
  estimatedCostPer150k: 14, // ~$14 per 150k emails
};

// ── warmup scheduler ─────────────────────────────────────────────────────────

/**
 * Get daily target based on warmup schedule.
 * After warmup complete, returns full daily target.
 */
export function getWarmupTarget(dayNumber: number): number {
  const schedule = HIGH_VOLUME_CONFIG.warmupSchedule;

  if (dayNumber < 1) {
    return 0;
  }

  const warmupDay = schedule.find(d => d.day === dayNumber);
  if (warmupDay) {
    return warmupDay.target;
  }

  // After warmup, return full target
  return HIGH_VOLUME_CONFIG.dailyTarget;
}

/**
 * Check if still in warmup period.
 */
export function isInWarmup(dayNumber: number): boolean {
  return dayNumber <= HIGH_VOLUME_CONFIG.warmupSchedule.length;
}

/**
 * Get warmup progress percentage.
 */
export function getWarmupProgress(dayNumber: number): number {
  if (dayNumber >= HIGH_VOLUME_CONFIG.warmupSchedule.length) {
    return 100;
  }
  return Math.round((dayNumber / HIGH_VOLUME_CONFIG.warmupSchedule.length) * 100);
}

// ── quality gates ────────────────────────────────────────────────────────────

export interface QualityGateResult {
  passed: boolean;
  bounceRate: number;
  complaintRate: number;
  unsubscribeRate: number;
  openRate: number;
  clickRate: number;
  violations: string[];
  warnings: string[];
  shouldPause: boolean;
}

/**
 * Engagement rate thresholds for campaign health.
 * Research: Industry email open rate benchmark is 15-25% for RE.
 * <5% open rate indicates list or content issues - pause to investigate.
 */
export const ENGAGEMENT_THRESHOLDS = {
  minOpenRate: 0.05,      // 5% minimum - below this pause campaign
  warningOpenRate: 0.10,  // 10% - show warning
  targetOpenRate: 0.15,   // 15% - healthy campaign
  minClickRate: 0.01,     // 1% minimum click rate
} as const;

/**
 * Check quality gates against current metrics.
 * Returns whether to continue or pause the campaign.
 *
 * FIX: Added engagement rate gate (opens/clicks) to pause campaigns with
 * <5% open rate. This saves sender reputation and prevents wasted sends.
 * Research: AWS SES complaint rate >0.1% can trigger account review.
 */
export function checkQualityGates(metrics: CampaignMetrics): QualityGateResult {
  const gates = HIGH_VOLUME_CONFIG.qualityGates;
  const violations: string[] = [];
  const warnings: string[] = [];

  const bounceRate = metrics.sent > 0 ? metrics.bounced / metrics.sent : 0;
  const complaintRate = metrics.sent > 0 ? metrics.complaints / metrics.sent : 0;
  const unsubscribeRate = metrics.sent > 0 ? metrics.unsubscribes / metrics.sent : 0;
  const openRate = metrics.delivered > 0 ? metrics.opens / metrics.delivered : 0;
  const clickRate = metrics.delivered > 0 ? metrics.clicks / metrics.delivered : 0;

  if (bounceRate > gates.maxBounceRate) {
    violations.push(`Bounce rate ${(bounceRate * 100).toFixed(2)}% exceeds max ${gates.maxBounceRate * 100}%`);
  }

  if (complaintRate > gates.maxComplaintRate) {
    violations.push(`Complaint rate ${(complaintRate * 100).toFixed(3)}% exceeds max ${gates.maxComplaintRate * 100}%`);
  }

  if (unsubscribeRate > gates.maxUnsubscribeRate) {
    violations.push(`Unsubscribe rate ${(unsubscribeRate * 100).toFixed(2)}% exceeds max ${gates.maxUnsubscribeRate * 100}%`);
  }

  // Engagement rate gate: only check after sufficient sends (100+) for statistical significance
  if (metrics.delivered >= 100) {
    if (openRate < ENGAGEMENT_THRESHOLDS.minOpenRate) {
      violations.push(`Open rate ${(openRate * 100).toFixed(1)}% below minimum ${ENGAGEMENT_THRESHOLDS.minOpenRate * 100}% - list or content issue suspected`);
    } else if (openRate < ENGAGEMENT_THRESHOLDS.warningOpenRate) {
      warnings.push(`Open rate ${(openRate * 100).toFixed(1)}% below target ${ENGAGEMENT_THRESHOLDS.targetOpenRate * 100}% - consider reviewing content/list`);
    }

    if (clickRate < ENGAGEMENT_THRESHOLDS.minClickRate && openRate > ENGAGEMENT_THRESHOLDS.minOpenRate) {
      warnings.push(`Click rate ${(clickRate * 100).toFixed(2)}% below minimum ${ENGAGEMENT_THRESHOLDS.minClickRate * 100}% - CTA may need optimization`);
    }
  }

  return {
    passed: violations.length === 0,
    bounceRate,
    complaintRate,
    unsubscribeRate,
    openRate,
    clickRate,
    violations,
    warnings,
    shouldPause: violations.length > 0,
  };
}

// ── pacing calculator ────────────────────────────────────────────────────────

export interface PacingResult {
  canSend: boolean;
  sendCount: number;
  waitMs: number;
  reason?: string;
}

/**
 * Calculate how many emails can be sent right now based on pacing limits.
 */
export function calculatePacing(
  sentThisMinute: number,
  sentThisHour: number,
  sentToday: number,
  dayNumber: number
): PacingResult {
  const config = HIGH_VOLUME_CONFIG;
  const dailyTarget = getWarmupTarget(dayNumber);

  // Check daily limit
  if (sentToday >= dailyTarget) {
    return {
      canSend: false,
      sendCount: 0,
      waitMs: 0,
      reason: `Daily target reached (${sentToday}/${dailyTarget})`,
    };
  }

  // Check hourly limit
  if (sentThisHour >= config.pacingPerHour) {
    return {
      canSend: false,
      sendCount: 0,
      waitMs: 60_000, // Wait 1 minute
      reason: `Hourly limit reached (${sentThisHour}/${config.pacingPerHour})`,
    };
  }

  // Check per-minute limit
  if (sentThisMinute >= config.pacingPerMinute) {
    return {
      canSend: false,
      sendCount: 0,
      waitMs: 5_000, // Wait 5 seconds
      reason: `Per-minute limit reached (${sentThisMinute}/${config.pacingPerMinute})`,
    };
  }

  // Calculate how many we can send
  const remainingDaily = dailyTarget - sentToday;
  const remainingHourly = config.pacingPerHour - sentThisHour;
  const remainingMinute = config.pacingPerMinute - sentThisMinute;

  const canSendNow = Math.min(
    config.burstLimit,
    remainingDaily,
    remainingHourly,
    remainingMinute
  );

  return {
    canSend: true,
    sendCount: canSendNow,
    waitMs: 0,
  };
}

// ── cost estimation ──────────────────────────────────────────────────────────

/**
 * Estimate cost for a given email count.
 */
export function estimateCost(emailCount: number): number {
  const costPer150k = HIGH_VOLUME_CONFIG.estimatedCostPer150k;
  return (emailCount / 150_000) * costPer150k;
}

/**
 * Estimate monthly cost at full volume.
 */
export function estimateMonthlyCost(): number {
  const dailyEmails = HIGH_VOLUME_CONFIG.dailyTarget;
  const daysPerMonth = 30;
  return estimateCost(dailyEmails * daysPerMonth);
}
