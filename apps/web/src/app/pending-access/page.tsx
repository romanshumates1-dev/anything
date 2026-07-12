import Link from 'next/link';

export const metadata = {
  title: 'Access pending — DealFlow AI',
};

/**
 * Landing page for allowed-domain users whose role is below MIN_ACCESS_ROLE
 * (middleware redirects them here). An administrator must grant access from
 * Settings → Users. Deliberately outside the middleware matcher.
 */
export default function PendingAccessPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="max-w-md w-full bg-white border border-gray-200 rounded-lg p-8 text-center shadow-sm">
        <h1 className="text-2xl font-semibold text-gray-900">Access pending</h1>
        <p className="mt-3 text-gray-600">
          Your account was created, but it has not been granted access to the platform yet. An
          administrator needs to approve your account before you can continue.
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
