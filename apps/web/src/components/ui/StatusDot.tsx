import { cn } from '@/lib/utils';

type StatusType = 'success' | 'warning' | 'error' | 'info' | 'neutral';

interface StatusDotProps {
  status: StatusType;
  size?: 'sm' | 'md' | 'lg';
  pulse?: boolean;
  className?: string;
}

const statusStyles: Record<StatusType, string> = {
  success: 'status-dot-success',
  warning: 'status-dot-warning',
  error: 'status-dot-error',
  info: 'bg-[var(--color-info)] shadow-[0_0_8px_rgba(6,182,212,0.5)]',
  neutral: 'bg-[var(--text-muted)]',
};

const sizeStyles = {
  sm: 'w-2 h-2',
  md: 'w-2.5 h-2.5',
  lg: 'w-3 h-3',
};

export function StatusDot({
  status,
  size = 'md',
  pulse = false,
  className,
}: StatusDotProps) {
  return (
    <span
      className={cn(
        'status-dot inline-block rounded-full',
        statusStyles[status],
        sizeStyles[size],
        pulse && 'animate-pulse',
        className
      )}
    />
  );
}
