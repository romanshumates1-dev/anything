import { canonicalFor } from '@/lib/seo';
import CashOfferClient from './CashOfferClient';

/**
 * Server boundary for the cash-offer consent flow.
 *
 * The interactive form is a client component (it owns local state), and
 * `export const metadata` is a SERVER-only export in the App Router - declaring
 * it inside a 'use client' module is a build error. Keeping the metadata here
 * and the interactivity in the child is the standard split, and it means the
 * canonical URL is emitted correctly rather than silently omitted.
 */
export const metadata = {
	...canonicalFor('/cash-offer'),
  // Title + description are NOT optional here. This page previously spread
  // only the canonical, so Next.js fell back to the (marketing) layout's
  // `default` title — meaning /cash-offer shipped the IDENTICAL <title> and
  // og:title as the homepage. Two indexable URLs with the same title split
  // ranking signal and give searchers no reason to click either.
  //
  // Brand-free on purpose: the layout template is "%s — DealFlow AI", so the
  // brand is appended automatically.
  title: 'Get a Cash Offer',
  description:
    'Tell us about your property and get a no-obligation cash offer from a vetted real estate wholesaler. No repairs, no fees, no listing.',
};

export default function CashOfferPage() {
	return <CashOfferClient />;
}
