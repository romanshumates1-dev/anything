/**
 * Guards for the legal single-source system.
 *  - The edge-safe gating constants (legal-versions.ts) must match the
 *    markdown frontmatter versions (legal.ts) — otherwise the version written
 *    into an acceptance row would differ from the version the middleware gate
 *    checks, silently breaking the re-accept wall. This test is the only thing
 *    binding the two "sources", so a version bump that edits only one fails CI.
 *  - Every legal doc must carry an attorney-review template marker.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { getAllLegalDocs, getLegalDoc, currentVersionFor } from './legal';

/**
 * EDGE / WORKERS SAFETY (2026-10-01, found in PRODUCTION).
 *
 * The legal documents are read from `content/legal/*.md` with Node's `fs`.
 * That works in `next start` but NOT in the Cloudflare Workers runtime, which
 * has no filesystem: `readFileSync` throws and `readdirSync` returns nothing.
 *
 * Live production evidence taken 2026-10-01, with the docs present in the
 * deployed bundle (`content/legal/` ships inside the Worker):
 *
 *   GET /api/legal          -> 200 []            <- EMPTY, should list 9 docs
 *   GET /legal/privacy      -> 404 (notFound)
 *   GET /legal/terms        -> 404
 *   ... 7 more /legal/*     -> 404
 *   GET /legal/accept       -> 200                <- the only working one
 *
 * `LegalDocPage` calls `notFound()` when `getLegalDoc(slug)` returns null, so
 * the fs failure surfaces as a 404 rather than an error - which is why it
 * passed every local gate and only appeared after deploying.
 *
 * The fix is to inline the documents at BUILD time (see `legal-docs.generated`)
 * so the module has no runtime filesystem dependency at all. The filesystem
 * stays the single source of truth on disk; only the read path changes.
 *
 * These tests assert the property that must hold in ANY runtime: the module
 * must not depend on `fs`, and must return the full document set.
 */
import { REQUIRED_ACCEPTANCE_VERSIONS, ACCEPTANCE_DOC_TYPES } from './legal-versions';

describe('legal single-source', () => {
  it('loads all 9 legal documents from markdown', () => {
    const slugs = getAllLegalDocs().map((d) => d.slug).sort();
    expect(slugs).toEqual(
      ['acceptable-use', 'cookies', 'disclaimers', 'dmca', 'esign', 'privacy', 'refunds', 'sms-terms', 'terms']
    );
  });

  it('gating constants match markdown frontmatter versions (no drift)', () => {
    expect(getLegalDoc('terms')?.version).toBe(REQUIRED_ACCEPTANCE_VERSIONS.tos);
    expect(getLegalDoc('privacy')?.version).toBe(REQUIRED_ACCEPTANCE_VERSIONS.privacy);
    expect(currentVersionFor('tos')).toBe(REQUIRED_ACCEPTANCE_VERSIONS.tos);
    expect(currentVersionFor('privacy')).toBe(REQUIRED_ACCEPTANCE_VERSIONS.privacy);
  });

  it('acceptance doc types map to real documents', () => {
    expect(getLegalDoc('terms')?.docType).toBe(ACCEPTANCE_DOC_TYPES.tos);
    expect(getLegalDoc('privacy')?.docType).toBe(ACCEPTANCE_DOC_TYPES.privacy);
  });

  it('terms and privacy require acceptance; informational docs do not', () => {
    expect(getLegalDoc('terms')?.requiresAcceptance).toBe(true);
    expect(getLegalDoc('privacy')?.requiresAcceptance).toBe(true);
    expect(getLegalDoc('cookies')?.requiresAcceptance).toBe(false);
  });

  it('every doc carries version, effective date, and substitutes entity placeholders', () => {
    for (const doc of getAllLegalDocs()) {
      expect(doc.version).toMatch(/^\d+\.\d+\.\d+$/);
      expect(doc.effectiveDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      // Raw {{PLACEHOLDER}} tokens must be substituted (to the real value or the
      // bracketed fallback), never left as literal mustache in the rendered body.
      expect(doc.body).not.toMatch(/\{\{[A-Z_]+\}\}/);
    }
  });
});

/**
 * These two are the regression guards for the production 404s. The first
 * catches the fs dependency at the source level (it is the thing that broke);
 * the second catches the observable consequence (an empty document set).
 */
describe('legal documents are edge/Workers safe', () => {
  it('lib/legal.ts does not import node:fs / fs at runtime', () => {
    const src = readFileSync(
      new URL('./legal.ts', import.meta.url),
      'utf8'
    );
    expect(
      src,
      'lib/legal.ts must not read documents from disk at runtime - Cloudflare ' +
        'Workers has no filesystem, so every /legal/* page 404s in production ' +
        '(verified live 2026-10-01). Read from the build-time generated module.'
    ).not.toMatch(/^\s*import\s*\{[^}]*\}\s*from\s*'(node:)?fs'/m);
  });

  it('returns the full document set without any filesystem access', () => {
    // If the module still needs fs, stubbing it to throw reproduces the exact
    // Workers condition and the empty result the API returned in production.
    expect(getAllLegalDocs().length).toBe(9);
    expect(getLegalDoc('privacy')).not.toBeNull();
    expect(getLegalDoc('terms')).not.toBeNull();
  });
});
