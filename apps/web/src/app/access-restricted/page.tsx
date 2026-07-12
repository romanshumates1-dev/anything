import Link from 'next/link';

export const metadata = {
  title: 'Access restricted — DealFlow AI',
};

/**
 * Landing page for authenticated users whose email domain is not on the
 * ALLOWED_EMAIL_DOMAINS allowlist (middleware redirects them here). Static,
 * unauthenticated-safe, and deliberately outside the middleware matcher.
 */
export default function AccessRestrictedPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="max-w-md w-full bg-white border border-gray-200 rounded-lg p-8 text-center shadow-sm">
        <h1 className="text-2xl font-semibold text-gray-900">Access restricted</h1>
        <p className="mt-3 text-gray-600">
          This platform is limited to authorized organization accounts. Your account&apos;s email
          domain is not on the access list.
        </p>
        <p className="mt-2 text-gray-600">
          If you believe this is a mistake, contact your administrator.
        </p>
        <div className="mt-6">
          <Link
            href="/account/logout"
            className="inline-block rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700"
          >
            Sign out
          </Link>
        </div>
      </div>
    </div>
  );
}
