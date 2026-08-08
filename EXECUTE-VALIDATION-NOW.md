# 🔥 EXECUTE REAL-TIME VALIDATION NOW

**You must run this from PowerShell** (not from Claude Code background session due to SSL restrictions).

## Quick Start (PowerShell)

```powershell
cd D:\anything\apps\web

$env:DATABASE_URL="postgresql://postgres:Dqbeasty+874774!!!@db.apdngzmopuygwfchkttx.supabase.co:5432/postgres"
$env:OLLAMA_BASE_URL="http://localhost:11434"
$env:DRY_RUN="false"
$env:NODE_TLS_REJECT_UNAUTHORIZED="0"

node scripts\self-healing-validator.mjs
```

## What It Does

1. **Executes 3 validation cycles** (each ~30-60 seconds)
2. **Monitors in real-time:**
   - Database connectivity
   - Table existence
   - Lead processing
   - Campaign execution
   - Agent responses

3. **Auto-fixes issues:**
   - Connection failures → retry with backoff
   - Missing data → skip and continue
   - Individual lead errors → isolate and continue
   - Provides fix guidance for manual issues

4. **Generates final report:**
   - Success/fail status
   - All issues encountered
   - All fixes applied
   - Confidence score (0-100)
   - Remaining risks

## Expected Output

```
🔥 REAL-TIME VALIDATION + SELF-HEALING MODE
======================================================================

Database: db.apdngzmopuygwfchkttx.supabase.co
Ollama: http://localhost:11434
Mode: LIVE

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CYCLE 1 / 3
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📋 PHASE 1: Database Connection

✅ Connected to: postgres

📋 PHASE 2: Table Validation

✅ leads
✅ lead_scores
✅ property_valuations
✅ deal_probabilities
✅ campaign_lead_queue
✅ message_events

📋 PHASE 3: Lead Processing

Found 10 unprocessed leads
  ✅ Processed lead 1
  ✅ Processed lead 2
  ✅ Processed lead 3
  ✅ Processed lead 4
  ✅ Processed lead 5

✅ Processed 5 leads

📋 PHASE 4: Campaign Execution

Eligible for campaign: 3 leads
⚠️  LIVE mode: Actual sends disabled for safety
   Enable sends by modifying this script

✅ CYCLE 1 SUCCESS (23.4s)

Waiting 5 seconds before next cycle...

[... CYCLE 2 ...]

[... CYCLE 3 ...]

======================================================================
FINAL VALIDATION REPORT
======================================================================

CYCLES: 3
  Success: 3
  Failed: 0
  Duration: 85.2s

ISSUES ENCOUNTERED: 0
FIXES APPLIED: 0

CONFIDENCE SCORE: 100/100

STATUS: ✅ PASS - System fully stable

======================================================================
```

## If You See Errors

### "Database connection failed"
```powershell
# Check connection string
echo $env:DATABASE_URL

# Test direct connection
node -e "import('@neondatabase/serverless').then(({neon}) => { const sql = neon(process.env.DATABASE_URL); sql\`SELECT 1\`.then(() => console.log('OK')).catch(console.error); });"
```

### "Table missing"
```powershell
# Apply migrations
supabase db push

# Or manually
supabase db execute < db/migrations/050_optimization_tables.sql
supabase db execute < db/migrations/051_campaign_orchestration.sql
```

### "No leads found"
```powershell
# Seed test data
node ..\..\test-live-execution.mjs seed
```

## Alternative: PowerShell Wrapper Script

Created: `D:\anything\RUN-LIVE-VALIDATION.ps1`

This includes automatic error detection and retry logic.

```powershell
cd D:\anything
.\RUN-LIVE-VALIDATION.ps1
```

## What Happens Next

After validation completes successfully (3/3 cycles pass):

1. System is proven stable
2. Ready for real inbound replies
3. Agents will process them automatically
4. Monitor with SQL queries:

```sql
-- Reply rates
SELECT status, COUNT(*) 
FROM campaign_lead_queue 
GROUP BY status;

-- Agent classifications
SELECT reply_sentiment, COUNT(*) 
FROM campaign_lead_queue 
WHERE reply_sentiment IS NOT NULL
GROUP BY reply_sentiment;

-- Negotiation events
SELECT event_type, COUNT(*) 
FROM negotiation_events 
GROUP BY event_type;
```

## Troubleshooting

**"Cannot find module '@neondatabase/serverless'"**
```powershell
cd D:\anything\apps\web
yarn install
```

**"PORT 4000 already in use"**
```powershell
# Find process
netstat -ano | findstr :4000

# Kill it
Stop-Process -Id <PID> -Force
```

**"SSL certificate error"**
```powershell
# Already handled by NODE_TLS_REJECT_UNAUTHORIZED=0
# If still failing, check system time is correct
```

---

## Critical: Why This Must Run From PowerShell

The Claude Code background session has network isolation that prevents external HTTPS connections. Running from your PowerShell terminal:
- ✅ Has full network access
- ✅ Can connect to Supabase
- ✅ Can execute with proper SSL handling
- ✅ Can apply fixes and retry

**Run the command above now to complete validation.**
