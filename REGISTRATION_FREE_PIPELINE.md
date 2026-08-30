# Registration-Free Outreach Pipeline — System Design

**Constraint:** reach sellers at volume with **no A2P 10DLC, no campaign registration, no carrier dependency**, and with skip-trace **optional** rather than required.

**Status:** built, tested, CI green. 911 tests / 113 files / 0 failures.

---

## 1. The mistake this corrects

Skip-trace had been treated as a prerequisite. `sourced_leads` deliberately carries no contact columns, so the only documented route from *sourced* to *contactable* was a paid phone lookup.

That coupled every campaign to two things at once:

- a per-record cost (~5–15¢), and
- **A2P 10DLC** — because a phone's only high-volume channel is SMS.

So "reach sellers without carrier registration" looked impossible. It wasn't. `sourced_leads.mailing_address` is **already populated from the public record** by both parsers. Physical mail is:

- not a "call" → **TCPA does not reach it**
- not "electronic mail" → **CAN-SPAM does not reach it**
- not carrier traffic → **no 10DLC, no A2P, no campaign approval, no throughput tier**

The cheapest and most universal channel was sitting unused.

> **Note:** consent does *not* unlock SMS. A2P 10DLC applies to application-to-person messaging regardless of consent, so a consent-first funnel would still require registration. SMS is genuinely off the table until registration clears.

---

## 2. Channel matrix

| Channel | Registration | Statute | Cost | Seller reach | Enrichment |
|---|---|---|---|---|---|
| **Mail** | none | none | ~55¢/pc | **universal** | **none** |
| **Email** | none | CAN-SPAM | ~$0.0001 | entity-owned subset | free lookup |
| Voice (live human) | none | TCPA + DNC | time | needs phone | paid |
| SMS | **10DLC required** | TCPA | — | — | paid |
| RVM | none formally | TCPA-litigated | ~5¢ | needs phone | paid |

**Mail is the primary seller channel. Email is the primary buyer channel** — buyers are businesses with real, reachable addresses; homeowner email coverage from skip-trace is poor.

RVM is excluded deliberately: many courts treat it as a call under the TCPA, so it carries telephony exposure without telephony's reach.

---

## 3. Architecture

```
┌─ INVENTORY ────────────────────────────────────────────────┐
│ POST /api/lead-finder/sources/[id]/fetch                   │
│   • PERMITTED sources only (terms_status guard)            │
│   • Socrata/SODA → parseSourcedRecords → score → dedupe    │
│   • contact data stripped before persistence               │
└────────────────────────────────────────────────────────────┘
                             ↓
┌─ SIZING ───────────────────────────────────────────────────┐
│ POST /api/lead-finder/create-campaign { targetDeals: N }   │
│   • 10,334 sellers + 200 buyers per assignment             │
│   • two LIMITed selects (seller surplus can't crowd buyers)│
│   • under-sized ⇒ top-level warnings + fullySized:false    │
└────────────────────────────────────────────────────────────┘
                             ↓
┌─ RESOLUTION (skip-trace optional) ─────────────────────────┐
│ contactResolution.ts                                        │
│   1. public-record-mailing  0¢  mail   universal            │
│   2. entity-lookup          0¢  email  entity-owned         │
│   3. skip-trace            10¢  phone  OPT-IN, A2P-gated    │
└────────────────────────────────────────────────────────────┘
                             ↓
┌─ GATE ─────────────────────────────────────────────────────┐
│ dispatchGate — one gate, per-channel rules                  │
│   telephony → DNC registry, Safe Harbor, consent, quiet hrs │
│   email     → opt-out only (CAN-SPAM)                       │
│   mail      → opt-out only                                  │
└────────────────────────────────────────────────────────────┘
                             ↓
┌─ DISPATCH ─────────────────────────────────────────────────┐
│ POST /api/outreach/mail/run  — DRY RUN BY DEFAULT           │
│   mailDriver  → deliverability guard → provider seam        │
│   emailDriver → CAN-SPAM guard      → provider seam         │
└────────────────────────────────────────────────────────────┘
```

---

## 4. Design decisions worth knowing

### Skip-trace is opt-in, and must prove ROI

`resolveContacts()` **never incurs cost**. It reports that a paid path *exists* so the caller decides with the price visible. Resolvers are ordered cheapest-first, so a paid lookup is only reached when every free option has failed.

`resolverRoi()` computes **cost per usable contact**, not per attempt — a 90%-hit 10¢ resolver is worse than a 30%-hit 1¢ one, and only that view shows it. It returns `null`, not `Infinity`, on zero hits, so an unmeasured resolver doesn't sort as infinitely expensive beside real data.

`paidResolverJustified()` refuses spend when free coverage is ≥95%: buying phones for leads you can already mail adds a channel that *also* needs registration.

### The mail guard is a spend guard, not a compliance guard

CAN-SPAM's guard exists because a violation is statutory (up to $53,088/email). Mail has no equivalent federal duty — its guard exists because **every piece costs money**. At 10,000 pieces a 5% bad-address rate is ~$275 burnt with no signal. Structural checks only (ZIP, state, street number); full CASS verification is the provider's job.

### Dry-run by default

Mail is the only channel where one request becomes unrecallable money. Every other send path defaults to *doing*; this one defaults to *pricing*. Spending requires a **literal `false`** — `"false"`, `0`, `null`, `undefined` all stay dry, because a form post serialising `dryRun` as a string must not start billing.

### One gate, per-channel rules

Applying telephony rules to mail would break the one channel that works without registration. There's a test where a maximally hostile telephony policy — federally listed number, strict DNC, stale coverage, required consent, 3am — is entirely inert for mail, while the *same* config still blocks an SMS.

Suppression keys differ by channel (phone / email / mailing address). Using the wrong key fails **open**, so it's resolved once and a missing key **denies** rather than falling back.

---

## 5. Economics

Mail is registration-free, not free.

| Volume | Cost @ 55¢ | Purpose |
|---|---|---|
| 1,000 | $550 | first real signal, validate address quality |
| 2,500 | $1,375 | A/B an offer at ~1% response |
| 10,334 | $5,684 | full 1-assignment target |

Direct-mail response in this vertical typically runs **1–3%** vs ~2% reply for cold SMS, so a smaller run produces measurable signal sooner.

**Measure on reply rate, not close rate.** Detecting a 1-in-2,000 → 1-in-1,500 close improvement needs ~328,000 sends *per arm*. Reply rate (2%→3%) needs ~3,825 per arm. Close rate is a reporting metric at this volume, not an optimisation target.

---

## 6. Owner actions (not code)

| Item | Where |
|---|---|
| `MAIL_PROVIDER_URL` | Lob / PostGrid / Click2Mail account |
| `EMAIL_PROVIDER_URL` | Lambda fronting SES |
| `dataset_id` on the Louisville source | SODA 4x4 from its API docs page |
| Mail copy + return address | your entity's real postal address |
| `dnc_enforcement` → `strict` | **before any telephony send** |

Until the provider URLs are set, both drivers run as `mock` — they report cost but never claim a real send, so the whole pipeline is exercisable at zero spend.

**Recommended first move:** a 1,000-lead dry run. It costs nothing, and the `undeliverable` and `unresolved` counts on real county data tell you the true address quality before you commit to volume.

---

## 7. Deferred, deliberately

- **A2P 10DLC** — still worth starting in parallel; the clock runs in weeks and it unlocks SMS later. Nothing above depends on it.
- **RVM** — TCPA-litigated; excluded until there's counsel sign-off.
- **Voice** — an AI agent cold-calling cells is the *clearest* §227(b) violation of any option; `voiceEscalation` stays OFF.
