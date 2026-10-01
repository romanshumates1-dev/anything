/**
 * ⚠ EDGE / WORKERS SAFE — DO NOT REINTRODUCE `fs` HERE ⚠
 *
 * This module used to read `content/legal/*.md` with Node's `fs` on every
 * call. Cloudflare Workers has no filesystem, so in production that meant:
 *
 *   GET /api/legal       -> 200 []            (readdirSync returned nothing)
 *   GET /legal/privacy   -> 404               (read threw -> notFound())
 *   ... all nine docs    -> 404
 *
 * while `next start`, the unit suite and the whole browser-QA gate all passed
 * locally. `content/legal/` does ship inside the deployed bundle, but nothing
 * can read it there, so shipping it was never sufficient.
 *
 * Documents are now inlined at BUILD time into `./legal-docs.generated` by
 * scripts/generate-legal-docs.mjs (wired into `cf:build`). The markdown on
 * disk is still the single source of truth - only the read path moved.
 *
 * `legal.test.ts` asserts there is no `fs` import here. If you need to change
 * where legal text comes from, change the generator, not this file.
 */
import { SUPPORT_EMAIL } from './contact';
import {
  REQUIRED_ACCEPTANCE_VERSIONS,
  MESSAGING_AGREEMENT_VERSION as MESSAGING_VERSION,
  ACCEPTANCE_DOC_TYPES,
  type AcceptanceKey,
} from './legal-versions';
import { LEGAL_DOC_SEEDS } from './legal-docs.generated';
import type { LegalDocSeed } from './legal-types';

export type { AcceptanceKey };

/**
 * Single source of truth for legal documents: the markdown files in
 * apps/web/content/legal/. Each carries frontmatter (title, doc_type,
 * version, effective_date, requires_acceptance). Pages render from here, and
 * the acceptance system reads CURRENT versions from here — so there is exactly
 * one place a version or a word of legal text lives (Phase 3 replaced the old
 * split between hardcoded TSX pages and an orphaned legal_documents DB seed).
 *
 * Entity placeholders ({{LEGAL_ENTITY_NAME}}, {{LEGAL_ENTITY_STATE}},
 * {{SUPPORT_EMAIL}}) are substituted from env at render time so the same
 * template ships to every deployment.
 */

export interface LegalDoc {
  slug: string; // route segment, e.g. "terms", "acceptable-use"
  docType: string; // canonical type used in acceptance rows
  title: string;
  version: string;
  effectiveDate: string;
  requiresAcceptance: boolean;
  body: string; // markdown body with placeholders substituted
}

/**
 * The placeholder map, as a function.
 *
 * `SUPPORT_EMAIL` previously fell back to the literal string
 * `[SUPPORT_EMAIL]`. `.env.production.template` ships that variable EMPTY
 * ("TODO(owner)"), so in production every /legal/* page rendered the bracketed
 * placeholder as real text in place of a contact address. A published privacy
 * policy that tells a data subject to email "[SUPPORT_EMAIL]" is worse than one
 * that names a real, monitored mailbox — it reads as a broken page and gives the
 * request nowhere to go.
 *
 * It now falls back to the canonical address in `lib/contact`. An env override
 * is still honoured so a deployment can point legal mail at a dedicated alias,
 * but silence no longer produces a placeholder.
 */
export function legalTemplateValues(): Record<string, string> {
  return {
    LEGAL_ENTITY_NAME:
      process.env.LEGAL_ENTITY_NAME || process.env.NEXT_PUBLIC_LEGAL_ENTITY_NAME || '[LEGAL_ENTITY_NAME]',
    LEGAL_ENTITY_STATE: process.env.LEGAL_ENTITY_STATE || '[LEGAL_ENTITY_STATE]',
    SUPPORT_EMAIL: process.env.SUPPORT_EMAIL || SUPPORT_EMAIL,
  };
}

function substitutePlaceholders(text: string): string {
  const map = legalTemplateValues();
  return text.replace(/\{\{(\w+)\}\}/g, (whole, key) => (key in map ? map[key] : whole));
}

/**
 * Frontmatter parsing now happens at BUILD time in
 * scripts/generate-legal-docs.mjs, so it is deliberately absent here. Keeping a
 * second copy in the runtime module would be two parsers free to disagree.
 */

function loadSeed(seed: LegalDocSeed): LegalDoc {
  const data = seed.frontmatter ?? {};
  // Strip the HTML template comment from the rendered body (it stays in source
  // as a reviewer signal, but shouldn't render as literal text on the page).
  const cleanBody = substitutePlaceholders(
    seed.body.replace(/<!--[\s\S]*?-->/g, '').replace(/^\s*\n/, '')
  );
  return {
    slug: seed.slug,
    docType: data.doc_type || seed.slug,
    title: data.title || seed.slug,
    version: data.version || '1.0.0',
    effectiveDate: data.effective_date || '',
    requiresAcceptance: data.requires_acceptance === 'true',
    body: cleanBody,
  };
}

export function getLegalDoc(slug: string): LegalDoc | null {
  const seed = LEGAL_DOC_SEEDS.find((s) => s.slug === slug);
  return seed ? loadSeed(seed) : null;
}

export function getAllLegalSlugs(): string[] {
  return LEGAL_DOC_SEEDS.map((s) => s.slug).sort();
}

export function getAllLegalDocs(): LegalDoc[] {
  return getAllLegalSlugs()
    .map((slug) => getLegalDoc(slug))
    .filter((d): d is LegalDoc => d !== null);
}

// Re-exported so callers that already import from '@/lib/legal' get the
// acceptance metadata too. The authoritative values live in the edge-safe
// './legal-versions' module, which the middleware imports directly.
export const ACCEPTANCE_DOCS = { tos: ACCEPTANCE_DOC_TYPES.tos, privacy: ACCEPTANCE_DOC_TYPES.privacy } as const;
export const MESSAGING_AGREEMENT_VERSION = MESSAGING_VERSION;

/**
 * Current version required for an acceptance key. Returns the edge-safe gating
 * constant (NOT the markdown frontmatter) so the version WRITTEN into an
 * acceptance row is exactly the version the middleware gate checks against.
 * legal.test.ts asserts the constant equals the markdown frontmatter version.
 */
export function currentVersionFor(key: AcceptanceKey): string {
  if (key === 'messaging') return MESSAGING_VERSION;
  return REQUIRED_ACCEPTANCE_VERSIONS[key];
}
