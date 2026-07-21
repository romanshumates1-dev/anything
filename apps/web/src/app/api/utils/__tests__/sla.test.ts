/**
 * SLA — LIVE DB tests for SQL semantics.
 *
 * Tests that exercise real SQL semantics (per-conversation "latest pending row"
 * selection, P95 windowing, ack idempotency) against the real `inbound_latency`
 * table. Mocking `sql` would make every assertion vacuous.
 *
 * Follows the same activation gate as the Layer C flow runner:
 * RUN_LIVE_FLOWS=1 DATABASE_URL=... vitest run
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sql from '@/app/api/utils/sql';
import {
  recordReplyReceived,
  recordAIDispatched,
  wasAckSent,
  markAckSent,
  computeP95Direct,
} from '../sla';
import { __resetAiConfigCache } from '../ai-settings';

const LIVE = process.env.RUN_LIVE_FLOWS === '1' && !!process.env.DATABASE_URL;

describe.skipIf(!LIVE)('sla — INT-1 latency + ack instrumentation (live DB)', () => {
  beforeEach(async () => {
    await sql`DELETE FROM inbound_latency`;
    __resetAiConfigCache();
  });

  afterEach(async () => {
    await sql`DELETE FROM inbound_latency`;
  });

  // ─── 1. recordReplyReceived ───
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

  // ─── 2. recordAIDispatched ───
  it('updates the latest pending row with ai_dispatched_at and provider', async () => {
    await recordReplyReceived(101, 202);
    await recordAIDispatched(101, 'anthropic');

    const [row] = await sql`SELECT * FROM inbound_latency WHERE conversation_id = 101`;
    expect(row.ai_dispatched_at).toBeInstanceOf(Date);
    expect(row.provider).toBe('anthropic');
  });

  it('only updates the most recent pending row per conversation', async () => {
    await recordReplyReceived(101, 202);
    await new Promise((r) => setTimeout(r, 10));
    await recordReplyReceived(101, 202);

    await recordAIDispatched(101, 'anthropic');

    const rows = await sql`SELECT * FROM inbound_latency WHERE conversation_id = 101 ORDER BY reply_received_at`;
    expect(rows).toHaveLength(2);
    expect(rows[0].ai_dispatched_at).toBeNull();
    expect(rows[1].ai_dispatched_at).toBeInstanceOf(Date);
  });

  // ─── 4. wasAckSent / markAckSent ───
  it('wasAckSent returns false before ack, true after', async () => {
    await recordReplyReceived(101, 202);
    expect(await wasAckSent(101)).toBe(false);

    await markAckSent(101);
    expect(await wasAckSent(101)).toBe(true);
  });

  it('markAckSent is idempotent (only updates one row)', async () => {
    await recordReplyReceived(101, 202);
    await markAckSent(101);
    await markAckSent(101);

    const rows = await sql`SELECT * FROM inbound_latency WHERE conversation_id = 101`;
    expect(rows).toHaveLength(1);
    expect(rows[0].ack_sent_at).toBeInstanceOf(Date);
  });

  // ─── 5. computeP95Direct ───
  it('returns null when no completed dispatches exist', async () => {
    const p95 = await computeP95Direct();
    expect(p95).toBeNull();
  });

  it('computes P95 correctly over a window', async () => {
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
    expect(p95).not.toBeNull();
    expect(p95).toBeGreaterThanOrEqual(400);
  });

  it('excludes pending rows (ai_dispatched_at IS NULL) from P95', async () => {
    const base = Date.now();
    await sql`
      INSERT INTO inbound_latency (conversation_id, lead_id, reply_received_at, ai_dispatched_at)
      VALUES (2001, 1, ${new Date(base)}, ${new Date(base + 500)})
    `;
    await sql`
      INSERT INTO inbound_latency (conversation_id, lead_id, reply_received_at, ai_dispatched_at)
      VALUES (2002, 1, ${new Date(base)}, NULL)
    `;

    const p95 = await computeP95Direct();
    expect(p95).toBe(500);
  });

  it('respects the windowHours parameter', async () => {
    const oldBase = Date.now() - 48 * 60 * 60 * 1000;
    const recentBase = Date.now();

    await sql`
      INSERT INTO inbound_latency (conversation_id, lead_id, reply_received_at, ai_dispatched_at)
      VALUES (3001, 1, ${new Date(oldBase)}, ${new Date(oldBase + 10_000)})
    `;
    await sql`
      INSERT INTO inbound_latency (conversation_id, lead_id, reply_received_at, ai_dispatched_at)
      VALUES (3002, 1, ${new Date(recentBase)}, ${new Date(recentBase + 5_000)})
    `;

    const p95_24h = await computeP95Direct(24);
    expect(p95_24h).toBe(5000);

    const p95_72h = await computeP95Direct(72);
    expect(p95_72h).toBe(9750);
  });
});

// Guard so the file is never a silent no-op when LIVE is disabled.
describe.skipIf(LIVE)('sla — skipped (set RUN_LIVE_FLOWS=1 + DATABASE_URL to enable)', () => {
  it('is intentionally skipped without a live DB', () => {
    expect(LIVE).toBe(false);
  });
});