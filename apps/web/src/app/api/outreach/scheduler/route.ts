import { NextRequest, NextResponse } from 'next/server';
import sql from '@/app/api/utils/sql';
import { auth } from '@/lib/auth';
import { headers } from 'next/headers';
import { logEvent } from '@/app/api/utils/logger';

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
    const organizationId = (session.user as any).organizationId || 'default';
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const campaigns = await sql`
      SELECT * FROM outreach_campaigns
      WHERE organization_id = ${organizationId}
        AND status = 'ACTIVE'
        AND start_date <= now()
        AND end_date >= now()
    `;

    const results: { campaignId: string; queued: number }[] = [];

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

        if (!log) {
          await sql`
            INSERT INTO campaign_daily_send_logs (id, campaign_id, date, sent_count, target_count)
            VALUES (${crypto.randomUUID()}, ${campaign.id}, ${today}, ${contacts.length}, ${targetCount})
          `;
        } else {
          await sql`
            UPDATE campaign_daily_send_logs
            SET sent_count = sent_count + ${contacts.length}
            WHERE id = ${log.id}
          `;
        }

        const contactIds = contacts.map((c: any) => c.id);
        for (const id of contactIds) {
          await sql`
            UPDATE campaign_contacts SET status = 'SENT', last_message_at = now(), updated_at = now() WHERE id = ${id}
          `;
        }

        results.push({ campaignId: campaign.id, queued: contacts.length });
      } catch (err) {
        console.error(`Scheduler failed for campaign ${campaign.id}`, err);
        results.push({ campaignId: campaign.id, queued: -1 });
      }
    }

    await logEvent('scheduler_run', 'system', 'scheduler', { results, campaignCount: campaigns.length }, organizationId);

    return NextResponse.json({ date: today.toISOString(), results });
  } catch (error: any) {
    console.error('POST /api/outreach/scheduler/run error', error);
    return NextResponse.json({ error: 'Internal Server Error', detail: error.message }, { status: 500 });
  }
}