'use client';

import { useState, useEffect } from 'react';
import { Clock, X, Zap } from 'lucide-react';

interface UrgencyBannerProps {
  variant?: 'spots' | 'timer' | 'deal';
  spotsRemaining?: number;
  dealEndDate?: Date;
  discount?: number;
  dismissible?: boolean;
}

export function UrgencyBanner({
  variant = 'spots',
  spotsRemaining = 847,
  dealEndDate,
  discount = 50,
  dismissible = true,
}: UrgencyBannerProps) {
  const [dismissed, setDismissed] = useState(false);
  const [timeLeft, setTimeLeft] = useState({ hours: 0, minutes: 0, seconds: 0 });
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);

    if (variant === 'timer' && dealEndDate) {
      const updateTimer = () => {
        const now = new Date();
        const diff = dealEndDate.getTime() - now.getTime();

        if (diff <= 0) {
          setTimeLeft({ hours: 0, minutes: 0, seconds: 0 });
          return;
        }

        const hours = Math.floor(diff / (1000 * 60 * 60));
        const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
        const seconds = Math.floor((diff % (1000 * 60)) / 1000);

        setTimeLeft({ hours, minutes, seconds });
      };

      updateTimer();
      const interval = setInterval(updateTimer, 1000);
      return () => clearInterval(interval);
    }
  }, [variant, dealEndDate]);

  if (dismissed || !mounted) return null;

  const bannerContent = {
    spots: (
      <>
        <Zap className="h-4 w-4 text-yellow-300" />
        <span className="font-semibold">{discount}% OFF Launch Pricing</span>
        <span className="mx-2 hidden sm:inline">|</span>
        <span className="opacity-90">
          Only <span className="font-bold">{spotsRemaining}</span> spots left at this price
        </span>
        <Clock className="h-4 w-4 ml-1 animate-pulse" />
      </>
    ),
    timer: (
      <>
        <span className="font-semibold">{discount}% OFF ends in:</span>
        <div className="flex items-center gap-1 mx-2 font-mono">
          <span className="bg-white/20 px-2 py-0.5 rounded">{String(timeLeft.hours).padStart(2, '0')}</span>:
          <span className="bg-white/20 px-2 py-0.5 rounded">{String(timeLeft.minutes).padStart(2, '0')}</span>:
          <span className="bg-white/20 px-2 py-0.5 rounded">{String(timeLeft.seconds).padStart(2, '0')}</span>
        </div>
        <span className="text-yellow-200 hidden sm:inline">Don't miss out!</span>
      </>
    ),
    deal: (
      <>
        <span className="bg-yellow-400 text-yellow-900 text-xs font-bold px-2 py-0.5 rounded-full mr-2">
          FLASH SALE
        </span>
        <span className="font-semibold">{discount}% OFF all plans</span>
        <span className="mx-2">|</span>
        <span className="opacity-90">Use code: <span className="font-mono font-bold">LAUNCH50</span></span>
      </>
    ),
  };

  return (
    <div className="bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 text-white py-3 px-4 text-center text-sm relative">
      <div className="flex items-center justify-center flex-wrap gap-1">
        {bannerContent[variant]}
      </div>
      {dismissible && (
        <button
          onClick={() => setDismissed(true)}
          className="absolute right-4 top-1/2 -translate-y-1/2 text-white/70 hover:text-white"
          aria-label="Dismiss"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
