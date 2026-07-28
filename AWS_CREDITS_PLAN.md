# DealFlow AI — $1,100 AWS Credit Allocation & 5-Day Plan

**Date:** 2026-07-27
**Context:** $1,100 AWS credits, GitHub Enterprise, Claude Pro. Goal: integrate AWS SMS, run 3–4 test campaigns, optimize, scale 5–10x, land 1–2 assignment fees, then polish UX.

---

## 1. Premise check — three findings that change the plan

### Finding 1: AWS does **not** bypass A2P 10DLC

A2P 10DLC is enforced by **The Campaign Registry (TCR)** and the US carriers, not by Twilio. AWS End User Messaging routes over the same carrier networks and requires the same TCR brand + campaign registration.

> "To use a 10DLC number you will need to register your company and create a 10DLC campaign... managed by a third-party company called The Campaign Registry (TCR)."
> — [AWS 10DLC registration process](https://docs.aws.amazon.com/sms-voice/latest/userguide/registrations-10dlc-setup.html)

Since **February 2025, unregistered A2P traffic is blocked outright** by US carriers. Switching providers changes nothing about your blocker. Your `FINAL_STATE.md` standing invariant — *"No live SMS until Twilio 10DLC/A2P approval clears"* — applies identically to AWS.

**Implication:** moving to AWS does not buy you a single day of schedule. The 10DLC clock is the long pole either way, and it starts when you submit, not when you switch vendors.

### Finding 2: AWS SMS is ~2.5x more expensive than Twilio

From [AWS End User Messaging pricing](https://aws.amazon.com/end-user-messaging/pricing):

| Item | AWS | Twilio | AWS premium |
|---|---|---|---|
| 10DLC outbound base | $0.02000 | ~$0.00830 | 2.4x |
| Carrier pass-through | $0.01000 | ~$0.00300–0.00500 | 2.0–3.3x |
| **All-in per segment** | **$0.03000** | **~$0.01180** | **2.5x** |
| Number lease | $1.00/mo | $1.15/mo | — |
| Campaign (standard) | $10.00/mo | $10.00/mo | — |
| Brand registration | $4.50 one-time | $4.50–$46 one-time | — |
| Brand vetting | $41.50 one-time | ~$40 one-time | — |

Carrier fees on both are pass-through, not markup.

### Finding 3: this makes SMS the **worst** possible use of the credits

Credits are only worth what they displace. Define **credit efficiency** = (cash you would otherwise spend elsewhere for the same output) ÷ (credits consumed).

| Service | AWS price | Best market alternative | Credit efficiency |
|---|---|---|---|
| **Bedrock (Claude Sonnet)** | $3 / $15 per M tokens | Anthropic API — identical | **100%** |
| **SES (email)** | $0.10 per 1,000 | Resend ~$0.40, Postmark ~$1.25 | **100%+** (cheapest available) |
| **App Runner / S3 / CloudFront** | market rate | Vercel / Render comparable | **~85–100%** |
| **Amazon Connect (voice out)** | $0.0228/min | Twilio ~$0.014/min | **~61%** |
| **End User Messaging (SMS 10DLC)** | $0.03000/msg | Twilio $0.01180/msg | **39%** |

**$1,100 of credits spent on AWS SMS delivers $433 of real value.** The same $1,100 spent on Bedrock delivers $1,100 of real value. You destroy roughly $667 by routing SMS through AWS.

**Recommendation: keep SMS on Twilio (paid in cash, ~$0.0118/msg) and spend the AWS credits on inference, compute, email, and storage — where AWS is at or below market.**

---

## 2. The legal picture (read before designing campaigns)

### One-to-one consent is dead — but that does not make cold texting legal

The FCC's one-to-one consent rule was **vacated** by the Eleventh Circuit in *Insurance Marketing Coalition v. FCC* (Jan 24, 2025), and the FCC formally repealed it in September 2025. The standard reverted to the pre-2023 **prior express written consent**.

This is often misread as "cold outreach is fine now." It is not. The relevant exposure for wholesaler texting is:

| Regime | What it requires | Exposure |
|---|---|---|
| TCPA §227(b) | Prior express written consent for marketing to wireless via ATDS or **artificial/prerecorded voice** | $500–$1,500 per message/call |
| TCPA §227(c) / National DNC | Prior express invitation or permission to text/call DNC-listed numbers | $500–$1,500 per violation, private right of action |
| State mini-TCPAs (FL FTSA, OK, WA CEMA, MD) | Stricter than federal; this is where wholesaler suits actually get filed | Varies; often per-message |
| CTIA / carrier layer | Documented opt-in process at campaign registration | Campaign rejection, silent filtering, brand blacklisting |

Two things carriers explicitly restrict, both of which describe standard wholesaler practice:

- **Third-party lead generation** — buying or skip-tracing lists of phone numbers is a restricted category under CTIA guidelines.
- **Undocumented opt-in** — TCR requires you to describe how consent was collected. A purchased list has no opt-in to describe.

The **October 2025 CTIA update** tightened three more areas relevant to you: public link shorteners (bit.ly etc.) are now a strong filtering trigger, the brand name in message bodies must match the TCR registration exactly, and opt-in language must explicitly state SMS, the sending entity, message type, and frequency.

### The honest read

Wholesalers do register 10DLC campaigns and do send cold texts. It is done by attesting to an opt-in process at registration. That attestation is the legal and reputational risk surface, and it is why this vertical generates disproportionate TCPA litigation. This is a decision for you and a TCPA attorney, not one I can make for you — but it should be a decision made deliberately, with the numbers above in front of you, not discovered after a demand letter.

### The unlock

The compliant automated motion is **consent-first**: acquire the opt-in through channels that do not require it (direct mail, paid search/social, "we buy houses" landing pages, driving-for-dollars door hangers), then let the AI work the opted-in inbound leads. That funnel:

- is **10DLC-approvable** with a real, documentable opt-in
- is **TCPA-defensible** because consent exists
- produces **higher-intent leads**, so the conversion math is far better than cold
- is what your repo is already built for — `consentBasis` gating and `CONSENT_BASIS_ATTESTED` already exist in `cadenceEngine`

This changes your top-of-funnel, not your product. The AI negotiation layer — the actual differentiated asset — is unchanged.

---

## 3. The measurement problem (this is the real blocker on "optimize")

Your plan is: run 3–4 test campaigns → identify low-performing phases → optimize → scale 5–10x. The statistics do not support that sequence at this volume.

### You cannot optimize on close rate

Your deck models a ~1-in-2,000 close rate. To detect a 33% relative improvement (1-in-2,000 → 1-in-1,500) at 80% power, α = 0.05, two-sided:

```
p₁ = 0.000500   p₂ = 0.000667   δ = 0.000167
p̄  = 0.000583

n = [z_{α/2}·√(2p̄q̄) + z_β·√(p₁q₁ + p₂q₂)]² / δ²
  = [1.96·√(0.0011654) + 0.8416·√(0.0011663)]² / (0.000167)²
  = [1.96(0.034138) + 0.8416(0.034151)]² / 2.7889e-8
  = [0.066911 + 0.028742]² / 2.7889e-8
  = 0.0091495 / 2.7889e-8
  ≈ 328,000 per arm
```

**~656,000 messages total.** At AWS pricing that is **$19,680**; at Twilio pricing **$7,741**. Both are far outside a $1,100 budget. Four test campaigns will produce an expected **2 closes** — you cannot learn anything from 2 events.

### You can optimize on reply rate

Same calculation with a proxy metric that has a usable base rate (2% → 3%):

```
p₁ = 0.020   p₂ = 0.030   δ = 0.010
p̄  = 0.025

n = [1.96·√(0.04875) + 0.8416·√(0.0487)]² / (0.010)²
  = [1.96(0.220794) + 0.8416(0.220681)]² / 0.0001
  = [0.432756 + 0.185725]² / 0.0001
  = 0.382519 / 0.0001
  ≈ 3,825 per arm
```

**~7,650 messages total — $230 at AWS pricing, $90 at Twilio.** Affordable, and it fits inside your test-campaign plan.

### What this means concretely

Design the 3–4 test campaigns to move **upstream proxy metrics**, in this priority order:

1. **Delivery rate** (are messages landing at all — the 10DLC health check)
2. **Reply rate** (n ≈ 3,825/arm — the opener is what you're testing)
3. **Positive-sentiment reply rate** (n ≈ 1,500–2,500/arm at a ~10% base)
4. **Conversation depth** — turns before drop-off (continuous metric, needs far smaller n; this is where the AI negotiator quality actually shows up)
5. **Human-escalation rate** and **escalation→appointment rate**

Close rate is a *reporting* metric at this stage, not an *optimization* metric. Treat any close-rate difference across 4 campaigns as noise, because it is.

### Where the credits actually earn their keep

The highest-signal optimization available to you is **offline evaluation**, not live A/B testing. Build a replay harness: take real conversation transcripts, run prompt/policy variants against them in **Bedrock batch mode (50% discount)**, and score with an LLM judge rubric. This costs tens of dollars, runs in minutes, needs zero carrier approval, and gives you thousands of comparisons instead of four. This is the single best use of the credits and it is available to you **today**, while 10DLC is still pending.

---

## 4. Goal calibration

> *"the same monthly sales volume as a professional wholesaler would generate in a single day — while maintaining equivalent call volume and the sophistication of an expert wholesaler"*

Two readings, both worth stating in numbers.

**Reading A — match a pro's daily activity volume.** A professional wholesaling operation with a VA team runs roughly 1,000–1,500 dials/day or 5,000–15,000 texts/day. *(Industry-reported ranges from wholesaler community sources — treat as approximate; I could not source these to a primary dataset and you should not put them in the deck without one.)* Matching that per month means ~10,000 messages/month, which at Twilio pricing is **$118/month** — trivially affordable. Volume is not your constraint.

**Reading B — match a pro's daily deal output.** A strong solo wholesaler closes 2–5 deals/month ≈ 0.1–0.25 deals/day. Producing that per month means roughly **1 assignment every 4–10 months** at the deck's 1-in-2,000 rate.

Working backward from your actual objective — **1–2 assignment fees**:

```
2 assignments ÷ (1/2,000 close rate) = 4,000 messages ... at the modeled rate
```

But that rate is a *model*, not an observation. The honest version is a range:

| Close rate | Messages for 2 assignments | Cost @ Twilio $0.0118 | Cost @ AWS $0.03 |
|---|---|---|---|
| 1 in 500 (opted-in inbound) | 1,000 | $12 | $30 |
| 1 in 2,000 (deck model) | 4,000 | $47 | $120 |
| 1 in 5,000 (cold, filtered) | 10,000 | $118 | $300 |
| 1 in 20,000 (cold, poorly targeted) | 40,000 | $472 | $1,200 |

**Messaging cost is not your binding constraint at any plausible close rate.** The constraints are, in order: (1) carrier approval, (2) list quality, (3) AI negotiation quality, (4) your time. Budget accordingly — the credits should buy leverage on #3, not volume on a channel you can't yet legally use.

---

## 5. Five-day plan

**A note on "fully allocate."** Every dollar below has a named job and a service by end of day 5. It does not all *burn* in five days — and forcing it to would mean dumping it into SMS at 39% efficiency, destroying ~$667 of value. Allocated ≠ consumed. Check your credit expiry date on day 1; that, not an artificial five-day window, is the real deadline.

### Day 1 — Start the long pole, stop the bleeding

| # | Task | Why |
|---|---|---|
| 1.1 | **Submit TCR brand registration** ($4.50) + **brand vetting** ($41.50) via your chosen provider | Weeks-long clock. Nothing else unblocks until this clears. Your LLC + EIN is sufficient for brand registration — C-corp conversion is not a prerequisite here. |
| 1.2 | Check AWS credit **expiry date** in Billing → Credits | Sets the real deadline. Activate credits typically expire in 12–24 months. |
| 1.3 | Set **AWS Budgets** alarms at $250 / $500 / $900 with SNS email alerts | Free. Prevents a runaway Bedrock loop from eating the whole grant. |
| 1.4 | Enable **Bedrock** model access for Claude in `us-east-1` | Provisioning can take a few hours; do it now so day 2 isn't blocked. |
| 1.5 | Write the **10DLC campaign use-case description** and the opt-in flow it will describe | This is the artifact that gets approved or rejected. Draft it before you build the funnel, so the funnel matches the description exactly. |

### Day 2 — Move inference to Bedrock

| # | Task | Why |
|---|---|---|
| 2.1 | Add `@anthropic-ai/bedrock-sdk`; add a `AI_PROVIDER=bedrock\|anthropic` env switch in `apps/web/src/app/api/utils/anthropic-client.ts` | Drop-in: `AnthropicBedrock` takes the same message shape as your existing `callAnthropic`. Keep the direct path behind the flag as fallback — do not create a single point of failure. |
| 2.2 | Map model IDs — Bedrock uses cross-region inference profile IDs (`us.anthropic.claude-sonnet-*`), not bare Anthropic IDs | Silent failure mode if missed. |
| 2.3 | Run the existing suite against both providers (`712 passed / 22 skipped` is your baseline) | Your `RUNTIME_TRUTH_TABLE.md` guarantees loud failure on misconfiguration — verify that still holds on the Bedrock path. |
| 2.4 | Turn on **prompt caching** for the system prompt (90% discount) and **batch mode** for offline eval (50% discount) | Cuts effective inference cost ~5–10x for the eval harness. |

### Day 3 — Build the eval harness (highest-value day)

| # | Task | Why |
|---|---|---|
| 3.1 | Export existing conversation transcripts from `ai_conversations.history` into an S3 eval set | Your ground truth. Even mock-mode transcripts are useful for policy testing. |
| 3.2 | Build a **replay harness**: N prompt/policy variants × M transcripts, run via Bedrock **batch** | Thousands of comparisons for tens of dollars, no carrier approval needed. This is the thing that actually improves the negotiator. |
| 3.3 | Write an **LLM-judge rubric**: did it stay in guardrails, did it respect the escalation invariant (never states/confirms price), did it advance the conversation, would a seller reply | Turns "the AI feels better" into a score you can regression-test. |
| 3.4 | Wire the rubric into CI on **GitHub Enterprise Actions** as a non-blocking report on PRs touching prompts | Prompt regressions become visible instead of silent. |

### Day 4 — Consent-first funnel + campaign submission

| # | Task | Why |
|---|---|---|
| 4.1 | Ship an opt-in landing page (**Amplify** or **S3+CloudFront**) with CTIA-compliant opt-in language — explicitly naming SMS, the sending entity, message type, and frequency | This is what makes the 10DLC campaign approvable, and it's the TCPA consent record. |
| 4.2 | Persist consent records: timestamp, IP, user-agent, exact language version | Your legal-acceptance tables already do this pattern for ToS — reuse it. This folder becomes data-room evidence. |
| 4.3 | **Submit the 10DLC campaign** ($50 one-time, $10/mo) pointing at the real opt-in flow | TCR reports only the first defect it finds, so expect 1–3 resubmit cycles. Starting now is the whole point. |
| 4.4 | Stand up **SES** for the buyer-side list and lead nurture; verify domain, DKIM, DMARC | $0.10/1,000. Buyers have email; sellers mostly don't. Also gives you a fully-legal channel to test messaging while SMS is pending. |
| 4.5 | Confirm no public link shorteners anywhere in message templates | October 2025 CTIA update made these a strong filtering trigger. |

### Day 5 — Dry run, instrument, decide

| # | Task | Why |
|---|---|---|
| 5.1 | Run the 3–4 test campaigns **in Personal Test Mode against verified numbers you own** | Exercises the full path — scheduler → `enqueueJob` → dispatchGate → provider → status callback → `recordStageTransition` — without carrier exposure. |
| 5.2 | Build the funnel dashboard on the `stage_transitions` table (**QuickSight** or plain SQL) | You already write NEW / CONTACTED / ENGAGED / NEGOTIATING / CLOSED_LOST at 7 lifecycle points. SIGNED/ASSIGNED are unwired — note the gap rather than reporting a false zero. |
| 5.3 | Ship transcripts + consent records + delivery receipts to **S3 + Glacier**, enable **CloudTrail** | Compliance evidence folder. Doubles as the diligence artifact for the raise. |
| 5.4 | Run the eval harness across ≥3 opener variants; pick the winner on **projected reply rate**, not close rate | Per §3 — close rate is unmeasurable at this n. |
| 5.5 | **Decision gate:** with counsel, choose cold-attested vs consent-first as the launch motion | Everything downstream depends on this. Do not skip it. |

---

## 6. The $1,100 allocation

| # | Bucket | Service | Allocated | Buys | Efficiency |
|---|---|---|---|---|---|
| 1 | **AI inference — production** | Bedrock (Claude Sonnet, cached) | **$300** | ~20–25K negotiation turns | 100% |
| 2 | **AI inference — offline eval** | Bedrock batch (50% off) | **$200** | ~100K+ scored variant runs | 100% |
| 3 | **App + staging hosting** | App Runner, CloudFront, S3 | **$180** | ~4 months | ~90% |
| 4 | **Email channel** | SES | **$60** | ~600K emails | 100%+ |
| 5 | **Observability** | CloudWatch, X-Ray | **$90** | logs, metrics, traces, dashboards | ~85% |
| 6 | **Compliance evidence store** | S3, Glacier, CloudTrail | **$40** | multi-year transcript + consent archive | 100% |
| 7 | **Voice — opted-in callbacks only** | Amazon Connect | **$70** | ~3,000 minutes | 61% |
| 8 | **10DLC registration + fees** | End User Messaging | **$110** | brand $4.50 + vetting $41.50 + campaign $50 + 3 mo campaign/number fees | 100% (identical to Twilio) |
| 9 | **Reserve** | unallocated | **$50** | overage buffer | — |
| | **Total** | | **$1,100** | | |

**Not allocated: bulk SMS sends.** At 39% efficiency this is the one place credits burn value. Send via Twilio in cash — 10,000 messages is **$118**, which is less than the value you'd destroy by routing the same volume through AWS.

### Two deliberate exclusions

- **Do not migrate Neon → Aurora/RDS.** Credits would cover it, but a production Postgres migration is a multi-week project with real data-loss risk, against zero product benefit right now. Your `@neondatabase/serverless` driver is working. Revisit post-revenue.
- **Do not use Amazon Connect for outbound cold calling.** TCPA §227(b) covers **artificial or prerecorded voice** regardless of the ATDS question — an AI voice agent cold-calling cell phones without prior express written consent is the *clearest* violation of any option on the table, not a workaround for SMS restrictions. The $70 allocation is for **inbound and opted-in callbacks only**. Your `voiceEscalation` flag should stay OFF by default, as it currently is.

---

## 7. GitHub Enterprise + Claude Pro

These are separate resource pools from AWS and from each other — worth being deliberate about.

| Resource | What it's for | Highest-leverage use here |
|---|---|---|
| **AWS credits → Bedrock** | Your *product's* AI inference | Eval harness + production negotiation. Metered per token. |
| **Claude Pro → Claude Code** | Your *development* velocity | Building the product. Metered by weekly session limits — **this is the pool that just ran out mid-workflow.** |

They do not substitute for each other. Bedrock credits will not extend your Claude Code weekly limit, and Claude Pro will not run your product's inference. Plan both separately — and given you hit the Claude Code weekly cap during the deck workflow, sequence heavy multi-agent runs rather than stacking them.

**GitHub Enterprise** — the underused asset:

- **Actions** — run the eval-harness rubric on every PR touching prompts; run the existing 712-test suite + `check-secrets-in-bundle.mjs` on every push. Note your `SESSION_HANDOFF.md` CI flake: rapid successive pushes cancel in-flight runs on the shared Neon test branch and leave `flows-live` dirty. Serialize pushes or give CI its own branch.
- **Environments + required reviewers** — gate production deploys behind an approval. Directly relevant once real SMS can go out: it makes an accidental live blast structurally impossible, and that control is itself a diligence artifact.
- **OIDC → AWS** — federate Actions into AWS with short-lived roles instead of long-lived access keys in secrets. Cheap to set up, and it's the kind of thing that shows up well in a security review.
- **Dependabot + CodeQL + secret scanning w/ push protection** — free on Enterprise, and push protection is a real backstop given you already built a bundle-secret guard.
- **Private package registry** — if the Electron desktop app and web app end up sharing code.

---

## 8. Sequenced beyond day 5

| Phase | Gate to exit | Primary metric |
|---|---|---|
| **Now → 10DLC approval** | Campaign approved by TCR | Approval, not volume |
| **First live sends** | Delivery rate >90%, zero STOP-handling defects | Delivery rate |
| **Opener optimization** | ~3,825 messages/arm sent | Reply rate |
| **Negotiation optimization** | Eval harness green on rubric; live conversations reaching depth ≥4 turns | Conversation depth, escalation quality |
| **First assignment** | 1–2 fees collected | Assignment fee, cycle time |
| **5–10x scale** | Unit economics positive at small n | Cost per qualified lead |
| **UX polish** | Someone with no context launches a campaign unaided | Time-to-first-campaign for a new user |

On the UX goal — the "a 13-year-old could use it" test is a real and good bar, and it is correctly sequenced last. One note: your repo already has a **Quick Launch (Test Mode)** path that activates a campaign in one click from step 1 of the wizard. That is the seed of the simple mode. The polish work is mostly *removing* the paths that aren't Quick Launch, not adding new UI.

---

## Sources

- [AWS End User Messaging pricing](https://aws.amazon.com/end-user-messaging/pricing)
- [AWS 10DLC registration process](https://docs.aws.amazon.com/sms-voice/latest/userguide/registrations-10dlc-setup.html)
- [AWS End User Messaging SMS best practices](https://docs.aws.amazon.com/sms-voice/latest/userguide/best-practices.html)
- [Twilio US SMS pricing](https://www.twilio.com/en-us/sms/pricing/us)
- [Amazon SES pricing](https://aws.amazon.com/ses/pricing/)
- [Amazon Connect pricing](https://aws.amazon.com/connect/pricing/)
- [Amazon Bedrock pricing](https://aws.amazon.com/bedrock/pricing/)
- [AWS Activate terms](https://aws.amazon.com/activate/terms)
- [Eleventh Circuit Vacates FCC's TCPA One-to-One Consent Rule — Morrison Foerster](https://www.mofo.com/resources/insights/250130-eleventh-circuit-vacates-fcc-s-tcpa-one-to-one-consent-rule)
- [FCC Repeals One-to-One Consent Rule — Womble Bond Dickinson](https://www.womblebonddickinson.com/us/insights/blogs/fcc-repeals-one-one-consent-rule-following-eleventh-circuit-decision)
- [CTIA Messaging Principles and Best Practices: 2026 Compliance Guide](https://messageiq.io/blogs/ctia-messaging-principles-and-best-practices/)
- [Launching Text Campaigns: Ins & Outs of 10DLC Registration — Faegre Drinker](https://www.faegredrinker.com/en/insights/publications/2025/6/launching-text-campaigns-ins-outs-of-10dlc-registration)
- [Common 10DLC campaign rejections — Telgorithm](https://www.telgorithm.com/news/common-10dlc-campaign-rejections)
- [10DLC Compliance Guide for Real Estate Teams — Signalmash](https://www.signalmash.com/post/10dlc-compliance-guide-for-real-estate-teams)

**Unsourced, flagged:** professional-wholesaler daily dial/text volumes in §4 are industry-community ranges, not primary data. Do not put them in the investor deck without a citable source.
