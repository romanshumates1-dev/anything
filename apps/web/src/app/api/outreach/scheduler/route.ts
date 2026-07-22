import { NextRequest, NextResponse } from 'next/server';
import sql from '@/app/api/utils/sql';
import { auth } from '@/lib/auth';
import { getOrganization } from '@/lib/organization-context';
import { headers } from 'next/headers';
import { logEvent } from '@/app/api/utils/logger';
import { enqueueJob } from '@/app/api/utils/jobs';
import { CONSENT_BASIS_ATTESTED } from '@/app/api/utils/cadenceEngine';

/**
 * POST /api/outreach/scheduler/run
 * Manually trigger daily campaign scheduling (also called by cron).
 * Enforces daily volume caps, queues sends across TCPA window.
 */
export async function POST(_request: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const organization = await getOrganization();
    if (!organization) {
      return NextResponse.json({ error: 'No organization found' }, { status: 403 });
    }
    const organizationId = organization.id;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const campaigns = await sql`
      SELECT * FROM outreach_campaigns
      WHERE organization_id = ${organizationId}
        AND status = 'ACTIVE'
        AND start_date <= now()
        AND end_date >= now()
    `;

    const results: { campaignId: string; queued: number; reason?: string }[] = [];

    const dateKey = today.toISOString().slice(0, 10);

    for (const campaign of campaigns) {
      try {
        const logRows = await sql`
          SELECT * FROM campaign_daily_send_logs
          WHERE campaign_id = ${campaign.id} AND date = ${today}
        `;
        const log = logRows[0];
        const targetCount = campaign.daily_volume_max;
        const alreadySent = log?.sent_count ?? 0;
        const remaining = targetCount - alreadySent;

        if (remaining <= 0) {
          results.push({ campaignId: campaign.id, queued: 0 });
          continue;
        }

        const contacts = await sql`
          SELECT * FROM campaign_contacts
          WHERE campaign_id = ${campaign.id}
            AND status = 'QUEUED'
          ORDER BY created_at ASC
          LIMIT ${remaining}
        `;

        if (contacts.length === 0) {
          results.push({ campaignId: campaign.id, queued: 0 });
          continue;
        }

        // The message these contacts get is the campaign's OPENING template —
        // one lookup per campaign, reused across every contact in the batch.
        const [opening] = await sql`
          SELECT * FROM campaign_message_templates
          WHERE campaign_id = ${campaign.id} AND kind = 'OPENING' AND is_active = true
          ORDER BY sequence_order ASC
          LIMIT 1
        `;
        if (!opening) {
          results.push({ campaignId: campaign.id, queued: 0, reason: 'no_opening_template' });
          continue;
        }

        const consentBasis = campaign.consent_confirmed_at ? CONSENT_BASIS_ATTESTED : null;

        // Enqueue a real send per contact (dispatchGate + provider run at
        // transmit time inside the job processor — bug #36: this previously
        // flipped contacts to SENT with no send/enqueue at all). Dedupe is
        // scoped to today so a repeat cron/manual trigger the same day can't
        // double-enqueue the same contact.
        let queued = 0;
        for (const contact of contacts) {
          const jobId = await enqueueJob(
            'send_message',
            {
              leadId: contact.seller_lead_id || contact.buyer_lead_id,
              to: contact.phone,
              text: opening.body,
              campaignId: campaign.id,
              organizationId,
              contactId: contact.id,
              channel: 'sms',
              isOpening: true,
              consentBasis,
            },
            { dedupeKey: `scheduler:${campaign.id}:${contact.id}:${dateKey}` }
          );
          if (!jobId) continue;

          await sql`
            UPDATE campaign_contacts SET status = 'SENT', last_message_at = now(), updated_at = now() WHERE id = ${contact.id}
          `;
          queued++;
        }

        if (queued > 0) {
          if (!log) {
            await sql`
              INSERT INTO campaign_daily_send_logs (id, campaign_id, date, sent_count, target_count)
              VALUES (${crypto.randomUUID()}, ${campaign.id}, ${today}, ${queued}, ${targetCount})
            `;
          } else {
            await sql`
              UPDATE campaign_daily_send_logs
              SET sent_count = sent_count + ${queued}
              WHERE id = ${log.id}
            `;
          }
        }

        results.push({ campaignId: campaign.id, queued });
      } catch (err) {
        console.error(`Scheduler failed for campaign ${campaign.id}`, err);
        results.push({ campaignId: campaign.id, queued: -1 });
      }
    }

    await logEvent('scheduler_run', 'system', 'scheduler', { results, campaignCount: campaigns.length }, organizationId);

    return NextResponse.json({ date: today.toISOString(), results });
  } catch (error: any) {
    console.error('POST /api/outreach/scheduler/run error', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}