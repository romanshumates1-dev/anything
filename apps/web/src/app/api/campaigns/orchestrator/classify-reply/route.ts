import { NextResponse } from 'next/server';
import { requireAdmin } from '@/app/api/utils/authz';
import { getOrganization } from '@/lib/organization-context';
import sql from '@/app/api/utils/sql';

/**
 * POST /api/campaigns/orchestrator/classify-reply
 *
 * Classifies inbound email replies using Claude:
 * 1. Reads reply from message_events
 * 2. Sends to Claude for sentiment analysis
 * 3. Updates campaign_lead_queue with sentiment
 * 4. Flags high-value positive replies for manual review
 * 5. Creates speed_alerts for immediate action
 *
 * Call this when you receive a reply to a campaign email.
 *
 * Body: { messageEventId: number }
 */
export async function POST(request: Request) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const organization = await getOrganization();
  if (!organization) {
    return NextResponse.json({ error: 'No organization found' }, { status: 403 });
  }

  const body = await request.json();
  const { messageEventId } = body;

  if (!messageEventId) {
    return NextResponse.json({ error: 'messageEventId required' }, { status: 400 });
  }

  try {
    // 1. Get the reply message
    const [reply] = await sql`
      SELECT
        me.id,
        me.lead_id,
        me.body,
        me.from_address,
        me.subject,
        me.created_at,
        l.name as lead_name,
        clq.expected_value,
        clq.offer_min,
        clq.offer_max
      FROM message_events me
      JOIN leads l ON l.id = me.lead_id
      LEFT JOIN campaign_lead_queue clq ON clq.lead_id = me.lead_id
      WHERE me.id = ${messageEventId}
        AND me.organization_id = ${organization.id}
        AND me.direction = 'inbound'
        AND me.channel = 'email'
    `;

    if (!reply) {
      return NextResponse.json({ error: 'Message not found' }, { status: 404 });
    }

    // 2. Call Claude to classify sentiment
    const claudeApiKey = process.env.ANTHROPIC_API_KEY;
    if (!claudeApiKey) {
      return NextResponse.json({ error: 'Claude API key not configured' }, { status: 500 });
    }

    const classificationPrompt = `You are analyzing an email reply to a real estate offer. Classify the sentiment and extract key information.

**Original Context:**
We sent an email offering to buy ${reply.lead_name}'s property for $${Math.round(reply.offer_min / 100).toLocaleString()} - $${Math.round(reply.offer_max / 100).toLocaleString()}.

**Their Reply:**
Subject: ${reply.subject || '(no subject)'}

${reply.body}

**Your Task:**
Classify this reply into ONE of these categories:
- **positive**: They are interested in selling, want to discuss, or are ready to move forward
- **question**: They have questions but haven't committed (timeline, price details, process)
- **objection**: They like the idea but have concerns (price too low, need more time, other issues)
- **neutral**: Acknowledgment without clear direction ("got your message", "I'll think about it")
- **negative**: Not interested, already sold, angry/hostile, or explicit rejection

Also determine:
- **requires_manual_review**: true if this is positive/question and the expected value is >$5000, OR if sentiment is ambiguous
- **counter_offer_amount**: if they counter with a specific dollar amount, extract it (integer cents)

Respond with ONLY valid JSON (no markdown, no explanation):
{
  "sentiment": "positive" | "question" | "objection" | "neutral" | "negative",
  "requires_manual_review": true | false,
  "counter_offer_amount": null | integer (cents),
  "reasoning": "one sentence explaining the classification"
}`;

    const claudeResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': claudeApiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 500,
        messages: [{
          role: 'user',
          content: classificationPrompt
        }]
      })
    });

    if (!claudeResponse.ok) {
      const errorText = await claudeResponse.text();
      console.error('Claude API error:', errorText);
      return NextResponse.json({ error: 'Failed to classify reply' }, { status: 500 });
    }

    const claudeResult = await claudeResponse.json();
    const responseText = claudeResult.content[0].text;

    let classification;
    try {
      classification = JSON.parse(responseText);
    } catch (parseError) {
      console.error('Failed to parse Claude response:', responseText);
      return NextResponse.json({ error: 'Invalid classification response' }, { status: 500 });
    }

    // 3. Update campaign_lead_queue with sentiment
    const sentiment = classification.sentiment;
    const requiresReview = classification.requires_manual_review || false;

    await sql`
      UPDATE campaign_lead_queue
      SET reply_sentiment = ${sentiment},
          requires_manual_review = ${requiresReview},
          status = CASE
            WHEN ${sentiment} = 'positive' THEN 'interested'
            WHEN ${sentiment} = 'negative' THEN 'rejected'
            ELSE 'replied'
          END,
          last_reply_at = ${new Date(reply.created_at)},
          updated_at = now()
      WHERE lead_id = ${reply.lead_id}
        AND organization_id = ${organization.id}
    `;

    // 4. If positive + high EV, create speed_alert
    if ((sentiment === 'positive' || sentiment === 'question') && reply.expected_value > 500000) {
      await sql`
        INSERT INTO speed_alerts (
          organization_id,
          lead_id,
          alert_type,
          priority,
          message,
          metadata
        ) VALUES (
          ${organization.id},
          ${reply.lead_id},
          'hot_reply',
          'high',
          ${`${reply.lead_name} replied "${sentiment}" to campaign email - EV $${Math.round(reply.expected_value / 100).toLocaleString()}`},
          ${JSON.stringify({
            messageEventId,
            sentiment,
            counterOffer: classification.counter_offer_amount,
            reasoning: classification.reasoning
          })}
        )
        ON CONFLICT DO NOTHING
      `;
    }

    // 5. If counter-offer detected, log it
    if (classification.counter_offer_amount) {
      await sql`
        INSERT INTO negotiation_events (
          organization_id,
          lead_id,
          event_type,
          event_data,
          created_at
        ) VALUES (
          ${organization.id},
          ${reply.lead_id},
          'counter_offer',
          ${JSON.stringify({
            amount: classification.counter_offer_amount,
            source: 'campaign_reply',
            messageEventId
          })},
          now()
        )
        ON CONFLICT DO NOTHING
      `;
    }

    return NextResponse.json({
      status: 'reply_classified',
      leadId: reply.lead_id,
      leadName: reply.lead_name,
      classification: {
        sentiment,
        requiresManualReview: requiresReview,
        counterOfferCents: classification.counter_offer_amount,
        reasoning: classification.reasoning
      },
      nextSteps: requiresReview
        ? ['Check dashboard for leads requiring manual review', 'Respond to high-value lead ASAP']
        : ['Lead updated in queue', 'Monitor for further replies']
    });

  } catch (error: any) {
    console.error('POST /api/campaigns/orchestrator/classify-reply error', error);
    return NextResponse.json(
      { error: 'Failed to classify reply' },
      { status: 500 }
    );
  }
}
