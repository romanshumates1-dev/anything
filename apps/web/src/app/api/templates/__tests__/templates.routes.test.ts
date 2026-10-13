/**
 * S1 — AI templates: behavioural proof for the four user-facing template routes
 * (matrix row S1 was IMPLEMENTED with "routes + components exist" only, which is
 * not evidence of behaviour). Also pins three prior live defects:
 *
 *   1. ENUM 500 (live-verified): `GET /api/templates?category=EMAIL` reached
 *      Postgres as `invalid input value for enum` → 500. Both list routes must
 *      answer 400 BEFORE any query runs.
 *   2. Defect #32: interpolated `sql` fragments made every FILTERED query 500
 *      (`syntax error at or near "$2"`). Filters now go through buildWhere();
 *      this suite asserts values are BOUND ($n params), never inlined.
 *   3. Tenant isolation: every `user_templates` read/write must bind
 *      `organization_id`, so one org can never see or mutate another's rows.
 *
 * The SQL builders (sqlFragments/templateEnums) are deliberately NOT mocked —
 * the whole point of defect #32 was that mocking the driver hid broken
 * composition. Only the driver (`sql`), auth and org context are mocked.
 *
 * WHAT IS ASSERTED
 * 1. All four routes: 401 before any work; 403 when no org (library is
 *    auth-only by design and needs no org).
 * 2. GET list: 400 for out-of-enum category/channel, org-scoped + is_active
 *    bound, filters bound as params, includeLibrary merges both stores and
 *    totals both, DB failure → opaque 500 (no SQL detail leak).
 * 3. POST: validation 400s run before any query; INSERT binds org + creator and
 *    extracts {{variables}} from content; ai_generated marks the generation row
 *    used, org-scoped.
 * 4. [id] GET: org-scoped read, library fallback, 404 when neither has it.
 * 5. [id] PUT: ownership miss → 404 with NO update attempted; update org-scoped.
 * 6. [id] DELETE: soft delete (`is_active = false`) org-scoped; 404 on miss.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { default: mockSql } = vi.hoisted(() => {
  const m: any = vi.fn(async () => []);
  return { default: m };
});
vi.mock('@/app/api/utils/sql', () => ({ default: mockSql }));

const { getSession } = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock('@/lib/auth', () => ({
  auth: { api: { getSession: (...a: any[]) => getSession(...a) } },
}));
vi.mock('next/headers', () => ({ headers: vi.fn(async () => new Headers()) }));

const { getOrganization } = vi.hoisted(() => ({ getOrganization: vi.fn() }));
vi.mock('@/lib/organization-context', () => ({
  getOrganization: (...a: any[]) => getOrganization(...a),
}));

import { GET as listGET, POST as listPOST } from '../route';
import { GET as libraryGET } from '../library/route';
import { GET as idGET, PUT as idPUT, DELETE as idDELETE } from '../[id]/route';

/** Request double: carries `.url` for GETs. */
function getReq(qs = '') {
  return new Request(`http://t/api/templates${qs}`) as any;
}
function libraryReq(qs = '') {
  return new Request(`http://t/api/templates/library${qs}`) as any;
}
/** Request double: carries a JSON body for POST/PUT. */
function jsonReq(body: unknown) {
  return { json: () => Promise.resolve(body) } as any;
}
function idCtx(id: string) {
  return { params: Promise.resolve({ id }) } as any;
}

/** SQL text of a mock call — tagged template (array) or string form. */
function text(call: any[]): string {
  return Array.isArray(call[0]) ? call[0].join('') : String(call[0]);
}
/** Bound values of a tagged-template call, excluding the SQL itself. */
function args(call: any[]): unknown[] {
  return Array.isArray(call[0]) ? call.slice(1) : [];
}
/** Params array of a string-form call (`sql(text, params)`). */
function params(call: any[]): unknown[] {
  return Array.isArray(call[0]) ? [] : ((call[1] as unknown[]) ?? []);
}

beforeEach(() => {
  vi.clearAllMocks();
  getSession.mockResolvedValue({ user: { id: 'user-1' } });
  getOrganization.mockResolvedValue({ id: 'org_1' });
  mockSql.mockResolvedValue([]);
});

describe('GET /api/templates (list)', () => {
  it('401s anonymous callers before any query', async () => {
    getSession.mockResolvedValueOnce(null);
    const res = await listGET(getReq());
    expect(res.status).toBe(401);
    expect(mockSql).not.toHaveBeenCalled();
  });

  it('403s a caller with no organization before any query', async () => {
    getOrganization.mockResolvedValueOnce(null);
    const res = await listGET(getReq());
    expect(res.status).toBe(403);
    expect(mockSql).not.toHaveBeenCalled();
  });

  it('400s an out-of-enum category instead of the live Postgres enum 500', async () => {
    const res = await listGET(getReq('?category=EMAIL'));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('Invalid category');
    expect(mockSql).not.toHaveBeenCalled();
  });

  it('400s an out-of-enum channel before any query', async () => {
    const res = await listGET(getReq('?channel=carrier_pigeon'));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('Invalid channel');
    expect(mockSql).not.toHaveBeenCalled();
  });

  it('scopes user templates to the caller organization and is_active (tenant isolation)', async () => {
    const res = await listGET(getReq());
    expect(res.status).toBe(200);
    expect(mockSql).toHaveBeenCalledTimes(1);
    const call = mockSql.mock.calls[0];
    expect(text(call)).toMatch(/FROM user_templates/);
    expect(text(call)).toContain('organization_id = $1');
    expect(text(call)).toContain('is_active = $2');
    expect(params(call)).toEqual(['org_1', true]);
  });

  it('binds category/channel/favorites filters as $n params, never inlined (defect #32)', async () => {
    const res = await listGET(getReq('?category=closing&channel=sms&favorites=true'));
    expect(res.status).toBe(200);
    const call = mockSql.mock.calls[0];
    const t = text(call);
    // Values must arrive as parameters, not SQL literals.
    expect(t).toContain('category = $3');
    expect(t).toContain('channel = $4');
    expect(t).toContain('is_favorite = $5');
    expect(t).not.toContain("'closing'");
    expect(t).not.toContain("'sms'");
    expect(params(call)).toEqual(['org_1', true, 'closing', 'sms', true]);
  });

  it('includeLibrary=true fetches both stores and totals both', async () => {
    mockSql
      .mockResolvedValueOnce([{ id: 't1' }, { id: 't2' }])
      .mockResolvedValueOnce([{ id: 'lib1' }]);
    const res = await listGET(getReq('?includeLibrary=true'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.userTemplates).toHaveLength(2);
    expect(body.libraryTemplates).toHaveLength(1);
    expect(body.total).toBe(3);
    expect(text(mockSql.mock.calls[1])).toMatch(/FROM template_library/);
  });

  it('answers an opaque 500 on query failure, leaking no SQL detail', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mockSql.mockRejectedValueOnce(new Error('relation "user_templates" is secret-detail'));
    const res = await listGET(getReq());
    expect(res.status).toBe(500);
    const raw = JSON.stringify(await res.json());
    expect(raw).toBe('{"error":"Internal Server Error"}');
    expect(raw).not.toContain('secret-detail');
    vi.restoreAllMocks();
  });
});

describe('POST /api/templates (create)', () => {
  const VALID = {
    name: 'Jefferson County opener',
    templateBody: 'Hi {{firstName}}, is {{propertyAddress}} still available?',
  };

  it('401s anonymous callers before any query', async () => {
    getSession.mockResolvedValueOnce(null);
    const res = await listPOST(jsonReq(VALID));
    expect(res.status).toBe(401);
    expect(mockSql).not.toHaveBeenCalled();
  });

  it('403s a caller with no organization before any query', async () => {
    getOrganization.mockResolvedValueOnce(null);
    const res = await listPOST(jsonReq(VALID));
    expect(res.status).toBe(403);
    expect(mockSql).not.toHaveBeenCalled();
  });

  it('400s a too-short name without touching the database', async () => {
    const res = await listPOST(jsonReq({ ...VALID, name: 'A' }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('at least 2 characters');
    expect(mockSql).not.toHaveBeenCalled();
  });

  it('400s a too-short body without touching the database', async () => {
    const res = await listPOST(jsonReq({ ...VALID, templateBody: 'short' }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('at least 10 characters');
    expect(mockSql).not.toHaveBeenCalled();
  });

  it('INSERTs with org + creator bound and extracts {{variables}} from content', async () => {
    mockSql.mockResolvedValueOnce([{ id: 'tpl-1' }]);
    const res = await listPOST(jsonReq(VALID));
    expect(res.status).toBe(200);
    expect((await res.json()).id).toBe('tpl-1');
    expect(mockSql).toHaveBeenCalledTimes(1);
    const call = mockSql.mock.calls[0];
    expect(text(call)).toMatch(/INSERT INTO user_templates/);
    // Bound values: the org and the creator are call arguments, not SQL text.
    expect(args(call)).toContain('org_1');
    expect(args(call)).toContain('user-1');
    expect(text(call)).not.toContain('org_1');
    // Variables were extracted from the template content (both occurrences).
    expect(JSON.stringify(args(call))).toContain('{{firstName}}');
    expect(JSON.stringify(args(call))).toContain('{{propertyAddress}}');
  });

  it('marks the AI generation row used, org-scoped, when sourceType is ai_generated', async () => {
    mockSql
      .mockResolvedValueOnce([{ id: 'tpl-1' }])
      .mockResolvedValueOnce([]);
    const res = await listPOST(
      jsonReq({ ...VALID, sourceType: 'ai_generated', sourceId: 'gen-7' })
    );
    expect(res.status).toBe(200);
    expect(mockSql).toHaveBeenCalledTimes(2);
    const mark = mockSql.mock.calls[1];
    expect(text(mark)).toMatch(/UPDATE ai_template_generations/);
    expect(args(mark)).toContain('gen-7');
    expect(args(mark)).toContain('org_1');
    expect(text(mark)).not.toContain('gen-7');
  });

  it('answers an opaque 500 on insert failure, leaking no SQL detail', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mockSql.mockRejectedValueOnce(new Error('duplicate key secret-detail'));
    const res = await listPOST(jsonReq(VALID));
    expect(res.status).toBe(500);
    const raw = JSON.stringify(await res.json());
    expect(raw).toBe('{"error":"Internal Server Error"}');
    expect(raw).not.toContain('secret-detail');
    vi.restoreAllMocks();
  });
});

describe('GET /api/templates/[id]', () => {
  it('401s anonymous callers before any query', async () => {
    getSession.mockResolvedValueOnce(null);
    const res = await idGET(getReq('/tpl-1'), idCtx('tpl-1'));
    expect(res.status).toBe(401);
    expect(mockSql).not.toHaveBeenCalled();
  });

  it('reads a user template org-scoped and does not fall through to the library', async () => {
    mockSql.mockResolvedValueOnce([{ id: 'tpl-1', source: 'user' }]);
    const res = await idGET(getReq('/tpl-1'), idCtx('tpl-1'));
    expect(res.status).toBe(200);
    expect((await res.json()).id).toBe('tpl-1');
    expect(mockSql).toHaveBeenCalledTimes(1);
    const call = mockSql.mock.calls[0];
    expect(text(call)).toMatch(/FROM user_templates/);
    expect(text(call)).toContain('organization_id');
    expect(args(call)).toContain('org_1');
  });

  it('falls back to the library when no org-owned template has the id', async () => {
    mockSql
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'lib-1', source: 'library' }]);
    const res = await idGET(getReq('/lib-1'), idCtx('lib-1'));
    expect(res.status).toBe(200);
    expect((await res.json()).id).toBe('lib-1');
    expect(text(mockSql.mock.calls[1])).toMatch(/FROM template_library/);
  });

  it('404s when neither the org nor the library has the id', async () => {
    mockSql.mockResolvedValue([]);
    const res = await idGET(getReq('/nope'), idCtx('nope'));
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe('Template not found');
  });
});

describe('PUT /api/templates/[id]', () => {
  it('401s anonymous callers before any query', async () => {
    getSession.mockResolvedValueOnce(null);
    const res = await idPUT(jsonReq({ name: 'Renamed' }), idCtx('tpl-1'));
    expect(res.status).toBe(401);
    expect(mockSql).not.toHaveBeenCalled();
  });

  it('404s an id owned by another organization and performs NO update', async () => {
    mockSql.mockResolvedValueOnce([]); // ownership check finds nothing
    const res = await idPUT(jsonReq({ name: 'Renamed' }), idCtx('tpl-9'));
    expect(res.status).toBe(404);
    // Exactly one query (the ownership check) — never an UPDATE for foreign rows.
    expect(mockSql).toHaveBeenCalledTimes(1);
  });

  it('updates only within the caller org and returns the updated row', async () => {
    mockSql
      .mockResolvedValueOnce([{ id: 'tpl-1' }]) // ownership check
      .mockResolvedValueOnce([{ id: 'tpl-1', name: 'Renamed' }]); // UPDATE ... RETURNING
    const res = await idPUT(jsonReq({ name: 'Renamed' }), idCtx('tpl-1'));
    expect(res.status).toBe(200);
    expect((await res.json()).name).toBe('Renamed');
    const update = mockSql.mock.calls[1];
    expect(text(update)).toMatch(/UPDATE user_templates/);
    expect(text(update)).toContain('organization_id');
    expect(args(update)).toContain('org_1');
  });
});

describe('DELETE /api/templates/[id]', () => {
  it('401s anonymous callers before any query', async () => {
    getSession.mockResolvedValueOnce(null);
    const res = await idDELETE(getReq('/tpl-1'), idCtx('tpl-1'));
    expect(res.status).toBe(401);
    expect(mockSql).not.toHaveBeenCalled();
  });

  it('404s when the org owns no such template', async () => {
    mockSql.mockResolvedValueOnce([]);
    const res = await idDELETE(getReq('/tpl-9'), idCtx('tpl-9'));
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe('Template not found');
  });

  it('soft-deletes (is_active = false) within the caller org only', async () => {
    mockSql.mockResolvedValueOnce([{ id: 'tpl-1' }]);
    const res = await idDELETE(getReq('/tpl-1'), idCtx('tpl-1'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ success: true, id: 'tpl-1' });
    const call = mockSql.mock.calls[0];
    expect(text(call)).toMatch(/UPDATE user_templates/);
    expect(text(call)).toContain('is_active = false');
    expect(args(call)).toContain('org_1');
    expect(text(call)).not.toContain('org_1');
  });
});

describe('GET /api/templates/library', () => {
  it('401s anonymous callers before any query (auth-only, no org required)', async () => {
    getSession.mockResolvedValueOnce(null);
    const res = await libraryGET(libraryReq());
    expect(res.status).toBe(401);
    expect(mockSql).not.toHaveBeenCalled();
  });

  it('400s an out-of-enum category — the live `?category=EMAIL` 500 regression', async () => {
    const res = await libraryGET(libraryReq('?category=EMAIL'));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('Invalid category');
    expect(mockSql).not.toHaveBeenCalled();
  });

  it('200s grouped by category with the ILIKE search bound as params (defect #32)', async () => {
    mockSql.mockResolvedValueOnce([
      { id: 'l1', category: 'cold_outreach' },
      { id: 'l2', category: 'cold_outreach' },
    ]);
    const res = await libraryGET(libraryReq('?search=vacant+land'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.total).toBe(2);
    expect(body.byCategory.cold_outreach).toHaveLength(2);
    const call = mockSql.mock.calls[0];
    expect(text(call)).toMatch(/FROM template_library/);
    expect(text(call)).toContain('ILIKE');
    // Bound, not inlined: the LIKE pattern lives in params, never in SQL text.
    expect(text(call)).not.toContain('vacant land');
    expect(params(call)).toContain('%vacant land%');
  });

  it('answers an opaque 500 on query failure, leaking no SQL detail', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mockSql.mockRejectedValueOnce(new Error('enum failure secret-detail'));
    const res = await libraryGET(libraryReq());
    expect(res.status).toBe(500);
    const raw = JSON.stringify(await res.json());
    expect(raw).toBe('{"error":"Internal Server Error"}');
    expect(raw).not.toContain('secret-detail');
    vi.restoreAllMocks();
  });
});



