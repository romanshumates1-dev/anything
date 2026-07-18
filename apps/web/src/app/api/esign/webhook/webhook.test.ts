/**
 * Phase P1 — E-Sign webhook tests.
 *
 * Tests the full webhook lifecycle: valid events, tampered signatures,
 * idempotent replay, invalid transitions, and missing fields.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

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

function createMockRequest(body: any, signature = 'any', provider = 'mock'): Request {
  return new Request('http://localhost:4000/api/esign/webhook', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-esign-signature': signature,
      'x-esign-provider': provider,
    },
    body: JSON.stringify(body),
  });
}

describe('E-Sign Webhook', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('accepts a valid signed event and updates contract status', async () => {
    // Mock: contract exists with esign_status = 'sent'
    (sql as any).mockImplementation(async (strings: any, ...values: any[]) => {
      const query = strings.join('?');
      if (query.includes('SELECT 1 FROM esign_events')) {
        return []; // No existing event
      }
      if (query.includes('SELECT esign_status FROM contracts')) {
        return [{ esign_status: 'sent' }];
      }
      if (query.includes('INSERT INTO esign_events')) {
        return [];
      }
      if (query.includes('UPDATE contracts')) {
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
    expect(logEvent).toHaveBeenCalledWith('contract_signed_domain_event', 'contract', 'contract-1', expect.any(Object));
  });

  it('rejects tampered signature for documenso provider', async () => {
    const response = await POST(createMockRequest(
      { event_type: 'signed', envelope_id: 'env-1', contract_id: 'c-1', event_id: 'evt-1' },
      'invalid',
      'documenso'
    ));

    expect(response.status).toBe(403);
    const data = await response.json();
    expect(data.error).toBe('Invalid signature');
  });

  it('rejects tampered signature for docusign provider', async () => {
    const response = await POST(createMockRequest(
      { event_type: 'signed', envelope_id: 'env-1', contract_id: 'c-1', event_id: 'evt-1' },
      'invalid',
      'docusign'
    ));

    expect(response.status).toBe(403);
    const data = await response.json();
    expect(data.error).toBe('Invalid signature');
  });

  it('returns 200 idempotent for duplicate webhook events', async () => {
    // Mock: event already exists
    (sql as any).mockImplementation(async (strings: any, ...values: any[]) => {
      const query = strings.join('?');
      if (query.includes('SELECT 1 FROM esign_events')) {
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
      const query = strings.join('?');
      if (query.includes('SELECT 1 FROM esign_events')) {
        return [];
      }
      if (query.includes('SELECT esign_status FROM contracts')) {
        return [{ esign_status: 'signed' }];
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
      const query = strings.join('?');
      if (query.includes('SELECT 1 FROM esign_events')) {
        return [];
      }
      if (query.includes('SELECT esign_status FROM contracts')) {
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