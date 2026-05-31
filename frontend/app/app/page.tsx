'use client';
import { useEffect, useState } from 'react';
import { Globe, Users, Activity, Clock, Cpu, HardDrive, Zap, Shield, RefreshCw, Copy, Server } from 'lucide-react';
import { api } from '@/lib/api';
import { fmtBytes, fmtUptime, fmtNum, fmtPing, pingQuality } from '@/lib/utils';
import { StatCard, Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/card';
import { useToast } from '@/components/providers/toast-provider';

export default function OverviewPage() {
  const toast = useToast();
  const [stats, setStats] = useState<any>(null);
  const [botInfo, setBotInfo] = useState<any>(null);
  const [apiKeys, setApiKeys] = useState<any[]>([]);
  const [loadingAction, setLoadingAction] = useState<string | null>(null);

  useEffect(() => {
    const token = sessionStorage.getItem('lumin_dash_token') || '';
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/dashboard/ws/stats?token=${encodeURIComponent(token)}`);
    ws.onmessage = (e) => {
      try { const d = JSON.parse(e.data); if (d.type === 'stats') setStats(d.data); } catch (_e) {}
    };
    ws.onclose = () => {};
    return () => ws.close();
  }, []);

  useEffect(() => {
    api.getStats().then((r: any) => {
      if (r.username) setBotInfo(r);
    });
    api.getApiKeyStats().then((r: any) => {
      if (r?.success) setApiKeys(r.data || []);
    });
  }, []);

  const runAction = async (key: string, fn: () => Promise<any>, successMsg: string) => {
    setLoadingAction(key);
    try {
      const r: any = await fn();
      if (r?.success || r?.ok) toast.success(successMsg);
      else toast.error('Action failed', r?.error || 'Unknown error');
    } catch (_e) { toast.error('Request failed'); }
    finally { setLoadingAction(null); }
  };

  const copyInvite = async () => {
    const r: any = await api.inviteLink();
    if (r?.url) { await navigator.clipboard.writeText(r.url); toast.success('Invite link copied'); }
    else toast.error('Could not get invite link');
  };

  const ping = stats?.ping ?? -1;
  const heapUsed = stats?.heapUsed || 0;
  const heapTotal = stats?.heapTotal || 1;
  const heapPct = Math.round((heapUsed / heapTotal) * 100);
  const sysTotal = stats?.sysTotal || 1;
  const sysFree = stats?.sysFree || 0;
  const ramPct = Math.round(((sysTotal - sysFree) / sysTotal) * 100);

  return (
    <div className="space-y-6">
      {/* Hero Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Servers" value={fmtNum(stats?.serverCount)} sub="Active guilds" icon={<Globe />} />
        <StatCard label="Members" value={fmtNum(stats?.totalUsers)} sub="Total across guilds" icon={<Users />} />
        <StatCard label="WS Ping" value={fmtPing(ping)} sub={pingQuality(ping)} icon={<Activity />}
          bar={ping >= 0 ? Math.min((ping / 500) * 100, 100) : 0}
          barColor={ping < 150 ? 'success' : ping < 350 ? 'warning' : 'error'}
        />
        <StatCard label="Uptime" value={fmtUptime(stats?.uptime)} sub="Since last restart" icon={<Clock />} />
      </div>

      {/* System Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatCard label="Heap" value={fmtBytes(heapUsed)} sub={`${heapPct}% of ${fmtBytes(heapTotal)}`}
          bar={heapPct} barColor={heapPct > 80 ? 'error' : heapPct > 60 ? 'warning' : 'success'} />
        <StatCard label="RSS" value={fmtBytes(stats?.rss)} sub="Resident set" />
        <StatCard label="System RAM" value={fmtBytes(sysTotal - sysFree)} sub={`${ramPct}% used`}
          bar={ramPct} barColor={ramPct > 85 ? 'error' : ramPct > 70 ? 'warning' : 'success'} />
        <StatCard label="Disk" value={stats?.disk?.used || '—'} sub={`${stats?.disk?.available || '—'} free`} />
        <StatCard label="Node.js" value={stats?.nodeVersion || '—'} sub="Runtime" />
        <StatCard label="Histories" value={fmtNum(stats?.totalHistories)} sub="Active sessions" />
      </div>

      {/* Main panels */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Bot Identity */}
        <Card title="Bot Identity" action={
          <Button size="sm" variant="ghost" icon={<Copy />} onClick={copyInvite}>Invite</Button>
        }>
          <div className="flex items-center gap-3 mb-4">
            {botInfo?.avatarURL ? (
              <img src={botInfo.avatarURL} alt="Bot avatar" width={48} height={48}
                className="w-12 h-12 rounded-full border-2 border-[var(--accent-border)]" />
            ) : (
              <div className="w-12 h-12 rounded-full bg-[var(--gray-2)] flex items-center justify-center">
                <Server size={20} className="text-[var(--fg-3)]" />
              </div>
            )}
            <div>
              <p className="text-label-14 font-semibold text-[var(--fg)]">{botInfo?.username || '—'}</p>
              <p className="text-xs text-[var(--fg-2)]">{botInfo?.tag || '—'}</p>
              <p className="text-[11px] font-mono text-[var(--fg-3)] mt-0.5">ID: {botInfo?.id || '—'}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className={`status-dot ${stats?.wsStatus === 'READY' ? 'online' : 'offline'}`} />
            <span className="text-xs text-[var(--fg-2)]">{stats?.wsStatus || 'Connecting'}</span>
            <span className="ml-auto">
              <Badge variant={stats?.globalLockdown ? 'error' : 'success'}>
                {stats?.globalLockdown ? 'Lockdown' : 'Live'}
              </Badge>
            </span>
          </div>
        </Card>

        {/* Quick Actions */}
        <Card title="Quick Actions">
          <div className="space-y-2">
            {[
              { key: 'save', label: 'Save State', fn: () => api.saveState(), ok: 'State saved' },
              { key: 'debug', label: 'Toggle Debug Mode', fn: () => api.toggleDebug(), ok: 'Debug toggled' },
              { key: 'reload', label: 'Reload Commands', fn: () => api.reloadCommands(), ok: 'Commands reloaded' },
            ].map(({ key, label, fn, ok }) => (
              <Button key={key} variant="ghost" size="md" className="w-full justify-start"
                loading={loadingAction === key}
                onClick={() => runAction(key, fn, ok)}>
                {label}
              </Button>
            ))}
            <Button variant="danger" size="md" className="w-full justify-start"
              loading={loadingAction === 'restart'}
              onClick={() => runAction('restart', () => api.restart(), 'Restart initiated')}>
              Restart Bot
            </Button>
          </div>
        </Card>

        {/* API Keys */}
        <Card title="API Keys" action={
          <Button size="sm" variant="accent" icon={<RefreshCw size={11} />}
            loading={loadingAction === 'rotate'}
            onClick={() => runAction('rotate', () => api.switchApiKey(), 'Key rotated')}>
            Rotate
          </Button>
        }>
          {apiKeys.length === 0 ? (
            <p className="text-xs text-[var(--fg-3)]">Loading…</p>
          ) : (
            <div className="space-y-1.5">
              {apiKeys.slice(0, 5).map((k: any, i) => (
                <div key={i} className={`flex items-center gap-2 px-2.5 py-2 rounded-md border text-xs ${k.current ? 'border-[var(--accent-border)] bg-[var(--accent-bg)]' : 'border-[var(--border)] bg-[var(--bg-1)]'}`}>
                  <span className="font-mono text-[var(--fg)] flex-1 truncate">Key {i + 1}</span>
                  {k.current && <Badge variant="accent">Active</Badge>}
                  <span className="text-[var(--fg-3)] tabular-nums">{k.requests || 0} req</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
