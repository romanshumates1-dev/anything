/**
 * REQUIREMENT SET T — route-level enforcement for /api/campaigns/[id]/voice.
 *
 * The pure recommender is proven in `voiceSelection.test.ts`. This file covers
 * the two properties that only exist at the HTTP boundary:
 *
 *   1. TENANT ISOLATION. A campaign belonging to another organization must be
 *      invisible — 404, never 403. A 403 confirms "this id exists, you just
 *      cannot see it", which is itself a cross-tenant enumeration oracle.
 *   2. A MANUAL CHOICE IS NOT SILENTLY DOWNGRADED. Posting an unknown voice in
 *      manual mode must be REJECTED. If it were downgraded to auto instead, the
 *      operator would be shown a voice they never chose and would have no way
 *      to know their selection was discarded.
 *
 * The route is driven with `sql` mocked, so these assertions are about the
 * handler's authorization logic and not about a database being reachable.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getSessionMock, orgMock, queryMock } = vi.hoisted(() => ({
  getSessionMock: vi.fn(),
  orgMock: vi.fn(),
  queryMock: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({
  auth: { api: { getSession: (args: unknown) => getSessionMock(args) } },
}));

vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('@/lib/organization-context', () => ({ getOrganization: orgMock }));

vi.mock('@/app/api/utils/sql', () => ({
  default: (...args: unknown[]) => queryMock(...args),
}));

import { GET, POST } from '../route';

const params = Promise.resolve({ id: 'campaign-abc' });

/** A campaign row as the tenant-scoped SELECT would return it. */
function campaignRow(overrides: Record<string, unknown> = {}) {
  return {
    objective_type: 'deals',
    channels: ['phone'],
    market: 'Phoenix, AZ',
    voice_selection_mode: 'auto',
    voice_id: 'twilio.jane',
    voice_resolved_from: 'deadbeef',
    ai_tone: 'professional',
    automation_level: 'semi_auto',
    ...overrides,
  };
}

/** Route calls issue the tenant SELECT first, then the UPDATE. */
function mockQuerySequence(rows: unknown[][]) {
  queryMock.mockReset();
  for (const rowsForCall of rows) {
    queryMock.mockResolvedValueOnce(rowsForCall);
  }
}

function makeRequest(body: unknown) {
  return new Request('https://example.test/api/campaigns/campaign-abc/voice', {
    method: 'POST',
    body: JSON.stringify(body),
  }) as never;
}

describe('Set T — /api/campaigns/[id]/voice', () => {
  beforeEach(() => {
    getSessionMock.mockReset();
    orgMock.mockReset();
    queryMock.mockReset();
  });

  it('refuses an unauthenticated request', async () => {
    getSessionMock.mockResolvedValue(null);

    const res = await GET({} as never, { params });

    expect(res.status).toBe(401);
    // Nothing may be read from the database for an anonymous caller.
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('returns 404, not 403, for a campaign in another organization', async () => {
    getSessionMock.mockResolvedValue({ user: { id: 'u-1' } });
    orgMock.mockResolvedValue({ id: 'org-a' });
    // The tenant-scoped SELECT matches no row for a foreign campaign id.
    mockQuerySequence([[]]);

    const res = await GET({} as never, { params });

    expect(res.status).toBe(404);
    const body = await res.json();
    // A "Forbidden" status or message here would confirm the id exists.
    expect(JSON.stringify(body)).not.toMatch(/forbidden/i);
  });

  it('returns the catalogue and an explanation for the current voice', async () => {
    getSessionMock.mockResolvedValue({ user: { id: 'u-1' } });
    orgMock.mockResolvedValue({ id: 'org-a' });
    mockQuerySequence([[campaignRow()]]);

    const res = await GET({} as never, { params });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(Array.isArray(body.catalog)).toBe(true);
    expect(body.resolution.factors.length).toBeGreaterThan(0);
    expect(body.resolution.voiceId).toBeTruthy();
  });

  it('flags an auto voice as stale when the campaign context changed', async () => {
    getSessionMock.mockResolvedValue({ user: { id: 'u-1' } });
    orgMock.mockResolvedValue({ id: 'org-a' });
    // `voice_resolved_from` deliberately does not match the live fingerprint.
    mockQuerySequence([[campaignRow({ voice_resolved_from: 'stale000' })]]);

    const res = await GET({} as never, { params });
    const body = await res.json();

    expect(body.stale).toBe(true);
  });

  it('rejects an unknown manual voice instead of silently choosing one', async () => {
    getSessionMock.mockResolvedValue({ user: { id: 'u-1' } });
    orgMock.mockResolvedValue({ id: 'org-a' });
    mockQuerySequence([[campaignRow()]]);

    const res = await POST(makeRequest({ mode: 'manual', voiceId: 'ghost.voice' }), {
      params,
    });

    expect(res.status).toBe(400);
    // Critically: no UPDATE may run. A downgrade-to-auto would have written a
    // voice the operator never selected.
    expect(queryMock).toHaveBeenCalledTimes(1);
  });

  it('rejects a mode outside auto/manual', async () => {
    getSessionMock.mockResolvedValue({ user: { id: 'u-1' } });
    orgMock.mockResolvedValue({ id: 'org-a' });

    const res = await POST(makeRequest({ mode: 'AUTO' }), { params });

    expect(res.status).toBe(400);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('persists a manual selection without consulting the recommender', async () => {
    getSessionMock.mockResolvedValue({ user: { id: 'u-1' } });
    orgMock.mockResolvedValue({ id: 'org-a' });
    mockQuerySequence([[campaignRow({ voice_id: null })], [{ campaign_id: 'campaign-abc' }]]);

    const res = await POST(makeRequest({ mode: 'manual', voiceId: 'twilio.nancy' }), {
      params,
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.voiceId).toBe('twilio.nancy');
    expect(body.resolution.source).toBe('manual');
  });

  it('reports a conflict instead of creating a partial settings row', async () => {
    getSessionMock.mockResolvedValue({ user: { id: 'u-1' } });
    orgMock.mockResolvedValue({ id: 'org-a' });
    // The UPDATE matches nothing: the campaign has no settings row.
    mockQuerySequence([[campaignRow()], []]);

    const res = await POST(makeRequest({ mode: 'auto' }), { params });

    expect(res.status).toBe(409);
  });
});