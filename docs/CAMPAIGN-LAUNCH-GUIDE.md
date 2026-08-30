# Campaign Launch Guide - Get 5-10 Negotiable Leads

**Status:** All code deployed, ready to launch first campaign  
**Goal:** Send rate-limited emails to high-EV leads, track responses, get 5-10 negotiable deals

---

## Prerequisites Checklist

Before launching, verify these are set:

### 1. Environment Variables

```bash
# Required for email sending
EMAIL_PROVIDER_URL=<your-email-provider-endpoint>
EMAIL_PROVIDER_API_KEY=<your-api-key>
EMAIL_FROM_ADDRESS=hello@yourdomain.com

# Required for CAN-SPAM compliance
COMPANY_POSTAL_ADDRESS="Your Company, 123 Main St, Suite 100, City, ST 12345"
NEXT_PUBLIC_APP_URL=https://app.yourdomain.com

# Required for reply classification
ANTHROPIC_API_KEY=<your-claude-api-key>
```

### 2. Database Setup

```sql
-- Set email warmup config (start conservative)
INSERT INTO email_warmup_config (
  organization_id,
  daily_limit,
  ramp_increment,
  ramp_interval_days,
  paused
) VALUES (
  'your-org-id',
  20,        -- Start at 20 emails/day
  10,        -- Increase by 10 every 2 days (if clean)
  2,
  false      -- NOT paused
) ON CONFLICT (organization_id) DO UPDATE
  SET daily_limit = 20,
      paused = false;
```

### 3. Leads with Optimization Data

```sql
-- Verify you have leads with optimization data
SELECT COUNT(*)
FROM leads l
JOIN lead_scores ls ON ls.lead_id = l.id
JOIN property_valuations pv ON pv.lead_id = l.id
JOIN deal_probabilities dp ON dp.lead_id = l.id
JOIN lead_actions la ON la.lead_id = l.id
WHERE l.email IS NOT NULL
  AND dp.p_close >= 0.4
  AND la.action = 'send_email';

-- If count is 0, run optimization pipeline first:
-- POST /api/optimization/process
```

---

## Daily Launch Workflow

### Step 1: Generate Today's Send Plan (Morning - 5 min)

```bash
curl -X POST http://localhost:4000/api/campaigns/orchestrator/daily-plan \
  -H "Cookie: <your-session-cookie>" \
  -H "Content-Type: application/json"
```

**Expected Response:**
```json
{
  "status": "plan_created",
  "summary": {
    "dailyLimit": 20,
    "alreadySent": 0,
    "remainingToday": 20,
    "leadsQueued": 15,
    "eligibleLeadsFound": 47
  },
  "economics": {
    "totalExpectedValueDollars": 12500,
    "avgPClose": 0.58,
    "expectedReplies": 4,
    "expectedPositiveReplies": 1
  },
  "nextStep": "Run: POST /api/campaigns/orchestrator/execute-sends",
  "queuedLeadIds": [101, 102, 103, ...]
}
```

**What this does:**
- Pulls top 20 leads by expected value
- Filters for P(close) >= 0.4 and valid email
- Queues them in `campaign_lead_queue` with status='queued'
- Respects your daily send limit (20/day to start)

---

### Step 2: Execute Sends (Morning - 2 min)

```bash
curl -X POST http://localhost:4000/api/campaigns/orchestrator/execute-sends \
  -H "Cookie: <your-session-cookie>" \
  -H "Content-Type: application/json"
```

**Expected Response:**
```json
{
  "status": "sends_executed",
  "summary": {
    "attempted": 15,
    "sent": 15,
    "failed": 0,
    "remainingTodayAfter": 5
  },
  "sent": [101, 102, 103, ...],
  "failed": [],
  "nextSteps": [
    "Monitor for replies: replies will appear in message_events",
    "Run POST /api/campaigns/orchestrator/classify-reply when replies come in",
    "Follow-up emails (touch 2) auto-queued for 2 days from now"
  ]
}
```

**What this does:**
- Sends emails to all queued leads
- Uses template from `campaign_message_library` (touch 1)
- Personalizes with lead name, address, offer range
- Logs to `message_events`
- Updates `email_daily_sends` count
- **AUTO-SCHEDULES TOUCH 2** for +2 days from send
- Marks leads as status='sent'

---

### Step 3: Monitor for Replies (Throughout Day)

**Check message_events for inbound replies:**

```sql
SELECT
  me.id as message_event_id,
  me.lead_id,
  l.name,
  me.from_address,
  me.subject,
  me.body,
  me.created_at
FROM message_events me
JOIN leads l ON l.id = me.lead_id
WHERE me.organization_id = 'your-org-id'
  AND me.direction = 'inbound'
  AND me.channel = 'email'
  AND me.created_at >= CURRENT_DATE
ORDER BY me.created_at DESC;
```

---

### Step 4: Classify Replies (As They Arrive - 1 min each)

When you see a reply, classify it:

```bash
curl -X POST http://localhost:4000/api/campaigns/orchestrator/classify-reply \
  -H "Cookie: <your-session-cookie>" \
  -H "Content-Type: application/json" \
  -d '{"messageEventId": 456}'
```

**Expected Response:**
```json
{
  "status": "reply_classified",
  "leadId": 101,
  "leadName": "John Smith",
  "classification": {
    "sentiment": "positive",
    "requiresManualReview": true,
    "counterOfferCents": null,
    "reasoning": "Lead expressed interest in discussing the offer and asked about timeline"
  },
  "nextSteps": [
    "Check dashboard for leads requiring manual review",
    "Respond to high-value lead ASAP"
  ]
}
```

**What this does:**
- Sends reply to Claude for sentiment analysis
- Classifies as: positive / question / objection / neutral / negative
- Updates `campaign_lead_queue` with sentiment
- Flags high-value positive replies for manual review
- Creates `speed_alerts` for EV >$5k positive responses
- Detects counter-offers and logs to `negotiation_events`

---

### Step 5: Respond to Positive Replies (Immediately)

**Check leads requiring manual review:**

```sql
SELECT
  clq.lead_id,
  l.name,
  l.phone,
  l.email,
  l.metadata->>'address' as address,
  clq.reply_sentiment,
  clq.expected_value,
  clq.offer_min,
  clq.offer_max,
  clq.last_reply_at
FROM campaign_lead_queue clq
JOIN leads l ON l.id = clq.lead_id
WHERE clq.organization_id = 'your-org-id'
  AND clq.requires_manual_review = true
  AND clq.reply_sentiment IN ('positive', 'question')
ORDER BY clq.expected_value DESC;
```

**For each positive reply:**
1. Call the lead immediately (phone from leads table)
2. Reference their specific response
3. Move to negotiation if interested
4. Track outcome manually (we'll automate this later)

---

## Follow-Up Sequence (Automated)

### Touch 1 (Day 0): Initial Offer
- Sent manually via execute-sends
- Template: "Quick question about {address}"
- Includes offer range, benefits, timeline

### Touch 2 (Day 2): Follow-Up
- **AUTO-QUEUED** when touch 1 is sent
- Scheduled for +2 days from initial send
- Template: "Following up on {address}"
- Gentle reminder, offer stands, happy to answer questions

### Touch 3 (Day 7): Final Check
- **MANUAL TRIGGER** (or cron job)
- Run `daily-plan` + `execute-sends` again after 5 more days
- Template: "Last check-in on {address}"
- Final opportunity, no pressure

**Max touches: 3 per lead (CAN-SPAM safe, domain-safe)**

---

## First Campaign Metrics to Track

### Week 1 Goals
- [ ] 100-150 emails sent (20/day × 5-7 days)
- [ ] 20-30 replies (20-25% reply rate)
- [ ] 5-8 positive responses
- [ ] 2-4 active negotiations
- [ ] 1-2 contracts signed

### Success Indicators

**Daily:**
- Reply rate: 20-30% (good domain reputation)
- Bounce rate: <5% (clean list)
- Positive sentiment: 25-30% of replies

**Weekly:**
- Positive replies: 5-10
- Negotiations started: 2-5
- Contracts: 1-3

**If metrics are low:**
- Reply rate <10% → Email copy needs work
- Bounce rate >5% → List quality issue
- Positive rate <15% → Offer ranges too low or targeting wrong leads

---

## Troubleshooting

### No leads queued
```
Error: "No eligible leads found"
```
**Fix:** Run optimization pipeline first:
```bash
curl -X POST http://localhost:4000/api/optimization/process \
  -H "Cookie: <your-session-cookie>"
```

### Daily limit reached
```
Status: "limit_reached"
```
**Fix:** Either wait until tomorrow, or increase limit if email reputation is strong:
```sql
UPDATE email_warmup_config
SET daily_limit = 30
WHERE organization_id = 'your-org-id';
```

### Email sending paused
```
Error: "Email sending paused"
```
**Fix:** Check bounce/complaint rates:
```sql
SELECT * FROM email_daily_sends
WHERE organization_id = 'your-org-id'
ORDER BY date DESC LIMIT 7;

-- If rates are clean, unpause:
UPDATE email_warmup_config
SET paused = false, paused_reason = NULL
WHERE organization_id = 'your-org-id';
```

### Reply classification fails
```
Error: "Failed to classify reply"
```
**Fix:** Check Claude API key is set:
```bash
echo $ANTHROPIC_API_KEY
```

---

## Campaign Economics

### Expected First Campaign (Week 1)

**Inputs:**
- 150 emails sent @ 20/day
- 25% reply rate = 38 replies
- 25% positive = 10 interested leads
- 40% conversion = 4 contracts
- Avg fee: $8,000

**Outputs:**
- 4 contracts × $8,000 = **$32,000 in fees**
- Cost: ~$50 in email/API costs
- ROI: 640x

**This hits your 5-10 negotiable leads goal.**

---

## Next Steps After First Campaign

Once you have real data from Week 1:

### 1. Calibrate Probability Model
```sql
-- Compare predicted P(close) vs actual outcomes
SELECT
  dp.p_close as predicted,
  CASE WHEN co.actual_closed THEN 1.0 ELSE 0.0 END as actual
FROM deal_probabilities dp
JOIN campaign_outcomes co ON co.lead_id = dp.lead_id
WHERE co.recorded_at >= CURRENT_DATE - 7;
```

### 2. Optimize Message Templates
- Which subject lines get highest reply rates?
- Which offer framing gets most positive responses?
- A/B test templates in `campaign_message_library`

### 3. Ramp Up Send Volume
If bounce <5% and complaint <0.1%:
```sql
UPDATE email_warmup_config
SET daily_limit = daily_limit + 10
WHERE organization_id = 'your-org-id';
```

### 4. Automate Follow-Ups
- Build cron job for touch 3
- Auto-classify all replies (not just manual)
- Integrate with inbound email webhook

---

## Ready to Launch?

**Final checklist:**
- [ ] Email provider configured (EMAIL_PROVIDER_URL set)
- [ ] CAN-SPAM compliance (postal address set)
- [ ] Claude API key configured
- [ ] Warmup config set (20/day)
- [ ] Leads have optimization data (P(close) ≥ 0.4)
- [ ] Message templates seeded (check `campaign_message_library`)

**Launch sequence:**
1. `POST /api/campaigns/orchestrator/daily-plan`
2. `POST /api/campaigns/orchestrator/execute-sends`
3. Monitor `message_events` for replies
4. `POST /api/campaigns/orchestrator/classify-reply` for each reply
5. Respond manually to positive leads
6. Repeat daily

**Goal:** 5-10 negotiable leads within 2 weeks. Let's launch.
