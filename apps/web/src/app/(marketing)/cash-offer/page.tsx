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
};

export default function CashOfferPage() {
	return <CashOfferClient />;
}
