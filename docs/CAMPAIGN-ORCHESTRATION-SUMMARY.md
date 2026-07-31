# Campaign Orchestration - Summary

**Status:** Foundation ready, endpoints to be implemented  
**Goal:** Get 5-10 negotiable leads from first campaign cycle

---

## What's Ready NOW

### ✅ Database (Migration 051 Applied)

3 new tables created:

1. **`campaign_lead_queue`** - Links optimization pipeline to outreach
   - Tracks touch attempts (0-3 max)
   - Stores expected value + offer ranges from optimization
   - Manages reply sentiment + manual review flags

2. **`campaign_message_library`** - Email templates with personalization
   - 3 default templates seeded (initial, follow-up, final)
   - Variables: `{name}`, `{address}`, `{offer}`, `{arv}`, `{closing_days}`

3. **`campaign_outcomes`** - Tracks results for learning
   - Predicted vs actual close rates
   - Touches to outcome
   - Deal fee amounts

### ✅ Existing Infrastructure (Already Built)

- Email sending (`emailDriver.ts` with CAN-SPAM compliance)
- Warmup tracking (`email_warmup_config`, `email_daily_sends`)
- Message events (`message_events` table)
- Optimization pipeline (lead scores, valuations, probabilities)

---

## What Needs Implementation

### Phase 1: Core Orchestration (Next)

**File:** `apps/web/src/app/api/campaigns/orchestrator/daily-plan/route.ts`
- Pulls top EV leads from optimization pipeline
- Checks daily send limit from `email_warmup_config`
- Queues leads into `campaign_lead_queue`
- Returns send plan for today

**File:** `apps/web/src/app/api/campaigns/orchestrator/execute-sends/route.ts`
- Sends queued emails (respects rate limits)
- Uses templates from `campaign_message_library`
- Personalizes with lead data
- Logs to `message_events` and increments `email_daily_sends`

### Phase 2: Response Handling

**File:** `apps/web/src/app/api/campaigns/orchestrator/classify-reply/route.ts`
- Claude-based reply classification (positive/neutral/negative/objection/question)
- Updates `campaign_lead_queue` with sentiment
- Flags high-value replies for manual review
- Creates `speed_alerts` for positive responses

### Phase 3: Follow-Up Automation

- Auto-schedule touch 2 (2 days after touch 1)
- Auto-schedule touch 3 (5 days after touch 1)
- Stop sequence if reply received or 3 touches reached

---

## Campaign Strategy

### Rate Limits (Start Conservative)

```sql
-- Set initial warmup config (20 emails/day)
INSERT INTO email_warmup_config (
  organization_id, 
  daily_limit, 
  ramp_increment, 
  ramp_interval_days
) VALUES (
  'your-org-id',
  20,              -- Start at 20/day
  10,              -- Increase by 10
  2                -- Every 2 days (if clean)
);
```

### Message Sequence (Max 3 Touches)

1. **Day 0:** Initial offer email
   - Lead with offer range
   - Emphasize speed + as-is purchase
   
2. **Day 2:** Follow-up (if no response)
   - Gentle reminder
   - Offer stands, happy to answer questions
   
3. **Day 7:** Final check (if no response)
   - Last touch before moving on
   - No pressure, wish them well

### Lead Selection Criteria

Only send to leads with:
- ✅ P(close) ≥ 0.4 (medium-high probability)
- ✅ Valid email address
- ✅ Not already contacted
- ✅ `lead_actions.action = 'send_email'` (from optimization)

Sorted by: Expected value (highest first)

---

## Expected First Campaign Results

**Assumptions:**
- 200-300 emails sent (20/day × 10-15 days)
- 20-30% reply rate = 40-60 replies
- 25% positive rate = 10-15 interested responses
- 50% conversion to negotiation = 5-10 active deals
- 40% close rate = 2-4 contracts

**This hits the 5-10 negotiable leads target.**

---

## Daily Workflow (Once Endpoints Built)

### Morning Routine (5 min)

```bash
# 1. Generate today's send plan
POST /api/campaigns/orchestrator/daily-plan

# 2. Execute queued sends
POST /api/campaigns/orchestrator/execute-sends

# 3. Check for replies needing review
GET /api/optimization/daily-queue?filter=requires_review
```

### Throughout Day

- Respond manually to positive replies
- Track outcomes when deals progress
- Monitor `speed_alerts` for hot leads

---

## Integration with Optimization Pipeline

### Flow

```
Optimization Pipeline (MVP)
  ↓ lead_scores (composite score 0-1)
  ↓ property_valuations (offer ranges)
  ↓ deal_probabilities (P(close), EV)
  ↓ lead_actions (action: 'send_email', priority: EV)
  ↓
Campaign Orchestration (NEW)
  ↓ campaign_lead_queue (rate-limited sends)
  ↓ email_warmup_config (daily limits)
  ↓ campaign_message_library (templates)
  ↓ emailDriver (CAN-SPAM compliance)
  ↓ message_events (sent)
  ↓
Inbound Replies
  ↓ classify-reply (Claude sentiment analysis)
  ↓ campaign_lead_queue (status: 'replied', sentiment, review flag)
  ↓ speed_alerts (if positive + high EV)
  ↓
Manual Review & Negotiation
  ↓ conversion layer (offer framing, negotiation agents)
  ↓ campaign_outcomes (track results)
  ↓
Learning Loop
  ↓ Compare predicted P(close) vs actual close rates
  ↓ Refine probability model weights
  ↓ Improve EV predictions
```

---

## Safety Mechanisms

### Rate Limiting
- Daily send cap per org (start 20, ramp gradually)
- Auto-pause if bounce >5% or complaints >0.1%
- Track in `email_daily_sends` table

### Quality Control
- Only P(close) ≥ 0.4 leads
- Max 3 touches per lead
- Manual review required for all positive responses
- CAN-SPAM footer on every email
- Honor unsubscribes immediately

### Learning Loop
- Track outcomes in `campaign_outcomes`
- Weekly calibration: predicted vs actual
- Adjust probability model based on real data

---

## Success Metrics

### Week 1-2 Targets
- [ ] Send 200-300 emails
- [ ] Get 40-60 replies (20-30% rate)
- [ ] Get 10-15 positive responses
- [ ] Move 5-10 to negotiation
- [ ] Close 2-3 contracts

### Key Metrics to Track
1. **Reply rate:** replies / emails sent
2. **Positive rate:** positive / total replies
3. **Conversion:** contracts / positive replies
4. **Template performance:** which touch gets best results
5. **Calibration:** predicted P(close) vs actual

---

## Implementation Priority

### Week 1: Core Sending
1. ✅ Migration 051 (DONE)
2. ⏳ Build `daily-plan` endpoint
3. ⏳ Build `execute-sends` endpoint
4. ⏳ Manual test with 5-10 leads

### Week 2: Response Handling
5. ⏳ Build `classify-reply` endpoint
6. ⏳ Hook into inbound email route
7. ⏳ Add review filter to dashboard

### Week 3: Follow-Up
8. ⏳ Auto-schedule touch 2 & 3
9. ⏳ Track outcomes when deals close
10. ⏳ Weekly calibration report

---

## Next Steps

1. **Set warmup config** for your organization (start at 20/day)
2. **Implement core endpoints** (daily-plan, execute-sends)
3. **Test with top 20 leads** from optimization pipeline
4. **Monitor first batch** for reply rates
5. **Iterate templates** based on responses

Full design: `docs/superpowers/specs/2026-07-31-campaign-orchestration.md`

---

## TL;DR

**Foundation is ready.** Database tables created, message templates seeded, integration points defined.

**Next:** Build 3 API endpoints (daily-plan, execute-sends, classify-reply).

**Goal:** Send rate-limited emails to high-EV leads, track responses, get 5-10 negotiable deals in first campaign cycle.

**The orchestration layer connects optimization intelligence to real outreach, respecting rate limits and learning from outcomes.**
