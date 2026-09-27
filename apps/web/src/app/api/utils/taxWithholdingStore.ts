/**
 * Persistence layer for seller tax withholding.
 *
 * SEPARATION OF CONCERNS
 * ----------------------
 * `taxWithholding.ts` holds the money policy and is pure (no DB, no clock, no
 * randomness) so the rules are exhaustively unit-testable. THIS module holds
 * only persistence: it does no arithmetic beyond coercion, and makes no policy
 * decisions. Swapping the store (PGlite in tests, Neon in prod) therefore cannot
 * change a cent of the computed tax.
 *
 * IDEMPOTENCY
 * -----------
 * Every ledger write goes through `recordWithholding`, which relies on the UNIQUE
 * `idempotency_key` constraint from migration 090. A retried webhook, a
 * double-clicked withdrawal, or a replayed job produces the SAME key, so the
 * second write is a no-op rather than a second debit. The function returns
 * whether the row was actually inserted so callers can tell "withheld" from
 * "already withheld" without a second query.
 */
import { randomUUID } from 'node:crypto';
import sql, { type SqlQuery } from '@/app/api/utils/sql';
import {
  buildIdempotencyKey,
  normalizeSettings,
  quarterOf,
  type LedgerEntry,
  type WithholdingKind,
  type WithholdingSettings,
} from './taxWithholding';

export interface LedgerWrite {
  userId: string;
  organizationId: string;
  kind: WithholdingKind;
  amountCents: number;
  rateBps: number;
  /** Stable scope for the idempotency key - e.g. the withdrawal id. */
  scope: string;
  earningId?: string | null;
  withdrawalId?: string | null;
  note?: string | null;
  /** Caller-supplied so tests are deterministic; defaults to now. */
  occurredAt?: Date;
}

export interface WriteResult {
  inserted: boolean;
  entry: LedgerEntry;
}

/**
 * Read the seller's withholding preference. Returns null when the seller has
 * never configured one - callers then treat withholding as disabled, which is
 * the correct default (opt-in, never opt-out).
 */
export async function getWithholdingSettings(
  userId: string,
  organizationId: string
): Promise<WithholdingSettings | null> {
  const rows = await sql`
    SELECT enabled, rate_bps, jurisdiction
    FROM tax_withholding_settings
    WHERE user_id = ${userId} AND organization_id = ${organizationId}
    LIMIT 1
  `;
  const row = rows[0];
  if (!row) return null;
  return normalizeSettings({
    enabled: row.enabled,
    rateBps: row.rate_bps,
    jurisdiction: row.jurisdiction,
  });
}

/**
 * Upsert the seller's preference. Scoped to (user, organization) so a member of
 * one org can never read or write another org's rate, and a user in several orgs
 * keeps an independent rate per org.
 */
export async function saveWithholdingSettings(
  userId: string,
  organizationId: string,
  input: { enabled: boolean; rateBps: number; jurisdiction?: string | null }
): Promise<WithholdingSettings> {
  // Normalize BEFORE persisting so an out-of-range rate can never reach the
  // table; the CHECK constraint is a backstop, not the primary defence.
  const settings = normalizeSettings(input);
  await sql`
    INSERT INTO tax_withholding_settings
      (user_id, organization_id, enabled, rate_bps, jurisdiction, updated_at)
    VALUES (
      ${userId}, ${organizationId}, ${settings.enabled}, ${settings.rateBps},
      ${settings.jurisdiction ?? null}, NOW()
    )
    ON CONFLICT (user_id, organization_id) DO UPDATE SET
      enabled = EXCLUDED.enabled,
      rate_bps = EXCLUDED.rate_bps,
      jurisdiction = EXCLUDED.jurisdiction,
      updated_at = NOW()
  `;
  return settings;
}


/** The lazy query object a tagged template returns, as the driver types it. */
type SqlTaggedQuery = SqlQuery;

export interface PreparedWithholding {
  /** Un-awaited insert, ready to be spliced into a `sql.transaction([...])` batch. */
  query: SqlTaggedQuery;
  kind: WithholdingKind;
  amountCents: number;
  rateBps: number;
  periodQualified: string;
  createdAt: string;
  idempotencyKey: string;
  /** Local id, used only when the insert returned no row (replay). */
  id: string;
}

/**
 * Build (but do NOT execute) the idempotent ledger insert.
 *
 * WHY NOT JUST `recordWithholding`
 * -------------------------------
 * On the withdrawal path the ledger row must commit in the SAME transaction as
 * the money movement. If the withholding write can commit independently, a
 * failure leaves an irreversible payout that was never withheld -- the failure
 * mode this module now refuses to allow. The withdrawal route therefore needs
 * the query itself, to batch it with the rest, rather than a pre-awaited call.
 *
 * The key comes from `buildIdempotencyKey` in the policy module so the ledger
 * key can never drift from the documented `tax:<kind>:<scope>:<amount>` shape.
 */
export interface PrepareOptions {
  /**
   * Write the row only when this withdrawal row exists.
   *
   * The withdrawal route needs the ledger row to commit in the SAME
   * transaction as the money movement, AND to be skipped entirely when that
   * movement did not happen. Without the gate, a REJECTED withdrawal (the
   * reservation did not cover the request) would still record withholding for
   * money that never left the platform, inflating the seller's withheld
   * balance and understating their net receipts in the tax report.
   *
   * The check is expressed in SQL because the driver's transaction callback
   * must be synchronous: a statement cannot be built from an earlier
   * statement's result. Inside a transaction the earlier insert is already
   * visible, so `EXISTS` sees the true mid-flight state.
   */
  gateOnWithdrawalId?: string | null;
}

export function prepareWithholdingInsert(
  write: LedgerWrite,
  options: PrepareOptions = {}
): PreparedWithholding {
  const occurredAt = write.occurredAt ?? new Date();
  const idempotencyKey = buildIdempotencyKey(write.scope, write.kind, write.amountCents);
  const periodQualified = quarterOf(occurredAt);
  const id = `txw_${randomUUID()}`;
  const gate = options.gateOnWithdrawalId;

  // Two statement shapes, deliberately. `VALUES (...)` cannot carry a WHERE, so
  // the gated form selects the literals instead. The casts are explicit because
  // Postgres cannot infer a parameter type from a bare `SELECT $1` inside an
  // INSERT ... SELECT, and would otherwise reject the batch.
  const query = gate
    ? sql`
        INSERT INTO tax_withholding_ledger
          (id, user_id, organization_id, earning_id, withdrawal_id,
           idempotency_key, kind, amount_cents, rate_bps, period_qualified, note)
        SELECT
          ${id}::text, ${write.userId}::text, ${write.organizationId}::text,
          ${write.earningId ?? null}::text, ${write.withdrawalId ?? null}::text,
          ${idempotencyKey}::text, ${write.kind}::text, ${write.amountCents}::bigint,
          ${write.rateBps}::integer, ${periodQualified}::text, ${write.note ?? null}::text
        WHERE EXISTS (SELECT 1 FROM withdrawals WHERE id = ${gate})
        ON CONFLICT (idempotency_key) DO NOTHING
        RETURNING id
      `
    : sql`
        INSERT INTO tax_withholding_ledger
          (id, user_id, organization_id, earning_id, withdrawal_id,
           idempotency_key, kind, amount_cents, rate_bps, period_qualified, note)
        VALUES (
          ${id}, ${write.userId}, ${write.organizationId}, ${write.earningId ?? null},
          ${write.withdrawalId ?? null}, ${idempotencyKey}, ${write.kind}, ${write.amountCents},
          ${write.rateBps}, ${periodQualified}, ${write.note ?? null}
        )
        ON CONFLICT (idempotency_key) DO NOTHING
        RETURNING id
      `;

  return {
    query,
    kind: write.kind,
    amountCents: write.amountCents,
    rateBps: write.rateBps,
    periodQualified,
    createdAt: occurredAt.toISOString(),
    idempotencyKey,
    id,
  };
}

/**
 * Interpret the rows a prepared insert returned. `ON CONFLICT DO NOTHING`
 * yields zero rows for a replay, which is how a caller can tell "withheld" from
 * "already withheld" without a second query.
 */
export function readWithholdingResult(
  prepared: PreparedWithholding,
  rows: ReadonlyArray<{ id?: string }>
): WriteResult {
  return {
    inserted: rows.length > 0,
    entry: {
      id: rows[0]?.id ?? prepared.id,
      kind: prepared.kind,
      amountCents: prepared.amountCents,
      rateBps: prepared.rateBps,
      periodQualified: prepared.periodQualified,
      createdAt: prepared.createdAt,
      idempotencyKey: prepared.idempotencyKey,
    },
  };
}

/**
 * Append one ledger row, idempotently, as its own statement.
 *
 * `ON CONFLICT (idempotency_key) DO NOTHING` is the whole replay story: the
 * unique index rejects the duplicate, and `RETURNING` yields zero rows, so we
 * can report `inserted: false` without a follow-up SELECT. The returned entry
 * describes the row that exists either way, so callers can build a consistent
 * response for a first write and a replay alike.
 *
 * Callers that need atomicity with other writes must use
 * `prepareWithholdingInsert` inside a transaction instead.
 */
export async function recordWithholding(write: LedgerWrite): Promise<WriteResult> {
  const prepared = prepareWithholdingInsert(write);
  const rows = (await prepared.query) as Array<{ id?: string }>;
  return readWithholdingResult(prepared, rows);
}

/**
 * Read one seller's ledger rows within an inclusive date range, oldest first.
 * Always filtered by BOTH user_id and organization_id - the tenant predicate is
 * applied in SQL, never in JavaScript after the fetch.
 */
export async function listLedger(
  userId: string,
  organizationId: string,
  from: Date,
  to: Date
): Promise<LedgerEntry[]> {
  const rows = await sql`
    SELECT id, kind, amount_cents, rate_bps, period_qualified, created_at, idempotency_key
    FROM tax_withholding_ledger
    WHERE user_id = ${userId}
      AND organization_id = ${organizationId}
      AND created_at >= ${from}
      AND created_at <= ${to}
    ORDER BY created_at ASC, id ASC
  `;
  return rows.map((r: any) => ({
    id: r.id,
    kind: r.kind,
    amountCents: Number(r.amount_cents),
    rateBps: Number(r.rate_bps),
    periodQualified: r.period_qualified,
    createdAt:
      r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
    idempotencyKey: r.idempotency_key,
  }));
}

/**
 * Currently-held (not yet released) withholding for a seller, in cents.
 * Computed in SQL from the append-only ledger so it cannot drift from the rows.
 */
export async function getWithheldBalance(
  userId: string,
  organizationId: string
): Promise<number> {
  const rows = await sql`
    SELECT COALESCE(SUM(CASE WHEN kind = 'WITHHELD' THEN amount_cents
                             WHEN kind = 'RELEASED' THEN -amount_cents
                             ELSE 0 END), 0) AS held
    FROM tax_withholding_ledger
    WHERE user_id = ${userId} AND organization_id = ${organizationId}
  `;
  return Math.max(0, Number(rows[0]?.held ?? 0));
}
