import { beforeEach, describe, expect, it, vi } from 'vitest';

// vi.mock is hoisted by vitest before module-level variables initialize.
// Use vi.hoisted() to create the mock reference during the hoist phase.
const { default: _sqlMock } = vi.hoisted(() => {
  const m = vi.fn(async () => []) as any;
  m.transaction = vi.fn(async () => []);
  return { default: m };
});
vi.mock('@/app/api/utils/sql', () => ({ default: _sqlMock }));

const { fn: getSession } = vi.hoisted(() => ({ fn: vi.fn() }));
vi.mock('@/lib/auth', () => ({
  auth: { api: { getSession: (...args: any[]) => getSession(...args) } },
}));

vi.mock('next/headers', () => ({
  headers: vi.fn(async () => new Headers()),
}));

const loggerMocks = vi.hoisted(() => ({
  logEvent: vi.fn(async () => {}),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('@/app/api/utils/logger', () => loggerMocks);

const complianceMocks = vi.hoisted(() => ({
  registerOptOut: vi.fn(async () => {}),
  checkConsent: vi.fn(async () => true),
}));
vi.mock('@/app/api/utils/compliance', () => complianceMocks);

const aiMocks = vi.hoisted(() => ({
  orchestrateAIResponse: vi.fn(async () => ({
    response_text: 'hi',
    confidence_score: 0.95,
    requires_human: false,
    suggested_action: 'reply',
    internal_reasoning: '',
  })),
  detectHighRisk: vi.fn(() => false),
}));
vi.mock('@/app/api/utils/ai-orchestrator', () => aiMocks);

const jobMocks = vi.hoisted(() => ({ enqueueJob: vi.fn(async () => 1) }));
vi.mock('@/app/api/utils/jobs', () => jobMocks);

// Import the REAL route handlers.
import * as leads from '../leads/route';
import * as message from '../conversations/message/route';
import * as optOut from '../compliance/opt-out/route';

function jsonRequest(url: string, body: unknown, method = 'POST') {
  return new Request(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  _sqlMock.mockResolvedValue([]);
});

describe('endpoint surface', () => {
  it('exposes the documented HTTP methods', () => {
    expect(typeof leads.POST).toBe('function');
    expect(typeof leads.GET).toBe('function');
    expect(typeof message.POST).toBe('function');
    expect(typeof optOut.POST).toBe('function');
  });
});

describe('POST /api/leads', () => {
  it('returns 401 when unauthenticated', async () => {
    getSession.mockResolvedValue(null);
    const res = await leads.POST(jsonRequest('http://t/api/leads', { name: 'A', type: 'seller' }));
    expect(res.status).toBe(401);
  });

  it('returns 400 when name/type missing', async () => {
    getSession.mockResolvedValue({ user: { id: 'u1' } });
    const res = await leads.POST(jsonRequest('http://t/api/leads', { name: 'A' }));
    expect(res.status).toBe(400);
  });

  it('returns 400 for an invalid lead type', async () => {
    getSession.mockResolvedValue({ user: { id: 'u1' } });
    const res = await leads.POST(
      jsonRequest('http://t/api/leads', { name: 'A', type: 'investor' })
    );
    expect(res.status).toBe(400);
  });
});

describe('POST /api/conversations/message', () => {
  it('returns 401 when unauthenticated', async () => {
    getSession.mockResolvedValue(null);
    const res = await message.POST(
      jsonRequest('http://t/api/conversations/message', { leadId: 1, message: 'hi' })
    );
    expect(res.status).toBe(401);
  });

  it('returns 400 when message is empty', async () => {
    getSession.mockResolvedValue({ user: { id: 'u1' } });
    const res = await message.POST(
      jsonRequest('http://t/api/conversations/message', { leadId: 1, message: '   ' })
    );
    expect(res.status).toBe(400);
  });
});

describe('POST /api/compliance/opt-out', () => {
  beforeEach(() => {
    process.env.SMS_INBOUND_SECRET = 'test-sms';
  });

  it('returns 401 without the sms secret', async () => {
    const res = await optOut.POST(
      jsonRequest('http://t/api/compliance/opt-out', { target: '+15551234567', channel: 'sms' })
    );
    expect(res.status).toBe(401);
  });

  it('returns 400 when target or channel missing', async () => {
    const res = await optOut.POST(
      new Request('http://t/api/compliance/opt-out', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-sms-secret': 'test-sms' },
        body: JSON.stringify({ channel: 'sms' }),
      })
    );
    expect(res.status).toBe(400);
  });

  it('records an opt-out and returns success', async () => {
    const res = await optOut.POST(
      new Request('http://t/api/compliance/opt-out', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-sms-secret': 'test-sms' },
        body: JSON.stringify({ target: '+15551234567', channel: 'sms' }),
      })
    );
    expect(res.status).toBe(200);
    expect(complianceMocks.registerOptOut).toHaveBeenCalledWith('+15551234567', 'sms', expect.any(Object));
  });
});