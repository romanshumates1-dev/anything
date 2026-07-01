import sql from '@/app/api/utils/sql';

/**
 * Per-contact advisory lock using PostgreSQL advisory locks.
 * Wraps any state-mutating operation to prevent concurrent double-processing
 * (e.g., duplicate Twilio webhook delivery race condition).
 */
export async function withContactLock<T>(contactId: string, fn: () => Promise<T>): Promise<T> {
  // Use pg_advisory_xact_lock for transaction-scoped blocking lock
  // Key = hashed contact ID (positive bigint)
  const key = hashContactId(contactId);

  // Try to acquire lock (blocks until available, then releases at transaction end)
  await sql`SELECT pg_advisory_xact_lock(${key})`;

  try {
    return await fn();
  } finally {
    // Lock auto-releases at end of transaction
  }
}

/** Convert a string ID to a positive bigint suitable for advisory locks. */
function hashContactId(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = ((hash << 5) - hash + id.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % 2147483647; // fit in signed 32-bit positive range
}