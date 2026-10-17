/**
 * Migration 102 — `award_achievement()` exact-once proof on a REAL engine.
 *
 * PGlite is genuine PostgreSQL (WASM); migration 102 is applied from disk
 * verbatim. Proves: function exists, never-touched rows are created, progress
 * is monotonic, and N unlock attempts pay EXACTLY ONCE. It does NOT prove
 * multi-connection row-lock blocking (PGlite is single-connection; the
 * FOR UPDATE claim rests on review of the one-statement function).
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

let db: PGlite;

const MIGRATION_102 = join(process.cwd(), 'db', 'migrations', '102_achievement_points_race_fix.sql');
const USER = 'ach_user_1';
const ACH_ID = 7;
const POINTS = 150;

interface AwardRow {
  progress: number;
  unlocked: boolean;
  just_unlocked: boolean;
  points_awarded: number;
}

async function award(
  userId: string,
  achId: number,
  progress: number,
  unlock: boolean,
  points: number,
): Promise<AwardRow> {
  const res = await db.query<AwardRow>('SELECT * FROM award_achievement($1,$2,$3,$4,$5)', [
    userId,
    achId,
    progress,
    unlock,
    points,
  ]);
  return res.rows[0];
}

async function statsPoints(userId: string): Promise<number> {
  const res = await db.query<{ points: number | string }>(
    'SELECT points FROM user_stats WHERE user_id = $1',
    [userId],
  );
  return res.rows.length ? Number(res.rows[0].points) : 0;
}

async function achRow(
  userId: string,
  achId: number,
): Promise<{ progress: number; unlocked: boolean; unlocked_at: string | null } | undefined> {
  const res = await db.query<{ progress: number; unlocked: boolean; unlocked_at: string | null }>(
    'SELECT progress, unlocked, unlocked_at FROM user_achievements WHERE user_id=$1 AND achievement_id=$2',
    [userId, achId],
  );
  return res.rows[0];
}

beforeAll(async () => {
  db = new PGlite();
  await db.waitReady;
  await db.exec(`
    CREATE TABLE "user" (id text PRIMARY KEY);
    CREATE TABLE achievements (
      id serial PRIMARY KEY,
      key text UNIQUE NOT NULL,
      max_progress integer,
      points integer NOT NULL DEFAULT 0
    );
    CREATE TABLE user_achievements (
      user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
      achievement_id integer NOT NULL REFERENCES achievements(id) ON DELETE CASCADE,
      progress integer NOT NULL DEFAULT 0,
      unlocked boolean NOT NULL DEFAULT false,
      unlocked_at timestamptz,
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE(user_id, achievement_id)
    );
    CREATE TABLE user_stats (
      user_id text PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
      points integer NOT NULL DEFAULT 0,
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    INSERT INTO "user" (id) VALUES ('${USER}');
    INSERT INTO achievements (id, key, max_progress, points)
    VALUES (${ACH_ID}, 'campaign_creator', 5, ${POINTS});
  `);
  await db.exec(readFileSync(MIGRATION_102, 'utf8'));
  await db.exec(readFileSync(MIGRATION_102, 'utf8'));
}, 120_000);

beforeEach(async () => {
  await db.exec('TRUNCATE user_achievements, user_stats');
});

describe('migration 102 on a real Postgres engine', () => {
  it('creates the function and survives re-application', async () => {
    const res = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM pg_proc WHERE proname='award_achievement'`,
    );
    expect(res.rows[0].n).toBe(1);
  });

  it('creates the row for a never-touched achievement and pays on unlock', async () => {
    expect(await achRow(USER, ACH_ID)).toBeUndefined();
    const r = await award(USER, ACH_ID, 5, true, POINTS);
    expect(r.unlocked).toBe(true);
    expect(Number(r.points_awarded)).toBe(POINTS);
    expect(await statsPoints(USER)).toBe(POINTS);
    expect((await achRow(USER, ACH_ID))?.progress).toBe(5);
  });

  it('a repeated unlock pays zero, preserves timestamp', async () => {
    await award(USER, ACH_ID, 5, true, POINTS);
    const first = await achRow(USER, ACH_ID);
    const r = await award(USER, ACH_ID, 5, true, POINTS);
    expect(Number(r.points_awarded)).toBe(0);
    expect(await statsPoints(USER)).toBe(POINTS);
    expect((await achRow(USER, ACH_ID))?.unlocked_at).toEqual(first?.unlocked_at);
  });

  it('progress without unlock pays nothing and never rewinds', async () => {
    const r1 = await award(USER, ACH_ID, 3, false, POINTS);
    expect(Number(r1.points_awarded)).toBe(0);
    expect(r1.unlocked).toBe(false);
    const r2 = await award(USER, ACH_ID, 1, false, POINTS);
    expect(Number(r2.progress)).toBe(3);
    expect(await statsPoints(USER)).toBe(0);
  });

  it('a burst of unlocks pays exactly once', async () => {
    const dead: AwardRow = { progress: 0, unlocked: false, just_unlocked: false, points_awarded: 0 };
    const results = await Promise.all(
      Array.from({ length: 10 }, () => award(USER, ACH_ID, 5, true, POINTS).catch(() => dead)),
    );
    const paid = results.filter((r) => Number(r.points_awarded) > 0);
    expect(paid).toHaveLength(1);
    expect(await statsPoints(USER)).toBe(POINTS);
  }, 60_000);
});

