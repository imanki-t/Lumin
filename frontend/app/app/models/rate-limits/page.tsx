'use client';
import { useEffect, useState } from 'react';
import { Save, AlertTriangle } from 'lucide-react';
import { api } from '@/lib/api';
import { PageHeader, Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/providers/toast-provider';

export default function RateLimitsPage() {
  const toast = useToast();
  const [cfg, setCfg] = useState({
    rpm: '', window: '', cooldown: '', retryForbidden: '', retryRateLimit: '', retryServer: '',
    modelOverrides: '{}',
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.getRuntimeConfig().then((r: any) => {
      const c = r?.config?.rateLimits || {};
      setCfg({
        rpm: c.rpm ?? '',
        window: c.window ?? '',
        cooldown: c.cooldown ?? '',
        retryForbidden: c.retryForbidden ?? '',
        retryRateLimit: c.retryRateLimit ?? '',
        retryServer: c.retryServer ?? '',
        modelOverrides: JSON.stringify(c.modelOverrides || {}, null, 2),
      });
    });
  }, []);

  const save = async () => {
    let overrides: any;
    try { overrides = JSON.parse(cfg.modelOverrides); }
    catch (_e) { toast.error('Invalid JSON in model overrides'); return; }
    setSaving(true);
    const r: any = await api.setRuntimeConfig({
      rateLimits: {
        rpm: +cfg.rpm || undefined,
        window: +cfg.window || undefined,
        cooldown: +cfg.cooldown || undefined,
        retryForbidden: +cfg.retryForbidden || undefined,
        retryRateLimit: +cfg.retryRateLimit || undefined,
        retryServer: +cfg.retryServer || undefined,
        modelOverrides: overrides,
      }
    });
    if (r?.success) toast.success('Rate limits saved', 'Restart required to apply');
    else toast.error('Failed to save');
    setSaving(false);
  };

  const up = (key: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setCfg(c => ({ ...c, [key]: e.target.value }));

  return (
    <div className="space-y-5">
      <PageHeader title="Rate Limits" description="Configure API rate limiting per key per model." action={
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1.5 text-xs text-[var(--warning)]">
            <AlertTriangle size={12} />Restart required to apply
          </span>
          <Button variant="accent" size="sm" loading={saving} icon={<Save size={12} />} onClick={save}>Save</Button>
        </div>
      } />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card title="Request Limits">
          <div className="space-y-3">
            <Input label="Default RPM (requests per minute)" type="number" min={1} max={2000} placeholder="15"
              value={cfg.rpm} onChange={up('rpm')} />
            <Input label="Window Duration (ms)" type="number" placeholder="60000"
              value={cfg.window} onChange={up('window')} />
            <Input label="Cooldown After 429 (ms)" type="number" placeholder="60000"
              value={cfg.cooldown} onChange={up('cooldown')} />
          </div>
        </Card>

        <Card title="Retry Delays">
          <div className="space-y-3">
            <Input label="Retry: Forbidden (403) (ms)" type="number" placeholder="3000"
              value={cfg.retryForbidden} onChange={up('retryForbidden')} />
            <Input label="Retry: Rate Limited (429) (ms)" type="number" placeholder="2500"
              value={cfg.retryRateLimit} onChange={up('retryRateLimit')} />
            <Input label="Retry: Server Error (5xx) (ms)" type="number" placeholder="1000"
              value={cfg.retryServer} onChange={up('retryServer')} />
          </div>
        </Card>
      </div>

      <Card title="Per-Model RPM Overrides" description="JSON object — use null for unlimited. e.g. {\"gemini-flash-lite\": null}">
        <textarea
          value={cfg.modelOverrides}
          onChange={up('modelOverrides')}
          rows={6}
          spellCheck={false}
          className="code-editor"
          aria-label="Per-model RPM overrides JSON"
        />
      </Card>
    </div>
  );
}
