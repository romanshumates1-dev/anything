/**
 * Durable SMS idempotency store (Gap G-3).
 *
 * The gateway keeps an in-memory Map as an L1 cache; this is the durable L2 that
 * survives restarts and is shared across instances/workers. It is injected into
 * the gateway (GatewayConfig.idempotencyStore) so tests can omit it (identical
 * legacy behaviour) and production wires the DB-backed implementation.
 *
 * Semantics match the existing model: RECORD-after-success (dedupe retries of an
 * already-succeeded send), not a distributed pre-dispatch lock. Two workers
 * racing the same uuid in the same instant can still both dispatch — the same
 * race the in-memory version had; making that impossible needs a pre-claim
 * redesign and is tracked separately. This change removes the restart/multi-
 * instance blind spot, which is the actual production gap.
 */
import sql from '@/app/api/utils/sql';
import type { DeliveryStatus } from './providers';

export interface IdempotencyRecord {
  status: DeliveryStatus;
  providerId: string;
  provider?: string;
}

export interface IdempotencyStore {
  lookup(messageUuid: string): Promise<IdempotencyRecord | null>;
  remember(messageUuid: string, record: IdempotencyRecord): Promise<void>;
}

export class DbIdempotencyStore implements IdempotencyStore {
  async lookup(messageUuid: string): Promise<IdempotencyRecord | null> {
    const rows = (await sql`
      SELECT status, provider_id, provider FROM sms_idempotency
      WHERE message_uuid = ${messageUuid} LIMIT 1
    `) as { status: string; provider_id: string | null; provider: string | null }[];
    if (rows.length === 0) return null;
    return {
      status: rows[0].status as DeliveryStatus,
      providerId: rows[0].provider_id ?? '',
      provider: rows[0].provider ?? undefined,
    };
  }

  async remember(messageUuid: string, record: IdempotencyRecord): Promise<void> {
    await sql`
      INSERT INTO sms_idempotency (message_uuid, status, provider_id, provider)
      VALUES (${messageUuid}, ${record.status}, ${record.providerId}, ${record.provider ?? null})
      ON CONFLICT (message_uuid) DO NOTHING
    `;
  }
}
