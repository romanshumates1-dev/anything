/**
 * Email warmup ramp + auto-pause.
 *
 * Deliverability IS the volume ceiling for email. A new domain starts with zero
 * reputation; sending 500 emails on day 1 triggers spam filters and potentially
 * bans the account. The warmup ramp starts low and grows daily. Auto-pause kicks
 * in when bounce or complaint rates exceed provider suspension thresholds (SES:
 * bounce >5%, complaint >0.1%; most providers are similar).
 *
 * The ramp is intentionally conservative: better to send 20/day for a week than
 * to blast 300 and lose the domain. The owner can raise daily_limit in config
 * once reputation is established.
 */
import sql from '@/app/api/utils/sql';

export interface WarmupConfig {
  dailyLimit: number;
  rampIncrement: number;
  rampIntervalDays: number;
  autoPauseBouncePct: number;
  autoPauseComplaintPct: number;
  paused: boolean;
  pausedReason: string | null;
}

export interface SendAllowance {
  allowed: boolean;
  remaining: number;
  reason?: string;
}

const DEFAULT_CONFIG: WarmupConfig = {
  dailyLimit: 20,
  rampIncrement: 10,
  rampIntervalDays: 2,
  autoPauseBouncePct: 5.0,
  autoPauseComplaintPct: 0.1,
  paused: false,
  pausedReason: null,
};

export async function getWarmupConfig(organizationId: string): Promise<WarmupConfig> {
  const rows = await sql`
    SELECT * FROM email_warmup_config WHERE organization_id = ${organizationId} LIMIT 1
  `;
  if (rows.length === 0) return DEFAULT_CONFIG;
  const r = rows[0];
  return {
    dailyLimit: r.daily_limit,
    rampIncrement: r.ramp_increment,
    rampIntervalDays: r.ramp_interval_days,
    autoPauseBouncePct: parseFloat(r.auto_pause_bounce_pct),
    autoPauseComplaintPct: parseFloat(r.auto_pause_complaint_pct),
    paused: r.paused,
    pausedReason: r.paused_reason,
  };
}

export async function getCurrentDailyLimit(organizationId: string): Promise<number> {
  const cfg = await getWarmupConfig(organizationId);
  if (cfg.paused) return 0;

  const rows = await sql`
    SELECT COUNT(*) as days_active
    FROM email_daily_sends
    WHERE organization_id = ${organizationId} AND sent_count > 0
  `;
  const daysActive = parseInt(rows[0]?.days_active) || 0;
  const rampSteps = Math.floor(daysActive / cfg.rampIntervalDays);
  return cfg.dailyLimit + rampSteps * cfg.rampIncrement;
}

export async function canSendEmail(organizationId: string): Promise<SendAllowance> {
  const cfg = await getWarmupConfig(organizationId);
  if (cfg.paused) {
    return { allowed: false, remaining: 0, reason: `Email paused: ${cfg.pausedReason || 'manually paused'}` };
  }

  const limit = await getCurrentDailyLimit(organizationId);
  const today = new Date().toISOString().slice(0, 10);
  const rows = await sql`
    SELECT sent_count FROM email_daily_sends
    WHERE organization_id = ${organizationId} AND date = ${today}
  `;
  const sentToday = rows.length > 0 ? rows[0].sent_count : 0;
  const remaining = Math.max(0, limit - sentToday);

  if (remaining <= 0) {
    return { allowed: false, remaining: 0, reason: `Daily warmup limit reached (${limit}/day)` };
  }

  return { allowed: true, remaining };
}

export async function recordEmailSend(organizationId: string): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  await sql`
    INSERT INTO email_daily_sends (organization_id, date, sent_count)
    VALUES (${organizationId}, ${today}, 1)
    ON CONFLICT (organization_id, date)
    DO UPDATE SET sent_count = email_daily_sends.sent_count + 1
  `;
}

export async function recordEmailBounce(organizationId: string): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  await sql`
    INSERT INTO email_daily_sends (organization_id, date, bounce_count)
    VALUES (${organizationId}, ${today}, 1)
    ON CONFLICT (organization_id, date)
    DO UPDATE SET bounce_count = email_daily_sends.bounce_count + 1
  `;
  await checkAutoPause(organizationId);
}

export async function recordEmailComplaint(organizationId: string): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  await sql`
    INSERT INTO email_daily_sends (organization_id, date, complaint_count)
    VALUES (${organizationId}, ${today}, 1)
    ON CONFLICT (organization_id, date)
    DO UPDATE SET complaint_count = email_daily_sends.complaint_count + 1
  `;
  await checkAutoPause(organizationId);
}

export async function checkAutoPause(organizationId: string): Promise<boolean> {
  const cfg = await getWarmupConfig(organizationId);
  if (cfg.paused) return true;

  const today = new Date().toISOString().slice(0, 10);
  const rows = await sql`
    SELECT sent_count, bounce_count, complaint_count
    FROM email_daily_sends
    WHERE organization_id = ${organizationId} AND date = ${today}
  `;
  if (rows.length === 0) return false;
  const { sent_count, bounce_count, complaint_count } = rows[0];
  if (sent_count === 0) return false;

  const bouncePct = (bounce_count / sent_count) * 100;
  const complaintPct = (complaint_count / sent_count) * 100;

  let pauseReason: string | null = null;
  if (bouncePct > cfg.autoPauseBouncePct) {
    pauseReason = `Bounce rate ${bouncePct.toFixed(1)}% exceeds ${cfg.autoPauseBouncePct}% threshold`;
  } else if (complaintPct > cfg.autoPauseComplaintPct) {
    pauseReason = `Complaint rate ${complaintPct.toFixed(1)}% exceeds ${cfg.autoPauseComplaintPct}% threshold`;
  }

  if (pauseReason) {
    await sql`
      INSERT INTO email_warmup_config (organization_id, paused, paused_reason, updated_at)
      VALUES (${organizationId}, true, ${pauseReason}, now())
      ON CONFLICT (organization_id)
      DO UPDATE SET paused = true, paused_reason = ${pauseReason}, updated_at = now()
    `;
    return true;
  }
  return false;
}
