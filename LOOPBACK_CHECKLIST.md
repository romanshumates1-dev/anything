
# LOOPBACK CHECKLIST — Live SMS End-to-End Proof

## Prerequisites — Install ngrok (one-time setup)

ngrok is a separate program, not part of this repo. Install it first:

**Windows (PowerShell):**
```powershell
winget install ngrok.ngrok
```
> **Close and reopen PowerShell after installing** — PATH updates need a fresh shell.

**Then authenticate (free signup at https://ngrok.com → dashboard → copy authtoken):**
```powershell
ngrok config add-authtoken YOUR_TOKEN_HERE
```

**Verify it works:**
```powershell
ngrok http 4000
```
You should see a forwarding URL like `https://abc123.ngrok.io`. Ctrl+C to stop it for now.

## Prerequisites (owner must do before testing)

- [ ] **Run preflight first**: `cd apps/web && node --env-file=.env scripts/preflight.mjs` — fixes the FIRST FAIL only, re-runs until all 8 PASS
- [ ] **ngrok running**: `ngrok http 4000` — copy the HTTPS URL (e.g. `https://abc123.ngrok.io`)
- [ ] **PUBLIC_WEBHOOK_URL set**: edit `apps/web/.env` → `PUBLIC_WEBHOOK_URL=https://YOUR_NGROK_ID.ngrok.io/api/sms/inbound`
- [ ] **Twilio webhook configured**: Twilio Console → Phone Numbers → your number → Messaging → "A MESSAGE COMES IN" → POST to `https://YOUR_NGROK_ID.ngrok.io/api/sms/inbound`
- [ ] **OWNER_NUMBER in E.164**: `.env` has `OWNER_NUMBER=+15025241638` (already set)
- [ ] **Dev server running**: `cd apps/web && yarn dev`
- [ ] **Job runner running**: `cd apps/web && yarn jobs:dev` (second terminal)

## Step 1 — Owner texts the Twilio number

From Google Voice or your phone, text your Twilio number: **"yes I'm selling"**

### Expected server log chain (in the `yarn dev` terminal):

```
[sms/inbound] Twilio webhook received {
  from: '+15025241638',
  messageSid: 'SM...',
  signatureValid: true
}
```

Since this is from OWNER_NUMBER, the route logs `sms_inbound_owner` and returns TwiML.
No AI job is enqueued for owner messages (by design).

### Expected job runner log (in the `yarn jobs:dev` terminal):

No output (owner messages don't enqueue jobs).

## Step 2 — Test with a lead number

Create a lead in the DB with a phone number you control:

```sql
INSERT INTO leads (phone, name, status)
VALUES ('+1YOUR_PHONE', 'Test Lead', 'new')
ON CONFLICT (phone) DO NOTHING;
```

Then text the Twilio number from that phone: **"interested, what's the price?"**

### Expected server log chain:

```
[sms/inbound] Twilio webhook received {
  from: '+1YOUR_PHONE',
  messageSid: 'SM...',
  signatureValid: true
}
```

### Expected job runner log:

```
[jobs-dev] processed 1 job(s)
```

### Expected AI reply flow:

1. Job processed → `ai_reply` handler runs
2. `orchestrateAIResponse()` calls Anthropic
3. AI draft saved to `ai_conversations` with `requires_human=true`
4. **No auto-send** — the draft awaits human approval (by design)

## Step 3 — Outbound send (via campaign launch)

Launch a test-mode campaign targeting your lead. The gateway will:

1. Check `test_phone_numbers` table for your number
2. If verified → real Twilio REST call via `TwilioAdapter.send()`
3. Log: `[TwilioAdapter] sent { sid: 'SM...', status: 'queued', to: '+1...' }`

### Verify on phone:

- [ ] SMS arrives on your phone from the Twilio number
- [ ] Message SID logged in `message_events` table

## Step 4 — Full round-trip exchange

1. Reply to the SMS from your phone
2. Server receives inbound → signature validated → job enqueued
3. Job runner processes → AI drafts a reply
4. Approve the draft via the dashboard
5. Outbound SMS sent → arrives on your phone

## Troubleshooting

| Symptom | Check |
|---------|-------|
| No log output at all | ngrok URL in Twilio console matches current ngrok session? |
| `403 Invalid signature` | `PUBLIC_WEBHOOK_URL` in .env matches the ngrok URL? |
| Jobs enqueue but never process | `yarn jobs:dev` running in second terminal? |
| `BLOCKED_TEST_MODE` | Your phone number in `test_phone_numbers` table with `verified=true`? |
| Outbound never sends | `TWILIO_MESSAGING_SERVICE_SID` set in .env? |

## Env Var Reference

| Variable | Purpose | Example |
|----------|---------|---------|
| `TWILIO_ACCOUNT_SID` | Twilio account | `AC922b...` |
| `TWILIO_AUTH_TOKEN` | Signature validation | `5bf3ba...` |
| `TWILIO_MESSAGING_SERVICE_SID` | Outbound sender | `MGe1cf...` |
| `OWNER_NUMBER` | Owner's phone (E.164) | `+15025241638` |
| `PUBLIC_WEBHOOK_URL` | ngrok public URL | `https://abc.ngrok.io/api/sms/inbound` |
| `SMS_INBOUND_SECRET` | Simulator auth | (set in .env) |
| `JOB_RUNNER_SECRET` | Job runner auth | (set in .env) |