/**
 * POST /api/eval/run — offline prompt-variant sweep.
 *
 * Mirrors the mail run's spend discipline: the expensive mode must never be
 * the one you get by forgetting a parameter. hardOnly defaults TRUE, so an
 * accidental call runs the free compliance pass and spends nothing.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockSql } = vi.hoisted(() => {
  const m: any = vi.fn(async () => []);
  m.transaction = vi.fn(async () => []);
  m.query = m;
  return { mockSql: m };
});
vi.mock('@/app/api/utils/sql', () => ({ default: mockSql }));

const { requireAdmin } = vi.hoisted(() => ({ requireAdmin: vi.fn() }));
vi.mock('@/app/api/utils/authz', () => ({ requireAdmin }));

const { getOrganization } = vi.hoisted(() => ({ getOrganization: vi.fn() }));
vi.mock('@/lib/organization-context', () => ({
  getOrganization: (...a: any[]) => getOrganization(...a),
}));

vi.mock('@/app/api/utils/logger', () => ({ logEvent: vi.fn(async () => {}) }));

const { runSweep } = vi.hoisted(() => ({
  runSweep: vi.fn(async () => ({
    candidates: 4,
    judged: 0,
    skippedAsDisqualified: 0,
    judgeCallsSaved: 0,
    summaries: [],
    winner: 'v2',
  })),
}));
vi.mock('@/app/api/utils/evalHarness', () => ({ runSweep }));

import { POST } from './route';

const req = (body: unknown) =>
  new Request('http://t/api/eval/run', { method: 'POST', body: JSON.stringify(body) }) as any;

const VARIANTS = [
  { id: 'v1', system: 'baseline prompt' },
  { id: 'v2', system: 'improved prompt' },
];

const convo = (id: number) => ({
  id,
  history: [{ role: 'user', content: 'who is this?' }],
});

beforeEach(() => {
  vi.clearAllMocks();
  requireAdmin.mockResolvedValue({ ok: true, userId: 'admin-1' });
  getOrganization.mockResolvedValue({ id: 'org_1' });
  mockSql.mockResolvedValue([convo(1), convo(2)]);
});

describe('free by default', () => {
  it('runs hardOnly when the flag is omitted — no judge spend', async () => {
    const b = await (await POST(req({ variants: VARIANTS }))).json();
    expect(b.hardOnly).toBe(true);
    expect(runSweep).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ hardOnly: true })
    );
    expect(b.note).toMatch(/no judge calls, no spend/);
  });

  it('treats a STRING "false" as hardOnly — a form post must not start spending', async () => {
    await POST(req({ variants: VARIANTS, hardOnly: 'false' }));
    expect(runSweep).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ hardOnly: true })
    );
  });

  it('enables the judge only on a literal false', async () => {
    const b = await (await POST(req({ variants: VARIANTS, hardOnly: false }))).json();
    expect(b.hardOnly).toBe(false);
    expect(runSweep).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ hardOnly: false })
    );
  });

  it('passes through a judge-call ceiling', async () => {
    await POST(req({ variants: VARIANTS, hardOnly: false, maxJudgeCalls: 10 }));
    expect(runSweep).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ maxJudgeCalls: 10 })
    );
  });
});

describe('variant validation', () => {
  it('400s with fewer than two valid variants — one arm compares nothing', async () => {
    expect((await POST(req({ variants: [VARIANTS[0]] }))).status).toBe(400);
    expect((await POST(req({ variants: [] }))).status).toBe(400);
    expect((await POST(req({}))).status).toBe(400);
  });

  it('400s on duplicate ids, which would silently merge two arms', async () => {
    const res = await POST(req({ variants: [VARIANTS[0], { id: 'v1', system: 'other' }] }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/unique/);
  });

  it('drops malformed variants before counting', async () => {
    const res = await POST(
      req({ variants: [VARIANTS[0], { id: 'v2' }, { system: 'no id' }, { id: 'v3', system: '  ' }] })
    );
    expect(res.status).toBe(400); // only v1 survived
  });
});

describe('transcripts', () => {
  it('scopes the conversation query to the caller org', async () => {
    await POST(req({ variants: VARIANTS }));
    expect(mockSql.mock.calls[0]).toContain('org_1');
  });

  it('400s with a clear message when no usable transcripts exist', async () => {
    mockSql.mockResolvedValue([]);
    const res = await POST(req({ variants: VARIANTS }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('no usable transcripts');
  });

  it('filters out malformed history entries rather than passing them to the model', async () => {
    mockSql.mockResolvedValue([
      { id: 1, history: [{ role: 'system', content: 'x' }, { role: 'user', content: 'ok' }, { role: 'user' }] },
    ]);
    await POST(req({ variants: VARIANTS }));
    const passed = runSweep.mock.calls[0][1] as any[];
    expect(passed[0].history).toEqual([{ role: 'user', content: 'ok' }]);
  });

  it('drops conversations left with no usable history', async () => {
    mockSql.mockResolvedValue([{ id: 1, history: [{ role: 'system', content: 'x' }] }]);
    const res = await POST(req({ variants: VARIANTS }));
    expect(res.status).toBe(400);
  });

  it('caps the transcript limit', async () => {
    await POST(req({ variants: VARIANTS, transcriptLimit: 99999 }));
    expect(mockSql.mock.calls[0]).toContain(500);
  });
});

describe('authz', () => {
  it('rejects non-admins and orgless callers', async () => {
    requireAdmin.mockResolvedValue({
      ok: false,
      response: Response.json({ error: 'Forbidden' }, { status: 403 }),
    });
    expect((await POST(req({ variants: VARIANTS }))).status).toBe(403);

    requireAdmin.mockResolvedValue({ ok: true, userId: 'admin-1' });
    getOrganization.mockResolvedValue(null);
    expect((await POST(req({ variants: VARIANTS }))).status).toBe(403);
  });
});
