/**
 * leadSuppression — one opt-out kills every channel for that PERSON.
 *
 * Proven live in scripts/verify-lead-suppression.mjs; this pins the behaviour
 * in CI so a regression fails a build rather than a campaign.
 *
 * The failure this guards against is quiet: an unsubscribe LOOKS honoured
 * (the origin row exists, the endpoint returns 200) while the same person
 * keeps receiving on another channel.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockSql } = vi.hoisted(() => ({ mockSql: vi.fn(async () => [] as any) }));
vi.mock('@/app/api/utils/sql', () => ({ default: mockSql }));
vi.mock('@/app/api/utils/logger', () => ({ logEvent: vi.fn(async () => {}) }));

import {
  identifiersForLead,
  findLeadByIdentifier,
  suppressLeadAllChannels,
} from '../leadSuppression';

const LEAD = {
  id: 42,
  phone: '+15025550123',
  email: 'Owner@Example.COM',
  metadata: { mailing_address: '123 Main St, Louisville, KY 40202', property_address: '9 Oak St' },
};

beforeEach(() => {
  vi.clearAllMocks();
  mockSql.mockResolvedValue([]);
});

describe('identifiersForLead', () => {
  it('collects phone, email and mailing address', () => {
    const ids = identifiersForLead(LEAD);
    expect(ids).toContain('+15025550123');
    expect(ids).toContain('owner@example.com'); // lower-cased
    expect(ids).toContain('123 Main St, Louisville, KY 40202');
  });

  it('EXCLUDES property_address — the house is not the owner mailbox', () => {
    // Suppressing it would block a different owner at the same parcel after a
    // sale, which is over-blocking, not compliance.
    expect(identifiersForLead(LEAD)).not.toContain('9 Oak St');
  });

  it('normalises a 10-digit phone to E.164 so it matches what the gate looks up', () => {
    expect(identifiersForLead({ phone: '5025550123' })).toContain('+15025550123');
    expect(identifiersForLead({ phone: '(502) 555-0123' })).toContain('+15025550123');
  });

  it('drops unusable values rather than storing junk keys', () => {
    expect(identifiersForLead({ phone: '123', email: 'nope', metadata: {} })).toEqual([]);
  });

  it('returns an empty list for an empty lead', () => {
    expect(identifiersForLead({})).toEqual([]);
  });
});

describe('findLeadByIdentifier', () => {
  it('does not query on an empty identifier', async () => {
    expect(await findLeadByIdentifier('  ')).toBeNull();
    expect(mockSql).not.toHaveBeenCalled();
  });

  it('binds a normalised phone and a lower-cased email', async () => {
    mockSql.mockResolvedValueOnce([LEAD]);
    await findLeadByIdentifier('(502) 555-0123');
    expect(mockSql.mock.calls[0]).toContain('+15025550123');
  });

  it('returns null when nothing matches', async () => {
    mockSql.mockResolvedValueOnce([]);
    expect(await findLeadByIdentifier('+15025559999')).toBeNull();
  });
});

describe('suppressLeadAllChannels — the cross-channel claim', () => {
  it('an EMAIL unsubscribe suppresses the lead PHONE and MAILING ADDRESS', async () => {
    mockSql
      .mockResolvedValueOnce([LEAD]) // findLeadByIdentifier
      .mockResolvedValueOnce([]); // existing suppressions
    const res = await suppressLeadAllChannels({
      identifier: 'owner@example.com',
      channel: 'email',
    });

    expect(res.leadId).toBe(42);
    expect(res.suppressed).toEqual(
      expect.arrayContaining([
        'owner@example.com',
        '+15025550123',
        '123 Main St, Louisville, KY 40202',
      ])
    );
    // One INSERT per identifier.
    const inserts = mockSql.mock.calls.filter(
      (c: any) => Array.isArray(c[0]) && c[0].join('?').includes('INSERT INTO compliance_records')
    );
    expect(inserts).toHaveLength(3);
  });

  it('still suppresses the origin identifier when NO lead matches', async () => {
    // Failing to resolve a person is not a reason to keep sending to them.
    mockSql.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    const res = await suppressLeadAllChannels({
      identifier: 'stranger@example.com',
      channel: 'email',
    });
    expect(res.leadId).toBeNull();
    expect(res.suppressed).toEqual(['stranger@example.com']);
  });

  it('normalises the origin identifier so the stored key matches the gate lookup', async () => {
    mockSql.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    const res = await suppressLeadAllChannels({ identifier: '(502) 555-0123', channel: 'sms' });
    expect(res.suppressed).toEqual(['+15025550123']);
  });

  it('reports identifiers that were already suppressed', async () => {
    mockSql
      .mockResolvedValueOnce([LEAD])
      .mockResolvedValueOnce([{ target: '+15025550123' }]);
    const res = await suppressLeadAllChannels({ identifier: 'owner@example.com', channel: 'email' });
    expect(res.alreadySuppressed).toContain('+15025550123');
    // Still re-written — ON CONFLICT refreshes the timestamp.
    expect(res.suppressed).toContain('+15025550123');
  });

  it('is a no-op on an empty identifier', async () => {
    const res = await suppressLeadAllChannels({ identifier: '   ', channel: 'sms' });
    expect(res).toEqual({ leadId: null, suppressed: [], alreadySuppressed: [] });
    expect(mockSql).not.toHaveBeenCalled();
  });

  it('records the channel the opt-out arrived on', async () => {
    mockSql.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    await suppressLeadAllChannels({ identifier: 'a@b.com', channel: 'mail' });
    const insert = mockSql.mock.calls.find(
      (c: any) => Array.isArray(c[0]) && c[0].join('?').includes('INSERT INTO compliance_records')
    );
    expect(insert).toContain('mail');
  });
});
