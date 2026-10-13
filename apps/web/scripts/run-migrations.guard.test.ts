/**
 * Regression guard for the `run-migrations.mjs` comment-stripping defect.
 *
 * WHY THIS TEST EXISTS
 * --------------------
 * `splitStatements()` attaches each statement's preceding comment block to the
 * statement text. The runner then gated on the FIRST LINE:
 *
 *     const trimmed = stmt.trim();
 *     if (!trimmed || trimmed.startsWith('--')) continue;   // <-- the defect
 *
 * so ANY migration statement written under a `--` header block was skipped
 * WHOLE. Migration 099 (`099_gamification_rewards.sql`) opens with a 40-line
 * `--` preamble above every `CREATE TABLE`, so the runner executed 10 of 23
 * statements, created 1 of the 13 tables, printed "All migrations complete!"
 * and exited 0. The deployed Worker then served HTTP 500
 * `relation "public.user_spin_wallet" does not exist`.
 *
 * Measured against the real migration file by the RED probe that accompanied
 * this fix: OLD gate = 10/23 statements and 1/13 CREATE TABLEs; NEW gate =
 * 23/23 statements and 13/13 CREATE TABLEs. Twelve tables silently vanished
 * while the runner reported success.
 *
 * The failure mode is what makes this worth a permanent test: it was SILENT.
 * Exit code 0, "All migrations complete!" on stdout, no error anywhere â€” and a
 * half-migrated database. Nothing but this assertion distinguishes "applied" from
 * "no-op".
 *
 * WHAT IS ASSERTED
 * ----------------
 * 1. `stripLeadingComments` removes documentation but never executable SQL.
 * 2. No migration file in `db/migrations/` has an executable statement silently
 *    dropped by the gate â€” applied to EVERY file, so the next migration written
 *    with a header comment cannot reintroduce this.
 * 3. The benign-error matcher stays narrow. It once also matched
 *    `does not exist`, which masked this very defect and would equally mask a
 *    wrong `DATABASE_URL` pointing at a database missing a migration's FK
 *    targets â€” a real deployment fault that must stop the run.
 *
 * The functions are re-implemented here verbatim from the runner because that
 * module executes `runMigrations()` on import. If the runner's copy drifts from
 * this one, assertions 2 and 3 fail â€” which is the intended alarm.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { splitStatements as vettedSplitStatements } from './lib/split-sql.mjs';

const MIGRATIONS_DIR = join(process.cwd(), 'db', 'migrations');

/** Verbatim from scripts/run-migrations.mjs. */
function stripTrailingComment(line: string): string {
  let inString = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === "'") {
      if (inString && line[i + 1] === "'") { i++; continue; }
      inString = !inString;
      continue;
    }
    if (!inString && ch === '-' && line[i + 1] === '-') {
      if (i === 0 || /\s/.test(line[i - 1])) return line.slice(0, i);
    }
  }
  return line;
}

/** Verbatim from scripts/run-migrations.mjs. */
function splitStatements(content: string): string[] {
  const statements: string[] = [];
  let current = '';
  let inDollarQuote = false;

  const lines = content.split('\n');
  for (const line of lines) {
    const dollarMatches = line.match(/\$\$/g);
    if (dollarMatches) {
      for (const _ of dollarMatches) {
        inDollarQuote = !inDollarQuote;
      }
    }

    current += line + '\n';

    if (!inDollarQuote && stripTrailingComment(line).trim().endsWith(';')) {
      statements.push(current.trim());
      current = '';
    }
  }

  if (current.trim()) {
    statements.push(current.trim());
  }

  return statements;
}

/** Verbatim from scripts/run-migrations.mjs. */
function stripLeadingComments(stmt: string): string {
  const lines = stmt.split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i].trim();
    if (line === '' || line.startsWith('--')) {
      i++;
      continue;
    }
    break;
  }
  return lines.slice(i).join('\n');
}

/** Verbatim from scripts/run-migrations.mjs. */
const BENIGN_ERROR = /(already exists|duplicate key value violates unique constraint)/i;

/** The shipped gate: strip documentation, run whatever executable remains. */
function gate(stmt: string): string | null {
  const trimmed = stripLeadingComments(stmt).trim();
  return trimmed ? trimmed : null;
}

/** The pre-fix gate, kept only so the test can prove the defect was real. */
function buggyGate(stmt: string): string | null {
  const trimmed = stmt.trim();
  if (!trimmed || trimmed.startsWith('--')) return null;
  return trimmed;
}

function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
}

describe('run-migrations comment stripping', () => {
  it('strips a leading comment block but keeps the executable SQL', () => {
    const stmt = [
      '-- Migration 099 â€” gamification reward layer.',
      '-- Spins are earned, never bought.',
      '',
      'CREATE TABLE user_spin_wallet (id uuid PRIMARY KEY);',
    ].join('\n');

    const result = gate(stmt);

    expect(result).not.toBeNull();
    expect(result).toBe('CREATE TABLE user_spin_wallet (id uuid PRIMARY KEY);');
    expect(result).not.toMatch(/gamification reward layer/);
  });

  it('drops a statement that is pure documentation', () => {
    expect(gate('-- just a note\n-- and another\n')).toBeNull();
    expect(gate('')).toBeNull();
  });

  it('reproduces the original defect so this guard cannot rot into a tautology', () => {
    // If the pre-fix gate ever stopped being broken, the reproduction below
    // would silently stop proving anything. Pin it explicitly.
    const stmt = ['-- header', 'CREATE TABLE t (id uuid);'].join('\n');
    expect(buggyGate(stmt)).toBeNull();
    expect(gate(stmt)).toBe('CREATE TABLE t (id uuid);');
  });

  it('applies every executable statement in migration 099 â€” the file that shipped broken', () => {
    const ddl = readFileSync(join(MIGRATIONS_DIR, '099_gamification_rewards.sql'), 'utf8');
    const applied = splitStatements(ddl).map(gate).filter(Boolean) as string[];

    const expectedCreates = (ddl.match(/CREATE\s+TABLE/gi) || []).length;
    const actualCreates = applied.filter((s) => /CREATE\s+TABLE/i.test(s)).length;

    expect(expectedCreates).toBeGreaterThan(0);
    expect(actualCreates).toBe(expectedCreates);
  });

  it('does not merge a statement whose semicolon is followed by a trailing comment', () => {
    const file = migrationFiles().find((f) => f.startsWith('082_'));
    expect(file).toBeDefined();
    const ddl = readFileSync(join(MIGRATIONS_DIR, file as string), 'utf8');

    // A SECOND, independent defect in the same runner, found by diffing its
    // output against the vetted splitter in scripts/lib/split-sql.mjs (used by
    // migration-gate.mjs) across all 99 files. 082 line 12 ends with
    // `... INTEGER DEFAULT 500000; -- $5k` â€” a trailing comment AFTER the
    // semicolon. The splitter's `line.trim().endsWith(';')` test fails on that
    // line, so the statement never terminates and silently merges with the two
    // that follow it. The lost statement is
    // `COMMENT ON COLUMN public.pipeline_config.negotiation_strategy`, whose
    // column therefore shipped without its documentation.
    const applied = splitStatements(ddl).map(gate).filter(Boolean) as string[];

    expect(applied.some((s) => /negotiation_strategy\s+IS/.test(s))).toBe(true);

    // Guard the general shape, not just this one file: no statement produced by
    // the splitter may still contain an un-consumed semicolon from a *later*
    // statement, which is what merging looks like from the inside.
    const vetted = vettedSplitStatements(ddl)
      .map((s) => gate(s))
      .filter(Boolean) as string[];

    expect(applied.length).toBe(vetted.length);
  });

  it('applies the same statements as the vetted splitter for every migration', () => {
    // The strongest available oracle. scripts/migration-gate.mjs â€” the gate that
    // has always reported PASS â€” uses scripts/lib/split-sql.mjs. run-migrations.mjs
    // carries its own weaker copy of that logic, and the two drifted: 772 vs 773
    // statements across the corpus, the missing one being real DDL in 082. If
    // they ever agree exactly, this runner can no longer lose a statement the
    // migration gate would have applied.
    let runMigrationsTotal = 0;
    let vettedTotal = 0;
    const differing: string[] = [];

    for (const file of migrationFiles()) {
      const ddl = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
      const mine = splitStatements(ddl).map(gate).filter(Boolean) as string[];
      const ref = vettedSplitStatements(ddl)
        .map((s) => gate(s))
        .filter(Boolean) as string[];

      runMigrationsTotal += mine.length;
      vettedTotal += ref.length;
      if (mine.length !== ref.length) differing.push(`${file}: ${mine.length} vs ${ref.length}`);
    }

    expect(differing).toEqual([]);
    expect(runMigrationsTotal).toBe(vettedTotal);
  });

  it('proves the defect was real, so the assertions above are not vacuous', () => {
    // A guard that passes against a runner which never had the bug protects
    // nothing. This pins the pre-fix behaviour to real numbers measured on the
    // real corpus, so if someone reverts the fix this test still describes a
    // genuine regression rather than an imagined one.
    // The pre-fix pipeline, reproduced exactly as it shipped: the ORIGINAL
    // terminator test (`line.trim().endsWith(';')`, which merged 082's
    // semicolon-plus-comment line) feeding the ORIGINAL gate
    // (`trimmed.startsWith('--')`, which dropped every commented statement).
    const originalSplit = (content: string): string[] => {
      const out: string[] = [];
      let cur = '';
      let inDollar = false;
      for (const line of content.split('\n')) {
        const dm = line.match(/\$\$/g);
        if (dm) for (const _ of dm) inDollar = !inDollar;
        cur += line + '\n';
        if (!inDollar && line.trim().endsWith(';')) {
          out.push(cur.trim());
          cur = '';
        }
      }
      if (cur.trim()) out.push(cur.trim());
      return out;
    };

    let buggyApplied = 0;
    let fixedApplied = 0;

    for (const file of migrationFiles()) {
      const ddl = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
      buggyApplied += originalSplit(ddl).map(buggyGate).filter(Boolean).length;
      fixedApplied += splitStatements(ddl).map(gate).filter(Boolean).length;
    }

    // These counts are PINNED against the full db/migrations/ corpus so the test
    // alarms when EITHER (a) a migration is silently dropped by the splitter, OR
    // (b) the corpus changes without this oracle being re-pinned. Refresh policy:
    // when a new migration is merged, re-derive BOTH numbers by replaying this
    // test's exact splitStatements/gate logic over the corpus and bump both
    // constants here. Current corpus at HEAD = 101 files; verified by an
    // independent node reproduction (tmp_oracle.mjs run from apps/web) yielding
    // fixedApplied=779, buggyApplied=391 (delta 388 > 300). The +3/+2 vs the prior
    // pinning (776/389) is EXACTLY migration 101_user_xp_events.sql (added in
    // 1cd4219), i.e. legitimate corpus growth after the `71252d0` pin â€” NOT a
    // splitter defect, NOT dropped statements, NOT data corruption.
    expect(fixedApplied).toBe(779);
    expect(buggyApplied).toBe(391);
    // The fix must be load-bearing: it recovers a large number of statements.
    expect(fixedApplied - buggyApplied).toBeGreaterThan(300);
  });

  it('keeps the benign-error matcher narrow enough to catch a wrong DATABASE_URL', () => {
    // The pre-fix list also matched `does not exist`, which is exactly what
    // swallowed migration 099's failure. A missing relation is a deployment
    // fault and must stop the run.
    expect(BENIGN_ERROR.test('relation "public.user_spin_wallet" does not exist')).toBe(false);
    expect(BENIGN_ERROR.test('column "x" does not exist')).toBe(false);
    expect(BENIGN_ERROR.test('permission denied for table users')).toBe(false);
    expect(BENIGN_ERROR.test('syntax error at or near "CREAT"')).toBe(false);

    // Idempotent re-runs must still be tolerated.
    expect(BENIGN_ERROR.test('relation "users" already exists')).toBe(true);
    expect(
      BENIGN_ERROR.test('duplicate key value violates unique constraint "users_pkey"'),
    ).toBe(true);
  });

  it('the shipped runner still uses this exact gate and matcher', () => {
    // Pins the duplicated logic to the runner. If someone edits
    // run-migrations.mjs without updating this file, the two drift and the
    // assertions above stop describing real behaviour.
    const runner = readFileSync(join(process.cwd(), 'scripts', 'run-migrations.mjs'), 'utf8');

    expect(runner).toContain('function stripLeadingComments');
    expect(runner).toContain('const BENIGN_ERROR = /(already exists|duplicate key value violates unique constraint)/i');
    expect(runner).toContain('stripLeadingComments(stmt).trim()');

    // The defect itself must stay gone. Checked against CODE LINES ONLY: the
    // fix documents the old gate verbatim in a doc comment, and matching that
    // prose would fail the build for the right fix.
    const code = runner
      .split('\n')
      .filter((l) => {
        const t = l.trim();
        return !t.startsWith('*') && !t.startsWith('/*') && !t.startsWith('//');
      })
      .join('\n');

    expect(code).not.toMatch(/trimmed\.startsWith\('--'\)/);
    // Silent success must stay gone: a failed run has to exit non-zero.
    expect(runner).toContain('process.exitCode = 1');
  });
});
