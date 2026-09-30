/**
 * MARKETING HONESTY RATCHET — COMPONENT DEFAULTS (2026-09-30).
 *
 * The companion test in this directory covers /api/marketing/stats, which
 * invents data at RUNTIME. This one covers data baked into COMPONENTS at build
 * time, which no API fix can reach.
 *
 * THE DEFECT THIS EXISTS FOR
 * -------------------------
 * `SocialProof.tsx` defaulted to four invented customers ("Marcus Johnson",
 * "$32,000 deal", "Sarah Chen", "David Williams", "Jennifer Martinez") with
 * first-person quotes about results that never happened, plus a "$45M"
 * revenue stat. `CaseStudy.tsx` exported `SAMPLE_CASE_STUDIES` with the same
 * invented people - and flagged the fabricated Marcus entry `verified: true`,
 * asserting a verification that never occurred.
 *
 * `CaseStudySection` DEFAULTED to that array under the heading "Real Results
 * from Real Investors" with a "Get Results Like These" CTA. Neither component
 * was mounted on a page at the time, so nothing was published - but both were
 * exported from the marketing barrel, meaning the first person to add
 * `<CaseStudySection />` would have published fabricated earnings claims to
 * the public without intending to.
 *
 * THE RULE
 * --------
 * A component must not supply invented CUSTOMER-SPECIFIC facts - a person's
 * name, a quote, an earnings figure, a rating - as a default. A default is a
 * decision, and defaults get rendered by whoever mounts the component next.
 *
 * A component may legitimately default a *product* fact (a plan name, a
 * feature list), because that is checkable. It may not default a *claim about
 * the world* (this person earned this much), because nothing can check it.
 */
import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
// _sourceScan.ts lives beside the other static guards, under
// src/app/api/__tests__/security/. The relative path is deliberately explicit:
// an unresolvable import here does not fail the suite, it silently collects
// ZERO tests and reports green, which is the exact failure mode this guard
// exists to prevent.
import { scanSource, readSource, SRC_ROOT } from '../../__tests__/security/_sourceScan';

const COMPONENTS = join(SRC_ROOT, 'components', 'marketing');

/** Files that legitimately present placeholders/illustrative content. */
const ALLOWLIST: string[] = [
  // LiveSocialProof reads real counts from /api/marketing/stats and already
  // refuses to render unverified data (see marketing-stats-honesty.test.ts).
  'LiveSocialProof.tsx',
  // Banners that describe a PROMOTION's own terms, not a customer's results.
  'LimitedTimeOffer.tsx',
  'ScarcityBadge.tsx',
  'SocialProofBanner.tsx',
];

/** Invented people and the specific earnings claims attached to them. */
const INVENTED_PEOPLE = [
  'Marcus Johnson',
  'Sarah Chen',
  'David Williams',
  'Jennifer Martinez',
];

/**
 * Remove line and block comments, keeping string literals.
 *
 * A guard that cannot tell documentation from data is a guard that gets
 * disabled the first time someone writes an honest note about what they
 * removed. A real person name in a comment is history; the same name in an
 * object literal is a published testimonial.
 */
function stripComments(src: string): string {
  let out = '';
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const next = src[i + 1];
    if (c === '/' && next === '/') {
      while (i < n && src[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && next === '*') {
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++;
      i += 2;
      // Preserve the newline so line numbers stay roughly stable.
      out += '\n';
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      const quote = c;
      out += c;
      i++;
      while (i < n) {
        if (src[i] === '\\') {
          out += src[i] + (src[i + 1] ?? '');
          i += 2;
          continue;
        }
        out += src[i];
        if (src[i] === quote) {
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

describe('marketing component honesty ratchet', () => {
  it('no marketing component ships an invented customer testimonial', () => {
    const offenders: string[] = [];
    const files = scanSource(COMPONENTS);

    // Vacuous-pass guard.
    expect(files.length, 'component scan collapsed - guard would pass vacuously')
      .toBeGreaterThan(5);

    for (const file of files) {
      const name = file.split(/[\\/]/).pop() as string;
      if (ALLOWLIST.includes(name)) continue;
      // Only .tsx can render copy; .ts holds the data, so check both.
      if (!/\.(ts|tsx)$/.test(name)) continue;

      // Comments are stripped before the check. This guard's own docblock, and
      // the "why this was removed" note in each component, legitimately NAME
      // the fabricated people in order to record that they were deleted.
      // Matching the raw text would therefore flag the fix as the defect.
      const text = stripComments(readSource(file));
      for (const person of INVENTED_PEOPLE) {
        if (text.includes(person)) offenders.push(`${name}: "${person}"`);
      }
    }

    expect(offenders).toEqual([]);
  });

  it('the fabricated-case-study export is gone from the barrel', () => {
    // The data was removed; the barrel export must not still advertise it,
    // or the next contributor re-imports a name that no longer exists.
    const barrel = readSource(join(COMPONENTS, 'index.ts'));
    expect(barrel).not.toContain('SAMPLE_CASE_STUDIES');
  });

  it('a case-study gallery cannot default to invented results', () => {
    const text = readSource(join(COMPONENTS, 'CaseStudy.tsx'));
    // Rendering "Real Results from Real Investors" with nothing to show would
    // be a promise with no backing, so the empty case must render nothing.
    expect(text).toContain('if (caseStudies.length === 0) return null;');
    expect(text).not.toContain('caseStudies = SAMPLE_CASE_STUDIES');
  });

  it('SocialProof cannot be rendered without real, supplied data', () => {
    const text = readSource(join(COMPONENTS, 'SocialProof.tsx'));
    // No default props means TypeScript forces a caller to pass real data.
    expect(text).toContain('testimonials: Testimonial[];');
    expect(text).toContain('if (!testimonials || testimonials.length === 0) return null;');
    // And an unmeasured figure must not survive as a RENDERED value. The check
    // is on JSX text (`>$45M<`), not the bare string, so the explanatory comment
    // recording WHY it was removed does not trip the guard.
    expect(text).not.toMatch(/>\s*\$45M\s*</);
  }, 30_000);
});
