import { cn } from '@/lib/utils';

type StatusVariant = 'success' | 'warning' | 'error' | 'info' | 'neutral';

interface StatusPillProps {
  variant: StatusVariant;
  children: React.ReactNode;
  size?: 'sm' | 'md';
}

const variantStyles: Record<StatusVariant, string> = {
  success: 'bg-[var(--color-success)]/10 text-[var(--color-success)]',
  warning: 'bg-[var(--color-warning)]/10 text-[var(--color-warning)]',
  error: 'bg-[var(--color-error)]/10 text-[var(--color-error)]',
  info: 'bg-[var(--color-info)]/10 text-[var(--color-info)]',
  neutral: 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)]',
};

const sizeStyles = {
  sm: 'px-2 py-0.5 text-xs',
  md: 'px-2.5 py-1 text-sm',
};

export function StatusPill({
  variant,
  children,
  size = 'sm',
}: StatusPillProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center font-medium rounded-full',
        variantStyles[variant],
        sizeStyles[size]
      )}
    >
      {children}
    </span>
  );
}
