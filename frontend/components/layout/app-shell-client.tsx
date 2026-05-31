'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import { usePathname } from 'next/navigation';
import { Sidebar } from '@/components/layout/sidebar';
import { Topbar } from '@/components/layout/topbar';
import { cn } from '@/lib/utils';

const PAGE_TITLES: Record<string, string> = {
  '/app':                        'Overview',
  '/app/servers':                'Servers',
  '/app/users':                  'User Management',
  '/app/models':                 'AI Models',
  '/app/models/settings':        'Generation Settings',
  '/app/models/media':           'Media Processing',
  '/app/models/rate-limits':     'Rate Limits',
  '/app/models/migration':       'Migration',
  '/app/commands':               'Admin Commands',
  '/app/presence':               'Bot Presence',
  '/app/announce':               'Global Announcement',
  '/app/lockdown':               'Global Lockdown',
  '/app/config':                 'Config Editor',
  '/app/database':               'Database Browser',
  '/app/files':                  'File Browser',
  '/app/terminals':              'Terminals',
};

function getTitle(pathname: string): string {
  return PAGE_TITLES[pathname] || 'Lumin';
}

export default function AppShellClient({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [user, setUser] = useState<{ name?: string; email?: string; picture?: string }>();
  const [wsStatus, setWsStatus] = useState('Connecting');
  const [ping, setPing] = useState(-1);
  const [lockdownActive, setLockdownActive] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    const token = sessionStorage.getItem('lumin_dash_token') || '';
    if (!token) { window.location.href = '/gate'; return; }

    // Load user
    fetch('/dashboard/auth/me', { headers: { 'x-token': token } })
      .then(r => r.json())
      .then(data => {
        if (data.success) setUser(data.user);
        else { sessionStorage.removeItem('lumin_dash_token'); window.location.href = '/gate'; }
      })
      .catch(() => { window.location.href = '/gate'; });

    // WebSocket stats stream
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const connect = () => {
      const ws = new WebSocket(`${proto}://${location.host}/dashboard/ws/stats?token=${encodeURIComponent(token)}`);
      wsRef.current = ws;
      ws.onmessage = (e) => {
        try {
          const d = JSON.parse(e.data);
          if (d.type === 'stats') {
            setPing(d.data.ping ?? -1);
            setWsStatus(d.data.wsStatus || 'Unknown');
            setLockdownActive(!!d.data.globalLockdown);
          }
        } catch {}
      };
      ws.onclose = () => setTimeout(connect, 3000);
      ws.onerror = () => ws.close();
    };
    connect();
    return () => wsRef.current?.close();
  }, []);

  const title = getTitle(pathname);

  useEffect(() => {
    setSidebarOpen(false);
  }, [pathname]);

  return (
    <div className="app-shell">
      {/* Sidebar */}
      <div className={cn(sidebarOpen && 'md:translate-x-0')}>
        <Sidebar
          user={user}
          wsStatus={wsStatus}
          ping={ping}
          lockdownActive={lockdownActive}
          onClose={() => setSidebarOpen(false)}
        />
      </div>

      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-[190] bg-black/60 md:hidden"
          onClick={() => setSidebarOpen(false)}
          aria-hidden
        />
      )}

      {/* Main */}
      <div className="main-area">
        <Topbar
          title={title}
          onMenuClick={() => setSidebarOpen(s => !s)}
          ping={ping}
          lockdownActive={lockdownActive}
        />
        <main className="page-content page-enter" id="main-content">
          <a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:px-4 focus:py-2 focus:bg-[var(--accent)] focus:text-white focus:rounded">
            Skip to content
          </a>
          {children}
        </main>
      </div>
    </div>
  );
}
