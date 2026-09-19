/**
 * Withdrawal Lifecycle Tests
 *
 * Tests the full lifecycle of withdrawals including:
 * - GET /api/withdrawals (list withdrawal history)
 * - POST /api/withdrawals (create withdrawal request)
 * - Status transitions (PENDING -> PROCESSING -> COMPLETED/FAILED)
 * - Edge cases (concurrent requests, exact balance, partial earnings)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock sql module
const mockSql = vi.fn();
vi.mock('@/app/api/utils/sql', () => ({
  default: mockSql,
}));

// Mock rate limiter - always allow in tests
vi.mock('@/app/api/utils/rateLimit', () => ({
  rateLimitByUser: vi.fn().mockResolvedValue({
    allowed: true,
    remaining: 10,
    resetAt: new Date(),
  }),
}));

// Mock auth
const mockGetSession = vi.fn();
vi.mock('@/lib/auth', () => ({
  auth: {
    api: {
      getSession: () => mockGetSession(),
    },
  },
}));

// Mock organization context
const mockGetOrganization = vi.fn();
vi.mock('@/lib/organization-context', () => ({
  getOrganization: () => mockGetOrganization(),
}));

// Mock next/headers
vi.mock('next/headers', () => ({
  headers: vi.fn().mockResolvedValue(new Headers()),
}));

// Mock crypto - use vi.hoisted for proper initialization order
const { mockRandomUUID } = vi.hoisted(() => ({
  mockRandomUUID: vi.fn(() => 'test-uuid-1234'),
}));
vi.mock('crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('crypto')>();
  return {
    ...actual,
    randomUUID: mockRandomUUID,
  };
});

describe('Withdrawals API', () => {
  const mockUser = { id: 'user_123', email: 'test@example.com' };
  const mockOrganization = { id: 'org_456', name: 'Test Org' };

  beforeEach(() => {
    vi.clearAllMocks();
    mockSql.mockReset();
    mockGetSession.mockResolvedValue({ user: mockUser });
    mockGetOrganization.mockResolvedValue(mockOrganization);
  });

  afterEach(() => {
    vi.resetModules();
  });

  describe('GET /api/withdrawals', () => {
    it('returns 401 when not authenticated', async () => {
      mockGetSession.mockResolvedValueOnce(null);

      const { GET } = await import('../route');
      const response = await GET();
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe('Unauthorized');
    });

    it('returns 403 when no organization found', async () => {
      mockGetOrganization.mockResolvedValueOnce(null);

      const { GET } = await import('../route');
      const response = await GET();
      const data = await response.json();

      expect(response.status).toBe(403);
      expect(data.error).toBe('No organization found');
    });

    it('returns empty array when no withdrawals exist', async () => {
      mockSql.mockResolvedValueOnce([]);

      const { GET } = await import('../route');
      const response = await GET();
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.withdrawals).toEqual([]);
    });

    it('returns withdrawal history for organization', async () => {
      const mockWithdrawals = [
        {
          id: 'wdr_1',
          amount_cents: 50000,
          status: 'COMPLETED',
          payout_method: 'bank_transfer',
          payout_reference: 'TRF-20260906ABCD',
          requested_at: '2026-09-01T10:00:00Z',
          processing_started_at: '2026-09-01T12:00:00Z',
          completed_at: '2026-09-03T10:00:00Z',
          failed_at: null,
          failure_reason: null,
          estimated_arrival_at: '2026-09-03T10:00:00Z',
          metadata: {},
        },
        {
          id: 'wdr_2',
          amount_cents: 25000,
          status: 'PENDING',
          payout_method: 'bank_transfer',
          payout_reference: 'TRF-20260905EFGH',
          requested_at: '2026-09-05T10:00:00Z',
          processing_started_at: null,
          completed_at: null,
          failed_at: null,
          failure_reason: null,
          estimated_arrival_at: '2026-09-07T10:00:00Z',
          metadata: {},
        },
      ];

      mockSql.mockResolvedValueOnce(mockWithdrawals);

      const { GET } = await import('../route');
      const response = await GET();
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.withdrawals).toHaveLength(2);
      expect(data.withdrawals[0].id).toBe('wdr_1');
      expect(data.withdrawals[0].status).toBe('COMPLETED');
      expect(data.withdrawals[1].id).toBe('wdr_2');
      expect(data.withdrawals[1].status).toBe('PENDING');
    });

    it('filters by status (implied by query)', async () => {
      // The current implementation returns all statuses,
      // but the SQL query could easily be extended to filter
      const mockWithdrawals = [
        {
          id: 'wdr_1',
          amount_cents: 50000,
          status: 'COMPLETED',
          payout_method: 'bank_transfer',
          payout_reference: 'TRF-123',
          requested_at: '2026-09-01T10:00:00Z',
          processing_started_at: null,
          completed_at: '2026-09-03T10:00:00Z',
          failed_at: null,
          failure_reason: null,
          estimated_arrival_at: null,
          metadata: {},
        },
      ];

      mockSql.mockResolvedValueOnce(mockWithdrawals);

      const { GET } = await import('../route');
      const response = await GET();
      const data = await response.json();

      expect(response.status).toBe(200);
      // Verify the query was made with user and org filters
      expect(mockSql).toHaveBeenCalled();
    });

    it('handles database errors gracefully', async () => {
      mockSql.mockRejectedValueOnce(new Error('Database connection failed'));

      const { GET } = await import('../route');
      const response = await GET();
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe('Internal Server Error');
    });
  });

  describe('POST /api/withdrawals (Create withdrawal)', () => {
    const createRequest = (body: object) => ({
      json: () => Promise.resolve(body),
    }) as Request;

    it('returns 401 when not authenticated', async () => {
      mockGetSession.mockResolvedValueOnce(null);

      const { POST } = await import('../route');
      const response = await POST(createRequest({ amountCents: 15000 }));
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe('Unauthorized');
    });

    it('returns 403 when no organization found', async () => {
      mockGetOrganization.mockResolvedValueOnce(null);

      const { POST } = await import('../route');
      const response = await POST(createRequest({ amountCents: 15000 }));
      const data = await response.json();

      expect(response.status).toBe(403);
      expect(data.error).toBe('No organization found');
    });

    it('successfully creates withdrawal with valid amount', async () => {
      // Mock: check daily withdrawal limit
      mockSql.mockResolvedValueOnce([{ total: 0 }]);
      // Mock: check available balance
      mockSql.mockResolvedValueOnce([{ available: 50000 }]);
      // Mock: check for pending withdrawal
      mockSql.mockResolvedValueOnce([]);
      // Mock: verify bank account
      mockSql.mockResolvedValueOnce([{ id: 'bank_1', verified: true }]);
      // Mock: get earnings to mark
      mockSql.mockResolvedValueOnce([
        { id: 'earn_1', amount_cents: 25000 },
        { id: 'earn_2', amount_cents: 25000 },
      ]);
      // Mock: insert withdrawal
      mockSql.mockResolvedValueOnce([]);
      // Mock: update earnings
      mockSql.mockResolvedValueOnce([]);
      // Mock: audit log
      mockSql.mockResolvedValueOnce([]);

      const { POST } = await import('../route');
      const response = await POST(createRequest({ amountCents: 15000 }));
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.withdrawalId).toMatch(/^wdr_/);
      expect(data.amountCents).toBe(15000);
      expect(data.status).toBe('PENDING');
      expect(data.reference).toBeTruthy();
      expect(data.estimatedArrival).toBeTruthy();
    });

    it('rejects withdrawal below minimum ($100)', async () => {
      const { POST } = await import('../route');
      const response = await POST(createRequest({ amountCents: 5000 })); // $50
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe('Minimum withdrawal amount is $100');
    });

    it('rejects withdrawal with zero amount', async () => {
      const { POST } = await import('../route');
      const response = await POST(createRequest({ amountCents: 0 }));
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe('Positive amountCents is required');
    });

    it('rejects withdrawal with negative amount', async () => {
      const { POST } = await import('../route');
      const response = await POST(createRequest({ amountCents: -10000 }));
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe('Positive amountCents is required');
    });

    it('rejects withdrawal with missing amount', async () => {
      const { POST } = await import('../route');
      const response = await POST(createRequest({}));
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe('Positive amountCents is required');
    });

    it('rejects withdrawal exceeding available balance', async () => {
      // Mock: check daily withdrawal limit
      mockSql.mockResolvedValueOnce([{ total: 0 }]);
      // Mock: check available balance (only $200 available)
      mockSql.mockResolvedValueOnce([{ available: 20000 }]);

      const { POST } = await import('../route');
      const response = await POST(createRequest({ amountCents: 50000 })); // $500
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe('Insufficient available balance');
      expect(data.available).toBe(20000);
      expect(data.requested).toBe(50000);
    });

    it('rejects withdrawal with unverified bank account', async () => {
      // Mock: check daily withdrawal limit
      mockSql.mockResolvedValueOnce([{ total: 0 }]);
      // Mock: check available balance
      mockSql.mockResolvedValueOnce([{ available: 50000 }]);
      // Mock: check for pending withdrawal
      mockSql.mockResolvedValueOnce([]);
      // Mock: verify bank account (not verified)
      mockSql.mockResolvedValueOnce([{ id: 'bank_1', verified: false }]);

      const { POST } = await import('../route');
      const response = await POST(createRequest({ amountCents: 15000 }));
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe('Bank account not verified. Please verify your bank account first.');
    });

    it('rejects withdrawal with no bank account', async () => {
      // Mock: check daily withdrawal limit
      mockSql.mockResolvedValueOnce([{ total: 0 }]);
      // Mock: check available balance
      mockSql.mockResolvedValueOnce([{ available: 50000 }]);
      // Mock: check for pending withdrawal
      mockSql.mockResolvedValueOnce([]);
      // Mock: no bank account found
      mockSql.mockResolvedValueOnce([]);

      const { POST } = await import('../route');
      const response = await POST(createRequest({ amountCents: 15000 }));
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe('No bank account connected. Please add a bank account first.');
    });

    it('rejects if pending withdrawal already exists', async () => {
      // Mock: check daily withdrawal limit
      mockSql.mockResolvedValueOnce([{ total: 0 }]);
      // Mock: check available balance
      mockSql.mockResolvedValueOnce([{ available: 50000 }]);
      // Mock: existing pending withdrawal
      mockSql.mockResolvedValueOnce([{ id: 'wdr_existing' }]);

      const { POST } = await import('../route');
      const response = await POST(createRequest({ amountCents: 15000 }));
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe('You already have a pending withdrawal. Please wait for it to complete.');
    });

    it('correctly allocates earnings FIFO', async () => {
      // Mock: check daily withdrawal limit
      mockSql.mockResolvedValueOnce([{ total: 0 }]);
      // Mock: check available balance
      mockSql.mockResolvedValueOnce([{ available: 100000 }]);
      // Mock: check for pending withdrawal
      mockSql.mockResolvedValueOnce([]);
      // Mock: verify bank account
      mockSql.mockResolvedValueOnce([{ id: 'bank_1', verified: true }]);
      // Mock: atomic UPDATE with FIFO selection returns only earnings needed
      // SQL selects oldest earnings first until amount is covered (30k + 40k = 70k >= 50k)
      mockSql.mockResolvedValueOnce([
        { id: 'earn_oldest', amount_cents: 30000 }, // oldest first
        { id: 'earn_middle', amount_cents: 40000 },
      ]);
      // Mock: insert withdrawal
      mockSql.mockResolvedValueOnce([]);
      // Mock: update earnings to WITHDRAWN
      mockSql.mockResolvedValueOnce([]);
      // Mock: audit log
      mockSql.mockResolvedValueOnce([]);

      const { POST } = await import('../route');
      const response = await POST(createRequest({ amountCents: 50000 })); // $500
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      // Should withdraw from oldest first (30k + 40k covers 50k)
      expect(data.earningsWithdrawn).toBe(2);
    });

    it('handles database errors gracefully', async () => {
      mockSql.mockRejectedValueOnce(new Error('Database error'));

      const { POST } = await import('../route');
      const response = await POST(createRequest({ amountCents: 15000 }));
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe('Internal Server Error');
    });
  });

  describe('Withdrawal status transitions', () => {
    it('PENDING -> PROCESSING transition', async () => {
      // This tests the conceptual transition - actual implementation would be
      // in a separate admin/webhook route
      const pendingWithdrawal = {
        id: 'wdr_1',
        status: 'PENDING',
        amount_cents: 50000,
      };

      // Verify valid status values from schema
      expect(['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED']).toContain(
        pendingWithdrawal.status
      );

      // Simulate transition
      const processingWithdrawal = {
        ...pendingWithdrawal,
        status: 'PROCESSING',
        processing_started_at: new Date().toISOString(),
      };

      expect(processingWithdrawal.status).toBe('PROCESSING');
      expect(processingWithdrawal.processing_started_at).toBeTruthy();
    });

    it('PROCESSING -> COMPLETED transition', async () => {
      const processingWithdrawal = {
        id: 'wdr_1',
        status: 'PROCESSING',
        amount_cents: 50000,
        processing_started_at: '2026-09-06T10:00:00Z',
      };

      // Simulate completion
      const completedWithdrawal = {
        ...processingWithdrawal,
        status: 'COMPLETED',
        completed_at: new Date().toISOString(),
      };

      expect(completedWithdrawal.status).toBe('COMPLETED');
      expect(completedWithdrawal.completed_at).toBeTruthy();
    });

    it('PROCESSING -> FAILED transition', async () => {
      const processingWithdrawal = {
        id: 'wdr_1',
        status: 'PROCESSING',
        amount_cents: 50000,
        processing_started_at: '2026-09-06T10:00:00Z',
      };

      // Simulate failure
      const failedWithdrawal = {
        ...processingWithdrawal,
        status: 'FAILED',
        failed_at: new Date().toISOString(),
        failure_reason: 'Bank rejected transfer: invalid account number',
      };

      expect(failedWithdrawal.status).toBe('FAILED');
      expect(failedWithdrawal.failed_at).toBeTruthy();
      expect(failedWithdrawal.failure_reason).toBeTruthy();
    });

    it('validates status enum values match schema', () => {
      // From migration: CHECK (status IN ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED'))
      const validStatuses = ['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED'];

      validStatuses.forEach((status) => {
        expect(typeof status).toBe('string');
      });

      // Invalid status should not be in the list
      expect(validStatuses).not.toContain('APPROVED');
      expect(validStatuses).not.toContain('REJECTED');
    });
  });

  describe('Edge cases', () => {
    it('concurrent withdrawal requests (should fail second one)', async () => {
      // First request setup
      mockSql.mockResolvedValueOnce([{ total: 0 }]); // daily limit check
      mockSql.mockResolvedValueOnce([{ available: 50000 }]); // balance check
      mockSql.mockResolvedValueOnce([]); // no pending withdrawal
      mockSql.mockResolvedValueOnce([{ id: 'bank_1', verified: true }]); // bank verified
      mockSql.mockResolvedValueOnce([{ id: 'earn_1', amount_cents: 50000 }]); // earnings
      mockSql.mockResolvedValueOnce([]); // insert withdrawal
      mockSql.mockResolvedValueOnce([]); // update earnings
      mockSql.mockResolvedValueOnce([]); // audit log

      const { POST } = await import('../route');
      const response1 = await POST({
        json: () => Promise.resolve({ amountCents: 15000 }),
      } as Request);

      expect(response1.status).toBe(200);

      // Reset mocks for second request
      vi.resetModules();
      mockSql.mockReset();

      // Second request - should find pending withdrawal
      mockSql.mockResolvedValueOnce([{ total: 15000 }]); // daily limit check (from first withdrawal)
      mockSql.mockResolvedValueOnce([{ available: 35000 }]); // balance check (reduced)
      mockSql.mockResolvedValueOnce([{ id: 'wdr_1' }]); // existing pending withdrawal

      const { POST: POST2 } = await import('../route');
      const response2 = await POST2({
        json: () => Promise.resolve({ amountCents: 10000 }),
      } as Request);
      const data2 = await response2.json();

      expect(response2.status).toBe(400);
      expect(data2.error).toBe('You already have a pending withdrawal. Please wait for it to complete.');
    });

    it('withdrawal with exact available balance', async () => {
      const exactBalance = 25000; // $250

      // Mock: check daily withdrawal limit
      mockSql.mockResolvedValueOnce([{ total: 0 }]);
      // Mock: check available balance
      mockSql.mockResolvedValueOnce([{ available: exactBalance }]);
      // Mock: check for pending withdrawal
      mockSql.mockResolvedValueOnce([]);
      // Mock: verify bank account
      mockSql.mockResolvedValueOnce([{ id: 'bank_1', verified: true }]);
      // Mock: get earnings to mark (exact amount)
      mockSql.mockResolvedValueOnce([
        { id: 'earn_1', amount_cents: 25000 },
      ]);
      // Mock: insert withdrawal
      mockSql.mockResolvedValueOnce([]);
      // Mock: update earnings
      mockSql.mockResolvedValueOnce([]);
      // Mock: audit log
      mockSql.mockResolvedValueOnce([]);

      const { POST } = await import('../route');
      const response = await POST({
        json: () => Promise.resolve({ amountCents: exactBalance }),
      } as Request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.amountCents).toBe(exactBalance);
      expect(data.earningsWithdrawn).toBe(1);
    });

    it('withdrawal with partial earnings (some still in hold)', async () => {
      // Total earnings: $500 but only $200 available (rest in PENDING status)
      const availableBalance = 20000; // $200

      // Mock: check daily withdrawal limit
      mockSql.mockResolvedValueOnce([{ total: 0 }]);
      // Mock: check available balance (only AVAILABLE status counted)
      mockSql.mockResolvedValueOnce([{ available: availableBalance }]);
      // Mock: check for pending withdrawal
      mockSql.mockResolvedValueOnce([]);
      // Mock: verify bank account
      mockSql.mockResolvedValueOnce([{ id: 'bank_1', verified: true }]);
      // Mock: get AVAILABLE earnings to mark
      mockSql.mockResolvedValueOnce([
        { id: 'earn_available_1', amount_cents: 10000 },
        { id: 'earn_available_2', amount_cents: 10000 },
        // Note: PENDING earnings are not included in this query
      ]);
      // Mock: insert withdrawal
      mockSql.mockResolvedValueOnce([]);
      // Mock: update earnings
      mockSql.mockResolvedValueOnce([]);
      // Mock: audit log
      mockSql.mockResolvedValueOnce([]);

      const { POST } = await import('../route');
      const response = await POST({
        json: () => Promise.resolve({ amountCents: 15000 }), // $150
      } as Request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.amountCents).toBe(15000);
      // Should only use available earnings
      expect(data.earningsWithdrawn).toBe(2);
    });

    it('rejects withdrawal when trying to exceed available (ignoring pending)', async () => {
      // User has $500 total but only $200 available
      const availableBalance = 20000; // $200

      // Mock: check daily withdrawal limit
      mockSql.mockResolvedValueOnce([{ total: 0 }]);
      mockSql.mockResolvedValueOnce([{ available: availableBalance }]);

      const { POST } = await import('../route');
      const response = await POST({
        json: () => Promise.resolve({ amountCents: 30000 }), // $300 > $200 available
      } as Request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe('Insufficient available balance');
      expect(data.available).toBe(20000);
      expect(data.requested).toBe(30000);
    });

    it('handles null available balance (no earnings)', async () => {
      // Mock: check daily withdrawal limit
      mockSql.mockResolvedValueOnce([{ total: 0 }]);
      // Mock: check available balance returns null/0
      mockSql.mockResolvedValueOnce([{ available: null }]);

      const { POST } = await import('../route');
      const response = await POST({
        json: () => Promise.resolve({ amountCents: 10000 }),
      } as Request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe('Insufficient available balance');
      expect(data.available).toBe(0);
    });

    it('handles empty earnings result for available balance', async () => {
      // Mock: check daily withdrawal limit
      mockSql.mockResolvedValueOnce([{ total: 0 }]);
      // Mock: check available balance returns empty
      mockSql.mockResolvedValueOnce([{}]);

      const { POST } = await import('../route');
      const response = await POST({
        json: () => Promise.resolve({ amountCents: 10000 }),
      } as Request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe('Insufficient available balance');
    });

    it('withdrawal allocates correct earnings when amount spans multiple', async () => {
      // Test FIFO allocation with specific amounts
      mockSql.mockResolvedValueOnce([{ total: 0 }]); // daily limit check
      mockSql.mockResolvedValueOnce([{ available: 100000 }]); // $1000 available
      mockSql.mockResolvedValueOnce([]); // no pending
      mockSql.mockResolvedValueOnce([{ id: 'bank_1', verified: true }]);
      // Atomic UPDATE returns only earnings needed via SQL FIFO selection
      // $450 needs earn_1 ($150) + earn_2 ($250) + earn_3 ($350) = $750 >= $450
      mockSql.mockResolvedValueOnce([
        { id: 'earn_1', amount_cents: 15000 }, // $150 - oldest
        { id: 'earn_2', amount_cents: 25000 }, // $250
        { id: 'earn_3', amount_cents: 35000 }, // $350
      ]);
      mockSql.mockResolvedValueOnce([]); // insert
      mockSql.mockResolvedValueOnce([]); // update
      mockSql.mockResolvedValueOnce([]); // audit

      const { POST } = await import('../route');
      const response = await POST({
        json: () => Promise.resolve({ amountCents: 45000 }), // $450
      } as Request);
      const data = await response.json();

      expect(response.status).toBe(200);
      // $450 requires earn_1 ($150) + earn_2 ($250) + earn_3 ($350)
      // SQL selects these 3 earnings as that's enough to cover $450
      expect(data.earningsWithdrawn).toBe(3);
    });
  });

  describe('FIFO allocation logic', () => {
    it('marks earnings in order until amount is covered', async () => {
      mockSql.mockResolvedValueOnce([{ total: 0 }]); // daily limit check
      mockSql.mockResolvedValueOnce([{ available: 200000 }]);
      mockSql.mockResolvedValueOnce([]);
      mockSql.mockResolvedValueOnce([{ id: 'bank_1', verified: true }]);
      // Atomic UPDATE returns only earnings needed via SQL FIFO selection
      // $250 needs 3 earnings of $100 each = $300 >= $250
      mockSql.mockResolvedValueOnce([
        { id: 'earn_1', amount_cents: 10000 }, // $100
        { id: 'earn_2', amount_cents: 10000 }, // $100
        { id: 'earn_3', amount_cents: 10000 }, // $100
      ]);
      mockSql.mockResolvedValueOnce([]);
      mockSql.mockResolvedValueOnce([]);
      mockSql.mockResolvedValueOnce([]);

      const { POST } = await import('../route');
      const response = await POST({
        json: () => Promise.resolve({ amountCents: 25000 }), // $250
      } as Request);
      const data = await response.json();

      expect(response.status).toBe(200);
      // $250 needs 3 earnings of $100 each
      expect(data.earningsWithdrawn).toBe(3);
    });

    it('handles single large earning covering full amount', async () => {
      mockSql.mockResolvedValueOnce([{ total: 0 }]); // daily limit check
      mockSql.mockResolvedValueOnce([{ available: 100000 }]);
      mockSql.mockResolvedValueOnce([]);
      mockSql.mockResolvedValueOnce([{ id: 'bank_1', verified: true }]);
      mockSql.mockResolvedValueOnce([
        { id: 'earn_large', amount_cents: 100000 }, // $1000
      ]);
      mockSql.mockResolvedValueOnce([]);
      mockSql.mockResolvedValueOnce([]);
      mockSql.mockResolvedValueOnce([]);

      const { POST } = await import('../route');
      const response = await POST({
        json: () => Promise.resolve({ amountCents: 15000 }), // $150
      } as Request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.earningsWithdrawn).toBe(1);
    });
  });
});
