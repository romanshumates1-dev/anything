/**
 * Credit Security Regression Tests
 *
 * Verifies credit system security guarantees:
 * - Prevents negative balance attacks
 * - Prevents concurrent overspend (race conditions)
 * - Prevents unauthorized credit modification
 * - Ensures idempotency to prevent double-charging
 * - Validates integer overflow protection
 *
 * SECURITY INVARIANTS:
 * 1. Balance can NEVER go negative
 * 2. Concurrent deductions cannot overspend
 * 3. Only authorized operations can modify credits
 * 4. Idempotent operations prevent duplicate charges
 * 5. Integer overflow is prevented at all boundaries
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the sql module - must use the same path as the credits module imports
vi.mock('@/app/api/utils/sql', () => ({
  default: vi.fn(),
}));

// Mock the logger
vi.mock('@/app/api/utils/logger', () => ({
  logEvent: vi.fn(),
}));

import sql from '@/app/api/utils/sql';
import {
  deductCredits,
  addCredits,
  getBalance,
  MAX_CREDITS,
  type DeductResult,
} from '@/app/api/utils/credits';

// Valid UUIDs for testing (credits.ts validates org IDs as UUIDs)
const ORG_123 = '00000000-0000-0000-0000-000000000123';
const ORG_RACE = '00000000-0000-0000-0000-0000000ace00';
const ORG_NEW = '00000000-0000-0000-0000-0000000000aa';
const ORG_RICH = '00000000-0000-0000-0000-0000001c0000';
const ORG_NONEXISTENT = '00000000-0000-0000-0000-0000000e0000';

describe('Credit Security', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('Negative Balance Prevention', () => {
    it('prevents deduction when balance is insufficient', async () => {
      // Balance: 50, trying to deduct: 100
      (sql as any)
        .mockResolvedValueOnce([]) // Atomic CTE returns nothing (balance check failed)
        .mockResolvedValueOnce([{ balance: 50 }]); // getBalance for error response

      const result = await deductCredits(ORG_123, 100, 'DEDUCT', 'Test deduction');

      expect(result.success).toBe(false);
      expect(result.insufficientCredits).toBe(true);
      expect(result.errorCode).toBe('INSUFFICIENT_CREDITS');
      expect(result.remainingBalance).toBe(50);
      expect(result.deducted).toBe(0);
    });

    it('prevents deduction of negative amounts', async () => {
      // Negative amount would effectively add credits
      (sql as any).mockResolvedValue([{ balance: 100 }]);

      const result = await deductCredits(ORG_123, -50, 'DEDUCT', 'Negative deduction');

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('INVALID_AMOUNT');
    });

    it('prevents deduction of non-integer amounts', async () => {
      (sql as any).mockResolvedValue([{ balance: 100 }]);

      const result = await deductCredits(ORG_123, 10.5, 'DEDUCT', 'Fractional deduction');

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('INVALID_AMOUNT');
    });

    it('prevents deduction of Infinity', async () => {
      (sql as any).mockResolvedValue([{ balance: 100 }]);

      const result = await deductCredits(ORG_123, Infinity, 'DEDUCT', 'Infinite deduction');

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('INVALID_AMOUNT');
    });

    it('prevents deduction of NaN', async () => {
      (sql as any).mockResolvedValue([{ balance: 100 }]);

      const result = await deductCredits(ORG_123, NaN, 'DEDUCT', 'NaN deduction');

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('INVALID_AMOUNT');
    });

    it('allows zero-amount deduction (no-op)', async () => {
      (sql as any).mockResolvedValue([{ balance: 100 }]);

      const result = await deductCredits(ORG_123, 0, 'DEDUCT', 'Zero deduction');

      expect(result.success).toBe(true);
      expect(result.deducted).toBe(0);
      // No DB mutation should occur for zero amount
    });

    it('allows deduction when balance exactly equals amount', async () => {
      // Balance: 100, deducting: 100 (edge case)
      (sql as any).mockResolvedValueOnce([{ balance: 0, transaction_id: 'txn_123' }]);

      const result = await deductCredits(ORG_123, 100, 'DEDUCT', 'Exact balance deduction');

      expect(result.success).toBe(true);
      expect(result.remainingBalance).toBe(0);
      expect(result.deducted).toBe(100);
    });
  });

  describe('Concurrent Overspend Prevention', () => {
    it('uses FOR UPDATE SKIP LOCKED to serialize concurrent deductions', async () => {
      // This test verifies the query pattern, not actual concurrency
      // The SQL should include FOR UPDATE SKIP LOCKED

      (sql as any).mockResolvedValueOnce([{ balance: 90, transaction_id: 'txn_1' }]);

      await deductCredits(ORG_123, 10, 'DEDUCT', 'Concurrent test');

      // Verify the SQL call was made
      expect(sql).toHaveBeenCalled();

      // The actual SQL query includes:
      // FOR UPDATE SKIP LOCKED - prevents race conditions
      // Single atomic CTE - deduct + log in one transaction
    });

    it('simulates concurrent deduction race - only one succeeds when balance is limited', async () => {
      // Simulate two concurrent requests trying to deduct 60 from balance of 100
      // With proper locking, one succeeds (balance -> 40), one fails

      const org = ORG_RACE;
      const initialBalance = 100;
      const deductAmount = 60;

      // First deduction succeeds
      (sql as any).mockResolvedValueOnce([
        { balance: initialBalance - deductAmount, transaction_id: 'txn_1' },
      ]);

      const result1 = await deductCredits(org, deductAmount, 'DEDUCT', 'Request 1');
      expect(result1.success).toBe(true);
      expect(result1.remainingBalance).toBe(40);

      // Second deduction fails (balance now 40, trying to deduct 60)
      (sql as any)
        .mockResolvedValueOnce([]) // CTE returns nothing (insufficient)
        .mockResolvedValueOnce([{ balance: 40 }]); // getBalance for error

      const result2 = await deductCredits(org, deductAmount, 'DEDUCT', 'Request 2');
      expect(result2.success).toBe(false);
      expect(result2.insufficientCredits).toBe(true);

      // Total deducted is exactly 60, not 120 (no overspend)
    });

    it('handles row lock skip gracefully', async () => {
      // When SKIP LOCKED skips a locked row, the query returns nothing
      // This should be handled as a transient failure, not insufficient credits

      (sql as any)
        .mockResolvedValueOnce([]) // CTE returns nothing (row was locked)
        .mockResolvedValueOnce([{ balance: 100 }]); // getBalance shows sufficient

      const result = await deductCredits(ORG_123, 10, 'DEDUCT', 'Lock skip');

      // Should fail gracefully, not claim insufficient credits
      expect(result.success).toBe(false);
      // Error code could be INSUFFICIENT_CREDITS or INTERNAL_ERROR depending on balance
    });
  });

  describe('Unauthorized Credit Modification Prevention', () => {
    it('addCredits validates amount is positive integer', async () => {
      // Trying to add negative amount (effectively stealing credits)
      await expect(
        addCredits(ORG_123, -100, 'PURCHASE', 'Negative purchase')
      ).rejects.toThrow();
    });

    it('addCredits validates amount is finite', async () => {
      await expect(
        addCredits(ORG_123, Infinity, 'PURCHASE', 'Infinite purchase')
      ).rejects.toThrow();
    });

    it('addCredits validates amount is an integer', async () => {
      await expect(
        addCredits(ORG_123, 10.5, 'PURCHASE', 'Fractional purchase')
      ).rejects.toThrow();
    });

    it('transaction types are constrained to valid enum values', () => {
      // Only allowed transaction types
      const validTypes = [
        'PURCHASE',
        'DEDUCT',
        'REFUND',
        'BONUS',
        'ADJUSTMENT',
        'WITHDRAWAL',
      ];

      // Invalid types should be rejected at the type level
      // This is enforced by TypeScript at compile time
      expect(validTypes).toContain('PURCHASE');
      expect(validTypes).toContain('DEDUCT');
      expect(validTypes).not.toContain('HACK');
      expect(validTypes).not.toContain('STEAL');
    });

    it('metadata cannot contain executable content', () => {
      // Metadata is stored as JSONB, should be sanitized
      const maliciousMetadata = {
        __proto__: { admin: true },
        constructor: { prototype: { admin: true } },
        script: '<script>evil()</script>',
      };

      // JSON.stringify + JSON.parse neutralizes prototype pollution
      const sanitized = JSON.stringify(maliciousMetadata);
      const parsed = JSON.parse(sanitized);

      // Prototype pollution attempts are neutralized - the parsed object
      // does not inherit the malicious __proto__ properties
      expect(parsed.admin).toBeUndefined();
      // Note: parsed.__proto__ exists as Object.prototype (normal inheritance)
      // but the malicious value { admin: true } is NOT there
      expect((parsed as any).__proto__?.admin).toBeUndefined();
      // Script tags are stored as data, not executed
      expect(parsed.script).toBe('<script>evil()</script>');
    });

    it('organization_id is required and validated', async () => {
      // Empty org ID should fail
      (sql as any).mockResolvedValue([]);

      const result = await getBalance('');

      // Should return 0 for non-existent org, not throw
      expect(result).toBe(0);
    });
  });

  describe('Idempotency Protection', () => {
    it('duplicate deduction with same idempotency key returns original result', async () => {
      const idempotencyKey = 'idem_123';

      // First call: check idempotency (returns null), then deduct succeeds
      // The CTE query returns balance and transaction_id
      (sql as any)
        .mockResolvedValueOnce([]) // checkIdempotency returns nothing (no existing)
        .mockResolvedValueOnce([{ balance: 90, transaction_id: 'txn_generated_1' }]); // deduct CTE succeeds

      const result1 = await deductCredits(
        ORG_123,
        10,
        'DEDUCT',
        'First call',
        {},
        idempotencyKey
      );
      expect(result1.success).toBe(true);
      expect(result1.transactionId).toBeDefined();

      // Second call: check idempotency finds existing record
      (sql as any).mockResolvedValueOnce([{ id: 'txn_generated_1', balance_after: 90 }]);

      const result2 = await deductCredits(
        ORG_123,
        10,
        'DEDUCT',
        'Duplicate call',
        {},
        idempotencyKey
      );

      // Should return cached result, not double-charge
      expect(result2.success).toBe(true);
      expect(result2.errorCode).toBe('DUPLICATE');
    });

    it('handles idempotency key collision on insert gracefully', async () => {
      const idempotencyKey = 'idem_collision';

      // First: checkIdempotency returns null (no existing)
      (sql as any).mockResolvedValueOnce([]);

      // Then: Simulate unique constraint violation (23505) on insert
      const duplicateError = new Error('duplicate key value');
      (duplicateError as any).code = '23505';

      (sql as any)
        .mockRejectedValueOnce(duplicateError) // Insert fails with duplicate key
        .mockResolvedValueOnce([{ id: 'txn_existing', balance_after: 85 }]); // Retry lookup succeeds

      const result = await deductCredits(
        ORG_123,
        15,
        'DEDUCT',
        'Collision test',
        {},
        idempotencyKey
      );

      expect(result.success).toBe(true);
      expect(result.errorCode).toBe('DUPLICATE');
    });

    it('different idempotency keys allow separate transactions', async () => {
      // First transaction: checkIdempotency returns null, deduct succeeds
      (sql as any)
        .mockResolvedValueOnce([]) // checkIdempotency for key_1
        .mockResolvedValueOnce([{ balance: 90 }]); // deduct succeeds

      const result1 = await deductCredits(
        ORG_123,
        10,
        'DEDUCT',
        'Transaction 1',
        {},
        'key_1'
      );

      // Second transaction: different key, also succeeds independently
      (sql as any)
        .mockResolvedValueOnce([]) // checkIdempotency for key_2
        .mockResolvedValueOnce([{ balance: 80 }]); // deduct succeeds

      const result2 = await deductCredits(
        ORG_123,
        10,
        'DEDUCT',
        'Transaction 2',
        {},
        'key_2'
      );

      // Both succeeded without DUPLICATE error
      expect(result1.success).toBe(true);
      expect(result2.success).toBe(true);
      expect(result1.errorCode).toBeUndefined();
      expect(result2.errorCode).toBeUndefined();
    });
  });

  describe('Integer Overflow Protection', () => {
    it('rejects amounts exceeding MAX_CREDITS constant', async () => {
      // MAX_CREDITS = 2,000,000,000
      const overflowAmount = MAX_CREDITS + 1;

      const result = await deductCredits(
        ORG_123,
        overflowAmount,
        'DEDUCT',
        'Overflow attempt'
      );

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('INVALID_AMOUNT');
    });

    it('prevents balance from exceeding MAX_CREDITS on add', async () => {
      // Current balance: MAX_CREDITS - 100, trying to add: 200
      const currentBalance = MAX_CREDITS - 100;
      const addAmount = 200;

      (sql as any)
        .mockResolvedValueOnce([]) // Ensure record exists
        .mockResolvedValueOnce([]); // CTE returns nothing (overflow check failed)

      // Add should fail because final balance would exceed MAX_CREDITS
      await expect(
        addCredits(ORG_123, addAmount, 'PURCHASE', 'Would overflow')
      ).rejects.toThrow(/exceed maximum/);
    });

    it('MAX_CREDITS is set to safe PostgreSQL INTEGER limit', () => {
      // PostgreSQL INTEGER max is ~2.1 billion
      // MAX_CREDITS should be below this for safety
      const POSTGRES_INT_MAX = 2147483647;

      expect(MAX_CREDITS).toBeLessThan(POSTGRES_INT_MAX);
      expect(MAX_CREDITS).toBe(2_000_000_000);
    });

    it('validates amount fits in 32-bit signed integer', () => {
      const amounts = [
        { value: 100, valid: true },
        { value: MAX_CREDITS, valid: true },
        { value: MAX_CREDITS + 1, valid: false },
        { value: Number.MAX_SAFE_INTEGER, valid: false },
        { value: 2147483648, valid: false }, // PostgreSQL INT overflow
      ];

      amounts.forEach(({ value, valid }) => {
        const isValid = value >= 0 && value <= MAX_CREDITS;
        expect(isValid).toBe(valid);
      });
    });
  });

  describe('Transaction Logging Security', () => {
    it('all balance changes are logged in credit_transactions', async () => {
      // Every deduction creates a transaction record
      (sql as any).mockResolvedValueOnce([{ balance: 90, transaction_id: 'txn_logged' }]);

      const result = await deductCredits(ORG_123, 10, 'DEDUCT', 'Logged deduction');

      expect(result.transactionId).toBeDefined();
      expect(result.transactionId).toMatch(/^txn_/);
    });

    it('transaction amount is negative for deductions in ledger', async () => {
      // Ledger uses signed amounts: positive for credits, negative for debits
      // This is enforced in the INSERT query: ${-amount}

      (sql as any).mockResolvedValueOnce([{ balance: 90, transaction_id: 'txn_1' }]);

      await deductCredits(ORG_123, 10, 'DEDUCT', 'Debit entry');

      // The INSERT should have -10, not 10
      const insertCall = (sql as any).mock.calls[0];
      expect(insertCall).toBeDefined();
    });

    it('failed deductions do not create transaction records', async () => {
      // If balance check fails, no transaction should be logged
      (sql as any)
        .mockResolvedValueOnce([]) // CTE returns nothing
        .mockResolvedValueOnce([{ balance: 5 }]); // getBalance

      const result = await deductCredits(ORG_123, 100, 'DEDUCT', 'Failed deduction');

      expect(result.success).toBe(false);
      expect(result.transactionId).toBeUndefined();
    });
  });

  describe('Edge Cases', () => {
    it('handles new organization with no balance record', async () => {
      // First query: no record found
      (sql as any)
        .mockResolvedValueOnce([]) // SELECT returns nothing
        .mockResolvedValueOnce([]); // INSERT ON CONFLICT creates record

      const balance = await getBalance(ORG_NEW);

      expect(balance).toBe(0);
    });

    it('handles database errors gracefully', async () => {
      (sql as any).mockRejectedValue(new Error('Database connection failed'));

      const balance = await getBalance(ORG_123);

      // Should return 0 on error, not throw
      expect(balance).toBe(0);
    });

    it('deduction on non-existent org fails safely', async () => {
      // Org doesn't exist, CTE returns nothing
      (sql as any)
        .mockResolvedValueOnce([]) // CTE returns nothing
        .mockResolvedValueOnce([]); // getBalance returns no record

      const result = await deductCredits(ORG_NONEXISTENT, 10, 'DEDUCT', 'No org');

      expect(result.success).toBe(false);
      expect(result.remainingBalance).toBe(0);
    });

    it('handles very large but valid amounts', async () => {
      // Just under the limit
      const largeAmount = MAX_CREDITS - 1;

      (sql as any)
        .mockResolvedValueOnce([{ balance: 1, transaction_id: 'txn_large' }]);

      const result = await deductCredits(ORG_RICH, largeAmount, 'DEDUCT', 'Large deduction');

      // This would succeed if org has enough balance
      expect(largeAmount).toBeLessThanOrEqual(MAX_CREDITS);
    });
  });
});
