/**
 * PUBLIC CONTACT INFORMATION — the single source of truth.
 *
 * WHY A MODULE
 * ------------
 * The support contact was previously hard-coded in six places and had drifted
 * into three mailboxes (`support@`, `privacy@`, `legal@`) of which only one is
 * actually provisioned. A privacy request or legal notice sent to an
 * unmonitored alias is silently lost, so this is a compliance surface, not
 * copy.
 *
 * The duplication was the root cause, so the fix is structural: every page
 * imports from here, and `src/app/api/__tests__/contact-info.test.ts` fails if a
 * hard-coded mailbox or an unowned domain reappears anywhere in `src/`.
 *
 * Server components and the client SupportChat widget can both import this: it
 * has no server-only dependency and no `process.env` read, so there is nothing
 * to leak into the client bundle.
 */

/** The one provisioned mailbox. Receives support, privacy and legal mail. */
export const SUPPORT_EMAIL = 'roman.shumate@dealswiftautomation.com';

/** Display form. Shown to humans, so it keeps punctuation. */
export const SUPPORT_PHONE = '(502) 524-1638';

/** `tel:` target. E.164 — a tap-to-call on mobile must reach the same line. */
export const SUPPORT_PHONE_HREF = 'tel:+15025241638';

/**
 * `mailto:` href for a given address, defaulting to the canonical support
 * mailbox. Passing the address explicitly keeps the link and the visible text
 * provably in sync at every call site.
 */
export function mailtoHref(address: string = SUPPORT_EMAIL): string {
  return `mailto:${address}`;
}
