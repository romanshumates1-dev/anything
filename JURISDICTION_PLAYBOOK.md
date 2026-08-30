# JURISDICTION_PLAYBOOK.md — DealFlow AI

Repeatable steps for adding one county/metro to the `lead_sources` registry.
Future waves: paste a market list against this playbook — no new prompt needed.

---

## Prerequisites

- Access to the admin panel (`/admin`) or direct DB access
- The target county/metro name and state abbreviation
- ~30 minutes per market for live source verification

---

## Step 1 — Identify Sources

For each new market, identify sources in these categories:

| Category | Source type | Examples |
|---|---|---|
| Probate | County probate court docket | `{county}.courts.state.gov/probate` |
| Tax delinquent | County treasurer / tax collector | `{county}treasurer.gov` |
| Pre-foreclosure | County recorder / clerk of courts | `{county}recorder.gov` |
| Code enforcement | City/county code enforcement | `{city}.gov/code-enforcement` |
| Assessor/GIS | County assessor parcel data | `{county}assessor.gov/gis` |
| Vacant/abandoned | City blight registry | `{city}.gov/blight` |

**Disambiguation rule**: when two jurisdictions share a name (e.g., Jefferson County KY vs Jefferson County AL), the `state` field in `lead_sources` is the disambiguator. Always set `state` explicitly — never rely on county name alone.

---

## Step 2 — Check robots.txt and Terms

For each source URL, perform a LIVE check (not from memory):

```bash
curl -s https://{source-domain}/robots.txt | head -50
```

Classify as:
- `PERMITTED` — robots.txt allows `/resource/`, `/api/`, or the specific path; crawl-delay noted
- `MANUAL_ONLY` — robots.txt disallows the data path, or no robots.txt + terms prohibit scraping
- `PROHIBITED` — explicit prohibition in terms of service

**Record the check date** — a PERMITTED classification is only valid for 90 days without re-verification.

> ⚠️ NOT LEGAL ADVICE: Owner confirms each source's terms with an attorney per state before operating.

---

## Step 3 — Seed the Registry

Insert into `lead_sources` via migration or admin SQL:

```sql
INSERT INTO lead_sources
  (name, state, county, source_type, access_method, terms_status,
   base_url, distress_weight, notes)
VALUES
  ('{Source Name}',
   '{STATE}',           -- 2-letter state code, e.g. 'TN'
   '{County Name}',     -- e.g. 'Davidson'
   '{probate|tax_delinquent|pre_foreclosure|code_enforcement|assessor|vacant}',
   '{PERMITTED|MANUAL_ONLY|PROHIBITED}',
   '{confirmed|unconfirmed}',
   '{https://source-url}',
   {1-5},               -- distress weight: 5=highest (probate), 1=lowest (assessor)
   '{notes including robots check date and crawl-delay}')
ON CONFLICT (name, state) DO NOTHING;
```

**Distress weight guide:**
- 5: Probate, pre-foreclosure (imminent motivation)
- 4: Tax delinquent (financial distress)
- 3: Code enforcement, vacant/abandoned
- 2: Assessor (absentee owner flag)
- 1: General GIS/parcel data

---

## Step 4 — Ingest Test Batch

For PERMITTED sources, run a test ingest of ≤10 rows:

1. Navigate to Lead Finder → Sources → select the new source
2. Click "Test Ingest" (dry-run mode)
3. Verify:
   - Rows appear in `sourced_leads` with correct `state`, `county`, `source_id`
   - **Zero contact data** in `sourced_leads` (phone/email columns must be NULL)
   - Provenance fields populated (`source_id`, `source_name`, `record_type`)
   - Dedupe working (re-ingest same rows → 0 new inserts)

For MANUAL_ONLY sources, upload a CSV export from the source website.

---

## Step 5 — Verify Scoring

Run the existing scorer against the test batch:

```sql
SELECT name, metadata->>'distress_score' as score,
       metadata->>'signals' as signals,
       metadata->>'why' as why
FROM sourced_leads
WHERE source_id = (SELECT id FROM lead_sources WHERE name = '{Source Name}')
ORDER BY (metadata->>'distress_score')::int DESC
LIMIT 5;
```

Confirm:
- Scores are non-zero
- Stacked signals (probate + absentee + equity) outrank single signals
- `why` string is human-readable and accurate

---

## Step 6 — Lock Compliance Gates

Every new jurisdiction×channel starts with `attorney_reviewed = false` (fail-closed).

```sql
-- Seed locked gates for the new jurisdiction (all channels locked by default)
INSERT INTO compliance_gates (organization_id, jurisdiction, channel, attorney_reviewed)
SELECT '{org_id}', '{STATE}-{County}', ch, false
FROM unnest(ARRAY['sms','email','mail','voice','rvm']) AS ch
ON CONFLICT (organization_id, jurisdiction, channel) DO NOTHING;
```

The owner + attorney must explicitly set `attorney_reviewed = true` via the admin panel
(`/admin` → Compliance Gates) before any cold send fires to this jurisdiction.

---

## Step 7 — Confirm Suite Green

```bash
cd apps/web && yarn test --run
```

No new failures. The existing scorer, dedupe, and compliance tests cover new markets automatically.

---

## Wave 2 Markets (Phase 7)

Regional expansion adjacent to KY/NC/GA/MO/StL for JV/buyer compounding:

| State | Metro | County | Status |
|---|---|---|---|
| TN | Nashville | Davidson | Seeded (MANUAL_ONLY) |
| TN | Memphis | Shelby | Seeded (MANUAL_ONLY) |
| TN | Knoxville | Knox | Seeded (MANUAL_ONLY) |
| OH | Cincinnati | Hamilton | Seeded (MANUAL_ONLY) |
| OH | Columbus | Franklin | Seeded (MANUAL_ONLY) |
| IN | Indianapolis | Marion | Seeded (MANUAL_ONLY) |
| AL | Birmingham | Jefferson | Seeded (MANUAL_ONLY) — **state='AL', NOT 'KY'** |
| SC | Charleston | Charleston | Seeded (MANUAL_ONLY) |
| SC | Columbia | Richland | Seeded (MANUAL_ONLY) |
| VA | Richmond | Richmond City | Seeded (MANUAL_ONLY) |

**KY/AL Jefferson disambiguation**: both states have a Jefferson County. The `state` column
disambiguates: `state='KY'` = Louisville metro; `state='AL'` = Birmingham metro.
Query always includes `AND state = '{STATE}'` — never query by county name alone.

All Wave 2 jurisdictions start with compliance gates locked (`attorney_reviewed = false`).
Owner + attorney review required before any cold send fires.

---

## Checklist (per market)

- [ ] Sources identified (all categories)
- [ ] robots.txt checked live (date recorded)
- [ ] Terms reviewed (PERMITTED / MANUAL_ONLY / PROHIBITED classified)
- [ ] `lead_sources` rows inserted with correct `state` field
- [ ] Test ingest run: zero contact data, provenance intact, dedupe working
- [ ] Scoring verified: stacked signals outrank single signals
- [ ] Compliance gates seeded as locked (`attorney_reviewed = false`)
- [ ] Owner + attorney review scheduled before first cold send
- [ ] Suite green after addition
