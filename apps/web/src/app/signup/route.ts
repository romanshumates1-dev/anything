/**
 * LEGACY SIGNUP URL REDIRECT — /signup -> /account/signup
 *
 * Why this exists (found during the final acceptance audit, 2026-10-04):
 * `GET /api/referrals` hands every user a shareable referral link of the form
 * `${baseUrl}/signup?ref=CODE`, but the signup page lives at
 * `/account/signup` and there is no `src/app/signup` page. The live domain
 * therefore answered **404** for every shared referral link, which made
 * referral attribution impossible end-to-end.
 *
 * This route fixes the already-shared links: it 307-redirects /signup to
 * /account/signup while PRESERVING the query string (?ref=...), so any link
 * that is already "in the wild" starts working without asking anyone to
 * re-share. The generator itself now emits /account/signup directly (see
 * `src/app/api/referrals/route.ts`), and a source-level integrity test pins
 * both halves of the contract.
 *
 * 307 (Temporary Redirect) preserves the method and is safe for a GET link
 * that may arrive with any query parameters.
 */
import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const target = new URL('/account/signup', requestUrl.origin);
  // Preserve ?ref=CODE and any other parameters (callbackUrl, plan, ...) so
  // the landing page keeps its full attribution and intent context.
  target.search = requestUrl.search;
  return NextResponse.redirect(target, 307);
}
