/**
 * Phase P1 — E-Sign webhook tests.
 *
 * Tests the full webhook lifecycle: valid events, tampered signatures,
 * idempotent replay, invalid transitions, and missing fields.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock sql and logger
vi.mock('@/app/api/utils/sql', () => ({
  default: vi.fn(),
}));

vi.mock('@/app/api/utils/logger', () => ({
  logEvent: vi.fn(),
}));

import sql from '@/app/api/utils/sql';
import { logEvent } from '@/app/api/utils/logger';

// We'll test the webhook handler by importing it
import { POST } from './route';
import { resetStripeProvider } from '@/app/api/services/stripeProvider';
import { resetEsignProvider } from '@/app/api/services/esignProvider';

function createMockRequest(body: any, signature = 'any'): Request {
  return new Request('http://localhost:4000/api/esign/webhook', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-esign-signature': signature,
    },
    body: JSON.stringify(body),
  });
}

const ORIGINAL_ESIGN_PROVIDER = process.env.ESIGN_PROVIDER;

describe('E-Sign Webhook', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStripeProvider();
    resetEsignProvider();
  });

  afterEach(() => {
    // Phase 5 fix (bug #34): the provider is now resolved from server config
    // (ESIGN_PROVIDER), never a client-supplied x-esign-provider header — a
    // caller could previously force the accept-all mock verifier regardless
    // of the real configured provider. Restore the ambient env after tests
    // that set it.
    if (ORIGINAL_ESIGN_PROVIDER === undefined) delete process.env.ESIGN_PROVIDER;
    else process.env.ESIGN_PROVIDER = ORIGINAL_ESIGN_PROVIDER;
    resetEsignProvider();
  });

  it('accepts a valid signed event and updates contract status', async () => {
    // Mock: contract exists with esign_status = 'sent' and fee_collection = 'at_closing'
    (sql as any).mockImplementation(async (strings: any, ...values: any[]) => {
      const query = strings.join('?').toLowerCase();
      if (query.includes('select 1 from esign_events')) {
        return []; // No existing event
      }
      // Fixed: match the actual query SELECT esign_status, organization_id FROM contracts
      if (query.includes('select esign_status, organization_id from contracts')) {
        return [{ esign_status: 'sent', organization_id: 'org-1', fee_collection: 'at_closing', fee_config: {} }];
      }
      if (query.includes('insert into esign_events')) {
        return [];
      }
      if (query.includes('update contracts')) {
        return [];
      }
      if (query.includes('insert into payments_ledger')) {
        return [];
      }
      return [];
    });

    const response = await POST(createMockRequest({
      event_type: 'signed',
      envelope_id: 'env-123',
      contract_id: 'contract-1',
      event_id: 'evt-1',
      signed_at: '2026-07-18T12:00:00Z',
    }));

    const data = await response.json();
    expect(response.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.eventId).toBeDefined();
    expect(logEvent).toHaveBeenCalledWith('esign_signed', 'contract', 'contract-1', expect.any(Object));
  });

  it('rejects tampered signature for documenso provider (server-configured, not client-selected)', async () => {
    process.env.ESIGN_PROVIDER = 'documenso';
    resetEsignProvider();
    const response = await POST(createMockRequest(
      { event_type: 'signed', envelope_id: 'env-1', contract_id: 'c-1', event_id: 'evt-1' },
      'invalid'
    ));

    expect(response.status).toBe(403);
    const data = await response.json();
    expect(data.error).toBe('Invalid signature');
  });

  it('rejects tampered signature for docusign provider (server-configured, not client-selected)', async () => {
    process.env.ESIGN_PROVIDER = 'docusign';
    resetEsignProvider();
    const response = await POST(createMockRequest(
      { event_type: 'signed', envelope_id: 'env-1', contract_id: 'c-1', event_id: 'evt-1' },
      'invalid'
    ));

    expect(response.status).toBe(403);
    const data = await response.json();
    expect(data.error).toBe('Invalid signature');
  });

  it('a client-supplied x-esign-provider header can no longer select the verifier (bug #34)', async () => {
    // Server config says documenso (real verification); attacker tries to
    // force mock (accept-all) via the header. Must still 403.
    process.env.ESIGN_PROVIDER = 'documenso';
    resetEsignProvider();
    const req = new Request('http://localhost:4000/api/esign/webhook', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-esign-signature': 'anything',
        'x-esign-provider': 'mock', // attacker-controlled, must be ignored
      },
      body: JSON.stringify({ event_type: 'signed', envelope_id: 'env-1', contract_id: 'c-1', event_id: 'evt-1' }),
    });
    const response = await POST(req);
    expect(response.status).toBe(403);
  });

  it('returns 200 idempotent for duplicate webhook events', async () => {
    // Mock: event already exists
    (sql as any).mockImplementation(async (strings: any, ...values: any[]) => {
      const query = strings.join('?').toLowerCase();
      if (query.includes('select 1 from esign_events')) {
        return [{ exists: true }]; // Already processed
      }
      return [];
    });

    const response = await POST(createMockRequest({
      event_type: 'signed',
      envelope_id: 'env-123',
      contract_id: 'contract-1',
      event_id: 'evt-1',
    }));

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.idempotent).toBe(true);
  });

  it('rejects invalid event_type', async () => {
    const response = await POST(createMockRequest({
      event_type: 'invalid_type',
      envelope_id: 'env-1',
      contract_id: 'c-1',
      event_id: 'evt-1',
    }));

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toContain('Invalid event_type');
  });

  it('rejects missing required fields', async () => {
    const response = await POST(createMockRequest({
      event_type: 'signed',
      // Missing envelope_id, contract_id, event_id
    }));

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toContain('Missing required fields');
  });

  it('rejects invalid status transition (signed → sent)', async () => {
    (sql as any).mockImplementation(async (strings: any, ...values: any[]) => {
      const query = strings.join('?').toLowerCase();
      if (query.includes('select 1 from esign_events')) {
        return [];
      }
      // Fixed: match the actual query
      if (query.includes('select esign_status, organization_id from contracts')) {
        return [{ esign_status: 'signed', organization_id: 'org-1' }];
      }
      return [];
    });

    const response = await POST(createMockRequest({
      event_type: 'sent',
      envelope_id: 'env-1',
      contract_id: 'c-1',
      event_id: 'evt-1',
    }));

    expect(response.status).toBe(409);
    const data = await response.json();
    expect(data.error).toContain('Invalid status transition');
  });

  it('returns 404 for non-existent contract', async () => {
    (sql as any).mockImplementation(async (strings: any, ...values: any[]) => {
      const query = strings.join('?').toLowerCase();
      if (query.includes('select 1 from esign_events')) {
        return [];
      }
      // Fixed: match the actual query
      if (query.includes('select esign_status, organization_id from contracts')) {
        return []; // Contract not found
      }
      return [];
    });

    const response = await POST(createMockRequest({
      event_type: 'signed',
      envelope_id: 'env-1',
      contract_id: 'nonexistent',
      event_id: 'evt-1',
    }));

    expect(response.status).toBe(404);
    const data = await response.json();
    expect(data.error).toBe('Contract not found');
  });

  it('rejects invalid JSON body', async () => {
    const response = await POST(new Request('http://localhost:4000/api/esign/webhook', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-esign-signature': 'any',
        'x-esign-provider': 'mock',
      },
      body: 'not-json',
    }));

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toBe('Invalid JSON body');
  });
});