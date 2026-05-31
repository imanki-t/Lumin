'use client';
import { useEffect, useState } from 'react';
import { Save } from 'lucide-react';
import { api } from '@/lib/api';
import { PageHeader, Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { useToast } from '@/components/providers/toast-provider';

const boolOpts = [
  { value: 'true', label: 'Enabled' },
  { value: 'false', label: 'Disabled' },
];
const boolOptsRev = [
  { value: 'false', label: 'Disabled' },
  { value: 'true', label: 'Enabled' },
];

const respFmtOpts = [
  { value: 'Normal', label: 'Normal' },
  { value: 'Markdown', label: 'Markdown' },
  { value: 'Plain', label: 'Plain Text' },
];

export default function GenerationSettingsPage() {
  const toast = useToast();
  const [flags, setFlags] = useState<Record<string, boolean>>({});
  const [botCfg, setBotCfg] = useState<any>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    Promise.all([api.getFeatureFlags(), api.getRuntimeConfig()]).then(([fr, rr]: any[]) => {
      if (fr?.flags) setFlags(fr.flags);
      if (rr?.config) setBotCfg(rr.config || {});
      setLoading(false);
    });
  }, []);

  const toggleFlag = async (key: string, val: string) => {
    const enabled = val === 'true';
    setFlags(f => ({ ...f, [key]: enabled }));
    const r: any = await api.toggleFeature(key, enabled);
    if (!r?.success) { toast.error('Failed to update flag'); setFlags(f => ({ ...f, [key]: !enabled })); }
    else toast.success(`${key.replace(/_/g, ' ')} ${enabled ? 'enabled' : 'disabled'}`);
  };

  const saveBotConfig = async () => {
    setSaving(true);
    const r: any = await api.setRuntimeConfig(botCfg);
    if (r?.success) toast.success('Configuration saved');
    else toast.error('Failed to save', r?.error);
    setSaving(false);
  };

  const f = (key: string) => flags[key] ? 'true' : 'false';
  const set = (key: string) => (val: string) => toggleFlag(key, val);

  return (
    <div className="space-y-5">
      <PageHeader title="Generation Settings" description="Control AI behavior, memory, and context settings." />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Core AI flags */}
        <Card title="AI Behavior">
          <div className="space-y-4">
            <Select label="Gemma Models" options={boolOpts} value={f('ENABLE_GEMMA')} onValueChange={set('ENABLE_GEMMA')} />
            <Select label="Auto RAG (memory search)" options={boolOptsRev}
              value={f('ENABLE_RAG')} onValueChange={set('ENABLE_RAG')}
              hint="Disabled saves ~3 API calls per message" />
            <Select label="Redis Cache" options={boolOptsRev} value={f('CACHE_ENABLED')} onValueChange={set('CACHE_ENABLED')} />
            <Select label="Cycle Gemma + Gemini" options={boolOptsRev} value={f('CYCLE_GEMMA_WITH_GEMINI')} onValueChange={set('CYCLE_GEMMA_WITH_GEMINI')} />
            <Select label="Web Search / Grounding" options={boolOpts} value={f('ENABLE_WEB_SEARCH')} onValueChange={set('ENABLE_WEB_SEARCH')} />
            <Select label="Function / Tool Calling" options={boolOpts} value={f('ENABLE_FUNCTION_CALLING')} onValueChange={set('ENABLE_FUNCTION_CALLING')} />
            <Select label="Cross-Context Memory" options={boolOptsRev} value={f('CROSS_CONTEXT_ENABLED')} onValueChange={set('CROSS_CONTEXT_ENABLED')} />
            <Select label="Weekly Summary" options={boolOpts} value={f('WEEKLY_SUMMARY_ENABLED')} onValueChange={set('WEEKLY_SUMMARY_ENABLED')} />
          </div>
        </Card>

        {/* Bot & Queue config */}
        <Card title="Bot & Queue Config" action={
          <Button size="sm" variant="accent" loading={saving} icon={<Save size={12} />} onClick={saveBotConfig}>Save</Button>
        }>
          <div className="grid grid-cols-1 gap-3">
            <Select label="Response Format" options={respFmtOpts}
              value={botCfg.responseFormat || 'Normal'}
              onValueChange={v => setBotCfg((c: any) => ({ ...c, responseFormat: v }))} />
            <Select label="Work in DMs" options={boolOpts}
              value={botCfg.workInDMs !== false ? 'true' : 'false'}
              onValueChange={v => setBotCfg((c: any) => ({ ...c, workInDMs: v === 'true' }))} />
            <div className="grid grid-cols-2 gap-3">
              <Input label="Max Queue / User" type="number" min={1} max={50} placeholder="5"
                value={botCfg.maxQueuePerUser || ''}
                onChange={e => setBotCfg((c: any) => ({ ...c, maxQueuePerUser: +e.target.value }))} />
              <Input label="Key Switch Hold (ms)" type="number" placeholder="1500"
                value={botCfg.keySwitchHoldMs || ''}
                onChange={e => setBotCfg((c: any) => ({ ...c, keySwitchHoldMs: +e.target.value }))} />
              <Input label="RAM Suspend Threshold (MB)" type="number" placeholder="380"
                value={botCfg.ramSuspendThresholdMB || ''}
                onChange={e => setBotCfg((c: any) => ({ ...c, ramSuspendThresholdMB: +e.target.value }))} />
              <Input label="Max History Messages" type="number" placeholder="50"
                value={botCfg.maxHistoryMessages || ''}
                onChange={e => setBotCfg((c: any) => ({ ...c, maxHistoryMessages: +e.target.value }))} />
              <Input label="Context Break (min)" type="number" placeholder="30"
                value={botCfg.contextBreakMin || ''}
                onChange={e => setBotCfg((c: any) => ({ ...c, contextBreakMin: +e.target.value }))} />
              <Input label="Gemma Daily Limit / Key" type="number" placeholder="1500"
                value={botCfg.gemmaDailyLimit || ''}
                onChange={e => setBotCfg((c: any) => ({ ...c, gemmaDailyLimit: +e.target.value }))} />
            </div>
            <Input label="Gemma Default Model" placeholder="gemma-4-26b"
              value={botCfg.gemmaDefaultModel || ''}
              onChange={e => setBotCfg((c: any) => ({ ...c, gemmaDefaultModel: e.target.value }))} />
            <Input label="Gemma Fallback Model" placeholder="gemma-4-31b"
              value={botCfg.gemmaFallbackModel || ''}
              onChange={e => setBotCfg((c: any) => ({ ...c, gemmaFallbackModel: e.target.value }))} />
          </div>
        </Card>
      </div>
    </div>
  );
}
