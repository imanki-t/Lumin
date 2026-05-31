'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  LayoutDashboard, Globe, Users, Layers, Terminal, Megaphone,
  Lock, Settings, Database, FileText, Code2, MemoryStick,
  Shield, Activity, LogOut, ChevronRight, Moon, Sun
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTheme } from 'next-themes';

// Vercel triangle logo
const VercelTriangle = ({ size = 20 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 116 100" fill="currentColor" aria-hidden>
    <path d="M57.5 0L115 100H0L57.5 0z" />
  </svg>
);

interface NavItem {
  href: string;
  label: string;
  icon: React.ElementType;
  badge?: string;
  badgeVariant?: 'error' | 'warning';
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

const navGroups: NavGroup[] = [
  {
    label: 'Monitor',
    items: [
      { href: '/app',          label: 'Overview',  icon: LayoutDashboard },
      { href: '/app/servers',  label: 'Servers',   icon: Globe },
      { href: '/app/users',    label: 'Users',     icon: Users },
    ],
  },
  {
    label: 'Models',
    items: [
      { href: '/app/models',               label: 'AI Models',         icon: Layers },
      { href: '/app/models/settings',      label: 'Generation',        icon: Settings },
      { href: '/app/models/media',         label: 'Media Processing',  icon: FileText },
      { href: '/app/models/rate-limits',   label: 'Rate Limits',       icon: Activity },
      { href: '/app/models/migration',     label: 'Migration',         icon: MemoryStick },
    ],
  },
  {
    label: 'Control',
    items: [
      { href: '/app/commands',  label: 'Commands',    icon: Terminal },
      { href: '/app/presence',  label: 'Presence',    icon: Activity },
      { href: '/app/announce',  label: 'Announce',    icon: Megaphone },
      { href: '/app/lockdown',  label: 'Lockdown',    icon: Lock, badgeVariant: 'error' },
    ],
  },
  {
    label: 'Advanced',
    items: [
      { href: '/app/config',    label: 'Config',      icon: Code2 },
      { href: '/app/database',  label: 'Database',    icon: Database },
      { href: '/app/files',     label: 'Files',       icon: FileText },
    ],
  },
  {
    label: 'Consoles',
    items: [
      { href: '/app/terminals?tab=node',   label: 'Node.js REPL',   icon: Code2 },
      { href: '/app/terminals?tab=mongo',  label: 'MongoDB Shell',  icon: Database },
      { href: '/app/terminals?tab=shell',  label: 'Bash Shell',     icon: Terminal },
    ],
  },
];

interface SidebarProps {
  user?: { name?: string; email?: string; picture?: string };
  wsStatus?: string;
  ping?: number;
  lockdownActive?: boolean;
  onClose?: () => void;
}

export function Sidebar({ user, wsStatus, ping, lockdownActive, onClose }: SidebarProps) {
  const pathname = usePathname();
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  const handleLogout = async () => {
    await fetch('/dashboard/auth/logout', { method: 'POST', headers: { 'x-token': sessionStorage.getItem('lumin_dash_token') || '' } }).catch(() => {});
    sessionStorage.removeItem('lumin_dash_token');
    window.location.href = '/gate';
  };

  const isActive = (href: string) => {
    if (href === '/app') return pathname === '/app';
    return pathname.startsWith(href.split('?')[0]);
  };

  return (
    <nav className="sidebar" role="navigation" aria-label="Main navigation">
      {/* Brand */}
      <div className="flex items-center gap-3 px-4 py-3.5 border-b border-[var(--border)]">
        <div className="w-7 h-7 rounded flex items-center justify-center bg-[var(--fg)] text-[var(--bg-1)] shrink-0">
          <VercelTriangle size={14} />
        </div>
        <div>
          <div className="text-label-14 font-bold tracking-wide text-[var(--fg)]">LUMIN</div>
          <div className="text-[10px] text-[var(--fg-3)] uppercase tracking-widest">Control Panel</div>
        </div>
      </div>

      {/* Connection Status */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-[var(--border)]">
        <span
          className={cn('status-dot', {
            online: wsStatus === 'READY' && (ping ?? -1) >= 0,
            offline: wsStatus !== 'READY' || (ping ?? -1) < 0,
            warning: (ping ?? -1) > 400,
          })}
        />
        <span className="text-xs font-mono text-[var(--fg-2)]">
          {(ping ?? -1) >= 0 ? `${ping} ms` : '—'}
        </span>
        <span className="text-[var(--fg-3)] text-xs">·</span>
        <span className="text-xs text-[var(--fg-3)] truncate">{wsStatus || 'Connecting'}</span>
      </div>

      {/* Nav Groups */}
      <div className="flex-1 overflow-y-auto py-2 px-2">
        {navGroups.map(group => (
          <div key={group.label} className="mb-1">
            <span className="block px-2 py-1.5 text-[10px] font-semibold tracking-widest uppercase text-[var(--fg-3)]">
              {group.label}
            </span>
            {group.items.map(item => {
              const active = isActive(item.href);
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={onClose}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'flex items-center gap-2.5 px-2.5 py-2 rounded-md text-label-13',
                    'transition-colors duration-100 relative group',
                    active
                      ? 'bg-[var(--accent-bg)] text-[var(--accent)] font-semibold border border-[var(--accent-border)]'
                      : 'text-[var(--fg-2)] hover:bg-[var(--gray-1)] hover:text-[var(--fg)] border border-transparent'
                  )}
                >
                  {active && (
                    <span className="absolute left-0 top-1/4 bottom-1/4 w-0.5 rounded-r-full bg-[var(--accent)]" aria-hidden />
                  )}
                  <Icon
                    size={14}
                    className={cn('shrink-0', active ? 'text-[var(--accent)]' : 'text-[var(--fg-3)] group-hover:text-[var(--fg-2)]')}
                    aria-hidden
                  />
                  <span className="flex-1 truncate">{item.label}</span>
                  {item.label === 'Lockdown' && lockdownActive && (
                    <span className="w-1.5 h-1.5 rounded-full bg-[var(--error)] animate-pulse" aria-label="Lockdown active" />
                  )}
                </Link>
              );
            })}
          </div>
        ))}
      </div>

      {/* Footer */}
      <div className="border-t border-[var(--border)] p-3">
        <div className="flex items-center gap-2.5">
          {user?.picture ? (
            <img
              src={user.picture}
              alt={user.name || 'User'}
              width={28}
              height={28}
              className="w-7 h-7 rounded-full border border-[var(--border)] shrink-0"
            />
          ) : (
            <div className="w-7 h-7 rounded-full bg-[var(--gray-2)] flex items-center justify-center shrink-0">
              <Users size={12} className="text-[var(--fg-3)]" aria-hidden />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <p className="text-label-12 font-medium text-[var(--fg)] truncate">{user?.name || 'Admin'}</p>
            <p className="text-[10px] font-mono text-[var(--fg-3)] truncate">{user?.email || '—'}</p>
          </div>
          {mounted && (
            <button
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
              aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
              className="p-1.5 rounded border border-[var(--border)] text-[var(--fg-3)] hover:text-[var(--fg)] hover:bg-[var(--gray-1)] transition-colors shrink-0"
            >
              {theme === 'dark' ? <Sun size={12} /> : <Moon size={12} />}
            </button>
          )}
          <button
            onClick={handleLogout}
            aria-label="Sign out"
            className="p-1.5 rounded border border-[var(--border)] text-[var(--fg-3)] hover:text-[var(--error)] hover:bg-[var(--error-bg)] hover:border-[color:rgba(239,68,68,0.3)] transition-colors shrink-0"
          >
            <LogOut size={12} />
          </button>
        </div>
      </div>
    </nav>
  );
}
