import Link from 'next/link';

interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description: string;
  action?: {
    label: string;
    href: string;
  };
  secondaryAction?: {
    label: string;
    href: string;
  };
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  secondaryAction,
}: EmptyStateProps) {
  return (
    <div className="text-center py-12 px-4">
      {icon && (
        <div className="mx-auto h-12 w-12 text-[var(--text-muted)] mb-4">{icon}</div>
      )}
      <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-1">{title}</h3>
      <p className="text-sm text-[var(--text-muted)] mb-6 max-w-sm mx-auto">
        {description}
      </p>
      {action && (
        <Link
          href={action.href}
          className="btn-gradient inline-flex items-center px-4 py-2 text-sm font-medium rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[var(--accent-blue)]"
        >
          {action.label}
        </Link>
      )}
      {secondaryAction && (
        <Link
          href={secondaryAction.href}
          className="block mt-3 text-sm text-[var(--text-muted)] hover:text-[var(--text-primary)]"
        >
          {secondaryAction.label}
        </Link>
      )}
    </div>
  );
}
