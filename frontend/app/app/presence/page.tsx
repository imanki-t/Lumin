'use client';
import { useEffect, useState } from 'react';
import { Circle } from 'lucide-react';
import { api } from '@/lib/api';
import { PageHeader, Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { useToast } from '@/components/providers/toast-provider';

const statusOpts = [
  { value: 'online', label: '🟢 Online' },
  { value: 'idle', label: '🟡 Idle' },
  { value: 'dnd', label: '🔴 Do Not Disturb' },
  { value: 'invisible', label: '⚫ Invisible' },
];

const activityOpts = [
  { value: '0', label: 'Playing' },
  { value: '1', label: 'Streaming' },
  { value: '2', label: 'Listening to' },
  { value: '3', label: 'Watching' },
  { value: '5', label: 'Competing in' },
];

const presets = [
  { label: '🟢 Online', status: 'online', activity: '', type: '0' },
  { label: '🟡 Idle', status: 'idle', activity: '', type: '0' },
  { label: '🔴 DND', status: 'dnd', activity: '', type: '0' },
  { label: '⚫ Invisible', status: 'invisible', activity: '', type: '0' },
  { label: '🔧 Maintenance', status: 'dnd', activity: 'Bot maintenance', type: '3' },
  { label: '🎧 Listening', status: 'online', activity: 'your messages', type: '2' },
  { label: '📺 Watching Anime', status: 'online', activity: 'anime', type: '3' },
  { label: '📚 Homework Help', status: 'online', activity: 'homework help', type: '2' },
  { label: '🎮 Gaming', status: 'online', activity: 'video games', type: '0' },
  { label: '💤 AFK', status: 'idle', activity: 'be right back', type: '0' },
  { label: '🎵 J-Pop', status: 'online', activity: 'j-pop', type: '2' },
];

const TYPE_LABELS: Record<string, string> = { '0': 'Playing', '1': 'Streaming', '2': 'Listening to', '3': 'Watching', '5': 'Competing in' };
const STATUS_EMOJIS: Record<string, string> = { online: '🟢', idle: '🟡', dnd: '🔴', invisible: '⚫' };

export default function PresencePage() {
  const toast = useToast();
  const [current, setCurrent] = useState<any>(null);
  const [status, setStatus] = useState('online');
  const [activity, setActivity] = useState('');
  const [type, setType] = useState('0');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.getPresence().then((r: any) => { if (r?.success) setCurrent(r.presence); });
  }, []);

  const apply = async () => {
    setSaving(true);
    const r: any = await api.setPresence({ status, activity: activity || null, type: +type });
    if (r?.success) {
      toast.success('Presence updated');
      setCurrent({ status, activities: activity ? [{ name: activity, type: +type }] : [] });
    } else toast.error('Failed to update presence', r?.error);
    setSaving(false);
  };

  const setPreset = (p: typeof presets[0]) => {
    setStatus(p.status); setActivity(p.activity); setType(p.type);
  };

  return (
    <div className="space-y-5 max-w-2xl">
      <PageHeader title="Bot Presence" description="Control what status and activity the bot shows on Discord." />

      {/* Current presence */}
      <Card title="Current Presence">
        {current ? (
          <div className="flex items-center gap-3">
            <span className="text-xl" aria-hidden>{STATUS_EMOJIS[current.status] || '⚪'}</span>
            <div>
              <p className="text-label-13 font-semibold capitalize text-[var(--fg)]">{current.status}</p>
              {current.activities?.[0] && (
                <p className="text-xs text-[var(--fg-2)]">
                  {TYPE_LABELS[current.activities[0].type]} {current.activities[0].name}
                </p>
              )}
            </div>
          </div>
        ) : (
          <p className="text-sm text-[var(--fg-3)]">Loading current presence…</p>
        )}
      </Card>

      {/* Override */}
      <Card title="Set Presence">
        <div className="space-y-4">
          <Select label="Status" options={statusOpts} value={status} onValueChange={setStatus} />
          <div className="grid grid-cols-2 gap-3">
            <Input label="Activity Text" value={activity} onChange={e => setActivity(e.target.value)}
              placeholder="e.g. with 1000 servers" />
            <Select label="Activity Type" options={activityOpts} value={type} onValueChange={setType} />
          </div>
          <Button variant="accent" size="lg" className="w-full" loading={saving} onClick={apply}>
            Update Presence
          </Button>
        </div>
      </Card>

      {/* Presets */}
      <Card title="Quick Presets">
        <div className="flex flex-wrap gap-2">
          {presets.map(p => (
            <button key={p.label}
              onClick={() => setPreset(p)}
              className="px-3 py-1.5 rounded-md border border-[var(--border)] bg-[var(--bg-1)] text-xs text-[var(--fg-2)] hover:bg-[var(--accent-bg)] hover:text-[var(--accent)] hover:border-[var(--accent-border)] transition-colors cursor-pointer"
            >
              {p.label}
            </button>
          ))}
        </div>
      </Card>
    </div>
  );
}
