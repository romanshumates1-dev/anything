# Campaign System Validation

**Run this BEFORE launching your first campaign to verify everything works end-to-end.**

---

## What This Tests

### Phase 1: Prerequisites (10 checks)
- ✅ Environment variables (Claude API, database, email config)
- ✅ Database connection
- ✅ All 10 required tables exist
- ✅ Message templates seeded (3 templates)

### Phase 2: Test Data (2 checks)
- ✅ Can create test lead
- ✅ Can configure email warmup

### Phase 3: Optimization Pipeline (4 checks)
- ✅ Lead scoring works (composite score calculation)
- ✅ Valuation works (ARV, offer ranges)
- ✅ Probability works (P(close), expected value)
- ✅ Decision works (action prioritization)

### Phase 4: Campaign Orchestration (6 checks)
- ✅ Daily plan can find eligible leads
- ✅ Leads can be queued for sending
- ✅ Email composition with personalization
- ✅ CAN-SPAM compliance (subject, unsubscribe, postal)
- ✅ Mock send successful
- ✅ Follow-up auto-scheduled (+2 days)

### Phase 5: Reply Classification (2 checks)
- ✅ Mock reply created
- ✅ Sentiment classification works
- ✅ Speed alert created for hot leads

### Phase 6: Integration (3 checks)
- ✅ Database indexes exist
- ✅ Rate limiting configured
- ✅ Circuit breaker active

**Total: ~27 validation checks**

---

## How to Run

### Option 1: Quick Validation (Recommended)

```bash
# From project root
cd D:/anything
node apps/web/scripts/validate-campaign-system.mjs
```

### Option 2: With Environment Loading

```bash
# If you need to load .env first
export $(cat .env | xargs)
node apps/web/scripts/validate-campaign-system.mjs
```

### Option 3: With NPM Script

```bash
# Add to package.json scripts:
"validate": "node apps/web/scripts/validate-campaign-system.mjs"

# Then run:
npm run validate
```

---

## Expected Output

```
🚀 DealFlow Campaign System Validation

Testing end-to-end pipeline with mock data...

📋 PHASE 1: Prerequisites Check

✅ env-required: ANTHROPIC_API_KEY is set
✅ env-required: DATABASE_URL is set
✅ env-required: NEXTAUTH_SECRET is set
⚠️  env-optional: EMAIL_PROVIDER_URL not set (will use mock/default)
✅ env-optional: EMAIL_FROM_ADDRESS is set
✅ env-optional: COMPANY_POSTAL_ADDRESS is set
✅ database: Connection successful
✅ migration: Table leads exists
✅ migration: Table lead_scores exists
✅ migration: Table property_valuations exists
✅ migration: Table deal_probabilities exists
✅ migration: Table lead_actions exists
✅ migration: Table campaign_lead_queue exists
✅ migration: Table campaign_message_library exists
✅ migration: Table campaign_outcomes exists
✅ migration: Table email_warmup_config exists
✅ migration: Table message_events exists
✅ templates: 3 message templates seeded

📋 PHASE 2: Test Data Setup

✅ test-data: Test lead created: ID 123
✅ warmup-config: Email warmup configured (5/day for testing)

📋 PHASE 3: Optimization Pipeline

✅ lead-scoring: Score: 0.75 (distress: 0.85)
✅ valuation: ARV: $250k, Offer: $150k-$160k
✅ probability: P(close): 0.65, EV: $5200
✅ decision: Action: send_email (priority: $5,200 EV)

📋 PHASE 4: Campaign Orchestration

✅ daily-plan: 1 leads eligible for campaign
✅ queue-creation: Lead queued: queue ID 456
✅ email-composition: Subject: "Quick question about 123 Test St..."
✅ can-spam: CAN-SPAM compliance: subject ✓ unsubscribe ✓ postal ✓
✅ mock-send: Email send simulated (mock provider)
✅ follow-up: Touch 2 scheduled for 08/02/2026

📋 PHASE 5: Reply Classification

✅ reply-mock: Mock reply created: message ID 789
✅ reply-classify: Classified as: positive (requires review: true)
✅ speed-alert: Hot lead alert created

📋 PHASE 6: Integration Checks

✅ indexes: 12 indexes found on campaign tables
✅ rate-limit: Conservative limit: 5/day (good for testing)
✅ circuit-breaker: Mock mode (no provider = no breaker needed)

🧹 Test data cleaned up

======================================================================
📊 VALIDATION RESULTS
======================================================================

✅ Passed: 27
❌ Failed: 0
⚠️  Warnings: 1

⚠️  WARNINGS:

  • env-optional: EMAIL_PROVIDER_URL not set (will use mock/default)

======================================================================
🎯 READINESS SCORE: 100/100
======================================================================

✅ SYSTEM OPERATIONAL - Ready to launch campaign

📝 Broken steps: None
🔧 Action required: System validated, ready to launch
```

---

## Interpreting Results

### Readiness Score: 100/100
**Status:** ✅ System fully operational  
**Action:** Proceed with campaign launch

### Readiness Score: 90-99/100
**Status:** ✅ System mostly operational  
**Action:** Minor issues present, but can launch. Check warnings.

### Readiness Score: 70-89/100
**Status:** ⚠️ System partially operational  
**Action:** Fix critical failures before launch. Review failed steps.

### Readiness Score: <70/100
**Status:** ❌ System not operational  
**Action:** Do NOT launch. Fix all failures first.

---

## Common Warnings (OK to Launch)

### `EMAIL_PROVIDER_URL not set`
**Impact:** Uses mock provider (no real sends)  
**Fix:** Set `EMAIL_PROVIDER_URL` before production launch  
**Launch?** ✅ Yes (for testing)

### `speed_alerts table may not exist`
**Impact:** Hot lead alerts won't be created  
**Fix:** Run missing migration or create table manually  
**Launch?** ✅ Yes (non-critical)

### `Only X indexes found`
**Impact:** May have slower queries on large datasets  
**Fix:** Check `docs/superpowers/specs/` for index definitions  
**Launch?** ✅ Yes (performance optimization)

---

## Common Failures (Must Fix)

### `Table X missing`
**Impact:** Critical - system cannot run  
**Fix:** Run migrations: `psql $DATABASE_URL -f apps/web/db/migrations/`  
**Launch?** ❌ No

### `No templates found`
**Impact:** Critical - cannot send emails  
**Fix:** Re-run migration 051 or manually insert templates  
**Launch?** ❌ No

### `No organization found`
**Impact:** Critical - no org context  
**Fix:** Create organization record in database  
**Launch?** ❌ No

### `ANTHROPIC_API_KEY is MISSING`
**Impact:** Critical - reply classification will fail  
**Fix:** Set environment variable  
**Launch?** ❌ No

### `Email warmup is PAUSED`
**Impact:** Critical - no sends allowed  
**Fix:** `UPDATE email_warmup_config SET paused = false`  
**Launch?** ❌ No

---

## What Gets Tested (No Real Sends)

### Mock Data Flow
```
Test Lead Created
  ↓ optimization agents run (mock scoring)
  ↓ valuation calculated
  ↓ probability assigned
  ↓ action decided (send_email)
Campaign Queue
  ↓ lead queued
  ↓ email composed with personalization
  ↓ CAN-SPAM compliance checked
  ↓ mock send executed (no real provider call)
  ↓ message_events logged
  ↓ touch 2 auto-scheduled
Mock Reply
  ↓ inbound reply created
  ↓ sentiment classified (positive)
  ↓ speed alert created
  ↓ queue updated (requires_manual_review)
Cleanup
  ↓ all test data deleted
```

**No real emails sent. No API calls to Claude. Pure system validation.**

---

## Troubleshooting

### Script Won't Run
```bash
# Check Node version (need 18+)
node --version

# Check if script is executable
ls -la apps/web/scripts/validate-campaign-system.mjs

# Try with explicit node
node --loader ts-node/esm apps/web/scripts/validate-campaign-system.mjs
```

### Database Connection Fails
```bash
# Verify DATABASE_URL is set
echo $DATABASE_URL

# Test connection manually
psql $DATABASE_URL -c "SELECT 1"

# Check if DB is running
pg_isready -h localhost -p 5432
```

### Import Errors
```bash
# Ensure sql utility exists
ls apps/web/src/app/api/utils/sql.js

# Check if .js extension is needed (ESM)
# Script uses: import sql from '../src/app/api/utils/sql.js'
```

### Validation Hangs
```bash
# Script may be waiting on DB connection
# Check for long-running queries:
psql $DATABASE_URL -c "SELECT * FROM pg_stat_activity WHERE state = 'active'"

# Kill hung queries if needed
```

---

## After Validation

### If Score = 100/100
1. ✅ System validated
2. ✅ Set real `EMAIL_PROVIDER_URL` (if not using mock)
3. ✅ Increase warmup limit from 5 to 20: `UPDATE email_warmup_config SET daily_limit = 20`
4. ✅ Run optimization pipeline on real leads: `POST /api/optimization/process`
5. ✅ Launch first campaign: See `docs/CAMPAIGN-LAUNCH-GUIDE.md`

### If Score < 100
1. ❌ Review failed steps in output
2. ❌ Fix each failure
3. ❌ Re-run validation: `node apps/web/scripts/validate-campaign-system.mjs`
4. ❌ Repeat until 100/100

---

## Safety Features Tested

### CAN-SPAM Compliance ✅
- Subject line present
- Unsubscribe URL included in body
- Physical postal address in footer
- Valid recipient email format

### Rate Limiting ✅
- Daily send limit enforced
- Pause mechanism works
- Send count tracking

### Org Scoping ✅
- All queries scoped to organization
- No cross-org data leaks

### Error Handling ✅
- Failed sends don't crash pipeline
- Missing data handled gracefully
- Cleanup runs even on errors

### Data Integrity ✅
- Foreign key constraints work
- Unique constraints prevent duplicates
- Indexes present for performance

---

## What's NOT Tested

These require manual testing or production monitoring:

- ❌ Real email deliverability (inbox placement)
- ❌ Actual Claude API responses (uses mock data)
- ❌ Provider-specific errors (SES, SendGrid, etc.)
- ❌ Bounce/complaint handling (needs real sends)
- ❌ Multi-day campaign sequences (need time passage)
- ❌ Production load (concurrent sends)
- ❌ Edge cases (malformed replies, etc.)

**Use this validation to confirm system is wired correctly. Then launch a small test campaign (5-10 leads) to validate real-world behavior.**

---

## Next Steps

1. **Run validation:** `node apps/web/scripts/validate-campaign-system.mjs`
2. **Review results:** Check readiness score and fix any failures
3. **Configure production:** Set real EMAIL_PROVIDER_URL and warmup limits
4. **Launch test campaign:** 5-10 leads to validate end-to-end
5. **Monitor metrics:** Reply rates, bounce rates, sentiment classification
6. **Scale gradually:** Ramp from 20/day to 50/day over 2 weeks

**Validation runs in <30 seconds. Run it every time you deploy changes to campaign system.**
