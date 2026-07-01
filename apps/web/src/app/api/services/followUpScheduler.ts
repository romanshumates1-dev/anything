import sql from '@/app/api/utils/sql';
import { logEvent } from '@/app/api/utils/logger';

/**
 * Hourly follow-up scheduler.
 * Finds contacts whose follow-up delay has elapsed with no reply,
 * and queues the next follow-up message.
 */
export async function processFollowUps(organizationId: string) {
  // Find candidates: SENT or FOLLOWED_UP with no reply
  const candidates = await sql`
    SELECT cc.*, oc.direction, oc.id AS campaign_id,
           cmt.body AS follow_up_body, cmt.delay_hours, cmt.sequence_order
    FROM campaign_contacts cc
    JOIN outreach_campaigns oc ON oc.id = cc.campaign_id
    LEFT JOIN campaign_message_templates cmt
      ON cmt.campaign_id = oc.id
     AND cmt.kind = 'FOLLOW_UP'
     AND cmt.sequence_order = cc.follow_ups_sent + 1
    WHERE cc.organization_id = ${organizationId}
      AND cc.status IN ('SENT', 'FOLLOWED_UP')
      AND cc.last_reply_at IS NULL
      AND cc.last_message_at IS NOT NULL
  `;

  const now = new Date();
  const results: { contactId: string; action: string }[] = [];

  for (const contact of candidates) {
    // Determine next follow-up template
    const nextOrder = contact.follow_ups_sent + 1;
    const templates = await sql`
      SELECT * FROM campaign_message_templates
      WHERE campaign_id = ${contact.campaign_id}
        AND kind = 'FOLLOW_UP'
        AND sequence_order = ${nextOrder}
      ORDER BY sequence_order ASC
      LIMIT 1
    `;

    if (templates.length === 0) {
      // No more follow-ups configured → mark cold
      await sql`
        UPDATE campaign_contacts SET status = 'COLD', updated_at = now() WHERE id = ${contact.id}
      `;
      results.push({ contactId: contact.id, action: 'cold' });
      continue;
    }

    const template = templates[0];
    const dueAt = new Date(contact.last_message_at.getTime() + template.delay_hours * 3600_000);

    if (now < dueAt) {
      results.push({ contactId: contact.id, action: 'not_due' });
      continue;
    }

    // In production: queue SMS job via BullMQ/Twilio
    // await smsQueue.add('campaign-followup-send', { ... });

    await sql`
      UPDATE campaign_contacts
      SET status = 'FOLLOWED_UP',
          follow_ups_sent = follow_ups_sent + 1,
          last_message_at = now(),
          updated_at = now()
      WHERE id = ${contact.id}
    `;

    results.push({ contactId: contact.id, action: 'sent' });
  }

  await logEvent('follow_up_scheduler_run', 'system', 'followup-scheduler', { processed: results.length, results }, organizationId);

  return results;
}