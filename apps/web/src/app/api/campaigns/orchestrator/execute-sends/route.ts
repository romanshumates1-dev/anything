import { NextResponse } from 'next/server';
import { requireAdmin } from '@/app/api/utils/authz';
import { getOrganization } from '@/lib/organization-context';
import sql from '@/app/api/utils/sql';
import { sendEmail, type EmailMessage } from '@/app/api/utils/emailDriver';

/**
 * POST /api/campaigns/orchestrator/execute-sends
 *
 * Executes queued email sends:
 * 1. Pulls leads with status='queued' from campaign_lead_queue
 * 2. Personalizes message templates with lead data
 * 3. Sends via emailDriver (CAN-SPAM compliant)
 * 4. Logs to message_events and updates email_daily_sends
 *
 * This is your execution step - run after daily-plan creates the queue.
 */
export async function POST(request: Request) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const organization = await getOrganization();
  if (!organization) {
    return NextResponse.json({ error: 'No organization found' }, { status: 403 });
  }

  try {
    // 1. Check if email sending is paused
    const [warmupConfig] = await sql`
      SELECT daily_limit, paused, paused_reason
      FROM email_warmup_config
      WHERE organization_id = ${organization.id}
    `;

    if (!warmupConfig) {
      return NextResponse.json({
        error: 'Email warmup not configured',
        action: 'Run POST /api/campaigns/orchestrator/daily-plan first'
      }, { status: 400 });
    }

    if (warmupConfig.paused) {
      return NextResponse.json({
        error: 'Email sending paused',
        reason: warmupConfig.paused_reason
      }, { status: 400 });
    }

    // 2. Get today's send count (check limit)
    const [todayCounts] = await sql`
      SELECT sent_count, bounce_count, complaint_count
      FROM email_daily_sends
      WHERE organization_id = ${organization.id}
        AND date = CURRENT_DATE
    `;

    const alreadySent = todayCounts?.sent_count || 0;
    const remainingToday = Math.max(0, warmupConfig.daily_limit - alreadySent);

    if (remainingToday === 0) {
      return NextResponse.json({
        status: 'limit_reached',
        sent: alreadySent,
        limit: warmupConfig.daily_limit,
        message: 'Daily limit reached. Come back tomorrow.'
      });
    }

    // 3. Pull queued leads (up to remaining limit)
    const queuedLeads = await sql`
      SELECT
        clq.id as queue_id,
        clq.lead_id,
        clq.touch_number,
        clq.offer_min,
        clq.offer_max,
        l.name,
        l.email,
        l.phone,
        l.metadata->>'address' as address,
        pv.arv
      FROM campaign_lead_queue clq
      JOIN leads l ON l.id = clq.lead_id
      LEFT JOIN property_valuations pv ON pv.lead_id = clq.lead_id
      WHERE clq.organization_id = ${organization.id}
        AND clq.status = 'queued'
        AND clq.scheduled_for <= now()
      ORDER BY clq.expected_value DESC
      LIMIT ${remainingToday}
    `;

    if (queuedLeads.length === 0) {
      return NextResponse.json({
        status: 'no_queued_leads',
        message: 'No queued leads ready to send. Run POST /api/campaigns/orchestrator/daily-plan first.'
      });
    }

    // 4. Get message template for touch 1 (initial offer)
    const [template] = await sql`
      SELECT subject_template, body_template
      FROM campaign_message_library
      WHERE (organization_id = ${organization.id} OR organization_id = 'default')
        AND touch_number = 1
        AND message_type = 'initial_offer'
        AND active = true
      ORDER BY organization_id DESC
      LIMIT 1
    `;

    if (!template) {
      return NextResponse.json({
        error: 'No message template found',
        action: 'Check campaign_message_library table has templates seeded'
      }, { status: 500 });
    }

    // 5. Send emails
    const results = {
      sent: [] as number[],
      failed: [] as { leadId: number; reason: string }[]
    };

    for (const lead of queuedLeads) {
      try {
        // Personalize template
        const offerRange = `$${Math.round(lead.offer_min / 100).toLocaleString()} - $${Math.round(lead.offer_max / 100).toLocaleString()}`;
        const subject = template.subject_template
          .replace('{name}', lead.name || 'there')
          .replace('{address}', lead.address || 'your property');

        const body = template.body_template
          .replace(/{name}/g, lead.name || 'there')
          .replace(/{address}/g, lead.address || 'your property')
          .replace(/{offer}/g, offerRange)
          .replace(/{arv}/g, lead.arv ? `$${Math.round(lead.arv / 100).toLocaleString()}` : 'market value');

        // Build CAN-SPAM compliant email
        const unsubscribeUrl = process.env.NEXT_PUBLIC_APP_URL
          ? `${process.env.NEXT_PUBLIC_APP_URL}/unsubscribe?email=${encodeURIComponent(lead.email)}`
          : `https://app.dealflow.com/unsubscribe?email=${encodeURIComponent(lead.email)}`;

        const postalAddress = process.env.COMPANY_POSTAL_ADDRESS || '123 Main St, Suite 100, City, ST 12345';

        const fullBody = `${body}\n\n---\n<p style="font-size: 12px; color: #666;">
<a href="${unsubscribeUrl}">Unsubscribe</a><br>
${postalAddress}
</p>`;

        const emailMsg: EmailMessage = {
          to: lead.email,
          subject,
          body: fullBody,
          unsubscribeUrl,
          postalAddress,
          organizationId: organization.id,
          leadId: lead.lead_id,
          coldOutbound: true
        };

        // Send via emailDriver
        const sendResult = await sendEmail(emailMsg);

        if (sendResult.status === 'dispatched') {
          // Log to message_events
          await sql`
            INSERT INTO message_events (
              organization_id,
              conversation_id,
              contact_id,
              lead_id,
              channel,
              direction,
              from_address,
              to_address,
              subject,
              body,
              status,
              provider_message_id
            ) VALUES (
              ${organization.id},
              'campaign-' || ${lead.lead_id},
              NULL,
              ${lead.lead_id},
              'email',
              'outbound',
              ${process.env.EMAIL_FROM_ADDRESS || 'hello@dealflow.com'},
              ${lead.email},
              ${subject},
              ${fullBody},
              'sent',
              ${sendResult.providerId || null}
            )
          `;

          // Update campaign_lead_queue
          await sql`
            UPDATE campaign_lead_queue
            SET status = 'sent',
                touch_number = touch_number + 1,
                last_sent_at = now(),
                updated_at = now()
            WHERE id = ${lead.queue_id}
          `;

          // Increment daily send count
          await sql`
            INSERT INTO email_daily_sends (organization_id, date, sent_count)
            VALUES (${organization.id}, CURRENT_DATE, 1)
            ON CONFLICT (organization_id, date)
            DO UPDATE SET sent_count = email_daily_sends.sent_count + 1
          `;

          results.sent.push(lead.lead_id);
        } else {
          // Send failed - mark as dead or log failure
          await sql`
            UPDATE campaign_lead_queue
            SET status = 'dead',
                updated_at = now()
            WHERE id = ${lead.queue_id}
          `;

          results.failed.push({
            leadId: lead.lead_id,
            reason: sendResult.status === 'suppressed'
              ? `Suppressed: ${sendResult.reason}`
              : sendResult.status === 'blocked'
                ? `Blocked: ${sendResult.reason}`
                : `Failed: ${sendResult.errorMessage}`
          });
        }

      } catch (error: any) {
        console.error(`Failed to send email to lead ${lead.lead_id}:`, error);
        results.failed.push({
          leadId: lead.lead_id,
          reason: 'Unexpected error during send'
        });
      }
    }

    // 6. Check if we should schedule follow-ups for successfully sent emails
    // (Touch 2 scheduled for +2 days)
    for (const leadId of results.sent) {
      await sql`
        INSERT INTO campaign_lead_queue (
          organization_id,
          lead_id,
          expected_value,
          p_close,
          offer_min,
          offer_max,
          status,
          scheduled_for,
          touch_number
        )
        SELECT
          organization_id,
          lead_id,
          expected_value,
          p_close,
          offer_min,
          offer_max,
          'queued',
          now() + interval '2 days',
          1
        FROM campaign_lead_queue
        WHERE lead_id = ${leadId}
          AND touch_number = 1
          AND status = 'sent'
        ON CONFLICT DO NOTHING
      `;
    }

    return NextResponse.json({
      status: 'sends_executed',
      summary: {
        attempted: queuedLeads.length,
        sent: results.sent.length,
        failed: results.failed.length,
        remainingTodayAfter: remainingToday - results.sent.length
      },
      sent: results.sent,
      failed: results.failed,
      nextSteps: [
        'Monitor for replies: replies will appear in message_events',
        'Run POST /api/campaigns/orchestrator/classify-reply when replies come in',
        'Follow-up emails (touch 2) auto-queued for 2 days from now'
      ]
    });

  } catch (error: any) {
    console.error('POST /api/campaigns/orchestrator/execute-sends error', error);
    return NextResponse.json(
      { error: 'Failed to execute sends' },
      { status: 500 }
    );
  }
}
