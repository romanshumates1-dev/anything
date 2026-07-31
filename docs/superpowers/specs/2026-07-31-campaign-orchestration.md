# Campaign Orchestration Layer - Simple & Measurable

**Date:** 2026-07-31  
**Goal:** Get 5-10 negotiable leads from first campaign cycle  
**Foundation:** Optimization MVP + existing email/SMS infrastructure

---

## Philosophy

**Start simple. Measure everything. Add intelligence only after real data.**

This is NOT:
- Complex ML or experimentation
- High-volume blasting
- Over-engineered automation

This IS:
- Rate-limited, domain-safe outreach
- 2-3 touch sequences max
- Real conversation tracking
- Manual review of high-EV responses

---

## Existing Infrastructure (Use What's There)

### Tables Already Available:
- `message_events` - All sent/received messages
- `email_warmup_config` - Per-org daily limits
- `email_daily_sends` - Send/bounce/complaint counters
- `campaign_contacts` - Contact records
- `outreach_campaigns` - Campaign definitions
- `lead_actions` - Optimization queue (from MVP)
- `lead_scores` + `property_valuations` + `deal_probabilities` (from MVP)

### Services Already Built:
- `emailDriver.ts` - CAN-SPAM compliant sending
- Warmup tracking (046 migration)
- Bounce/complaint handling

---

## New Components (Minimal Addition)

### 1. Campaign Orchestration Table

```sql
-- 051_campaign_orchestration.sql

-- Links optimization pipeline to outreach campaigns
CREATE TABLE IF NOT EXISTS public.campaign_lead_queue (
  id bigserial PRIMARY KEY,
  organization_id text NOT NULL,
  campaign_id text REFERENCES public.outreach_campaigns(id) ON DELETE CASCADE,
  lead_id bigint NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  
  -- From optimization pipeline
  expected_value integer NOT NULL,  -- cents
  p_close numeric(5,4) NOT NULL,
  offer_min integer NOT NULL,       -- cents
  offer_max integer NOT NULL,       -- cents
  
  -- Outreach state
  touch_number integer NOT NULL DEFAULT 0,  -- 0 = not sent, 1 = first touch, 2 = follow-up
  status text NOT NULL DEFAULT 'queued',  -- 'queued', 'sent', 'replied', 'interested', 'rejected', 'dead'
  
  -- Timing
  scheduled_for timestamptz NOT NULL DEFAULT now(),
  last_sent_at timestamptz,
  last_reply_at timestamptz,
  
  -- Response classification (manual or AI-assisted)
  reply_sentiment text,  -- 'positive', 'neutral', 'negative', 'objection'
  requires_manual_review boolean DEFAULT false,
  
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_campaign_queue_scheduled ON campaign_lead_queue(scheduled_for) 
  WHERE status = 'queued';
CREATE INDEX idx_campaign_queue_review ON campaign_lead_queue(expected_value DESC) 
  WHERE requires_manual_review = true;
CREATE INDEX idx_campaign_queue_status ON campaign_lead_queue(status, updated_at);

-- Message templates with personalization
CREATE TABLE IF NOT EXISTS public.campaign_message_library (
  id bigserial PRIMARY KEY,
  organization_id text NOT NULL,
  touch_number integer NOT NULL,  -- 1 = initial, 2 = first follow-up, 3 = final
  message_type text NOT NULL,      -- 'initial_offer', 'follow_up', 'final_check'
  
  subject_template text NOT NULL,
  body_template text NOT NULL,
  
  -- Personalization variables: {name}, {address}, {offer}, {arv}, {closing_days}
  variables text[] DEFAULT ARRAY['name', 'address', 'offer'],
  
  active boolean DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_message_library_org_touch ON campaign_message_library(organization_id, touch_number) 
  WHERE active = true;

-- Track outcomes for learning
CREATE TABLE IF NOT EXISTS public.campaign_outcomes (
  id bigserial PRIMARY KEY,
  campaign_lead_id bigint NOT NULL REFERENCES campaign_lead_queue(id),
  lead_id bigint NOT NULL REFERENCES leads(id),
  
  -- What happened
  outcome_type text NOT NULL,  -- 'contract', 'verbal_yes', 'counter_offer', 'not_interested', 'no_response'
  touches_to_outcome integer,
  days_to_outcome numeric,
  
  -- Deal details (if closed)
  offer_accepted integer,  -- cents
  actual_fee integer,      -- cents (if deal closed)
  
  -- Learning data
  predicted_p_close numeric(5,4),
  actual_closed boolean NOT NULL,
  
  recorded_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_campaign_outcomes_lead ON campaign_outcomes(lead_id);
CREATE INDEX idx_campaign_outcomes_recorded ON campaign_outcomes(recorded_at DESC);
```

---

## 2. Daily Send Orchestrator

### Purpose
Pull leads from optimization pipeline → schedule rate-limited sends → track responses

### Algorithm

```typescript
// apps/web/src/app/api/campaigns/orchestrator/daily-plan/route.ts

export async function POST(request: Request) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const organization = await getOrganization();
  if (!organization) {
    return NextResponse.json({ error: 'No organization' }, { status: 403 });
  }

  // 1. Get warmup config (daily send limit)
  const [warmupConfig] = await sql`
    SELECT daily_limit, paused 
    FROM email_warmup_config 
    WHERE organization_id = ${organization.id}
  `;
  
  if (!warmupConfig || warmupConfig.paused) {
    return NextResponse.json({ 
      error: 'Email sending paused or not configured',
      dailyLimit: warmupConfig?.daily_limit || 0
    }, { status: 400 });
  }

  const dailyLimit = warmupConfig.daily_limit;

  // 2. Get today's send count
  const [todayCounts] = await sql`
    SELECT sent_count 
    FROM email_daily_sends 
    WHERE organization_id = ${organization.id} 
      AND date = CURRENT_DATE
  `;
  
  const alreadySent = todayCounts?.sent_count || 0;
  const remainingToday = Math.max(0, dailyLimit - alreadySent);

  if (remainingToday === 0) {
    return NextResponse.json({
      status: 'limit_reached',
      dailyLimit,
      sent: alreadySent,
      message: 'Daily send limit reached'
    });
  }

  // 3. Pull high-EV leads from optimization pipeline that haven't been contacted
  const eligibleLeads = await sql`
    SELECT 
      l.id as lead_id,
      l.name,
      l.email,
      l.phone,
      l.metadata->>'address' as address,
      ls.composite_score,
      pv.arv,
      pv.offer_min,
      pv.offer_max,
      dp.p_close,
      dp.expected_value
    FROM leads l
    JOIN lead_scores ls ON ls.lead_id = l.id
    JOIN property_valuations pv ON pv.lead_id = l.id
    JOIN deal_probabilities dp ON dp.lead_id = l.id
    LEFT JOIN lead_actions la ON la.lead_id = l.id 
      AND la.status = 'pending'
    LEFT JOIN campaign_lead_queue clq ON clq.lead_id = l.id
    WHERE l.organization_id = ${organization.id}
      AND l.email IS NOT NULL
      AND l.email != ''
      AND la.action = 'send_email'
      AND clq.id IS NULL  -- Not already in campaign queue
      AND dp.p_close >= 0.4  -- Only medium-high probability
    ORDER BY dp.expected_value DESC
    LIMIT ${remainingToday * 2}  -- Pull 2x to account for filtering
  `;

  // 4. Queue leads for today's batch (up to remaining limit)
  const leadsToQueue = eligibleLeads.slice(0, remainingToday);
  
  const queuedIds = [];
  for (const lead of leadsToQueue) {
    const [queued] = await sql`
      INSERT INTO campaign_lead_queue (
        organization_id,
        lead_id,
        expected_value,
        p_close,
        offer_min,
        offer_max,
        status,
        scheduled_for
      ) VALUES (
        ${organization.id},
        ${lead.lead_id},
        ${lead.expected_value},
        ${Number(lead.p_close)},
        ${lead.offer_min},
        ${lead.offer_max},
        'queued',
        now()
      )
      RETURNING id
    `;
    queuedIds.push(queued.id);
  }

  return NextResponse.json({
    status: 'plan_created',
    dailyLimit,
    alreadySent,
    remainingToday,
    leadsQueued: leadsToQueue.length,
    queuedIds,
    estimatedEV: leadsToQueue.reduce((sum, l) => sum + l.expected_value, 0) / 100,
    plan: {
      sendToday: leadsToQueue.length,
      avgPClose: leadsToQueue.reduce((sum, l) => sum + Number(l.p_close), 0) / leadsToQueue.length,
      expectedReplies: Math.round(
        leadsToQueue.reduce((sum, l) => sum + Number(l.p_close), 0) * 0.5  // 50% of P(close) = reply rate
      )
    }
  });
}
```

---

## 3. Send Executor

### Purpose
Actually send queued emails (respects rate limits, logs everything)

```typescript
// apps/web/src/app/api/campaigns/orchestrator/execute-sends/route.ts

import { send as sendEmail } from '@/app/api/services/emailDriver';

export async function POST(request: Request) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const organization = await getOrganization();
  if (!organization) {
    return NextResponse.json({ error: 'No organization' }, { status: 403 });
  }

  // Get today's remaining send allowance
  const [warmupConfig] = await sql`
    SELECT daily_limit FROM email_warmup_config 
    WHERE organization_id = ${organization.id}
  `;
  
  const [todayCounts] = await sql`
    SELECT sent_count FROM email_daily_sends 
    WHERE organization_id = ${organization.id} AND date = CURRENT_DATE
  `;
  
  const remaining = (warmupConfig?.daily_limit || 20) - (todayCounts?.sent_count || 0);
  
  if (remaining <= 0) {
    return NextResponse.json({ status: 'limit_reached' });
  }

  // Get queued leads ready to send
  const queuedLeads = await sql`
    SELECT 
      clq.id as queue_id,
      clq.lead_id,
      clq.touch_number,
      clq.offer_min,
      clq.offer_max,
      l.name,
      l.email,
      l.metadata->>'address' as address,
      pv.arv
    FROM campaign_lead_queue clq
    JOIN leads l ON l.id = clq.lead_id
    JOIN property_valuations pv ON pv.lead_id = clq.lead_id
    WHERE clq.organization_id = ${organization.id}
      AND clq.status = 'queued'
      AND clq.scheduled_for <= now()
    ORDER BY clq.expected_value DESC
    LIMIT ${remaining}
  `;

  const results = [];
  
  for (const lead of queuedLeads) {
    try {
      // Get appropriate message template
      const [template] = await sql`
        SELECT subject_template, body_template
        FROM campaign_message_library
        WHERE organization_id = ${organization.id}
          AND touch_number = ${lead.touch_number + 1}
          AND active = true
        ORDER BY created_at DESC
        LIMIT 1
      `;

      if (!template) {
        console.error(`No template found for touch ${lead.touch_number + 1}`);
        continue;
      }

      // Personalize message
      const offerAmount = Math.round((lead.offer_min + lead.offer_max) / 2 / 100);
      const arvAmount = Math.round(lead.arv / 100);
      
      const subject = template.subject_template
        .replace('{name}', lead.name || 'there')
        .replace('{address}', lead.address || 'your property');
      
      const body = template.body_template
        .replace(/{name}/g, lead.name || 'there')
        .replace(/{address}/g, lead.address || 'your property')
        .replace(/{offer}/g, `$${offerAmount.toLocaleString()}`)
        .replace(/{arv}/g, `$${arvAmount.toLocaleString()}`)
        .replace(/{closing_days}/g, '7-14');

      // Send via existing email driver
      const sendResult = await sendEmail({
        to: lead.email,
        from: process.env.EMAIL_FROM || 'noreply@dealswiftautomation.com',
        subject,
        html: body,
        leadId: lead.lead_id.toString(),
        contactId: lead.lead_id.toString()  // Using lead_id as contactId for now
      });

      // Update queue status
      await sql`
        UPDATE campaign_lead_queue
        SET 
          status = 'sent',
          touch_number = touch_number + 1,
          last_sent_at = now(),
          updated_at = now()
        WHERE id = ${lead.queue_id}
      `;

      // Log to message_events (integrate with existing system)
      await sql`
        INSERT INTO message_events (
          id,
          organization_id,
          campaign_id,
          contact_id,
          direction,
          provider,
          provider_message_id,
          status,
          metadata,
          created_at
        ) VALUES (
          gen_random_uuid()::text,
          ${organization.id},
          'optimization-campaign',
          ${lead.lead_id.toString()},
          'outbound',
          'email',
          ${sendResult.providerMessageId || ''},
          'sent',
          ${JSON.stringify({ leadId: lead.lead_id, touchNumber: lead.touch_number + 1 })},
          now()
        )
      `;

      // Increment daily counter
      await sql`
        INSERT INTO email_daily_sends (organization_id, date, sent_count)
        VALUES (${organization.id}, CURRENT_DATE, 1)
        ON CONFLICT (organization_id, date) 
        DO UPDATE SET sent_count = email_daily_sends.sent_count + 1
      `;

      results.push({
        leadId: lead.lead_id,
        status: 'sent',
        touchNumber: lead.touch_number + 1
      });

    } catch (error: any) {
      console.error(`Failed to send to lead ${lead.lead_id}:`, error);
      results.push({
        leadId: lead.lead_id,
        status: 'failed',
        error: error.message
      });
    }
  }

  return NextResponse.json({
    sent: results.filter(r => r.status === 'sent').length,
    failed: results.filter(r => r.status === 'failed').length,
    results
  });
}
```

---

## 4. Reply Classifier (Simple)

### Purpose
When replies come in, classify them for manual review

```typescript
// apps/web/src/app/api/campaigns/orchestrator/classify-reply/route.ts

export const REPLY_CLASSIFICATION_PROMPT = `You are classifying seller email replies.

Input:
{
  "replyText": "The seller's full reply message",
  "ourLastMessage": "What we last sent them"
}

Classify into ONE category:

1. **positive** - They're interested, asking questions, want to discuss
   Examples: "Yes let's talk", "What's next step?", "Tell me more"

2. **neutral** - They're not committing but haven't rejected
   Examples: "Let me think about it", "I'll discuss with family"

3. **negative** - Clear rejection
   Examples: "Not interested", "Already sold", "Don't contact again"

4. **objection** - They have concerns but might be persuadable
   Examples: "Price too low", "Need more time", "Can you do better?"

5. **question** - They're asking for clarification
   Examples: "How fast can you close?", "Do I need to make repairs?"

Output JSON (strict format):
{
  "sentiment": "positive" | "neutral" | "negative" | "objection" | "question",
  "requiresManualReview": true,  // Always true for positive/objection
  "suggestedResponse": "Brief guidance on how to respond",
  "reasoning": "Why this classification"
}

Rules:
- If uncertain, mark as "neutral" + requiresManualReview: true
- NEVER auto-respond - all positive replies need human review
- Return ONLY valid JSON`;

export async function POST(request: Request) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const { leadId, replyText, messageEventId } = await request.json();

  if (!leadId || !replyText) {
    return NextResponse.json({ error: 'Missing leadId or replyText' }, { status: 400 });
  }

  // Get context
  const [queueEntry] = await sql`
    SELECT * FROM campaign_lead_queue WHERE lead_id = ${leadId} ORDER BY updated_at DESC LIMIT 1
  `;

  if (!queueEntry) {
    return NextResponse.json({ error: 'Lead not in campaign queue' }, { status: 404 });
  }

  // Call Claude to classify
  const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY || ''
  });

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 512,
    messages: [{
      role: 'user',
      content: `${REPLY_CLASSIFICATION_PROMPT}\n\nInput:\n${JSON.stringify({
        replyText,
        ourLastMessage: 'Offer email about their property'
      }, null, 2)}`
    }]
  });

  const classification = JSON.parse(response.content[0].text);

  // Update queue entry
  await sql`
    UPDATE campaign_lead_queue
    SET 
      status = 'replied',
      reply_sentiment = ${classification.sentiment},
      requires_manual_review = ${classification.requiresManualReview},
      last_reply_at = now(),
      updated_at = now()
    WHERE lead_id = ${leadId}
  `;

  // If positive/high-EV, create alert
  if (['positive', 'objection'].includes(classification.sentiment)) {
    await sql`
      INSERT INTO speed_alerts (lead_id, alert_type, priority, triggered_at)
      VALUES (${leadId}, 'positive_reply', ${queueEntry.expected_value}, now())
    `;
  }

  return NextResponse.json({
    leadId,
    classification,
    nextAction: classification.requiresManualReview 
      ? 'Review at /optimization/dashboard?filter=requires_review'
      : 'No immediate action needed'
  });
}
```

---

## 5. Default Message Templates

### Seed Initial Templates

```sql
-- Seed campaign_message_library with default templates
INSERT INTO campaign_message_library (
  organization_id, touch_number, message_type, subject_template, body_template, variables
) VALUES

-- Touch 1: Initial offer
('default', 1, 'initial_offer',
 'Quick question about {address}',
 '<p>Hi {name},</p>
  <p>I came across {address} and wanted to reach out with a straightforward offer.</p>
  <p>Based on current market comps and the work the property needs, I can offer <strong>{offer}</strong> and close in 7-14 days.</p>
  <p>We buy as-is - no repairs, no showings, no contingencies. Just a clean, fast close.</p>
  <p>Would that work for you?</p>
  <p>Best,<br>Your Name</p>',
 ARRAY['name', 'address', 'offer']),

-- Touch 2: Follow-up (2 days later)
('default', 2, 'follow_up',
 'Following up on {address}',
 '<p>Hi {name},</p>
  <p>Just wanted to follow up on my offer for {address}.</p>
  <p>I know these decisions take time. If you have any questions about the offer or process, I''m happy to hop on a quick call.</p>
  <p>The offer of <strong>{offer}</strong> stands and we can close whenever works for you.</p>
  <p>Best,<br>Your Name</p>',
 ARRAY['name', 'address', 'offer']),

-- Touch 3: Final check (5 days later)
('default', 3, 'final_check',
 'Last check-in on {address}',
 '<p>Hi {name},</p>
  <p>I wanted to reach out one last time about {address} before I move on to other opportunities.</p>
  <p>My offer of <strong>{offer}</strong> is still available if you decide selling makes sense.</p>
  <p>If now isn''t the right time, no problem at all. Just wanted to make sure you had a chance to consider it.</p>
  <p>Best of luck either way,<br>Your Name</p>',
 ARRAY['name', 'address', 'offer']);
```

---

## Implementation Plan

### Phase 1: Foundation (Week 1)
1. Run migration 051 (new tables)
2. Seed default message templates
3. Set email_warmup_config (start at 20/day)

### Phase 2: Orchestration (Week 1-2)
4. Build daily-plan endpoint
5. Build execute-sends endpoint
6. Manual test with 5-10 leads

### Phase 3: Response Handling (Week 2)
7. Build classify-reply endpoint
8. Hook into inbound email handler
9. Add "requires review" filter to dashboard

### Phase 4: Follow-Up (Week 3)
10. Auto-schedule follow-up touches (touch 2 after 2 days, touch 3 after 5 days)
11. Add outcome tracking when deals close
12. Weekly calibration report

---

## Daily Workflow

### Morning (5-10 min):
```bash
# 1. Create today's send plan
curl -X POST http://localhost:4000/api/campaigns/orchestrator/daily-plan

# 2. Execute sends
curl -X POST http://localhost:4000/api/campaigns/orchestrator/execute-sends

# 3. Check for replies requiring review
curl http://localhost:4000/api/optimization/daily-queue?filter=requires_review
```

### Throughout Day:
- Respond to positive replies manually
- Mark outcomes when deals move forward
- Monitor speed_alerts for hot leads

---

## Success Metrics (First 2 Weeks)

**Campaign 1 Targets:**
- Send 200-300 initial emails (20/day × 10-15 days)
- Get 40-60 replies (20-30% reply rate)
- Get 10-15 positive/interested responses
- Move 5-10 to negotiation
- Close 2-3 contracts

**Key Metrics:**
1. **Reply rate:** Actual replies / emails sent
2. **Positive rate:** Positive replies / total replies
3. **Conversion rate:** Contracts / positive replies
4. **Time-to-reply:** Hours from send to first reply
5. **Template performance:** Which touches get best response

---

## Safety Mechanisms

**Rate Limits:**
- Daily send cap (start at 20, ramp by +10 every 2 days if clean)
- Auto-pause if bounce rate >5% or complaints >0.1%
- Manual review required for all positive responses

**Quality Control:**
- Only send to P(close) ≥ 0.4 (medium-high probability)
- Max 3 touches per lead
- Track unsubscribes and honor immediately
- CAN-SPAM footer on every email

**Learning Loop:**
- Track outcomes in campaign_outcomes table
- Weekly comparison: predicted P(close) vs actual response rate
- Adjust probability model based on real data

---

## Next Steps

1. Review this design
2. Run migration 051
3. Set warmup config (start conservative: 20/day)
4. Test with manual seed data first
5. Launch with top 20 EV leads from optimization pipeline
6. Iterate based on actual response patterns
