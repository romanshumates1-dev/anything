'use client';

import { useState, useEffect, useCallback } from 'react';
import { Users, MapPin, TrendingUp, Star, Activity } from 'lucide-react';

interface SignupActivity {
  location: string;
  timeAgo: string;
}

interface LiveSocialProofProps {
  /** Number of signups this week */
  signupsThisWeek?: number;
  /** Last signup location and time */
  lastSignup?: SignupActivity;
  /** Variant style */
  variant?: 'banner' | 'popup' | 'inline' | 'rotating';
  /** Fetch from API */
  fetchFromApi?: boolean;
  /** Auto-rotate testimonials */
  autoRotate?: boolean;
  /** Rotation interval in ms */
  rotationInterval?: number;
  /** Custom className */
  className?: string;
}

interface Testimonial {
  name: string;
  location: string;
  quote: string;
  result: string;
  avatar: string;
}

const DEFAULT_TESTIMONIALS: Testimonial[] = [
  {
    name: 'Marcus J.',
    location: 'Atlanta, GA',
    quote: 'Closed my first $32K deal in 6 weeks using AI negotiation.',
    result: '$32,000',
    avatar: 'MJ',
  },
  {
    name: 'Sarah C.',
    location: 'Phoenix, AZ',
    quote: 'Doubled my close rate after switching from REsimpli.',
    result: '2x close rate',
    avatar: 'SC',
  },
  {
    name: 'David W.',
    location: 'Houston, TX',
    quote: 'Went from 2 to 8 deals per month with AI automation.',
    result: '8 deals/mo',
    avatar: 'DW',
  },
  {
    name: 'Jennifer M.',
    location: 'Miami, FL',
    quote: 'First deal in 45 days as a complete beginner.',
    result: '45 days',
    avatar: 'JM',
  },
];

const SAMPLE_LOCATIONS = [
  'Austin, TX',
  'Phoenix, AZ',
  'Atlanta, GA',
  'Houston, TX',
  'Dallas, TX',
  'Miami, FL',
  'Denver, CO',
  'Seattle, WA',
  'Los Angeles, CA',
  'Chicago, IL',
];

/**
 * LiveSocialProof - Display live signup activity and social proof
 *
 * Shows real-time (or simulated) activity like:
 * - "127 wholesalers signed up this week"
 * - "Last signup: 3 minutes ago from Austin, TX"
 * - Rotating testimonials
 */
export function LiveSocialProof({
  signupsThisWeek: initialSignups = 127,
  lastSignup: initialLastSignup = { location: 'Austin, TX', timeAgo: '3 minutes ago' },
  variant = 'banner',
  fetchFromApi = false,
  autoRotate = true,
  rotationInterval = 5000,
  className = '',
}: LiveSocialProofProps) {
  const [signups, setSignups] = useState(initialSignups);
  const [lastSignup, setLastSignup] = useState(initialLastSignup);
  const [testimonialIndex, setTestimonialIndex] = useState(0);
  const [mounted, setMounted] = useState(false);
  const [showNotification, setShowNotification] = useState(false);

  useEffect(() => {
    setMounted(true);

    if (fetchFromApi) {
      fetch('/api/marketing/stats')
        .then((res) => res.json())
        .then((data) => {
          if (data.signupsThisWeek !== undefined) {
            setSignups(data.signupsThisWeek);
          }
          if (data.lastSignupLocation) {
            setLastSignup({
              location: data.lastSignupLocation,
              timeAgo: data.lastSignupTimeAgo || 'just now',
            });
          }
        })
        .catch(() => {});
    }
  }, [fetchFromApi]);

  // Rotate testimonials
  useEffect(() => {
    if (!autoRotate || !mounted) return;

    const interval = setInterval(() => {
      setTestimonialIndex((prev) => (prev + 1) % DEFAULT_TESTIMONIALS.length);
    }, rotationInterval);

    return () => clearInterval(interval);
  }, [autoRotate, rotationInterval, mounted]);

  // Show popup notification periodically
  useEffect(() => {
    if (variant !== 'popup' || !mounted) return;

    // Initial delay
    const showTimeout = setTimeout(() => {
      setShowNotification(true);

      // Auto-hide after 5 seconds
      const hideTimeout = setTimeout(() => {
        setShowNotification(false);
      }, 5000);

      return () => clearTimeout(hideTimeout);
    }, 3000);

    // Show periodically
    const interval = setInterval(() => {
      setShowNotification(true);
      setLastSignup({
        location: SAMPLE_LOCATIONS[Math.floor(Math.random() * SAMPLE_LOCATIONS.length)],
        timeAgo: 'just now',
      });

      setTimeout(() => {
        setShowNotification(false);
      }, 5000);
    }, 30000);

    return () => {
      clearTimeout(showTimeout);
      clearInterval(interval);
    };
  }, [variant, mounted]);

  if (!mounted) return null;

  const currentTestimonial = DEFAULT_TESTIMONIALS[testimonialIndex];

  if (variant === 'popup') {
    if (!showNotification) return null;

    return (
      <div
        className={`fixed bottom-4 left-4 z-50 bg-white dark:bg-[#1E293B] border border-gray-200 dark:border-white/10 rounded-xl shadow-xl p-4 max-w-xs animate-slide-up ${className}`}
        role="status"
        aria-live="polite"
      >
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-full bg-emerald-100 dark:bg-emerald-500/10">
            <Users className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-medium text-gray-900 dark:text-white">New signup!</p>
            <p className="text-xs text-gray-500 dark:text-slate-400 flex items-center gap-1 mt-0.5">
              <MapPin className="h-3 w-3" />
              {lastSignup.location}
              <span className="mx-1 text-gray-300 dark:text-slate-600">|</span>
              {lastSignup.timeAgo}
            </p>
          </div>
          <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
        </div>
      </div>
    );
  }

  if (variant === 'inline') {
    return (
      <div
        className={`flex flex-wrap items-center gap-4 text-sm ${className}`}
        role="status"
        aria-live="polite"
      >
        <div className="flex items-center gap-2 text-slate-400">
          <Activity className="h-4 w-4 text-emerald-400" />
          <span>
            <span className="font-semibold text-white">{signups}</span> signed up this week
          </span>
        </div>
        <div className="hidden sm:block h-4 w-px bg-white/10" />
        <div className="flex items-center gap-2 text-slate-400">
          <MapPin className="h-4 w-4 text-[#3B82F6]" />
          <span>
            Last signup: <span className="text-white">{lastSignup.timeAgo}</span> from{' '}
            <span className="text-white">{lastSignup.location}</span>
          </span>
        </div>
      </div>
    );
  }

  if (variant === 'rotating') {
    return (
      <div className={`relative overflow-hidden ${className}`}>
        <div className="flex items-center justify-center gap-3 py-3 bg-[#1E293B]/50 border-y border-white/5">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[#3B82F6] to-[#8B5CF6] flex items-center justify-center text-white text-xs font-bold">
              {currentTestimonial.avatar}
            </div>
            <div className="flex items-center gap-1">
              {[...Array(5)].map((_, i) => (
                <Star key={i} className="h-3 w-3 fill-amber-400 text-amber-400" />
              ))}
            </div>
          </div>
          <p className="text-sm text-slate-300 max-w-md">
            "{currentTestimonial.quote}"
          </p>
          <div className="text-right hidden sm:block">
            <p className="text-xs text-white font-medium">{currentTestimonial.name}</p>
            <p className="text-xs text-slate-500">{currentTestimonial.location}</p>
          </div>
          <span className="text-sm font-bold text-emerald-400 ml-2">
            {currentTestimonial.result}
          </span>
        </div>
      </div>
    );
  }

  // Default: banner variant
  return (
    <div
      className={`bg-[#1E293B]/50 border-y border-white/5 py-3 px-4 ${className}`}
      role="status"
      aria-live="polite"
    >
      <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-center gap-4 sm:gap-8 text-sm">
        <div className="flex items-center gap-2 text-slate-400">
          <TrendingUp className="h-4 w-4 text-emerald-400" />
          <span>
            <span className="font-semibold text-white">{signups}</span> wholesalers signed up this
            week
          </span>
        </div>
        <div className="hidden sm:block h-4 w-px bg-white/10" />
        <div className="flex items-center gap-2 text-slate-400">
          <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          <span>
            Last signup: <span className="text-white">{lastSignup.timeAgo}</span> from{' '}
            <span className="text-white">{lastSignup.location}</span>
          </span>
        </div>
      </div>
    </div>
  );
}

/**
 * SignupCounter - Animated counter for total signups
 */
interface SignupCounterProps {
  count: number;
  label?: string;
  className?: string;
  fetchFromApi?: boolean;
}

export function SignupCounter({
  count: initialCount,
  label = 'wholesalers this week',
  className = '',
  fetchFromApi = false,
}: SignupCounterProps) {
  const [count, setCount] = useState(initialCount);
  const [displayCount, setDisplayCount] = useState(0);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);

    if (fetchFromApi) {
      fetch('/api/marketing/stats')
        .then((res) => res.json())
        .then((data) => {
          if (data.signupsThisWeek !== undefined) {
            setCount(data.signupsThisWeek);
          }
        })
        .catch(() => {});
    }
  }, [fetchFromApi]);

  // Animate count up
  useEffect(() => {
    if (!mounted) return;

    const duration = 1500;
    const steps = 30;
    const increment = count / steps;
    let current = 0;

    const timer = setInterval(() => {
      current += increment;
      if (current >= count) {
        setDisplayCount(count);
        clearInterval(timer);
      } else {
        setDisplayCount(Math.floor(current));
      }
    }, duration / steps);

    return () => clearInterval(timer);
  }, [count, mounted]);

  if (!mounted) return null;

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <Users className="h-5 w-5 text-[#3B82F6]" />
      <span className="text-2xl font-bold text-white">{displayCount}</span>
      <span className="text-slate-400">{label}</span>
    </div>
  );
}
