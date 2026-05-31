'use client';
import * as RadixSwitch from '@radix-ui/react-switch';
import { cn } from '@/lib/utils';

interface ToggleProps {
  checked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  label?: string;
  description?: string;
  id?: string;
  disabled?: boolean;
  variant?: 'default' | 'danger';
}

export function Toggle({ checked, onCheckedChange, label, description, id, disabled, variant = 'default' }: ToggleProps) {
  const switchId = id || label?.toLowerCase().replace(/\s+/g, '-');
  return (
    <div className="flex items-center justify-between gap-4">
      {(label || description) && (
        <div>
          {label && <label htmlFor={switchId} className="text-label-13 text-[var(--fg)] cursor-pointer">{label}</label>}
          {description && <p className="text-xs text-[var(--fg-3)] mt-0.5">{description}</p>}
        </div>
      )}
      <RadixSwitch.Root
        id={switchId}
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
        className={cn(
          'relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent',
          'transition-colors duration-200 focus-visible:outline-none',
          'focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2',
          'data-[disabled]:opacity-50 data-[disabled]:cursor-not-allowed',
          checked && variant === 'default' ? 'bg-[var(--accent)]' : '',
          checked && variant === 'danger' ? 'bg-[var(--error)]' : '',
          !checked ? 'bg-[var(--gray-3)]' : '',
        )}
      >
        <RadixSwitch.Thumb
          className={cn(
            'pointer-events-none block h-4 w-4 rounded-full bg-white shadow-sm',
            'transition-transform duration-200',
            'data-[state=unchecked]:translate-x-0 data-[state=checked]:translate-x-4',
          )}
        />
      </RadixSwitch.Root>
    </div>
  );
}
