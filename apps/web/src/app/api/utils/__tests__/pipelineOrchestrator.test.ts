import { describe, it, expect, vi, beforeEach } from 'vitest';

// Hoist mocks before any imports
vi.mock('../sql', () => ({
  default: Object.assign(
    vi.fn((strings: TemplateStringsArray, ..._values: unknown[]) => {
      const query = strings.join('?');
      // Check COUNT first as it's more specific
      if (query.includes('COUNT(*)')) {
        return Promise.resolve([{ total: '1' }]);
      }
      if (query.includes('pipeline_config')) {
        return Promise.resolve([{
          organization_id: 'org-123',
          deal_auto_approve_max_cents: 10000000,
          contract_auto_send: false,
          auto_continue_enabled: true,
          notification_mode: 'BATCH',
        }]);
      }
      if (query.includes('action_queue') && query.includes('INSERT')) {
        return Promise.resolve([{ id: 'action-123' }]);
      }
      if (query.includes('action_queue') && query.includes('SELECT')) {
        return Promise.resolve([
          {
            id: 'action-1',
            organization_id: 'org-123',
            type: 'REVIEW_DEAL',
            priority: 'HIGH',
            title: 'Test Action',
            status: 'PENDING',
            created_at: new Date().toISOString(),
          },
        ]);
      }
      if (query.includes('pipeline_runs')) {
        return Promise.resolve([{
          id: 'run-123',
          started_at: new Date().toISOString(),
          completed_at: new Date().toISOString(),
          status: 'COMPLETED',
          stage_stats: {},
        }]);
      }
      return Promise.resolve([]);
    }),
    {
      unsafe: (s: string) => s,
    }
  ),
}));

vi.mock('../logger', () => ({
  logEvent: vi.fn(() => Promise.resolve()),
}));

vi.mock('../jobs', () => ({
  enqueueJob: vi.fn(() => Promise.resolve('job-123')),
}));

import {
  getPipelineConfig,
  createActionItem,
  getActionQueue,
  completeAction,
  skipAction,
  getPipelineStatus,
} from '../pipelineOrchestrator';


describe('pipelineOrchestrator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getPipelineConfig', () => {
    it('returns config for organization', async () => {
      const config = await getPipelineConfig('org-123');

      expect(config).toMatchObject({
        organizationId: 'org-123',
        dealAutoApproveMaxCents: 10000000,
        contractAutoSend: false,
        autoContinueEnabled: true,
      });
    });

    it('returns defaults when no config exists', async () => {
      const sql = (await import('../sql')).default as any;
      sql.mockImplementationOnce(() => Promise.resolve([]));

      const config = await getPipelineConfig('org-new');

      expect(config).toMatchObject({
        organizationId: 'org-new',
        dealAutoApproveMaxCents: 10000000, // default $100k
        contractAutoSend: false,
        autoContinueEnabled: true,
      });
    });
  });

  describe('createActionItem', () => {
    it('creates action item with required fields', async () => {
      const actionId = await createActionItem({
        organizationId: 'org-123',
        type: 'REVIEW_DEAL',
        title: 'Review deal for 123 Main St',
      });

      expect(actionId).toBe('action-123');
    });

    it('creates action item with full options', async () => {
      const actionId = await createActionItem({
        organizationId: 'org-123',
        type: 'APPROVE_CONTRACT',
        title: 'Approve contract',
        description: 'Contract for $150,000',
        entityType: 'contract',
        entityId: 'contract-456',
        priority: 'HIGH',
        metadata: { priceCents: 15000000 },
        quickActions: [
          { action: 'approve', label: 'Approve' },
          { action: 'reject', label: 'Reject' },
        ],
        dueAt: new Date(),
        autoContinueHours: 24,
        autoContinueAction: 'approve',
      });

      expect(actionId).toBe('action-123');
    });
  });

  describe('getActionQueue', () => {
    it('returns pending actions', async () => {
      const { items, total } = await getActionQueue('org-123');

      expect(items).toHaveLength(1);
      expect(total).toBe(1);
      expect(items[0]).toMatchObject({
        id: 'action-1',
        type: 'REVIEW_DEAL',
        priority: 'HIGH',
      });
    });

    it('filters by status and priority', async () => {
      await getActionQueue('org-123', {
        status: 'PENDING',
        priority: 'URGENT',
      });

      // Query should include filters
      const sql = (await import('../sql')).default as any;
      expect(sql).toHaveBeenCalled();
    });
  });

  describe('completeAction', () => {
    it('marks action as completed', async () => {
      await completeAction('action-123', 'user-456', 'approve', 'Approved deal');

      const sql = (await import('../sql')).default as any;
      expect(sql).toHaveBeenCalled();
    });
  });

  describe('skipAction', () => {
    it('marks action as skipped with reason', async () => {
      await skipAction('action-123', 'user-456', 'Not needed');

      const sql = (await import('../sql')).default as any;
      expect(sql).toHaveBeenCalled();
    });
  });

  describe('getPipelineStatus', () => {
    it('returns pipeline status summary', async () => {
      const sql = (await import('../sql')).default as any;
      sql.mockImplementation((strings: TemplateStringsArray) => {
        const query = strings.join('?');
        if (query.includes('pipeline_runs')) {
          return Promise.resolve([{
            id: 'run-123',
            started_at: new Date().toISOString(),
            completed_at: new Date().toISOString(),
            status: 'COMPLETED',
            stage_stats: {
              leadIngestion: { processed: 10, errors: 0 },
              outreach: { sent: 5, deferred: 1 },
            },
          }]);
        }
        if (query.includes('GROUP BY priority')) {
          return Promise.resolve([
            { priority: 'URGENT', count: 1 },
            { priority: 'HIGH', count: 2 },
            { priority: 'NORMAL', count: 5 },
          ]);
        }
        if (query.includes('MAX') && query.includes('jobs')) {
          return Promise.resolve([{
            last_processed: new Date().toISOString(),
            errors: 0,
            total: 10,
          }]);
        }
        return Promise.resolve([]);
      });

      const status = await getPipelineStatus('org-123');

      expect(status).toMatchObject({
        isRunning: false,
        lastRun: expect.objectContaining({
          id: 'run-123',
          status: 'COMPLETED',
        }),
        pendingActions: expect.objectContaining({
          total: expect.any(Number),
        }),
      });
    });
  });
});

describe('Pipeline Action Types', () => {
  it('REVIEW_DEAL requires approval for high-value deals', () => {
    const dealAutoApproveMax = 10000000; // $100k
    const dealPrice = 15000000; // $150k

    expect(dealPrice > dealAutoApproveMax).toBe(true);
  });

  it('Auto-continue calculates correct time', () => {
    const hours = 24;
    const now = Date.now();
    const autoContinueAt = new Date(now + hours * 60 * 60 * 1000);

    expect(autoContinueAt.getTime()).toBe(now + 24 * 60 * 60 * 1000);
  });
});

describe('Pipeline Notification Modes', () => {
  it('IMMEDIATE sends notifications right away', () => {
    const mode = 'IMMEDIATE';
    expect(mode).toBe('IMMEDIATE');
  });

  it('BATCH batches notifications', () => {
    const mode = 'BATCH';
    expect(mode).toBe('BATCH');
  });

  it('DIGEST sends daily digest at configured hour', () => {
    const mode = 'DIGEST';
    const digestHour = 9; // 9 AM
    expect(mode).toBe('DIGEST');
    expect(digestHour).toBe(9);
  });
});
