/**
 * message_events — every INSERT must be satisfiable by the real schema.
 *
 * WHY THIS EXISTS
 * ---------------
 * Four route handlers wrote to public.message_events columns that migration 001
 * never created (conversation_id, lead_id, channel, from_address, to_address,
 * subject, body, external_id, type) and three of them omitted the NOT NULL
 * primary key `id`. Every one of those statements failed at runtime with
 * SQLSTATE 42703 "column does not exist".
 *
 * It stayed invisible for three separate reasons, which is the part worth
 * remembering:
 *
 *   1. The table has 0 rows, so nothing that reads message_events noticed.
 *   2. `smsOutreachEngine.ts` ends its INSERT with `.catch(console.error)`,
 *      and `contractNotifications.ts` with `.catch(() => {})` — the two paths
 *      that swallow the exception are the ones that prove it is broken.
 *   3. The route is admin-only and manual (`requireAdmin` + a POST), so it is
 *      not exercised by the normal test or demo flow.
 *
 * A unit test with a mocked `sql` cannot catch this: the mock accepts any
 * column list. Catching it requires checking the SQL text against the columns
 * the migrations actually create, which is what this does.
 *
 * The schema was verified against the live database on 2026-09-30, not
 * inferred from the migrations alone.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { scanSource, readSource } from './_sourceScan';

const MIGRATIONS_DIR = join(process.cwd(), 'db', 'migrations');
const API_ROOT = join(process.cwd(), 'src', 'app', 'api');

/**
/**
 * Columns created by the migrations, in file order.
 *
 * Parsed from `CREATE TABLE public.message_events` plus every
 * `ALTER TABLE public.message_events ADD/DROP COLUMN` across the chain.
 * `IF [NOT] EXISTS` is tolerated so a re-run is not misread as a change.
 */
function declaredColumns(): Set<string> {
  const cols = new Set<string>();
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
  for (const f of files) {
    const text = readFileSync(join(MIGRATIONS_DIR, f), 'utf8');

    const create = /CREATE TABLE(?:\s+IF NOT EXISTS)?\s+public\.message_events\s*\(([\s\S]*?)\n\);/i.exec(text);
    if (create) {
      for (const line of create[1].split('\n')) {
        const m = /^\s*([a-z_][a-z0-9_]*)\s+[a-z]/i.exec(line);
        if (m) cols.add(m[1]);
      }
    }

    for (const stmt of text.match(/ALTER TABLE\s+public\.message_events[\s\S]*?;/gi) || []) {
      for (const clause of stmt.split(',')) {
        const add = /ADD COLUMN(?:\s+IF NOT EXISTS)?\s+([a-z_][a-z0-9_]*)/i.exec(clause);
        if (add) {
          cols.add(add[1]);
          continue;
        }
        const drop = /DROP COLUMN(?:\s+IF EXISTS)?\s+([a-z_][a-z0-9_]*)/i.exec(clause);
        if (drop) cols.delete(drop[1]);
      }
    }
  }
  return cols;
}

/** The exact column list of one `INSERT INTO message_events (...) VALUES (...)`. */
function insertColumns(sqlText: string): string[] | null {
  const m = /INSERT INTO\s+message_events\s*\(([\s\S]*?)\)\s*VALUES/i.exec(sqlText);
  if (!m) return null;
  return m[1]
    .split(',')
    .map((c) => c.trim())
    .filter(Boolean);
}

/**
 * Columns that are NOT NULL *and* have no DEFAULT, after accounting for later
 * migrations that relax them. A statement omitting one of these fails at
 * runtime; a NOT NULL column with a DEFAULT does not.
 *
 * Built from the live-verified facts rather than assumed: `id`,
 * `organization_id`, `direction` have no default, while `status`,
 * `segment_count`, `cost_cents`, `ai_cost_cents` and `created_at` all carry
 * DEFAULTs in migration 001, so omitting them is legal.
 */
function requiredColumns(): Set<string> {
  const required = new Set<string>(['id', 'organization_id', 'direction']);
  for (const file of readdirSync(MIGRATIONS_DIR)) {
    if (!file.endsWith('.sql')) continue;
    const text = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    for (const stmt of text.match(/ALTER TABLE\s+public\.message_events[\s\S]*?;/gi) || []) {
      for (const part of stmt.split(',')) {
        const drop = /ALTER COLUMN\s+([a-z_][a-z0-9_]*)\s+DROP NOT NULL/i.exec(part);
        if (drop) required.delete(drop[1]);
      }
    }
  }
  return required;
}

describe('message_events ledger schema', () => {
  const declared = declaredColumns();
  const required = requiredColumns();

  const statements = scanSource(API_ROOT, { excludeTests: true })
    .filter((f) => readSource(f).includes('INSERT INTO message_events'))
    .map((f) => ({ f, cols: insertColumns(readSource(f)) }))
    .filter((s): s is { f: string; cols: string[] } => s.cols !== null);

  it('parses the migrations into a non-empty column set', () => {
    // A parser that silently matched nothing would make every assertion below
    // vacuously true, which is the recurring failure mode in this suite.
    expect(declared.size).toBeGreaterThan(10);
    for (const c of ['id', 'organization_id', 'campaign_id', 'contact_id', 'direction', 'status', 'metadata']) {
      expect(declared.has(c)).toBe(true);
    }
    // Columns the four broken statements needed.
    for (const c of ['channel', 'body', 'subject', 'type', 'external_id', 'from_address', 'to_address', 'lead_id', 'conversation_id']) {
      expect(declared.has(c)).toBe(true);
    }
  });

  it('finds every message_events INSERT (guards against a broken scan root)', () => {
    expect(statements.length).toBeGreaterThanOrEqual(4);
  });

  it('every INSERT references only columns the migrations create', () => {
    const violations = statements
      .map((s) => ({ f: s.f, unknown: s.cols.filter((c) => !declared.has(c)) }))
      .filter((v) => v.unknown.length > 0)
      .map((v) => `${v.f}: ${v.unknown.join(', ')}`);

    expect(violations).toEqual([]);
  });

  it('every INSERT supplies every still-required column', () => {
    const violations = statements
      .map((s) => ({ f: s.f, missing: [...required].filter((c) => !s.cols.includes(c)) }))
      .filter((v) => v.missing.length > 0)
      .map((v) => `${v.f}: ${v.missing.join(', ')}`);

    expect(violations).toEqual([]);
  });

  it('adds and drops no message_events column in the same migration', () => {
    // Scoped to message_events statements only. An unscoped version of this
    // assertion fires on unrelated tables — migration 016 legitimately both
    // adds and drops `contract_price_cents` on `contracts`, which has nothing
    // to do with this ledger.
    for (const file of readdirSync(MIGRATIONS_DIR)) {
      if (!file.endsWith('.sql')) continue;
      const text = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
      for (const stmt of text.match(/ALTER TABLE\s+public\.message_events[\s\S]*?;/gi) || []) {
        const added = [...stmt.matchAll(/ADD COLUMN(?:\s+IF NOT EXISTS)?\s+([a-z_][a-z0-9_]*)/gi)].map((m) => m[1]);
        const dropped = [...stmt.matchAll(/DROP COLUMN(?:\s+IF EXISTS)?\s+([a-z_][a-z0-9_]*)/gi)].map((m) => m[1]);
        for (const col of added) expect(dropped, `${file}: ${col}`).not.toContain(col);
      }
    }
  });
});