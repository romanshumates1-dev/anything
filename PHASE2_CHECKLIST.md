# PHASE 2 LOOPBACK — ACTION CHECKLIST

## GATE 0: 10DLC Throughput Model ✅ COMPLETE

**Status: PASS** — All unit tests passing, volume table verified for 3 trust scenarios.

### What you have now:
- ✅ Corrected throughput math: `min(MPS × windowSec, T-Mobile_daily_cap)`
- ✅ 57 unit tests covering all scenarios
- ✅ Volume planning report (run: `npm run throughput-report`)
- ✅ Hard cap enforcement (blocks loopback if credentials incomplete)
- ✅ Default config (low trust, 2,000/day cap)

---

## GATE 1: Live Connectivity — BLOCKED ON OWNER

### Before you run GATE 1, please complete these tasks:

#### A. Twilio Setup (owner's Twilio console)
- [ ] Have an active Twilio account
- [ ] Create or use existing 10DLC phone number (or get one assigned)
- [ ] Complete **A2P 10DLC brand registration** (Twilio dashboard → Compliance)
- [ ] Complete **A2P 10DLC campaign registration**
- [ ] ✨ **NOTE**: After approval, check your Twilio console for assigned **MPS** and **T-Mobile daily cap**

#### B. Environment Setup (your `.env` file)
```env
# Twilio credentials (from Twilio console)
TWILIO_ACCOUNT_SID=ACxxxx...
TWILIO_AUTH_TOKEN=3ce60239ebe...
TWILIO_MESSAGING_SERVICE_SID=MGxxxx (or use TWILIO_FROM_NUMBER=+15551234567)
TWILIO_NUMBER_TYPE=10dlc

# A2P throughput (from Twilio dashboard after campaign approval)
TWILIO_10DLC_ASSIGNED_MPS=1          # ← Check your dashboard
TWILIO_10DLC_TMOBILE_DAILY_CAP=2000  # ← Check your dashboard

# Test phone (owner's phone for loopback)
OWNER_NUMBER=+15551234567            # ← Use your actual test phone
```

#### C. Network Setup (webhook reachability)
- [ ] Set up ngrok or cloudflared tunnel to expose local webhook
  ```bash
  # ngrok example:
  ngrok http 4000
  # Your public URL will be something like: https://abc123.ngrok.io
  
  # cloudflared example:
  cloudflared tunnel --url http://localhost:4000
  ```
- [ ] Copy the public URL (e.g., `https://abc123.ngrok.io`)
- [ ] Configure webhook in Twilio console:
  - Go to Twilio Console → Messaging → Phone Numbers
  - Click your 10DLC number
  - Under "Messaging" → "Webhook URL": paste `https://YOUR_PUBLIC_URL/api/webhooks/twilio`

#### D. Anthropic Setup
- [ ] Have an active Anthropic API key
- [ ] Add to `.env`:
  ```env
  ANTHROPIC_API_KEY=sk-ant-...
  ```

---

## Once you've completed the above (GATE 1 Prerequisites):

Reply with:
1. Confirmation that all `.env` vars are set
2. The **assigned MPS** from Twilio (e.g., "1 MPS")
3. The **T-Mobile daily cap** from Twilio (e.g., "2,000/day")
4. Your **public webhook URL** (e.g., "https://abc123.ngrok.io")

Then I'll run **GATE 1: Live Connectivity** which will:
- ✅ Verify Twilio connection (account lookup)
- ✅ Verify Anthropic connection (ping)
- ✅ Send ONE real SMS to your phone
- ✅ Verify webhook signature validation
- 📊 Report total spend (expect <$1)

---

## GATE 2: Full Loopback (11 branches on owner's phones)

After GATE 1 passes, we'll run all 11 test branches covering:
1. Follow-up delay (no reply → auto-fire)
2. Wrong number (graceful handling)
3. Intent (yes I'm selling)
4. Range negotiation (owner involvement)
5. Tier-1 offer (seller receives)
6. Counter-offer (AI negotiates)
7. Deal acceptance (seller agrees)
8. Contract approval (owner approves)
9. Signature completion (buyer signs)
10. Buyer funnel (auto-triggered)
11. STOP opt-out (permanent opt-out)

**Safety rails enforced**:
- Allowlist: ONLY owner's phone number
- Max Claude calls: 30
- Max SMS segments: 40
- Abort on any non-allowlisted number send attempt

---

## Quickstart

```bash
# After you've set up .env:

# 1. Verify throughput model
npm run throughput-report

# 2. Check if config is ready
node -e "
  import { validate10DLCThroughputConfig } from './src/app/api/utils/a2pConfig.ts';
  const result = validate10DLCThroughputConfig();
  console.log(result.message);
"

# 3. Run tests to ensure all green
npm test

# 4. Once credentials are live, I'll run GATE 1
```

---

## Questions?

- **What if I don't have Twilio yet?** Start at twilio.com, create account, provision 10DLC number
- **What if A2P approval is pending?** Use default low-trust config (2,000/day) for now; update after approval
- **How long does A2P approval take?** Usually 1-3 hours, sometimes up to 24 hours
- **Can I test without ngrok?** Yes, for GATE 1 we can simulate webhook if you can't expose public URL; GATE 2 needs it for real SMS replies

---

**Status**: Waiting for your environment setup. Once ready, ping me with the completion checklist. 🚀
