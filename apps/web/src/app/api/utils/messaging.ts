import sql from '@/app/api/utils/sql';
import { checkConsent } from './compliance';
import { logEvent } from './logger';
import { recordRun } from './execution-ledger';

export type SendMessagePayload = {
  leadId: number | string;
  channel: 'sms' | 'email';
  to: string;
  text: string;
  campaignLeadId?: number | string | null;
};

/**
 * Provider-agnostic outbound send.
 *
 * Phase 1 uses a MOCK adapter: when SMS_PROVIDER_URL is unset, delivery is
 * simulated (recorded as `mock`). When a real provider URL is configured the
 * same code path POSTs the message to it. There is intentionally no Twilio
 * coupling here — only the seam.
 *
 * This function NEVER returns "success" without an observable side effect:
 * it always either flips campaign_leads.status and writes an audit log, or
 * throws (so the job queue can retry / dead-letter).
 */
export async function sendMessage(payload: SendMessagePayload) {
  const { leadId, channel, to, text, campaignLeadId = null } = payload;

  if (!to || !text) {
    throw new Error('sendMessage requires both `to` and `text`');
  }

  const setCampaignLeadStatus = async (status: 'sent' | 'failed') => {
    if (campaignLeadId == null) return;
    await sql`
      UPDATE campaign_leads
      SET status = ${status}
      WHERE id = ${campaignLeadId}
    `;
  };

  // 1. Consent gate — a re-check at send time, not just at enqueue time.
  const hasConsent = await checkConsent(to, channel);
  if (!hasConsent) {
    await setCampaignLeadStatus('failed');
    await logEvent('message_suppressed', 'message', String(leadId), {
      to,
      channel,
      reason: 'opted_out',
    });
    await recordRun({
      task: 'process_jobs',
      flow: 'campaign_lifecycle',
      step: 'send_message',
      status: 'pass',
      passed: true,
      detail: 'suppressed: opted_out',
      dbAssertion: campaignLeadId != null ? "campaign_leads.status='failed'" : 'no campaign_lead',
      logAssertion: "audit_logs.action='message_suppressed'",
    });
    return { status: 'suppressed' as const };
  }

  try {
    let delivery: 'mock' | 'provider' = 'mock';

    const providerUrl = process.env.SMS_PROVIDER_URL;
    if (providerUrl) {
      const res = await fetch(providerUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to, text, channel }),
      });
      if (!res.ok) {
        throw new Error(`SMS provider responded [${res.status}] ${res.statusText}`);
      }
      delivery = 'provider';
    }

    await setCampaignLeadStatus('sent');
    await logEvent('message_sent', 'message', String(leadId), {
      to,
      channel,
      delivery,
    });

    await recordRun({
      task: 'process_jobs',
      flow: 'campaign_lifecycle',
      step: 'send_message',
      status: 'pass',
      passed: true,
      detail: `sent via ${delivery}`,
      dbAssertion: campaignLeadId != null ? "campaign_leads.status='sent'" : 'no campaign_lead',
      logAssertion: "audit_logs.action='message_sent'",
    });

    return { status: 'sent' as const, delivery };
  } catch (error: any) {
    await setCampaignLeadStatus('failed');
    await logEvent('message_failed', 'message', String(leadId), {
      to,
      channel,
      error: error?.message ?? 'unknown',
    });
    await recordRun({
      task: 'process_jobs',
      flow: 'campaign_lifecycle',
      step: 'send_message',
      status: 'fail',
      passed: false,
      detail: error?.message ?? 'unknown',
      dbAssertion: campaignLeadId != null ? "campaign_leads.status='failed'" : 'no campaign_lead',
      logAssertion: "audit_logs.action='message_failed'",
    });
    // Re-throw so the job queue marks the job failed/dead and can retry.
    throw error;
  }
}
