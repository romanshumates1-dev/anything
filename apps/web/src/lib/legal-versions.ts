/**
 * Edge-safe legal version constants.
 *
 * The middleware runs on the edge runtime (no `fs`), so it can't read the
 * markdown frontmatter to learn the current required versions. These constants
 * are the authoritative GATING versions, referenced by both the middleware
 * (re-accept gate) and the acceptance API (the version written into a row).
 *
 * To bump a document: edit its markdown frontmatter AND the matching value
 * here. legal.test.ts asserts the two never drift — a mismatch fails CI, so
 * there is effectively still one version per document.
 */

// Acceptance keys required at signup and gated app-wide on version bump.
export const REQUIRED_ACCEPTANCE_VERSIONS = {
  tos: '1.0.0',
  privacy: '1.0.0',
} as const;

// Separate one-time gate before a user can activate a campaign / send.
export const MESSAGING_AGREEMENT_VERSION = '1.0.0';

// Maps an acceptance key to the document_type stored in legal_acceptances.
export const ACCEPTANCE_DOC_TYPES = {
  tos: 'terms',
  privacy: 'privacy',
  messaging: 'messaging',
} as const;

export type AcceptanceKey = keyof typeof ACCEPTANCE_DOC_TYPES;
