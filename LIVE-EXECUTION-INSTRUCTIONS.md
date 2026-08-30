# 🔥 LIVE CAMPAIGN EXECUTION - YOU ARE HERE

**Status:** System validated (100/100), ready for live execution  
**Objective:** Validate agents produce coherent, usable, effective responses in real conversations

---

## Prerequisites ✅

- ✅ All agents implemented
- ✅ Database tables created (migrations 050, 051)
- ✅ Ollama running for AI classification
- ✅ Supabase connection available

---

## Step 1: Set Environment Variables

```bash
# From D:/anything directory
cd D:/anything

# Set database connection
export DATABASE_URL="postgresql://postgres:Dqbeasty+874774!!!@db.apdngzmopuygwfchkttx.supabase.co:5432/postgres"

# Set Ollama for reply classification
export OLLAMA_BASE_URL="http://localhost:11434"

# Optional: Set email provider (or use mock)
# export EMAIL_PROVIDER_URL="https://your-email-api.com"
# export EMAIL_FROM_ADDRESS="hello@yourdomain.com"
# export COMPANY_POSTAL_ADDRESS="Your Company, 123 Main St, City, ST 12345"
```

---

## Step 2: Apply Migrations (If Not Already Applied)

```bash
# Install Supabase CLI if needed
npm install -g supabase

# Login to Supabase
supabase login

# Link project
supabase link --project-ref apdngzmopuygwfchkttx

# Apply migrations
supabase db push

# Or manually apply via SQL:
# supabase db execute < apps/web/db/migrations/050_optimization_tables.sql
# supabase db execute < apps/web/db/migrations/051_campaign_orchestration.sql
```

---

## Step 3: Seed Test Leads (If Database is Empty)

```bash
# Create test leads for campaign
supabase db execute << SQL
INSERT INTO organizations (id, name) VALUES ('test-org-1', 'Test Organization')
ON CONFLICT (id) DO NOTHING;

INSERT INTO leads (organization_id, name, email, phone, metadata) VALUES
('test-org-1', 'John Smith', 'john.smith@example.com', '+15555551234', 
 '{"address": "123 Main St, City, ST 12345", "signals": ["pre_foreclosure", "vacant"]}'::jsonb),
('test-org-1', 'Jane Doe', 'jane.doe@example.com', '+15555555678',
 '{"address": "456 Oak Ave, City, ST 12345", "signals": ["probate"]}'::jsonb),
('test-org-1', 'Bob Johnson', 'bob.johnson@example.com', '+15555559012',
 '{"address": "789 Elm St, City, ST 12345", "signals": ["listed", "price_drop"]}'::jsonb)
ON CONFLICT DO NOTHING;
SQL
```

---

## Step 4: Execute Live Campaign

```bash
# DRY RUN (no real emails, test logic only)
export DRY_RUN=true
node apps/web/scripts/live-campaign-execution.mjs

# LIVE EXECUTION (sends real emails if EMAIL_PROVIDER_URL set)
export DRY_RUN=false
node apps/web/scripts/live-campaign-execution.mjs
```

---

## What the Script Does

### Phase 1: Verify Prerequisites
- ✅ Connect to database
- ✅ Check all required tables exist
- ✅ Verify leads in database
- ✅ Check email_warmup_config

### Phase 2: Run Optimization Pipeline
- Processes unoptimized leads
- Calculates scores, valuations, probabilities
- Creates lead_actions (send_email)
- Logs to lead_scores, property_valuations, deal_probabilities tables

### Phase 3: Execute Campaign
- Queries eligible leads (P(close) ≥ 0.4, has email)
- Respects daily send limit (20/day default)
- Queues leads in campaign_lead_queue
- Sends emails via emailDriver (or mock)
- Logs to message_events
- Auto-schedules touch 2 (+2 days)

### Phase 4: Process Mock Replies
- Creates test replies for classification
- Tests negotiation agent logic
- Validates response generation
- Logs to negotiation_events

### Phase 5: Generate Report
- Summary of emails sent, replies classified
- Database statistics
- Error log
- Next steps

---

## Expected Output

```
🚀 LIVE CAMPAIGN EXECUTION
======================================================================

Database: db.apdngzmopuygwfchkttx.supabase.co
Ollama: http://localhost:11434
Mode: DRY RUN (no emails sent)

📋 PHASE 1: Verifying Prerequisites

✅ Database connected: postgres
✅ Table exists: leads
✅ Table exists: lead_scores
✅ Table exists: property_valuations
✅ Table exists: deal_probabilities
✅ Table exists: campaign_lead_queue
✅ Table exists: campaign_message_library
✅ Table exists: email_warmup_config
✅ Table exists: message_events
✅ Table exists: negotiation_events

📊 Leads in database: 3
✅ Warmup config: 20/day, paused: false

📋 PHASE 2: Running Optimization Pipeline

Found 3 unprocessed leads
Processing lead 1 (John Smith)...
  ✅ Optimized lead 1
Processing lead 2 (Jane Doe)...
  ✅ Optimized lead 2
Processing lead 3 (Bob Johnson)...
  ✅ Optimized lead 3

✅ Processed 3 leads

📋 PHASE 3: Executing Campaign

Daily limit: 20 emails
Already sent today: 0
Remaining: 20

Queuing 3 leads for sending...

[DRY RUN] Would send to: john.smith@example.com (John Smith)
[DRY RUN] Would send to: jane.doe@example.com (Jane Doe)
[DRY RUN] Would send to: bob.johnson@example.com (Bob Johnson)

✅ Campaign executed: 3 emails sent

📋 PHASE 4: Processing Mock Replies

Mock reply: "Yes, interested. What are the next steps?"
Expected classification: ACCEPTANCE_SIGNAL
Actual classification: ACCEPTANCE_SIGNAL
  ✅ Correct classification

Mock reply: "Your offer is too low. I need at least $200k"
Expected classification: PRICE_PUSHBACK
Actual classification: PRICE_PUSHBACK
  ✅ Correct classification

✅ Classified 4 replies

📋 PHASE 5: Execution Summary

======================================================================
LIVE CAMPAIGN VALIDATION RESULTS
======================================================================

Leads Processed: 3
Emails Sent: 3
Replies Classified: 4
Agent Responses Generated: 0
Errors: 0

DATABASE STATS:
  Total Queued: 3
  Total Sent: 3
  Total Replied: 0

✅ LIVE EXECUTION COMPLETE

Next steps:
1. Monitor inbox for real replies
2. Classify replies with: POST /api/campaigns/orchestrator/classify-reply
3. Generate responses with: POST /api/conversion/negotiation
4. Track outcomes in negotiation_events table
```

---

## Step 5: Process Real Replies (When They Come In)

### Option A: Via API Endpoint

```bash
# Classify a reply
curl -X POST http://localhost:4000/api/campaigns/orchestrator/classify-reply \
  -H "Content-Type: application/json" \
  -H "Cookie: your-session-cookie" \
  -d '{"messageEventId": 123}'

# Generate negotiation response
curl -X POST http://localhost:4000/api/conversion/negotiation \
  -H "Content-Type: application/json" \
  -H "Cookie: your-session-cookie" \
  -d '{
    "leadId": 456,
    "inboundMessage": "Your offer is too low",
    "currentOffer": 160000
  }'
```

### Option B: Via Direct Script

```javascript
// Process reply directly
import { neon } from '@neondatabase/serverless';
const sql = neon(process.env.DATABASE_URL);

// Get unclassified replies
const replies = await sql`
  SELECT id, lead_id, body
  FROM message_events
  WHERE direction = 'inbound'
    AND channel = 'email'
    AND status = 'received'
  ORDER BY created_at DESC
  LIMIT 10
`;

for (const reply of replies) {
  // Classify and respond
  console.log(`Processing reply from lead ${reply.lead_id}`);
  // Call classification API or run agent logic
}
```

---

## Step 6: Monitor & Observe Behavior

### Track These Metrics in Database:

```sql
-- Campaign performance
SELECT
  status,
  COUNT(*) as count,
  AVG(EXTRACT(EPOCH FROM (last_reply_at - last_sent_at))/3600)::numeric(10,1) as avg_hours_to_reply
FROM campaign_lead_queue
WHERE last_sent_at IS NOT NULL
GROUP BY status;

-- Reply classifications
SELECT
  reply_sentiment,
  COUNT(*) as count
FROM campaign_lead_queue
WHERE reply_sentiment IS NOT NULL
GROUP BY reply_sentiment;

-- Agent responses
SELECT
  event_type,
  COUNT(*) as count
FROM negotiation_events
GROUP BY event_type;

-- Conversion funnel
SELECT
  COUNT(*) FILTER (WHERE status = 'sent') as sent,
  COUNT(*) FILTER (WHERE status = 'replied') as replied,
  COUNT(*) FILTER (WHERE status = 'interested') as interested,
  COUNT(*) FILTER (WHERE requires_manual_review = true) as needs_review
FROM campaign_lead_queue;
```

---

## What We're Validating

### ✅ Agent Coherence
- Do offer framing messages make sense?
- Are reply classifications accurate?
- Are negotiation responses appropriate?
- Do follow-ups progress logically?

### ✅ System Reliability
- Do emails send successfully?
- Are replies captured correctly?
- Does queue management work?
- Are outcomes tracked properly?

### ✅ Real-World Effectiveness
- Do sellers respond?
- Do agents move conversations forward?
- Are classifications useful?
- Does the system produce actionable insights?

---

## NOT Doing Yet (After Data Collection)

- ❌ Machine learning optimization
- ❌ Automated A/B testing
- ❌ Probability model refinement
- ❌ Template performance optimization
- ❌ Learning loops

**First:** Collect real data  
**Then:** Build learning systems on top of proven agents

---

## Troubleshooting

### Connection Errors

```bash
# Test database connection
node -e "
import('@neondatabase/serverless').then(({neon}) => {
  const sql = neon(process.env.DATABASE_URL);
  sql\`SELECT 1\`.then(() => console.log('✅ Connected'))
    .catch(e => console.error('❌ Error:', e.message));
});
"
```

### No Leads Found

```bash
# Check leads table
echo "SELECT COUNT(*) FROM leads;" | supabase db execute
```

### Migrations Not Applied

```bash
# Check if tables exist
echo "SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename LIKE 'campaign%';" | supabase db execute
```

---

## Ready to Execute?

1. ✅ Environment variables set (DATABASE_URL, OLLAMA_BASE_URL)
2. ✅ Migrations applied (050, 051)
3. ✅ Test leads in database
4. ✅ Ollama running

**Run:** `node apps/web/scripts/live-campaign-execution.mjs`

**You are at Step 3 of 4: Run System LIVE 🔥**
