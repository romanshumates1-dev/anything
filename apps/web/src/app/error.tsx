'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const router = useRouter();

  useEffect(() => {
    // Log to console for debugging (matches existing error patterns)
    console.error('[ErrorBoundary] App error:', error);
  }, [error]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-md space-y-6 text-center">
        <div className="mx-auto w-20 h-20 rounded-full bg-red-100 flex items-center justify-center">
          <svg
            width="32"
            height="32"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-red-600"
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
        </div>

        <h1 className="text-3xl font-semibold text-gray-900">Something went wrong</h1>

        <p className="text-gray-600">
          We're sorry, but an unexpected error occurred. This has been logged and we'll look into it.
        </p>

        <div className="flex flex-col sm:flex-row gap-3 justify-center pt-4">
          <button
            onClick={reset}
            className="px-6 py-2 bg-emerald-600 text-white rounded-md hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-500"
          >
            Try again
          </button>
          <button
            onClick={() => router.push('/dashboard')}
            className="px-6 py-2 bg-gray-200 text-gray-800 rounded-md hover:bg-gray-300 focus:outline-none focus:ring-2 focus:ring-gray-500"
          >
            Go to Dashboard
          </button>
        </div>

        {process.env.NODE_ENV === 'development' && (
          <details className="mt-6 text-left">
            <summary className="cursor-pointer text-sm text-gray-500 hover:text-gray-700">
              Error details (dev only)
            </summary>
            <pre className="mt-2 text-xs bg-gray-100 p-3 rounded overflow-auto">
              {error.message}
              {error.digest && '\nDigest: ' + error.digest}
            </pre>
          </details>
        )}
      </div>
    </div>
  );
}