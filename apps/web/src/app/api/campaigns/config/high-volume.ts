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

  warmupSchedule: [
    { day: 1, target: 10_000 },
    { day: 2, target: 25_000 },
    { day: 3, target: 50_000 },
    { day: 4, target: 75_000 },
    { day: 5, target: 100_000 },
    { day: 6, target: 125_000 },
    { day: 7, target: 150_000 },
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
  violations: string[];
  shouldPause: boolean;
}

/**
 * Check quality gates against current metrics.
 * Returns whether to continue or pause the campaign.
 */
export function checkQualityGates(metrics: CampaignMetrics): QualityGateResult {
  const gates = HIGH_VOLUME_CONFIG.qualityGates;
  const violations: string[] = [];

  const bounceRate = metrics.sent > 0 ? metrics.bounced / metrics.sent : 0;
  const complaintRate = metrics.sent > 0 ? metrics.complaints / metrics.sent : 0;
  const unsubscribeRate = metrics.sent > 0 ? metrics.unsubscribes / metrics.sent : 0;

  if (bounceRate > gates.maxBounceRate) {
    violations.push(`Bounce rate ${(bounceRate * 100).toFixed(2)}% exceeds max ${gates.maxBounceRate * 100}%`);
  }

  if (complaintRate > gates.maxComplaintRate) {
    violations.push(`Complaint rate ${(complaintRate * 100).toFixed(3)}% exceeds max ${gates.maxComplaintRate * 100}%`);
  }

  if (unsubscribeRate > gates.maxUnsubscribeRate) {
    violations.push(`Unsubscribe rate ${(unsubscribeRate * 100).toFixed(2)}% exceeds max ${gates.maxUnsubscribeRate * 100}%`);
  }

  return {
    passed: violations.length === 0,
    bounceRate,
    complaintRate,
    unsubscribeRate,
    violations,
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
