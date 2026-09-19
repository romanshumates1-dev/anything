'use client';

import { useState, useEffect, useCallback } from 'react';
import { Gift, Clock, Timer, ArrowRight, Sparkles } from 'lucide-react';
import Link from 'next/link';

interface TimeLeft {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
}

interface LimitedTimeOfferProps {
  /** Offer end date */
  endDate: Date;
  /** Discount percentage */
  discount?: number;
  /** Offer headline */
  headline?: string;
  /** Description text */
  description?: string;
  /** CTA button text */
  ctaText?: string;
  /** CTA link */
  ctaHref?: string;
  /** Promo code to display */
  promoCode?: string;
  /** Variant style */
  variant?: 'banner' | 'card' | 'inline' | 'floating';
  /** Custom className */
  className?: string;
  /** Fetch end date from API */
  fetchFromApi?: boolean;
  /** Callback when offer expires */
  onExpire?: () => void;
}

/**
 * LimitedTimeOffer - Countdown timer for limited-time promotions
 *
 * Displays a countdown timer with days, hours, minutes, and seconds
 * Automatically hides or calls onExpire when the offer ends
 */
export function LimitedTimeOffer({
  endDate: initialEndDate,
  discount = 50,
  headline = `Limited Time: ${discount}% off first month`,
  description = 'Lock in early adopter pricing before it expires',
  ctaText = 'Claim Offer',
  ctaHref = '/account/signup',
  promoCode,
  variant = 'card',
  className = '',
  fetchFromApi = false,
  onExpire,
}: LimitedTimeOfferProps) {
  const [endDate, setEndDate] = useState(initialEndDate);
  const [timeLeft, setTimeLeft] = useState<TimeLeft>({ days: 0, hours: 0, minutes: 0, seconds: 0 });
  const [mounted, setMounted] = useState(false);
  const [expired, setExpired] = useState(false);

  const calculateTimeLeft = useCallback((end: Date): TimeLeft => {
    const now = new Date();
    const diff = end.getTime() - now.getTime();

    if (diff <= 0) {
      return { days: 0, hours: 0, minutes: 0, seconds: 0 };
    }

    return {
      days: Math.floor(diff / (1000 * 60 * 60 * 24)),
      hours: Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60)),
      minutes: Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60)),
      seconds: Math.floor((diff % (1000 * 60)) / 1000),
    };
  }, []);

  useEffect(() => {
    setMounted(true);

    if (fetchFromApi) {
      fetch('/api/marketing/stats')
        .then((res) => res.json())
        .then((data) => {
          if (data.promoEndDate) {
            setEndDate(new Date(data.promoEndDate));
          }
        })
        .catch(() => {});
    }
  }, [fetchFromApi]);

  useEffect(() => {
    if (!mounted) return;

    const updateTimer = () => {
      const newTimeLeft = calculateTimeLeft(endDate);
      setTimeLeft(newTimeLeft);

      if (
        newTimeLeft.days === 0 &&
        newTimeLeft.hours === 0 &&
        newTimeLeft.minutes === 0 &&
        newTimeLeft.seconds === 0
      ) {
        setExpired(true);
        onExpire?.();
      }
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);

    return () => clearInterval(interval);
  }, [mounted, endDate, calculateTimeLeft, onExpire]);

  if (!mounted || expired) return null;

  const TimeUnit = ({ value, label }: { value: number; label: string }) => (
    <div className="text-center">
      <div className="bg-white/10 backdrop-blur-sm rounded-lg px-3 py-2 min-w-[3.5rem]">
        <span className="text-2xl font-bold text-white font-mono">
          {String(value).padStart(2, '0')}
        </span>
      </div>
      <span className="text-xs text-slate-400 uppercase mt-1 block">{label}</span>
    </div>
  );

  const TimerDisplay = ({ compact = false }: { compact?: boolean }) => (
    <div className={`flex items-center gap-2 ${compact ? 'scale-75' : ''}`}>
      <TimeUnit value={timeLeft.days} label="Days" />
      <span className="text-xl text-white/50 font-bold">:</span>
      <TimeUnit value={timeLeft.hours} label="Hours" />
      <span className="text-xl text-white/50 font-bold">:</span>
      <TimeUnit value={timeLeft.minutes} label="Mins" />
      <span className="text-xl text-white/50 font-bold">:</span>
      <TimeUnit value={timeLeft.seconds} label="Secs" />
    </div>
  );

  if (variant === 'banner') {
    return (
      <div
        className={`bg-gradient-to-r from-[#3B82F6] to-[#8B5CF6] text-white py-4 px-4 ${className}`}
      >
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Gift className="h-5 w-5 text-yellow-300" />
            <span className="font-semibold">{headline}</span>
            {promoCode && (
              <span className="bg-white/20 px-2 py-0.5 rounded text-sm font-mono">
                {promoCode}
              </span>
            )}
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1 text-sm">
              <Clock className="h-4 w-4" />
              <span>
                {timeLeft.days}d {timeLeft.hours}h {timeLeft.minutes}m {timeLeft.seconds}s
              </span>
            </div>
            <Link
              href={ctaHref}
              className="bg-white text-[#3B82F6] px-4 py-1.5 rounded-lg text-sm font-semibold hover:bg-white/90 transition-colors"
            >
              {ctaText}
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (variant === 'inline') {
    return (
      <div
        className={`inline-flex items-center gap-3 px-4 py-2 rounded-lg bg-gradient-to-r from-[#3B82F6]/10 to-[#8B5CF6]/10 border border-[#3B82F6]/20 ${className}`}
      >
        <Timer className="h-4 w-4 text-[#3B82F6]" />
        <span className="text-sm text-white font-medium">
          Offer expires in{' '}
          <span className="font-mono text-[#3B82F6]">
            {timeLeft.days}d {timeLeft.hours}h {timeLeft.minutes}m
          </span>
        </span>
      </div>
    );
  }

  if (variant === 'floating') {
    return (
      <div
        className={`fixed bottom-4 right-4 z-50 bg-[#1E293B] border border-white/10 rounded-2xl shadow-2xl p-4 max-w-sm ${className}`}
      >
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-lg bg-gradient-to-br from-[#3B82F6] to-[#8B5CF6]">
            <Sparkles className="h-5 w-5 text-white" />
          </div>
          <div className="flex-1">
            <p className="font-semibold text-white text-sm">{headline}</p>
            <div className="flex items-center gap-1 mt-1 text-xs text-slate-400">
              <Clock className="h-3 w-3" />
              <span>
                Ends in {timeLeft.days}d {timeLeft.hours}h {timeLeft.minutes}m
              </span>
            </div>
            <Link
              href={ctaHref}
              className="inline-flex items-center gap-1 mt-2 text-sm text-[#3B82F6] font-medium hover:text-[#60A5FA]"
            >
              {ctaText}
              <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // Default: card variant
  return (
    <div
      className={`rounded-2xl border border-white/10 bg-gradient-to-br from-[#1E293B] to-[#0F172A] p-6 ${className}`}
    >
      <div className="text-center mb-6">
        <div className="inline-flex items-center gap-2 bg-amber-500/10 text-amber-400 px-3 py-1 rounded-full text-sm font-medium mb-4">
          <Gift className="h-4 w-4" />
          {discount}% OFF
        </div>
        <h3 className="text-xl font-bold text-white mb-2">{headline}</h3>
        <p className="text-slate-400 text-sm">{description}</p>
      </div>

      <div className="flex justify-center mb-6">
        <TimerDisplay />
      </div>

      {promoCode && (
        <div className="text-center mb-4">
          <p className="text-xs text-slate-500 mb-1">Use code at checkout:</p>
          <div className="inline-block bg-white/5 border border-white/10 rounded-lg px-4 py-2">
            <span className="font-mono font-bold text-[#3B82F6] text-lg">{promoCode}</span>
          </div>
        </div>
      )}

      <Link
        href={ctaHref}
        className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-[#3B82F6] to-[#8B5CF6] text-white px-6 py-3 rounded-lg font-semibold hover:opacity-90 transition-opacity"
      >
        {ctaText}
        <ArrowRight className="h-4 w-4" />
      </Link>
    </div>
  );
}

/**
 * SimpleCountdown - Minimal countdown display
 */
interface SimpleCountdownProps {
  endDate: Date;
  className?: string;
  fetchFromApi?: boolean;
}

export function SimpleCountdown({
  endDate: initialEndDate,
  className = '',
  fetchFromApi = false,
}: SimpleCountdownProps) {
  const [endDate, setEndDate] = useState(initialEndDate);
  const [mounted, setMounted] = useState(false);
  const [timeLeft, setTimeLeft] = useState('');

  useEffect(() => {
    setMounted(true);

    if (fetchFromApi) {
      fetch('/api/marketing/stats')
        .then((res) => res.json())
        .then((data) => {
          if (data.promoEndDate) {
            setEndDate(new Date(data.promoEndDate));
          }
        })
        .catch(() => {});
    }
  }, [fetchFromApi]);

  useEffect(() => {
    if (!mounted) return;

    const update = () => {
      const now = new Date();
      const diff = endDate.getTime() - now.getTime();

      if (diff <= 0) {
        setTimeLeft('Expired');
        return;
      }

      const days = Math.floor(diff / (1000 * 60 * 60 * 24));
      const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

      if (days > 0) {
        setTimeLeft(`${days}d ${hours}h ${minutes}m`);
      } else if (hours > 0) {
        setTimeLeft(`${hours}h ${minutes}m`);
      } else {
        const seconds = Math.floor((diff % (1000 * 60)) / 1000);
        setTimeLeft(`${minutes}m ${seconds}s`);
      }
    };

    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [mounted, endDate]);

  if (!mounted) return null;

  return (
    <span className={`font-mono font-medium ${className}`}>
      {timeLeft}
    </span>
  );
}
