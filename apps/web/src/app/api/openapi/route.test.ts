/**
 * Item 8 — /api/openapi OpenAPI 3 document (behavioral / schema).
 *
 * The route was a ghost (Swagger UI at /api/v1/docs pointed at a dead URL). It
 * now serves a static OpenAPI 3.0.3 document. This asserts the document is a
 * valid OpenAPI 3, declares the Bearer security scheme, and covers all seven
 * v1 resource groups (as both tags and /api/v1/* paths).
 */
import { describe, it, expect } from 'vitest';
import { GET } from './route';

const EXPECTED_GROUPS = ['auth', 'contacts', 'campaigns', 'conversations', 'approvals', 'analytics', 'webhooks'];

describe('Item 8 — /api/openapi', () => {
  it('returns a valid OpenAPI 3.x document', async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const doc = await res.json();
    expect(typeof doc.openapi).toBe('string');
    expect(doc.openapi.startsWith('3')).toBe(true);
    expect(doc.info).toBeDefined();
    expect(doc.info.title).toBeTruthy();
    expect(doc.paths).toBeDefined();
  });

  it('declares a Bearer security scheme', async () => {
    const doc = await (await GET()).json();
    const schemes = doc.components?.securitySchemes ?? {};
    const bearer = Object.values(schemes).find(
      (s: any) => s.type === 'http' && s.scheme === 'bearer'
    );
    expect(bearer).toBeDefined();
  });

  it('covers all 7 v1 resource groups as tags', async () => {
    const doc = await (await GET()).json();
    const tagNames = (doc.tags ?? []).map((t: any) => t.name);
    for (const group of EXPECTED_GROUPS) {
      expect(tagNames).toContain(group);
    }
    expect(tagNames.length).toBeGreaterThanOrEqual(6);
  });

  it('exposes at least 6 distinct /api/v1/* path groups', async () => {
    const doc = await (await GET()).json();
    const prefixes = new Set(
      Object.keys(doc.paths)
        .filter((p) => p.startsWith('/api/v1/'))
        .map((p) => p.replace('/api/v1/', '').split('/')[0])
    );
    expect(prefixes.size).toBeGreaterThanOrEqual(6);
    for (const group of EXPECTED_GROUPS) {
      expect(prefixes.has(group)).toBe(true);
    }
  });
});
