'use client';
import { useEffect, useState } from 'react';
import { Save, RotateCcw, AlertTriangle } from 'lucide-react';
import { api } from '@/lib/api';
import { PageHeader, Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/providers/toast-provider';
import { cn } from '@/lib/utils';
import * as Tabs from '@radix-ui/react-tabs';

export default function ConfigPage() {
  const toast = useToast();
  const [tab, setTab] = useState('runtime');

  // Runtime config
  const [rtModel, setRtModel] = useState('');
  const [rtColor, setRtColor] = useState('');
  const [rtRaw, setRtRaw] = useState('{}');
  const [rtLoading, setRtLoading] = useState(false);

  // File configs
  const [modulesCfg, setModulesCfg] = useState('');
  const [baseCfg, setBaseCfg] = useState('');
  const [modInfo, setModInfo] = useState('');
  const [baseInfo, setBaseInfo] = useState('');
  const [cfgLoading, setCfgLoading] = useState<Record<string, boolean>>({});

  useEffect(() => { loadRuntime(); }, []);
  useEffect(() => {
    if (tab === 'modules' && !modulesCfg) loadCfg('modules');
    if (tab === 'base' && !baseCfg) loadCfg('base');
  }, [tab]);

  const loadRuntime = async () => {
    const r: any = await api.getRuntimeConfig();
    const c = r?.config || {};
    setRtModel(c.model || '');
    setRtColor(c.embedColor || '');
    setRtRaw(JSON.stringify(c, null, 2));
  };

  const saveRuntime = async () => {
    setRtLoading(true);
    const r: any = await api.setRuntimeConfig({ model: rtModel || undefined, embedColor: rtColor || undefined });
    if (r?.success) { toast.success('Runtime config saved'); loadRuntime(); }
    else toast.error('Failed to save', r?.error);
    setRtLoading(false);
  };

  const saveRuntimeRaw = async () => {
    try {
      const parsed = JSON.parse(rtRaw);
      setRtLoading(true);
      const r: any = await api.setRuntimeConfig(parsed);
      if (r?.success) toast.success('Raw config saved');
      else toast.error('Failed', r?.error);
    } catch (_e) { toast.error('Invalid JSON'); }
    setRtLoading(false);
  };

  const clearRuntime = async () => {
    if (!confirm('Reset runtime config to defaults?')) return;
    const r: any = await api.clearRuntimeConfig();
    if (r?.success) { toast.success('Config reset'); loadRuntime(); }
    else toast.error('Failed');
  };

  const loadCfg = async (which: string) => {
    setCfgLoading(p => ({ ...p, [which]: true }));
    const fn = which === 'modules' ? api.getModulesConfig : api.getBaseConfig;
    const r: any = await fn();
    if (which === 'modules') { setModulesCfg(r?.content || ''); setModInfo(r?.backup || ''); }
    else { setBaseCfg(r?.content || ''); setBaseInfo(r?.backup || ''); }
    setCfgLoading(p => ({ ...p, [which]: false }));
  };

  const saveCfg = async (which: string) => {
    const content = which === 'modules' ? modulesCfg : baseCfg;
    setCfgLoading(p => ({ ...p, [`save-${which}`]: true }));
    const fn = which === 'modules' ? api.setModulesConfig : api.setBaseConfig;
    const r: any = await fn(content);
    if (r?.success) toast.success('File saved', 'Restart required to apply');
    else toast.error('Failed to save', r?.error);
    setCfgLoading(p => ({ ...p, [`save-${which}`]: false }));
  };

  const resetCfg = async (which: string) => {
    if (!confirm('Restore backup?')) return;
    const fn = which === 'modules' ? api.resetModulesConfig : api.resetBaseConfig;
    const r: any = await fn();
    if (r?.success) { toast.success('Backup restored'); loadCfg(which); }
    else toast.error('Failed');
  };

  const tabStyle = (t: string) => cn(
    'px-3.5 py-1.5 text-sm font-medium rounded-md cursor-pointer transition-colors border-b-2 border-transparent',
    tab === t
      ? 'text-[var(--fg)] border-[var(--accent)]'
      : 'text-[var(--fg-3)] hover:text-[var(--fg-2)]'
  );

  return (
    <div className="space-y-5">
      <PageHeader title="Config Editor" description="Edit config files directly. Backups are created automatically." />

      <Tabs.Root value={tab} onValueChange={setTab}>
        <Tabs.List className="flex gap-1 border-b border-[var(--border)] mb-5" aria-label="Config sections">
          <Tabs.Trigger value="runtime" className={tabStyle('runtime')}>Runtime Config</Tabs.Trigger>
          <Tabs.Trigger value="modules" className={tabStyle('modules')}>modules/config.js</Tabs.Trigger>
          <Tabs.Trigger value="base" className={tabStyle('base')}>config.js</Tabs.Trigger>
        </Tabs.List>

        <Tabs.Content value="runtime" className="space-y-4">
          <Card title="Runtime Config" description="Persists across restarts — saved to dashboard/runtime-config.json">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
              <Input label="Active Model Override" value={rtModel}
                onChange={e => setRtModel(e.target.value)} placeholder="e.g. gemini-3.5-flash" />
              <Input label="Global Embed Color" value={rtColor}
                onChange={e => setRtColor(e.target.value)} placeholder="#6D5AE6" />
            </div>
            <div className="flex gap-2">
              <Button variant="accent" size="md" loading={rtLoading} icon={<Save size={12} />} onClick={saveRuntime}>Save</Button>
              <Button variant="danger" size="md" icon={<RotateCcw size={12} />} onClick={clearRuntime}>Reset</Button>
            </div>
          </Card>

          <Card title="Raw JSON" action={
            <Button size="sm" variant="ghost" onClick={loadRuntime}>Reload</Button>
          }>
            <textarea
              value={rtRaw}
              onChange={e => setRtRaw(e.target.value)}
              rows={12}
              spellCheck={false}
              className="code-editor mb-3"
              aria-label="Runtime config JSON"
            />
            <Button variant="accent" size="md" loading={rtLoading} icon={<Save size={12} />} onClick={saveRuntimeRaw}>
              Save Raw JSON
            </Button>
          </Card>
        </Tabs.Content>

        {['modules', 'base'].map(which => (
          <Tabs.Content key={which} value={which} className="space-y-4">
            <Card
              title={which === 'modules' ? 'modules/config.js' : 'config.js (base)'}
              action={
                <div className="flex items-center gap-2">
                  <span className="flex items-center gap-1 text-xs text-[var(--warning)]">
                    <AlertTriangle size={11} />Restart required
                  </span>
                  <Button size="sm" variant="ghost" onClick={() => loadCfg(which)}>Reload</Button>
                  <Button size="sm" variant="danger" icon={<RotateCcw size={11} />} onClick={() => resetCfg(which)}>Backup</Button>
                  <Button size="sm" variant="accent" loading={cfgLoading[`save-${which}`]}
                    icon={<Save size={11} />} onClick={() => saveCfg(which)}>Save</Button>
                </div>
              }
            >
              {cfgLoading[which] ? (
                <div className="h-64 rounded-md bg-[var(--gray-1)] animate-pulse" />
              ) : (
                <textarea
                  value={which === 'modules' ? modulesCfg : baseCfg}
                  onChange={e => which === 'modules' ? setModulesCfg(e.target.value) : setBaseCfg(e.target.value)}
                  rows={24}
                  spellCheck={false}
                  className="code-editor"
                  aria-label={`${which} config file contents`}
                />
              )}
            </Card>
          </Tabs.Content>
        ))}
      </Tabs.Root>
    </div>
  );
}
