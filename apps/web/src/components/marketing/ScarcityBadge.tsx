'use client';

import { useState, useEffect, useCallback } from 'react';
import { AlertTriangle, Users, Zap, Clock } from 'lucide-react';

type UrgencyLevel = 'low' | 'medium' | 'high';

interface ScarcityBadgeProps {
  /** Number of spots remaining */
  spotsRemaining: number;
  /** Message template - use {spots} as placeholder */
  messageTemplate?: string;
  /** Size variant */
  size?: 'sm' | 'md' | 'lg';
  /** Whether to show pulsing animation */
  animated?: boolean;
  /** Custom className */
  className?: string;
  /** Fetch from API instead of using provided value */
  fetchFromApi?: boolean;
}

/**
 * ScarcityBadge - Display spots remaining with urgency levels
 *
 * Urgency levels based on spots remaining:
 * - green (low urgency): > 100 spots
 * - yellow (medium urgency): 50-100 spots
 * - red (high urgency): < 50 spots
 */
export function ScarcityBadge({
  spotsRemaining: initialSpots,
  messageTemplate = 'Only {spots} spots remaining at this price!',
  size = 'md',
  animated = true,
  className = '',
  fetchFromApi = false,
}: ScarcityBadgeProps) {
  const [spots, setSpots] = useState(initialSpots);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);

    if (fetchFromApi) {
      fetch('/api/marketing/stats')
        .then((res) => res.json())
        .then((data) => {
          if (data.spotsRemaining !== undefined) {
            setSpots(data.spotsRemaining);
          }
        })
        .catch(() => {
          // Keep initial value on error
        });
    }
  }, [fetchFromApi]);

  const getUrgencyLevel = useCallback((count: number): UrgencyLevel => {
    if (count < 50) return 'high';
    if (count <= 100) return 'medium';
    return 'low';
  }, []);

  const urgency = getUrgencyLevel(spots);

  const urgencyStyles = {
    low: {
      bg: 'bg-emerald-500/10',
      border: 'border-emerald-500/20',
      text: 'text-emerald-400',
      icon: Users,
      pulse: 'bg-emerald-400',
    },
    medium: {
      bg: 'bg-amber-500/10',
      border: 'border-amber-500/20',
      text: 'text-amber-400',
      icon: Clock,
      pulse: 'bg-amber-400',
    },
    high: {
      bg: 'bg-red-500/10',
      border: 'border-red-500/20',
      text: 'text-red-400',
      icon: AlertTriangle,
      pulse: 'bg-red-400',
    },
  };

  const sizeStyles = {
    sm: 'px-2.5 py-1 text-xs gap-1.5',
    md: 'px-3 py-1.5 text-sm gap-2',
    lg: 'px-4 py-2 text-base gap-2.5',
  };

  const iconSizes = {
    sm: 'h-3.5 w-3.5',
    md: 'h-4 w-4',
    lg: 'h-5 w-5',
  };

  const pulseSizes = {
    sm: 'h-1.5 w-1.5',
    md: 'h-2 w-2',
    lg: 'h-2.5 w-2.5',
  };

  const styles = urgencyStyles[urgency];
  const Icon = styles.icon;
  const message = messageTemplate.replace('{spots}', spots.toLocaleString());

  if (!mounted) {
    return null;
  }

  return (
    <div
      className={`inline-flex items-center rounded-full border ${styles.bg} ${styles.border} ${sizeStyles[size]} ${className}`}
      role="status"
      aria-live="polite"
    >
      {animated && (
        <span className={`${pulseSizes[size]} rounded-full ${styles.pulse} animate-pulse`} />
      )}
      <Icon className={`${iconSizes[size]} ${styles.text}`} />
      <span className={`font-medium ${styles.text}`}>{message}</span>
    </div>
  );
}

/**
 * ScarcityBar - Progress bar variant showing spots claimed
 */
interface ScarcityBarProps {
  spotsRemaining: number;
  totalSpots?: number;
  className?: string;
  showPercentage?: boolean;
  fetchFromApi?: boolean;
}

export function ScarcityBar({
  spotsRemaining: initialSpots,
  totalSpots = 1000,
  className = '',
  showPercentage = true,
  fetchFromApi = false,
}: ScarcityBarProps) {
  const [spots, setSpots] = useState(initialSpots);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);

    if (fetchFromApi) {
      fetch('/api/marketing/stats')
        .then((res) => res.json())
        .then((data) => {
          if (data.spotsRemaining !== undefined) {
            setSpots(data.spotsRemaining);
          }
        })
        .catch(() => {});
    }
  }, [fetchFromApi]);

  const percentClaimed = Math.round(((totalSpots - spots) / totalSpots) * 100);
  const percentRemaining = 100 - percentClaimed;

  const getBarColor = () => {
    if (spots < 50) return 'from-red-500 to-orange-500';
    if (spots <= 100) return 'from-amber-500 to-yellow-500';
    return 'from-emerald-500 to-teal-500';
  };

  if (!mounted) return null;

  return (
    <div className={`w-full ${className}`}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Zap className="h-4 w-4 text-amber-400" />
          <span className="text-sm font-medium text-white">
            {spots.toLocaleString()} spots remaining
          </span>
        </div>
        {showPercentage && (
          <span className="text-xs text-slate-500">{percentClaimed}% claimed</span>
        )}
      </div>
      <div className="h-2.5 bg-[#1E293B] rounded-full overflow-hidden">
        <div
          className={`h-full bg-gradient-to-r ${getBarColor()} rounded-full transition-all duration-500`}
          style={{ width: `${percentRemaining}%` }}
        />
      </div>
      <p className="mt-2 text-xs text-slate-500">
        Join now to lock in early adopter pricing before spots fill up
      </p>
    </div>
  );
}
