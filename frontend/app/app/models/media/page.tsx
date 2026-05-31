'use client';
import { useEffect, useState } from 'react';
import { Image, Video, Music, FileText, File } from 'lucide-react';
import { api } from '@/lib/api';
import { PageHeader, Card } from '@/components/ui/card';
import { Select } from '@/components/ui/select';
import { useToast } from '@/components/providers/toast-provider';

const boolOpts = [{ value: 'true', label: 'Enabled' }, { value: 'false', label: 'Disabled' }];
const boolOptsRev = [{ value: 'false', label: 'Disabled' }, { value: 'true', label: 'Enabled' }];

const mediaTypes = [
  { key: 'ENABLE_IMAGE_PROCESSING', label: 'Images', desc: 'PNG, JPEG, WebP', icon: Image, opts: boolOpts },
  { key: 'ENABLE_VIDEO_PROCESSING', label: 'Video', desc: 'MP4, MOV, WebM', icon: Video, opts: boolOptsRev },
  { key: 'ENABLE_AUDIO_PROCESSING', label: 'Audio', desc: 'MP3, WAV, OGG', icon: Music, opts: boolOptsRev },
  { key: 'ENABLE_FILE_PROCESSING', label: 'Generic Files', desc: 'Any file type', icon: File, opts: boolOptsRev },
  { key: 'PDF_ENABLED_FOR_GEMINI', label: 'PDFs', desc: 'Gemini-native PDF processing', icon: FileText, opts: boolOptsRev },
];

export default function MediaPage() {
  const toast = useToast();
  const [flags, setFlags] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getFeatureFlags().then((r: any) => {
      if (r?.flags) setFlags(r.flags);
      setLoading(false);
    });
  }, []);

  const toggle = async (key: string, val: string) => {
    const enabled = val === 'true';
    setFlags(f => ({ ...f, [key]: enabled }));
    const r: any = await api.toggleFeature(key, enabled);
    if (!r?.success) { toast.error('Failed'); setFlags(f => ({ ...f, [key]: !enabled })); }
    else toast.success(`${key.replace('ENABLE_', '').replace(/_/g, ' ')} ${enabled ? 'enabled' : 'disabled'}`);
  };

  return (
    <div className="space-y-5">
      <PageHeader title="Media Processing" description="Control which attachment types the bot accepts. Changes apply immediately." />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {mediaTypes.map(({ key, label, desc, icon: Icon, opts }) => (
          <Card key={key}>
            <div className="flex items-start gap-3 mb-4">
              <div className="w-9 h-9 rounded-lg bg-[var(--gray-1)] dark:bg-[var(--gray-2)] flex items-center justify-center shrink-0">
                <Icon size={16} className="text-[var(--fg-2)]" aria-hidden />
              </div>
              <div>
                <p className="text-label-13 font-semibold text-[var(--fg)]">{label}</p>
                <p className="text-xs text-[var(--fg-3)]">{desc}</p>
              </div>
            </div>
            {loading ? (
              <div className="h-8 rounded-md bg-[var(--gray-1)] animate-pulse" />
            ) : (
              <Select
                options={opts}
                value={flags[key] ? 'true' : 'false'}
                onValueChange={v => toggle(key, v)}
              />
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}
