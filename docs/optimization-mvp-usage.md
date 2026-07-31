# DealFlow AI Optimization MVP - Usage Guide

## Overview

The Optimization MVP is a Claude-native decision engine that:
1. Scores leads by conversion potential
2. Values properties using comp-based analysis
3. Calculates deal probability
4. Prioritizes actions by expected value

## Architecture

```
Lead → Orchestrator → [4 Claude Agents] → Database → Dashboard
```

**Agents:**
1. **Lead Scoring** - Distress + recency + equity + geo → composite score
2. **Valuation** - Comps + repairs → ARV + offer range
3. **Probability** - Score + valuation confidence → P(close) + EV
4. **Decision** - Probability + EV → action + priority

## Getting Started

### 1. Seed Test Data

```bash
cd apps/web
yarn tsx scripts/seed-optimization-test.mjs
```

This creates 5 test leads with varying distress levels.

### 2. Process Leads

**Single lead:**
```bash
curl -X POST http://localhost:4000/api/optimization/process \
  -H "Content-Type: application/json" \
  -H "Cookie: <session-cookie>" \
  -d '{"leadId": 123}'
```

**Batch:**
```bash
curl -X POST http://localhost:4000/api/optimization/process \
  -H "Content-Type: application/json" \
  -H "Cookie: <session-cookie>" \
  -d '{"leadIds": [123, 124, 125]}'
```

### 3. View Dashboard

Navigate to: http://localhost:4000/optimization/dashboard

**Dashboard sections:**
- **KPI Bar** - Total leads, active deals, expected value, avg probability
- **Deal Pipeline** - Leads sorted by expected value
- **Action Queue** - Next actions sorted by priority

### 4. View Lead Details

GET http://localhost:4000/api/optimization/decision/123

Returns all agent outputs for a specific lead.

## Database Tables

- `lead_scores` - Composite score + components
- `property_valuations` - ARV + repairs + offer range
- `deal_probabilities` - P(close) + expected value
- `lead_actions` - Priority queue of actions
- `lead_events` - Event log for learning (future)

## Configuration

**Required environment variable:**
```
ANTHROPIC_API_KEY=sk-ant-...
```

**Claude model used:** `claude-sonnet-4-20250514`

## Customization

### Adjust Scoring Weights

Edit `apps/web/src/app/api/optimization/agents/prompts.ts`:

```typescript
// Lead scoring weights
0.4 × distress +
0.3 × recency +
0.2 × equity +
0.1 × geo
```

### Adjust Wholesale Formula

Edit valuation prompt:

```typescript
buyerMax = ARV × 0.70  // 70% rule
offerMax = buyerMax - repairs - 10000  // $10k fee
```

### Adjust Decision Thresholds

Edit decision prompt:

```typescript
if pClose > 0.7 → pursue
if pClose 0.4-0.7 → conditional
if pClose < 0.4 → reject
```

## Troubleshooting

**No data in dashboard:**
- Verify leads were processed: `SELECT COUNT(*) FROM lead_scores`
- Check API logs for errors
- Ensure ANTHROPIC_API_KEY is set

**Claude API errors:**
- Check API key is valid
- Verify model name is correct
- Check Anthropic API status

**Database errors:**
- Verify migration 050 ran successfully
- Check all 5 tables exist

## Next Steps

After validating the MVP:

1. **Collect real outcomes** - Track which leads actually close
2. **Replace mock comps** - Integrate real comparable sales data
3. **Add learning loops** - Update models based on outcomes
4. **Add experimentation** - A/B test messaging, timing, strategies
5. **Scale up** - Add distributed workers when processing >100 leads/day

## Support

For issues or questions, see:
- Design doc: `docs/superpowers/specs/2026-07-31-dealflow-mvp-design.md`
- Implementation plan: `docs/superpowers/plans/2026-07-31-dealflow-optimization-mvp.md`
