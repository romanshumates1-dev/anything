'use client';

import { useState, useEffect } from 'react';
import { setCookie, getCookie } from '@/lib/cookies';

const COOKIE_CONSENT_KEY = 'cookie-consent';

export type CookieConsent = 'accepted' | 'rejected';

export function CookieConsentBanner() {
  const [showBanner, setShowBanner] = useState(false);

  useEffect(() => {
    const consent = getCookie(COOKIE_CONSENT_KEY);
    if (!consent) {
      setShowBanner(true);
    }
  }, []);

  const handleConsent = (choice: CookieConsent) => {
    setCookie(COOKIE_CONSENT_KEY, choice, 365); // 1 year
    setShowBanner(false);
  };

  if (!showBanner) return null;

  return (
    <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 shadow-lg p-4 z-50">
      <div className="mx-auto max-w-7xl flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="text-sm text-gray-600">
          <p>
            We use cookies to improve your experience and for analytics. 
            Read our <a href="/legal/cookies" className="text-blue-600 hover:underline">Cookie Policy</a>.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => handleConsent('rejected')}
            className="px-4 py-1.5 text-sm rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50"
          >
            Decline non-essential
          </button>
          <button
            onClick={() => handleConsent('accepted')}
            className="px-4 py-1.5 text-sm rounded-md bg-blue-600 text-white hover:bg-blue-700"
          >
            Accept all
          </button>
        </div>
      </div>
    </div>
  );
}