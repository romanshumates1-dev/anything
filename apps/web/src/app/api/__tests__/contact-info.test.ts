/**
 * PUBLIC CONTACT INFORMATION — one address, one number, one source of truth.
 *
 * WHY THIS EXISTS
 * ---------------
 * The support contact was hard-coded independently in six places and had DRIFTED
 * into three different mailboxes:
 *
 *   about/page.tsx        support@dealswiftautomation.com
 *   contact/page.tsx      support@dealswiftautomation.com
 *   privacy/page.tsx      privacy@dealswiftautomation.com  AND  support@...
 *   terms/page.tsx        legal@dealswiftautomation.com    AND  support@...
 *   settings/billing      support@dealswiftautomation.com
 *   components/SupportChat.tsx  support@dealswiftautomation.com
 *
 * Nothing in the repo created those extra mailboxes, and `SUPPORT_EMAIL` — the
 * variable the /legal/* documents substitute — is empty in
 * .env.production.template ("TODO(owner)"), so `lib/legal.ts` fell back to the
 * literal string `[SUPPORT_EMAIL]` and rendered that placeholder to the public.
 *
 * A privacy request or legal notice that lands on an unmonitored alias, or a
 * published page showing a bracketed placeholder, is a real compliance defect.
 * So the fix is structural rather than six more find-and-replace edits: one
 * module, imported everywhere, plus a guard that fails if a hard-coded mailbox
 * reappears. Duplication is the root cause; this test is the ratchet.
 */
import { describe, it, expect } from 'vitest';
import { relative, sep } from 'node:path';
import { scanSource, readSource, SRC_ROOT } from './security/_sourceScan';
import { SUPPORT_EMAIL, SUPPORT_PHONE, SUPPORT_PHONE_HREF, mailtoHref } from '../../../lib/contact';

describe('public contact information', () => {
  it('publishes exactly one support mailbox and one phone number', () => {
    expect(SUPPORT_EMAIL).toBe('roman.shumate@dealswiftautomation.com');
    expect(SUPPORT_PHONE).toBe('(502) 524-1638');
    // tel: must be E.164-ish and match the displayed digits, or a tap-to-call
    // on mobile reaches the wrong number.
    expect(SUPPORT_PHONE_HREF).toBe('tel:+15025241638');
    expect(SUPPORT_PHONE.replace(/\D/g, '')).toBe('5025241638');
    expect(SUPPORT_PHONE_HREF.replace('tel:', '')).toBe('+15025241638');
  });

  it('builds a mailto: href from the same address it displays', () => {
    expect(mailtoHref()).toBe(`mailto:${SUPPORT_EMAIL}`);
    expect(mailtoHref(SUPPORT_EMAIL)).toBe(`mailto:${SUPPORT_EMAIL}`);
  });

  describe('source tree', () => {
    // These are the mailboxes that were never provisioned. If one reappears in
    // a rendered page, a real request can go somewhere nobody reads.
    const DEAD_MAILBOXES = [
      'support@dealswiftautomation.com',
      'privacy@dealswiftautomation.com',
      'legal@dealswiftautomation.com',
    ];

    // dealflow.com / dealflow.ai are NOT domains this project owns — src/lib/seo.ts
    // documents having already fixed exactly this class of bug in metadataBase.
    const UNOWNED_DOMAIN = /@(dealflow\.(com|ai))/;

    // The single module that legitimately contains the canonical address.
    const CONTACT_MODULE = `${sep}lib${sep}contact.ts`;

    const offenders = scanSource(SRC_ROOT, { excludeTests: true })
      .map((f) => ({ f, rel: relative(SRC_ROOT, f) }))
      .filter(({ f }) => !f.endsWith(CONTACT_MODULE))
      .map(({ f, rel }) => ({ rel, text: readSource(f) }))
      .filter(({ text }) =>
        DEAD_MAILBOXES.some((m) => text.includes(m)) || UNOWNED_DOMAIN.test(text)
      );

    it('has no unprovisioned or unowned mailbox hard-coded in any source file', () => {
      expect(
        offenders.map((o) => o.rel)
      ).toEqual([]);
    });

    it('scanned a non-trivial number of files (guards against a broken root)', () => {
      // A wrong SRC_ROOT silently scans nothing and the assertion above passes
      // vacuously. This has bitten this suite four times via bad relative
      // imports, so the guard states its own coverage explicitly.
      expect(scanSource(SRC_ROOT, { excludeTests: true }).length).toBeGreaterThan(200);
    });
  });

  describe('legal document substitution', () => {
    it('falls back to the real address instead of rendering a placeholder', async () => {
      const { legalTemplateValues } = await import('../../../lib/legal');
      const prev = process.env.SUPPORT_EMAIL;
      delete process.env.SUPPORT_EMAIL;
      try {
        // The pre-fix fallback was the literal '[SUPPORT_EMAIL]', which
        // .env.production.template leaves empty in production.
        expect(legalTemplateValues().SUPPORT_EMAIL).toBe(SUPPORT_EMAIL);
        expect(legalTemplateValues().SUPPORT_EMAIL).not.toMatch(/\[.+\]/);
      } finally {
        if (prev === undefined) delete process.env.SUPPORT_EMAIL;
        else process.env.SUPPORT_EMAIL = prev;
      }
    });
  });
});
