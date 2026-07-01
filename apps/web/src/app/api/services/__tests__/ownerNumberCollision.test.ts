import { describe, it, expect, vi, beforeEach } from 'vitest';

const { default: mockSql } = vi.hoisted(() => {
  const m = vi.fn(async () => []) as any;
  return { default: m };
});
vi.mock('@/app/api/utils/sql', () => ({ default: mockSql }));

const complianceMocks = vi.hoisted(() => ({
  registerOptOut: vi.fn(async () => {}),
  checkConsent: vi.fn(async () => true),
}));
vi.mock('@/app/api/utils/compliance', () => complianceMocks);

const { fn: isOptOutMessage } = vi.hoisted(() => ({
  fn: vi.fn(() => false),
}));
vi.mock('@/app/api/services/optOutDetection', () => ({
  isOptOutMessage,
}));

import { processInboundSms } from '../inboundSms';

describe('owner-number collision', () => {
  beforeEach(() => {
    mockSql.mockClear();
    complianceMocks.registerOptOut.mockClear();
    isOptOutMessage.mockClear();
  });

  it('returns owner_reply when phone matches known owner', async () => {
    mockSql.mockResolvedValueOnce([1]);
    const result = await processInboundSms({
      from: '+15551234567', to: '+15550000000',
      body: 'I want to sell', organizationId: 'org-1',
    });
    expect(result.action).toBe('owner_reply');
    expect(result.body).toBe('I want to sell');
  });

  it('returns contact_reply when phone is in campaign_contacts not owner', async () => {
    mockSql
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 5, campaign_id: 1, direction: 'outbound', updated_at: new Date() }]);
    const result = await processInboundSms({
      from: '+15551234567', to: '+15550000000',
      body: 'yes', organizationId: 'org-1',
    });
    expect(result.action).toBe('contact_reply');
    expect(result.contactId).toBe(5);
  });

  it('owner check takes precedence even if same number is in campaign_contacts', async () => {
    mockSql.mockResolvedValueOnce([1]);
    const result = await processInboundSms({
      from: '+15551234567', to: '+15550000000',
      body: 'range 100000-150000', organizationId: 'org-1',
    });
    expect(result.action).toBe('owner_reply');
  });

  it('handles international owner numbers', async () => {
    mockSql.mockResolvedValueOnce([1]);
    const result = await processInboundSms({
      from: '+447911123456', to: '+15550000000',
      body: 'range 100000-150000', organizationId: 'org-1',
    });
    expect(result.action).toBe('owner_reply');
  });
});