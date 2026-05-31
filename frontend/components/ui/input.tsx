import { forwardRef } from 'react';
import { cn } from '@/lib/utils';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  hint?: string;
  error?: string;
  icon?: React.ReactNode;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, label, hint, error, icon, id, ...props }, ref) => {
    const inputId = id || label?.toLowerCase().replace(/\s+/g, '-');
    return (
      <div className="flex flex-col gap-1.5">
        {label && (
          <label htmlFor={inputId} className="text-label-12 font-medium text-[var(--fg-2)] uppercase tracking-wider">
            {label}
          </label>
        )}
        <div className="relative">
          {icon && (
            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--fg-3)] [&>svg]:w-3.5 [&>svg]:h-3.5 pointer-events-none" aria-hidden>
              {icon}
            </span>
          )}
          <input
            ref={ref}
            id={inputId}
            className={cn(
              'w-full h-8 px-3 rounded border bg-[var(--bg-1)] text-[var(--fg)]',
              'text-sm placeholder:text-[var(--fg-3)]',
              'border-[var(--border)] focus:border-[var(--accent)]',
              'outline-none transition-colors duration-150',
              'focus-visible:ring-2 focus-visible:ring-[var(--accent)]/20',
              icon && 'pl-8',
              error && 'border-[var(--error)]',
              className
            )}
            style={{ fontSize: '14px' }}
            {...props}
          />
        </div>
        {hint && !error && <p className="text-xs text-[var(--fg-3)]">{hint}</p>}
        {error && <p className="text-xs text-[var(--error)]" role="alert">{error}</p>}
      </div>
    );
  }
);
Input.displayName = 'Input';

interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  hint?: string;
  error?: string;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, label, hint, error, id, ...props }, ref) => {
    const inputId = id || label?.toLowerCase().replace(/\s+/g, '-');
    return (
      <div className="flex flex-col gap-1.5">
        {label && (
          <label htmlFor={inputId} className="text-label-12 font-medium text-[var(--fg-2)] uppercase tracking-wider">
            {label}
          </label>
        )}
        <textarea
          ref={ref}
          id={inputId}
          className={cn(
            'w-full px-3 py-2 rounded border bg-[var(--bg-1)] text-[var(--fg)]',
            'text-sm placeholder:text-[var(--fg-3)]',
            'border-[var(--border)] focus:border-[var(--accent)]',
            'outline-none transition-colors duration-150 resize-y',
            error && 'border-[var(--error)]',
            className
          )}
          style={{ fontSize: '14px' }}
          {...props}
        />
        {hint && !error && <p className="text-xs text-[var(--fg-3)]">{hint}</p>}
        {error && <p className="text-xs text-[var(--error)]" role="alert">{error}</p>}
      </div>
    );
  }
);
Textarea.displayName = 'Textarea';
