import { forwardRef } from 'react';
import { cn } from '@/lib/utils';
import { Loader2 } from 'lucide-react';

type Variant = 'default' | 'ghost' | 'accent' | 'danger' | 'success' | 'outline';
type Size = 'sm' | 'md' | 'lg';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: React.ReactNode;
}

const variants: Record<Variant, string> = {
  default: 'bg-[var(--fg)] text-[var(--bg-1)] border-transparent hover:opacity-90',
  ghost:   'bg-transparent text-[var(--fg-2)] border-[var(--border)] hover:bg-[var(--gray-1)] hover:text-[var(--fg)] hover:border-[var(--border-2)]',
  accent:  'bg-[var(--accent-bg)] text-[var(--accent)] border-[var(--accent-border)] hover:bg-[var(--accent)] hover:text-white hover:border-transparent',
  danger:  'bg-[var(--error-bg)] text-[var(--error)] border-[color:rgba(239,68,68,0.3)] hover:bg-[var(--error)] hover:text-white hover:border-transparent',
  success: 'bg-[var(--success-bg)] text-[var(--success)] border-[color:rgba(34,197,94,0.3)] hover:bg-[var(--success)] hover:text-white hover:border-transparent',
  outline: 'bg-transparent text-[var(--fg)] border-[var(--border-2)] hover:bg-[var(--gray-1)]',
};

const sizes: Record<Size, string> = {
  sm: 'h-7 px-2.5 text-xs gap-1.5',
  md: 'h-8 px-3 text-sm gap-2',
  lg: 'h-9 px-4 text-sm gap-2',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'ghost', size = 'md', loading, icon, children, disabled, ...props }, ref) => {
    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        className={cn(
          'inline-flex items-center justify-center rounded border font-medium',
          'transition-colors duration-150 cursor-pointer',
          'focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:outline-none',
          'disabled:opacity-50 disabled:cursor-not-allowed',
          'touch-manipulation select-none',
          variants[variant],
          sizes[size],
          className
        )}
        {...props}
      >
        {loading ? (
          <Loader2 size={12} className="animate-spin shrink-0" aria-hidden />
        ) : icon ? (
          <span className="shrink-0 [&>svg]:w-3.5 [&>svg]:h-3.5" aria-hidden>{icon}</span>
        ) : null}
        {children && <span>{children}</span>}
      </button>
    );
  }
);
Button.displayName = 'Button';
