'use client';
import { useEffect, useState } from 'react';
import { Shield, ShieldOff, X, Check } from 'lucide-react';
import { api } from '@/lib/api';
import { PageHeader, Card } from '@/components/ui/card';
import { useToast } from '@/components/providers/toast-provider';
import { cn } from '@/lib/utils';

export default function LockdownPage() {
  const toast = useToast();
  const [active, setActive] = useState(false);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState(false);

  useEffect(() => {
    api.getStats().then((r: any) => {
      setActive(!!r?.globalLockdown);
      setLoading(false);
    });
  }, []);

  const toggle = async (checked: boolean) => {
    if (checked && !confirm('Enable global lockdown? All bot responses will be halted.')) return;
    setToggling(true);
    const r: any = await api.setLockdown(checked);
    if (r?.success) {
      setActive(checked);
      toast[checked ? 'warning' : 'success'](
        checked ? 'Lockdown activated' : 'Lockdown deactivated',
        checked ? 'All bot responses are now halted.' : 'The bot is live again.'
      );
    } else {
      toast.error('Failed to toggle lockdown', r?.error);
    }
    setToggling(false);
  };

  const impacts = [
    { ok: false, text: 'Blocks all message responses globally' },
    { ok: false, text: 'Slash commands show a lockdown message' },
    { ok: true,  text: 'Zero data loss — all state is preserved' },
    { ok: true,  text: 'Can be disabled at any time instantly' },
  ];

  return (
    <div className="space-y-5 max-w-lg">
      <PageHeader title="Global Lockdown" description="Instantly halt or resume all bot activity across every server." />

      {/* Main toggle */}
      <Card>
        <div className={cn(
          'flex items-center justify-between p-4 rounded-lg border transition-all duration-300',
          active
            ? 'border-[color:rgba(239,68,68,0.4)] bg-[var(--error-bg)]'
            : 'border-[var(--border)] bg-[var(--bg-1)]'
        )}>
          <div className="flex items-center gap-3">
            {active ? (
              <ShieldOff size={22} className="text-[var(--error)]" />
            ) : (
              <Shield size={22} className="text-[var(--success)]" />
            )}
            <div>
              <p className={cn('text-label-14 font-bold', active ? 'text-[var(--error)]' : 'text-[var(--success)]')}>
                {loading ? 'Loading…' : active ? 'LOCKDOWN ACTIVE' : 'Bot is Live'}
              </p>
              <p className="text-xs text-[var(--fg-3)]">
                {active ? 'All responses are halted' : 'Responding normally to all servers'}
              </p>
            </div>
          </div>

          {/* Custom toggle */}
          <button
            role="switch"
            aria-checked={active}
            aria-label="Toggle global lockdown"
            disabled={toggling || loading}
            onClick={() => toggle(!active)}
            className={cn(
              'relative inline-flex h-7 w-14 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent',
              'transition-colors duration-200',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]',
              'disabled:opacity-50 disabled:cursor-not-allowed',
              active ? 'bg-[var(--error)]' : 'bg-[var(--gray-3)]'
            )}
          >
            <span className={cn(
              'pointer-events-none block h-5 w-5 rounded-full bg-white shadow',
              'transition-transform duration-200',
              active ? 'translate-x-7' : 'translate-x-1'
            )} />
          </button>
        </div>

        {/* Impact summary */}
        <div className={cn(
          'mt-4 rounded-lg border p-4 space-y-2.5',
          active ? 'border-[color:rgba(239,68,68,0.2)] bg-[var(--error-bg)]' : 'border-[color:rgba(245,158,11,0.2)] bg-[var(--warning-bg)]'
        )}>
          {impacts.map(({ ok, text }) => (
            <div key={text} className="flex items-start gap-2.5 text-sm text-[var(--fg-2)]">
              {ok
                ? <Check size={14} className="text-[var(--success)] shrink-0 mt-0.5" aria-hidden />
                : <X size={14} className="text-[var(--error)] shrink-0 mt-0.5" aria-hidden />
              }
              <span>{text}</span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
