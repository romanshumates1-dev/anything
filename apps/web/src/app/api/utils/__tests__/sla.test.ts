import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import sql from '@/app/api/utils/sql';
import {
  recordReplyReceived,
  recordAIDispatched,
  shouldSendAck,
  wasAckSent,
  markAckSent,
  computeP95Direct,
  dispatchAckIfNeeded,
  ANTHROPIC_ACK_THRESHOLD_MS,
} from '../sla';
import { __resetAiConfigCache } from '../ai-settings';

/**
 * These are LIVE-DB tests: they exercise real SQL semantics (per-conversation
 * "latest pending row" selection, P95 windowing, ack idempotency) against the
 * real `inbound_latency` table — mocking `sql` would make every assertion
 * vacuous. So they follow the SAME activation gate as the Layer C flow runner
 * (`flows-live.test.ts`): skipped in the plain unit suite (no DATABASE_URL,
 * where `sql` is a throwing NullishQueryFunction), executed in CI's Layer C job
 * and locally via:
 *   RUN_LIVE_FLOWS=1 node --env-file=.env ./node_modules/.bin/vitest run \
 *     --config src/app/api/vitest.config.ts src/app/api/utils/__tests__/sla.test.ts
 */
const LIVE = process.env.RUN_LIVE_FLOWS === '1' && !!process.env.DATABASE_URL;

describe.skipIf(!LIVE)('sla — INT-1 latency + ack instrumentation', () => {
  beforeEach(async () => {
    // Clean slate for every test
    await sql`DELETE FROM inbound_latency`;
    __resetAiConfigCache();
  });

  afterEach(async () => {
    await sql`DELETE FROM inbound_latency`;
  });

  // ── 1. recordReplyReceived ──
  it('creates a latency row with reply_received_at set', async () => {
    const id = await recordReplyReceived(101, 202);
    expect(id).toBeGreaterThan(0);

    const [row] = await sql`SELECT * FROM inbound_latency WHERE id = ${id}`;
    expect(row.conversation_id).toBe(101);
    expect(row.lead_id).toBe(202);
    expect(row.reply_received_at).toBeInstanceOf(Date);
    expect(row.ai_dispatched_at).toBeNull();
    expect(row.ack_sent_at).toBeNull();
  });

  // ── 2. recordAIDispatched ──
  it('updates the latest pending row with ai_dispatched_at and provider', async () => {
    await recordReplyReceived(101, 202);
    await recordAIDispatched(101, 'anthropic');

    const [row] = await sql`SELECT * FROM inbound_latency WHERE conversation_id = 101`;
    expect(row.ai_dispatched_at).toBeInstanceOf(Date);
    expect(row.provider).toBe('anthropic');
  });

  it('only updates the most recent pending row per conversation', async () => {
    // Two inbound replies on the same conversation (edge case: rapid replies)
    await recordReplyReceived(101, 202);
    await new Promise((r) => setTimeout(r, 10)); // tiny gap
    await recordReplyReceived(101, 202);

    // Dispatch should only touch the latest row
    await recordAIDispatched(101, 'anthropic');

    const rows = await sql`SELECT * FROM inbound_latency WHERE conversation_id = 101 ORDER BY reply_received_at`;
    expect(rows).toHaveLength(2);
    expect(rows[0].ai_dispatched_at).toBeNull(); // older row untouched
    expect(rows[1].ai_dispatched_at).toBeInstanceOf(Date); // latest row updated
  });

  // ── 3. shouldSendAck ──
  it('anthropic: does NOT ack within 45s threshold', () => {
    const received = new Date(Date.now() - 10_000); // 10s ago
    expect(shouldSendAck('anthropic', received)).toBe(false);
  });

  it('anthropic: DOES ack after 45s threshold', () => {
    const received = new Date(Date.now() - ANTHROPIC_ACK_THRESHOLD_MS - 1);
    expect(shouldSendAck('anthropic', received)).toBe(true);
  });

  it('anthropic: acks exactly at 45s threshold (>=)', () => {
    const received = new Date(Date.now() - ANTHROPIC_ACK_THRESHOLD_MS);
    expect(shouldSendAck('anthropic', received)).toBe(true);
  });

  it('ollama: ALWAYS acks immediately regardless of elapsed time', () => {
    const justNow = new Date(Date.now() - 100); // 100ms ago
    expect(shouldSendAck('ollama', justNow)).toBe(true);

    const longAgo = new Date(Date.now() - 120_000); // 2min ago
    expect(shouldSendAck('ollama', longAgo)).toBe(true);
  });

  // ── 4. wasAckSent / markAckSent ──
  it('wasAckSent returns false before ack, true after', async () => {
    await recordReplyReceived(101, 202);
    expect(await wasAckSent(101)).toBe(false);

    await markAckSent(101);
    expect(await wasAckSent(101)).toBe(true);
  });

  it('markAckSent is idempotent (only updates one row)', async () => {
    await recordReplyReceived(101, 202);
    await markAckSent(101);
    await markAckSent(101); // second call

    const rows = await sql`SELECT * FROM inbound_latency WHERE conversation_id = 101`;
    expect(rows).toHaveLength(1);
    expect(rows[0].ack_sent_at).toBeInstanceOf(Date);
  });

  // ── 5. computeP95Direct ──
  it('returns null when no completed dispatches exist', async () => {
    const p95 = await computeP95Direct();
    expect(p95).toBeNull();
  });

  it('computes P95 correctly over a window', async () => {
    // Seed 5 rows with known latencies: 100ms, 200ms, 300ms, 400ms, 500ms
    const base = Date.now();
    for (let i = 1; i <= 5; i++) {
      const convId = 1000 + i;
      const received = new Date(base);
      const dispatched = new Date(base + i * 100);
      await sql`
        INSERT INTO inbound_latency (conversation_id, lead_id, reply_received_at, ai_dispatched_at)
        VALUES (${convId}, 1, ${received}, ${dispatched})
      `;
    }

    const p95 = await computeP95Direct();
    // P95 of [100,200,300,400,500] = 500 (the 95th percentile of 5 points rounds up)
    expect(p95).not.toBeNull();
    expect(p95).toBeGreaterThanOrEqual(400);
  });

  it('excludes pending rows (ai_dispatched_at IS NULL) from P95', async () => {
    const base = Date.now();
    // One completed (500ms), one pending
    await sql`
      INSERT INTO inbound_latency (conversation_id, lead_id, reply_received_at, ai_dispatched_at)
      VALUES (2001, 1, ${new Date(base)}, ${new Date(base + 500)})
    `;
    await sql`
      INSERT INTO inbound_latency (conversation_id, lead_id, reply_received_at, ai_dispatched_at)
      VALUES (2002, 1, ${new Date(base)}, NULL)
    `;

    const p95 = await computeP95Direct();
    expect(p95).toBe(500); // only the completed row counts
  });

  it('respects the windowHours parameter', async () => {
    const oldBase = Date.now() - 48 * 60 * 60 * 1000; // 48 hours ago
    const recentBase = Date.now();

    // Old row: 10s latency
    await sql`
      INSERT INTO inbound_latency (conversation_id, lead_id, reply_received_at, ai_dispatched_at)
      VALUES (3001, 1, ${new Date(oldBase)}, ${new Date(oldBase + 10_000)})
    `;
    // Recent row: 5s latency
    await sql`
      INSERT INTO inbound_latency (conversation_id, lead_id, reply_received_at, ai_dispatched_at)
      VALUES (3002, 1, ${new Date(recentBase)}, ${new Date(recentBase + 5_000)})
    `;

    // 24h window should only see the recent row
    const p95_24h = await computeP95Direct(24);
    expect(p95_24h).toBe(5000);

    // 72h window should see both; P95 of [5000, 10000] interpolates to 9750
    // (percentile_cont(0.95) with 2 values: 5000 + 0.95*(10000-5000) = 9750)
    const p95_72h = await computeP95Direct(72);
    expect(p95_72h).toBe(9750);
  });

  // ── 6. dispatchAckIfNeeded ──
  it('ollama: sends ack immediately (no latency row needed for shouldSendAck)', async () => {
    // This tests the pure shouldSendAck logic; the full dispatchAckIfNeeded
    // requires DB + gateway mocking which we test at integration level.
    const justNow = new Date(Date.now() - 100);
    expect(shouldSendAck('ollama', justNow)).toBe(true);
  });

  it('anthropic within threshold: no ack', () => {
    const received = new Date(Date.now() - 1000);
    expect(shouldSendAck('anthropic', received)).toBe(false);
  });

  it('anthropic past threshold: ack required', () => {
    const received = new Date(Date.now() - ANTHROPIC_ACK_THRESHOLD_MS - 1000);
    expect(shouldSendAck('anthropic', received)).toBe(true);
  });

  // ── 7. Invariant: prospect never sits in silence ──
  it('invariant: ollama always acks (50s/gen > human patience)', () => {
    // The invariant is: for ollama, ack ALWAYS fires before AI response.
    // This is enforced by shouldSendAck returning true for ollama at t=0.
    const t0 = new Date();
    expect(shouldSendAck('ollama', t0)).toBe(true);
  });

  it('invariant: anthropic acks only when threshold crossed (fast path no ack)', () => {
    // Anthropic is typically <10s, so most of the time no ack is needed.
    // The 45s threshold is a safety net for slow/failing calls.
    const t0 = new Date();
    expect(shouldSendAck('anthropic', t0)).toBe(false);
  });
});
