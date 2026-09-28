/**
 * The valid `category` / `channel` values for templates, derived from the live
 * Postgres enums rather than guessed:
 *
 *   template_category: cold_outreach, follow_up, closing, reengagement,
 *                      buyer_outreach, custom
 *   template_channel:  sms, email, both
 *
 * Why this exists. Both values are PostgreSQL ENUM columns, so an unrecognised
 * value is not a validation nicety - it reaches the server as
 * `invalid input value for enum "template_category"` and surfaces as a 500.
 * `GET /api/templates?category=EMAIL` did exactly that.
 *
 * A previous allowlist in `api/templates/route.ts` listed only
 * ['cold_outreach', 'follow_up'], which had the opposite problem: it rejected
 * four perfectly valid categories with a 400. Both routes now share this module,
 * so they cannot drift apart again.
 *
 * Verified against the database by `scripts/verify-sql-fixes.mjs`.
 */
export const TEMPLATE_CATEGORIES = [
  'cold_outreach',
  'follow_up',
  'closing',
  'reengagement',
  'buyer_outreach',
  'custom',
] as const;

export const TEMPLATE_CHANNELS = ['sms', 'email', 'both'] as const;

export type TemplateCategory = (typeof TEMPLATE_CATEGORIES)[number];
export type TemplateChannel = (typeof TEMPLATE_CHANNELS)[number];

export function isTemplateCategory(value: string): value is TemplateCategory {
  return (TEMPLATE_CATEGORIES as readonly string[]).includes(value);
}

export function isTemplateChannel(value: string): value is TemplateChannel {
  return (TEMPLATE_CHANNELS as readonly string[]).includes(value);
}