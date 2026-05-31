'use client';
import { Menu } from 'lucide-react';
import { cn } from '@/lib/utils';

interface TopbarProps {
  title: string;
  onMenuClick?: () => void;
  ping?: number;
  lockdownActive?: boolean;
  rightSlot?: React.ReactNode;
}

export function Topbar({ title, onMenuClick, ping, lockdownActive, rightSlot }: TopbarProps) {
  return (
    <header className="topbar" role="banner">
      <button
        onClick={onMenuClick}
        aria-label="Toggle navigation menu"
        className={cn(
          'md:hidden p-1.5 rounded border border-[var(--border)]',
          'text-[var(--fg-2)] hover:bg-[var(--gray-1)] hover:text-[var(--fg)]',
          'transition-colors shrink-0'
        )}
      >
        <Menu size={16} />
      </button>

      <h2 className="text-label-14 font-semibold text-[var(--fg)] flex-1 truncate">{title}</h2>

      <div className="flex items-center gap-3 ml-auto shrink-0">
        {rightSlot}
        {ping !== undefined && ping >= 0 && (
          <span className="text-xs font-mono text-[var(--fg-3)] tabular-nums hidden sm:block" aria-label={`WebSocket latency ${ping} milliseconds`}>
            {ping}&nbsp;ms
          </span>
        )}
        {lockdownActive && (
          <span className="text-[10px] font-bold tracking-widest px-2 py-0.5 rounded border border-[var(--error)] bg-[var(--error-bg)] text-[var(--error)] uppercase animate-pulse">
            Lockdown
          </span>
        )}
      </div>
    </header>
  );
}
