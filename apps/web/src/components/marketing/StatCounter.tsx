'use client';

import { useEffect, useState, useRef } from 'react';
import { TrendingUp, Users, DollarSign, MessageSquare, Clock, Target } from 'lucide-react';

type IconType = 'users' | 'deals' | 'revenue' | 'messages' | 'time' | 'target';

interface StatCounterProps {
  value: number;
  label: string;
  prefix?: string;
  suffix?: string;
  icon?: IconType;
  animated?: boolean;
  duration?: number;
  variant?: 'default' | 'compact' | 'large';
  className?: string;
}

const ICONS: Record<IconType, React.ComponentType<{ className?: string }>> = {
  users: Users,
  deals: Target,
  revenue: DollarSign,
  messages: MessageSquare,
  time: Clock,
  target: TrendingUp,
};

/**
 * StatCounter - Displays an animated counter with real statistics
 *
 * Ethical guidelines:
 * - Only display real, verifiable numbers
 * - Use prefix "800+" instead of exact fake counts
 * - Update from API when available
 */
export function StatCounter({
  value,
  label,
  prefix = '',
  suffix = '',
  icon,
  animated = true,
  duration = 2000,
  variant = 'default',
  className = '',
}: StatCounterProps) {
  const [displayValue, setDisplayValue] = useState(animated ? 0 : value);
  const [hasAnimated, setHasAnimated] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!animated || hasAnimated) {
      setDisplayValue(value);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !hasAnimated) {
          setHasAnimated(true);
          const startTime = Date.now();
          const animate = () => {
            const elapsed = Date.now() - startTime;
            const progress = Math.min(elapsed / duration, 1);
            // Ease-out curve for natural feel
            const easeOut = 1 - Math.pow(1 - progress, 3);
            setDisplayValue(Math.floor(easeOut * value));
            if (progress < 1) {
              requestAnimationFrame(animate);
            }
          };
          requestAnimationFrame(animate);
        }
      },
      { threshold: 0.1 }
    );

    if (ref.current) {
      observer.observe(ref.current);
    }

    return () => observer.disconnect();
  }, [animated, duration, hasAnimated, value]);

  const Icon = icon ? ICONS[icon] : null;

  const formatNumber = (num: number) => {
    if (num >= 1000000) {
      return (num / 1000000).toFixed(1) + 'M';
    }
    if (num >= 1000) {
      return (num / 1000).toFixed(1) + 'K';
    }
    return num.toLocaleString();
  };

  const variants = {
    default: {
      container: 'text-center',
      value: 'text-3xl sm:text-4xl font-bold text-white',
      label: 'text-sm text-slate-400 mt-1',
      icon: 'h-6 w-6 text-[#3B82F6] mx-auto mb-2',
    },
    compact: {
      container: 'text-center',
      value: 'text-2xl font-bold text-white',
      label: 'text-xs text-slate-500 mt-0.5',
      icon: 'h-5 w-5 text-[#3B82F6] mx-auto mb-1',
    },
    large: {
      container: 'text-center',
      value: 'text-4xl sm:text-5xl font-bold text-white',
      label: 'text-base text-slate-400 mt-2',
      icon: 'h-8 w-8 text-[#3B82F6] mx-auto mb-3',
    },
  };

  const styles = variants[variant];

  return (
    <div ref={ref} className={`${styles.container} ${className}`}>
      {Icon && <Icon className={styles.icon} />}
      <div className={styles.value}>
        {prefix}
        {formatNumber(displayValue)}
        {suffix}
      </div>
      <div className={styles.label}>{label}</div>
    </div>
  );
}

/**
 * StatCounterGrid - Display multiple stats in a responsive grid
 */
interface StatItem {
  value: number;
  label: string;
  prefix?: string;
  suffix?: string;
  icon?: IconType;
}

interface StatCounterGridProps {
  stats: StatItem[];
  columns?: 2 | 3 | 4;
  variant?: 'default' | 'compact' | 'large';
  className?: string;
}

export function StatCounterGrid({
  stats,
  columns = 4,
  variant = 'default',
  className = '',
}: StatCounterGridProps) {
  const gridCols = {
    2: 'grid-cols-2',
    3: 'grid-cols-3',
    4: 'grid-cols-2 md:grid-cols-4',
  };

  return (
    <div className={`grid ${gridCols[columns]} gap-6 ${className}`}>
      {stats.map((stat, i) => (
        <StatCounter key={i} {...stat} variant={variant} />
      ))}
    </div>
  );
}
