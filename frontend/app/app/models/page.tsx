'use client';
import { useEffect, useState } from 'react';
import { CheckCircle, RefreshCw, Key, RotateCcw } from 'lucide-react';
import { api } from '@/lib/api';
import { PageHeader, Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/card';
import { useToast } from '@/components/providers/toast-provider';
import { cn } from '@/lib/utils';
import Link from 'next/link';

export default function ModelsPage() {
  const toast = useToast();
  const [models, setModels] = useState<any[]>([]);
  const [activeModel, setActiveModel] = useState('');
  const [keys, setKeys] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [rotating, setRotating] = useState(false);

  const load = async () => {
    setLoading(true);
    const [mr, kr] = await Promise.all([api.getModels(), api.getApiKeyStats()]);
    const mData = mr as any;
    const kData = kr as any;
    if (mData?.models) setModels(mData.models);
    if (mData?.current) setActiveModel(mData.current);
    if (kData?.success) setKeys(kData.data || []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const setModel = async (model: string) => {
    const r: any = await api.setModel(model);
    if (r?.success) { setActiveModel(model); toast.success('Model updated', model); }
    else toast.error('Failed to set model', r?.error);
  };

  const rotateKey = async () => {
    setRotating(true);
    const r: any = await api.switchApiKey();
    if (r?.success) { toast.success('API key rotated'); load(); }
    else toast.error('Rotation failed');
    setRotating(false);
  };

  const switchToKey = async (idx: number) => {
    const r: any = await api.switchToKey(idx);
    if (r?.success) { toast.success(`Switched to key ${idx + 1}`); load(); }
    else toast.error('Switch failed');
  };

  const subPages = [
    { href: '/app/models/settings', label: 'Generation', desc: 'RAG, cache, context settings' },
    { href: '/app/models/media', label: 'Media Processing', desc: 'Images, video, audio, PDF' },
    { href: '/app/models/rate-limits', label: 'Rate Limits', desc: 'RPM, cooldowns, windows' },
    { href: '/app/models/migration', label: 'Migration', desc: 'Push defaults to users/servers' },
  ];

  return (
    <div className="space-y-5">
      <PageHeader title="AI Models" description="Switch the active model and manage API key rotation."
        action={<Button variant="ghost" size="sm" icon={<RefreshCw size={13} />} onClick={load}>Refresh</Button>}
      />

      {/* Sub-navigation */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {subPages.map(sp => (
          <Link key={sp.href} href={sp.href}
            className="rounded-lg border border-[var(--border)] bg-[var(--bg-2)] dark:bg-[var(--gray-1)] p-3.5 hover:border-[var(--border-2)] hover:bg-[var(--gray-1)] dark:hover:bg-[var(--gray-2)] transition-colors group">
            <p className="text-label-13 font-semibold text-[var(--fg)] mb-0.5">{sp.label}</p>
            <p className="text-xs text-[var(--fg-3)]">{sp.desc}</p>
          </Link>
        ))}
      </div>

      {/* Model Grid */}
      <Card title="Available Models" description="Click a model to set it as active">
        {loading ? (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-20 rounded-md bg-[var(--gray-1)] animate-pulse" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
            {models.map((m: any) => {
              const name = typeof m === 'string' ? m : m.name || m.id;
              const isActive = name === activeModel;
              return (
                <button
                  key={name}
                  onClick={() => setModel(name)}
                  aria-pressed={isActive}
                  className={cn(
                    'relative rounded-md border px-3 py-3 text-left cursor-pointer transition-all',
                    'focus-visible:ring-2 focus-visible:ring-[var(--accent)] outline-none',
                    isActive
                      ? 'border-[var(--accent-border)] bg-[var(--accent-bg)]'
                      : 'border-[var(--border)] bg-[var(--bg-1)] hover:border-[var(--border-2)] hover:bg-[var(--gray-1)]'
                  )}
                >
                  {isActive && (
                    <CheckCircle size={12} className="absolute top-2 right-2 text-[var(--accent)]" aria-label="Active" />
                  )}
                  <p className={cn('text-xs font-mono leading-tight', isActive ? 'text-[var(--accent)]' : 'text-[var(--fg)]')}>
                    {name}
                  </p>
                  {isActive && <Badge variant="accent" className="mt-1.5 text-[10px]">Active</Badge>}
                </button>
              );
            })}
          </div>
        )}
      </Card>

      {/* API Keys Detail */}
      <Card title="API Key Status" action={
        <Button variant="accent" size="sm" loading={rotating} icon={<RotateCcw size={12} />} onClick={rotateKey}>
          Rotate to Next
        </Button>
      }>
        {keys.length === 0 ? (
          <p className="text-sm text-[var(--fg-3)] py-4 text-center">Loading API key stats…</p>
        ) : (
          <div className="space-y-2">
            {keys.map((k: any, i) => (
              <div key={i}
                className={cn(
                  'flex items-center gap-3 px-3 py-2.5 rounded-md border transition-colors',
                  k.current
                    ? 'border-[var(--accent-border)] bg-[var(--accent-bg)]'
                    : 'border-[var(--border)] bg-[var(--bg-1)]'
                )}>
                <Key size={13} className={k.current ? 'text-[var(--accent)]' : 'text-[var(--fg-3)]'} aria-hidden />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-[var(--fg)]">Key {i + 1}</span>
                    {k.current && <Badge variant="accent">Active</Badge>}
                    {k.exhausted && <Badge variant="error">Exhausted</Badge>}
                  </div>
                  <p className="text-[10px] font-mono text-[var(--fg-3)] mt-0.5 tabular-nums">
                    {k.requests || 0} requests · {k.gemmaCount || 0} Gemma today
                  </p>
                </div>
                {!k.current && (
                  <Button size="sm" variant="ghost" onClick={() => switchToKey(i)}>Use</Button>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
