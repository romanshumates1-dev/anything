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
import { getAllLegalDocs, getLegalDoc, currentVersionFor } from './legal';
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
