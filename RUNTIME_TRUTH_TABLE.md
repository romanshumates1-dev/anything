# Runtime Truth Table: Real AI Call Path

## Exact Call Path (No Mocks in Runtime)

### 1. User sends SMS
```
POST /api/sms/inbound
├── Validates SMS_INBOUND_SECRET
├── Extracts { from, text } from Twilio or JSON body
├── Finds lead in database by phone
├── Inserts user message into ai_conversations.history
└── Enqueues job: ai_reply with { leadId, conversationId }
```

### 2. Job Processor (Cron/System Trigger)
```
processNextJob() in jobs.ts
├── SELECT pending job from jobs table
└── CASE: ai_reply
    ├── SELECT ai_conversations for leadId
    ├── SELECT history array
    ├── CALL orchestrateAIResponse(leadId, history)
    ├── UPDATE ai_conversations with AI draft
    └── Mark job completed
```

### 3. AI Orchestrator
```
orchestrateAIResponse(leadId, history) in ai-orchestrator.ts
├── FILTER history to user/assistant roles
├── CALL callAnthropic({ messages, system, maxTokens })
│   └── throw AnthropicClientError('ANTHROPIC_API_KEY is not configured')
│       if (!apiKey) → NO FALLBACK, FAILS LOUDLY
│
├── PARSE result.text as JSON
│   └── throw Error('AI Orchestration returned non-JSON content')
│       if JSON parse fails → NO FALLBACK
│
├── VALIDATE response_text non-empty
│   └── throw Error('AI Orchestration returned an empty response_text')
│       if empty → NO FALLBACK
│
├── NORMALIZE decision object with confidence thresholds
└── RETURN AIDecision object
```

### 4. Anthropic Client (Zero Mocks, Real Fetch Only)
```
callAnthropic(options) in anthropic-client.ts
├── READ process.env.ANTHROPIC_API_KEY
│   └── throw AnthropicClientError if UNDEFINED (fails LOUDLY)
├── BUILD request body:
│   ├── model: ANTHROPIC_MODEL (default: claude-sonnet-4-20250514)
│   ├── max_tokens: 1024
│   ├── messages: filtered history
│   └── system: system prompt
├── FETCH https://api.anthropic.com/v1/messages
│   ├── Headers: x-api-key, anthropic-version
│   ├── Timeout: 60,000ms
│   └── Retries: 2 with exponential backoff (500 * 2^attempt ms)
└── RETURN { text, contentBlocks, stopReason, model, usage }
```

## What Happens If Key is Missing

| Condition | Behavior |
|-----------|----------|
| `ANTHROPIC_API_KEY` env var not set | `AnthropicClientError` thrown immediately with message "ANTHROPIC_API_KEY is not configured" |
| Key set but invalid | HTTP 401 from Anthropic → `AnthropicClientError` thrown |
| Network timeout | `Error: AI request timed out after 60000ms` → `AnthropicClientError` thrown |
| HTTP 429/500/502/503 | Retry with exponential backoff (max 2 retries) |
| Any failure | Job marked `failed` or `dead` after max attempts, stack trace logged |

**THERE ARE NO FAKE REPLIES. NO CANNED RESPONSES. NO FALLBACK LOGIC.**
The system will loudly fail if the real API is unreachable.

---

# Live Test Instructions

## Setup

1. **Create `.env.local` in `apps/web/`:**
```bash
# apps/web/.env.local
ANTHROPIC_API_KEY=your_actual_anthropic_api_key_here
SMS_INBOUND_SECRET=test-secret-123
DATABASE_URL=your_postgres_connection_string
```

2. **Install dependencies (if not already):**
```bash
cd apps/web
yarn install
```

3. **Run the simulator in hybrid mode (real Claude):**
```bash
# Real database required
DATABASE_URL=your_postgres_connection_string \
ANTHROPIC_API_KEY=your_actual_anthropic_api_key_here \
SMS_INBOUND_SECRET=test-secret-123 \
yarn dev
```

Then POST to `/api/simulator/run`:
```bash
curl -X POST http://localhost:4000/api/simulator/run \
  -H "Content-Type: application/json" \
  -d '{"count": 3, "mode": "hybrid", "maxClaudeCalls": 3}'
```

## Direct API Test (Single Call)

Test the orchestrator directly by enqueuing an `ai_reply` job:

```bash
# 1. Ensure you have a lead in DB with phone +15555550100
# 2. Insert inbound SMS to trigger ai_reply job
curl -X POST http://localhost:4000/api/sms/inbound \
  -H "Content-Type: application/json" \
  -H "x-sms-secret: test-secret-123" \
  -d '{"from": "+15555550100", "text": "Hi, I want to sell my house at 123 Main St"}'
```

Then manually run the job processor:
```bash
# Create a script to drain jobs, or hit the cron endpoint if you have one
# Check your DB: ai_conversations should have an assistant draft in history
```

## Verification Queries

After the test, check PostgreSQL:
```sql
-- See the AI draft
SELECT lead_id, history, confidence_score, requires_human, status
FROM ai_conversations
WHERE lead_id = YOUR_LEAD_ID;

-- See job status
SELECT type, status, error_message, attempts
FROM jobs
WHERE type = 'ai_reply';
```

## Expected Outcome

- `history` array contains both user message AND assistant response
- `confidence_score` between 0.0 and 1.0
- `requires_human` = true if any price/offer keywords detected or confidence < 0.8
- Real Claude model response (NOT mocked)

## Failure Modes (If Key Missing)

```
Job status: failed
error_message: "ANTHROPIC_API_KEY is not configured"
```

This is intentional — the system **never fake-responds** to a real lead.