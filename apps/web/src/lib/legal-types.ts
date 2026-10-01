/**
 * Shape of a legal document as it arrives from the build-time generator.
 *
 * Kept in its own module so both `legal.ts` and the generated
 * `legal-docs.generated.ts` can reference it without importing each other.
 */
export interface LegalDocSeed {
  /** Route segment, e.g. "terms", "acceptable-use". */
  slug: string;
  /** Raw markdown frontmatter, parsed as simple `key: value` pairs. */
  frontmatter: Record<string, string>;
  /** Markdown body, still containing {{PLACEHOLDER}} tokens. */
  body: string;
}
