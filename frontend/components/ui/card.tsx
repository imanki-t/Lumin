import { cn } from '@/lib/utils';

type BadgeVariant = 'default' | 'success' | 'error' | 'warning' | 'info' | 'accent';

interface BadgeProps {
  variant?: BadgeVariant;
  children: React.ReactNode;
  className?: string;
}

const badgeVariants: Record<BadgeVariant, string> = {
  default: 'bg-[var(--gray-2)] text-[var(--fg-2)]',
  success: 'bg-[var(--success-bg)] text-[var(--success)]',
  error:   'bg-[var(--error-bg)] text-[var(--error)]',
  warning: 'bg-[var(--warning-bg)] text-[var(--warning)]',
  info:    'bg-[var(--info-bg)] text-[var(--info)]',
  accent:  'bg-[var(--accent-bg)] text-[var(--accent)]',
};

export function Badge({ variant = 'default', children, className }: BadgeProps) {
  return (
    <span className={cn(
      'inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium tracking-wide',
      badgeVariants[variant],
      className
    )}>
      {children}
    </span>
  );
}

interface CardProps {
  children: React.ReactNode;
  className?: string;
  title?: string;
  description?: string;
  action?: React.ReactNode;
}

export function Card({ children, className, title, description, action }: CardProps) {
  return (
    <div className={cn(
      'rounded-lg border border-[var(--border)] bg-[var(--bg-2)]',
      'dark:bg-[var(--gray-1)]',
      className
    )}>
      {(title || action) && (
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-[var(--border)]">
          <div>
            {title && <h3 className="text-label-13 font-semibold text-[var(--fg)]">{title}</h3>}
            {description && <p className="text-xs text-[var(--fg-3)] mt-0.5">{description}</p>}
          </div>
          {action && <div className="flex items-center gap-2 shrink-0">{action}</div>}
        </div>
      )}
      <div className={cn('p-4', !title && !action && 'pt-4')}>
        {children}
      </div>
    </div>
  );
}

export function PageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 mb-6">
      <div>
        <h1 className="text-heading-20 text-[var(--fg)]">{title}</h1>
        {description && (
          <p className="text-copy-13 text-[var(--fg-2)] mt-1">{description}</p>
        )}
      </div>
      {action && <div className="flex items-center gap-2 shrink-0">{action}</div>}
    </div>
  );
}

export function StatCard({
  label,
  value,
  sub,
  icon,
  bar,
  barColor = 'accent',
}: {
  label: string;
  value: string;
  sub?: string;
  icon?: React.ReactNode;
  bar?: number;
  barColor?: 'accent' | 'success' | 'warning' | 'error';
}) {
  const barColors = {
    accent: 'bg-[var(--accent)]',
    success: 'bg-[var(--success)]',
    warning: 'bg-[var(--warning)]',
    error: 'bg-[var(--error)]',
  };

  return (
    <div className="relative overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--bg-2)] dark:bg-[var(--gray-1)] p-4 hover:border-[var(--border-2)] transition-colors group">
      <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-[var(--accent)]/30 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
      {icon && (
        <div className="absolute bottom-3 right-3 text-[var(--fg-3)] opacity-20 [&>svg]:w-5 [&>svg]:h-5" aria-hidden>
          {icon}
        </div>
      )}
      <p className="text-label-12 text-[var(--fg-2)] uppercase tracking-widest mb-1.5">{label}</p>
      <p className="text-2xl font-bold font-mono text-[var(--fg)] mb-0.5 leading-none">{value}</p>
      {sub && <p className="text-xs text-[var(--fg-3)]">{sub}</p>}
      {bar !== undefined && (
        <div className="h-1 rounded-full bg-[var(--gray-2)] mt-3 overflow-hidden">
          <div
            className={cn('h-full rounded-full transition-[width] duration-500', barColors[barColor])}
            style={{ width: `${Math.min(bar, 100)}%` }}
          />
        </div>
      )}
    </div>
  );
}
