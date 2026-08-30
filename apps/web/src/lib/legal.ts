import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import {
  REQUIRED_ACCEPTANCE_VERSIONS,
  MESSAGING_AGREEMENT_VERSION as MESSAGING_VERSION,
  ACCEPTANCE_DOC_TYPES,
  type AcceptanceKey,
} from './legal-versions';

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

const CONTENT_DIR = join(process.cwd(), 'content', 'legal');

function substitutePlaceholders(text: string): string {
  const map: Record<string, string> = {
    LEGAL_ENTITY_NAME: process.env.LEGAL_ENTITY_NAME || process.env.NEXT_PUBLIC_LEGAL_ENTITY_NAME || '[LEGAL_ENTITY_NAME]',
    LEGAL_ENTITY_STATE: process.env.LEGAL_ENTITY_STATE || '[LEGAL_ENTITY_STATE]',
    SUPPORT_EMAIL: process.env.SUPPORT_EMAIL || '[SUPPORT_EMAIL]',
  };
  return text.replace(/\{\{(\w+)\}\}/g, (whole, key) => (key in map ? map[key] : whole));
}

/** Minimal, dependency-free frontmatter parser (key: value lines only). */
function parseFrontmatter(raw: string): { data: Record<string, string>; body: string } {
  if (!raw.startsWith('---')) return { data: {}, body: raw };
  const end = raw.indexOf('\n---', 3);
  if (end === -1) return { data: {}, body: raw };
  const fmBlock = raw.slice(3, end).trim();
  const body = raw.slice(end + 4).replace(/^\s*\n/, '');
  const data: Record<string, string> = {};
  for (const line of fmBlock.split('\n')) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    data[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
  return { data, body };
}

function loadFile(slug: string): LegalDoc | null {
  let raw: string;
  try {
    raw = readFileSync(join(CONTENT_DIR, `${slug}.md`), 'utf8');
  } catch {
    return null;
  }
  const { data, body } = parseFrontmatter(raw);
  // Strip the HTML template comment from the rendered body (it stays in source
  // as a reviewer signal, but shouldn't render as literal text on the page).
  const cleanBody = substitutePlaceholders(body.replace(/<!--[\s\S]*?-->/g, '').replace(/^\s*\n/, ''));
  return {
    slug,
    docType: data.doc_type || slug,
    title: data.title || slug,
    version: data.version || '1.0.0',
    effectiveDate: data.effective_date || '',
    requiresAcceptance: data.requires_acceptance === 'true',
    body: cleanBody,
  };
}

export function getLegalDoc(slug: string): LegalDoc | null {
  return loadFile(slug);
}

export function getAllLegalSlugs(): string[] {
  try {
    return readdirSync(CONTENT_DIR)
      .filter((f) => f.endsWith('.md'))
      .map((f) => f.replace(/\.md$/, ''))
      .sort();
  } catch {
    return [];
  }
}

export function getAllLegalDocs(): LegalDoc[] {
  return getAllLegalSlugs()
    .map(loadFile)
    .filter((d): d is LegalDoc => d !== null);
}

// Re-exported so callers that already import from '@/lib/legal' get the
// acceptance metadata too. The authoritative values live in the edge-safe
// './legal-versions' module (the middleware can't import this fs-based file).
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
