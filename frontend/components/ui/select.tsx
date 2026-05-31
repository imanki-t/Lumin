'use client';
import * as RadixSelect from '@radix-ui/react-select';
import { Check, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { forwardRef } from 'react';

export interface SelectOption {
  value: string;
  label: string;
  description?: string;
}

interface SelectProps {
  options: SelectOption[];
  value?: string;
  onValueChange?: (val: string) => void;
  placeholder?: string;
  label?: string;
  hint?: string;
  disabled?: boolean;
  className?: string;
  id?: string;
}

export function Select({ options, value, onValueChange, placeholder = 'Select…', label, hint, disabled, className, id }: SelectProps) {
  const selectId = id || label?.toLowerCase().replace(/\s+/g, '-');
  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <label htmlFor={selectId} className="text-label-12 font-medium text-[var(--fg-2)] uppercase tracking-wider">
          {label}
        </label>
      )}
      <RadixSelect.Root value={value} onValueChange={onValueChange} disabled={disabled}>
        <RadixSelect.Trigger
          id={selectId}
          className={cn(
            'inline-flex items-center justify-between w-full h-8 px-3 rounded border',
            'bg-[var(--bg-1)] text-[var(--fg)] border-[var(--border)]',
            'text-sm cursor-pointer outline-none',
            'hover:border-[var(--border-2)] focus:border-[var(--accent)]',
            'focus-visible:ring-2 focus-visible:ring-[var(--accent)]/20',
            'transition-colors duration-150',
            'data-[disabled]:opacity-50 data-[disabled]:cursor-not-allowed',
            '[&>span]:truncate',
            className
          )}
          aria-label={label}
        >
          <RadixSelect.Value placeholder={<span className="text-[var(--fg-3)]">{placeholder}</span>} />
          <RadixSelect.Icon asChild>
            <ChevronDown size={12} className="text-[var(--fg-3)] shrink-0 ml-2" aria-hidden />
          </RadixSelect.Icon>
        </RadixSelect.Trigger>

        <RadixSelect.Portal>
          <RadixSelect.Content
            className={cn(
              'z-[9999] min-w-[var(--radix-select-trigger-width)] overflow-hidden',
              'rounded-lg border border-[var(--border-2)]',
              'bg-[var(--bg-1)] shadow-dark-lg',
              'animate-in fade-in-0 zoom-in-95',
              'data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95',
            )}
            position="popper"
            sideOffset={4}
          >
            <RadixSelect.Viewport className="p-1">
              {options.map(opt => (
                <SelectItem key={opt.value} value={opt.value}>
                  <span className="flex flex-col">
                    <span>{opt.label}</span>
                    {opt.description && (
                      <span className="text-xs text-[var(--fg-3)]">{opt.description}</span>
                    )}
                  </span>
                </SelectItem>
              ))}
            </RadixSelect.Viewport>
          </RadixSelect.Content>
        </RadixSelect.Portal>
      </RadixSelect.Root>
      {hint && <p className="text-xs text-[var(--fg-3)]">{hint}</p>}
    </div>
  );
}

const SelectItem = forwardRef<HTMLDivElement, { value: string; children: React.ReactNode }>(
  ({ children, value, ...props }, ref) => {
    return (
      <RadixSelect.Item
        ref={ref}
        value={value}
        className={cn(
          'relative flex items-center gap-2 px-2.5 py-1.5 rounded-md',
          'text-sm text-[var(--fg)] cursor-pointer outline-none',
          'select-none',
          'hover:bg-[var(--gray-1)] focus:bg-[var(--gray-1)]',
          'data-[highlighted]:bg-[var(--gray-1)]',
          'data-[state=checked]:text-[var(--accent)] data-[state=checked]:font-medium',
          'transition-colors duration-100'
        )}
        {...props}
      >
        <RadixSelect.ItemText className="flex-1">{children}</RadixSelect.ItemText>
        <RadixSelect.ItemIndicator>
          <Check size={12} className="text-[var(--accent)]" aria-hidden />
        </RadixSelect.ItemIndicator>
      </RadixSelect.Item>
    );
  }
);
SelectItem.displayName = 'SelectItem';
