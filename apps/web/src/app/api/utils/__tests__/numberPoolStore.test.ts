/**
 * INT-3 — number pool STORE (live DB).
 *
 * Only the things that genuinely need Postgres live here: the atomic cap claim,
 * the lazy daily reset, and the rotation-cap setting round-trip. The selection
 * algorithm itself is pure and tested with no DB in numberPool.select.test.ts.
 *
 * Gate matches the repo pattern (flows-live.test.ts, sla.test.ts):
 *   RUN_LIVE_FLOWS=1 DATABASE_URL=... vitest run
 */
import { describe, it, expect, beforeEach, afterAll } from 'vitest';

const LIVE = process.env.RUN_LIVE_FLOWS === '1' && !!process.env.DATABASE_URL;

describe.skipIf(!LIVE)('numberPoolStore — INT-3 pool storage (live DB)', () => {
  let store: typeof import('../numberPoolStore');
  let sql: typeof import('../sql').default;

  const P502 = '+15025550101';
  const P270 = '+12705550102';
  const P213 = '+12135550103';
  const ALL = [P502, P270, P213];

  const cleanup = async () => {
    await sql`DELETE FROM number_pool WHERE phone_number = ANY(${ALL})`;
    await sql`DELETE FROM app_settings WHERE key = 'number_pool'`;
  };

  beforeEach(async () => {
    store = await import('../numberPoolStore');
    sql = (await import('../sql')).default;
    await cleanup();
    for (const p of ALL) await store.addNumber({ phoneNumber: p });
  });

  afterAll(async () => {
    if (LIVE) await cleanup();
  });

  it('addNumber derives the area code and is idempotent', async () => {
    await store.addNumber({ phoneNumber: P502 }); // second insert, same number
    const rows = await sql`SELECT area_code, daily_sent FROM number_pool WHERE phone_number = ${P502}`;
    expect(rows).toHaveLength(1);
    expect(rows[0].area_code).toBe('502');
    expect(rows[0].daily_sent).toBe(0);
  });

  it('rotation cap round-trips and defaults to 125 when unset', async () => {
    expect(await store.getRotationCap()).toBe(125); // no row -> default
    await store.setRotationCap(40);
    expect(await store.getRotationCap()).toBe(40);
  });

  it('rejects a nonsense rotation cap rather than storing it', async () => {
    await expect(store.setRotationCap(-1)).rejects.toThrow();
    await expect(store.setRotationCap(1.5)).rejects.toThrow();
  });

  it('pickNumber returns the exact-area-code match and increments its counter', async () => {
    const picked = await store.pickNumber('+15025559999');
    expect(picked).toBe(P502);
    const [row] = await sql`SELECT daily_sent FROM number_pool WHERE phone_number = ${P502}`;
    expect(row.daily_sent).toBe(1);
  });

  it('respects the rotation cap and never exceeds it, then returns null', async () => {
    await store.setRotationCap(2);
    // Only the 502 number is a local match, but once every number in the pool is
    // capped the answer must be null — not "send from anything".
    const picks: (string | null)[] = [];
    for (let i = 0; i < 8; i++) picks.push(await store.pickNumber('+15025559999'));

    const sent = await sql`SELECT phone_number, daily_sent FROM number_pool WHERE phone_number = ANY(${ALL}) ORDER BY phone_number`;
    for (const r of sent) expect(r.daily_sent).toBeLessThanOrEqual(2); // cap never breached
    expect(picks.filter(Boolean)).toHaveLength(6); // 3 numbers x cap 2
    expect(picks[6]).toBeNull();
    expect(picks[7]).toBeNull();
  });

  it('lazy daily reset: yesterday\'s counter does not consume today\'s cap', async () => {
    await store.setRotationCap(1);
    await sql`UPDATE number_pool SET daily_sent = 99, last_reset_date = CURRENT_DATE - 1 WHERE phone_number = ${P502}`;

    // Stale counter is from yesterday -> today it reads as 0 and is eligible.
    expect(await store.pickNumber('+15025559999')).toBe(P502);
    const [row] = await sql`SELECT daily_sent, last_reset_date FROM number_pool WHERE phone_number = ${P502}`;
    expect(row.daily_sent).toBe(1); // reset to 0 then claimed once, NOT 100
  });

  it('concurrent picks cannot both claim the last slot', async () => {
    await store.setRotationCap(1);
    await sql`UPDATE number_pool SET active = false WHERE phone_number IN (${P270}, ${P213})`;

    // 5 racing picks, one slot on the only active number.
    const results = await Promise.all(Array.from({ length: 5 }, () => store.pickNumber('+15025559999')));
    expect(results.filter((r) => r === P502)).toHaveLength(1);
    const [row] = await sql`SELECT daily_sent FROM number_pool WHERE phone_number = ${P502}`;
    expect(row.daily_sent).toBe(1); // the invariant: exactly one send claimed
  });

  it('listPoolUsage exposes BOTH the rotation guard and the carrier ceiling', async () => {
    await store.setRotationCap(125);
    const usage = await store.listPoolUsage();
    expect(usage.rotationCap).toBe(125);
    const row = usage.numbers.find((n) => n.phoneNumber === P502)!;
    expect(row.cap.rotationCap).toBe(125);
    expect(row.cap.carrierCap).toBeGreaterThan(125); // carrier truth is higher
    expect(row.cap.effective).toBe(125);
    expect(row.cap.limitedBy).toBe('rotation');
    expect(row.remaining).toBe(125);
  });

  it('inactive numbers are never picked', async () => {
    await sql`UPDATE number_pool SET active = false WHERE phone_number = ${P502}`;
    const picked = await store.pickNumber('+15025559999');
    expect(picked).not.toBe(P502);
  });
});
