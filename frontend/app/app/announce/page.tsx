'use client';
import { useState } from 'react';
import { Send } from 'lucide-react';
import { api } from '@/lib/api';
import { PageHeader, Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Textarea } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { useToast } from '@/components/providers/toast-provider';

const targetOpts = [
  { value: 'both', label: 'All (Servers + Users)' },
  { value: 'servers', label: 'Servers only' },
  { value: 'users', label: 'Users DM only' },
];
const fmtOpts = [
  { value: 'true', label: 'Rich Embed' },
  { value: 'false', label: 'Plain Text' },
];

export default function AnnouncePage() {
  const toast = useToast();
  const [target, setTarget] = useState('both');
  const [title, setTitle] = useState('Announcement');
  const [msg, setMsg] = useState('');
  const [color, setColor] = useState('#6D5AE6');
  const [fmt, setFmt] = useState('true');
  const [sending, setSending] = useState(false);
  const [ownersMsg, setOwnersMsg] = useState('');
  const [sendingOwners, setSendingOwners] = useState(false);

  const send = async () => {
    if (!msg.trim()) { toast.error('Message is required'); return; }
    setSending(true);
    const payload = { title, message: msg, color, embed: fmt === 'true', target };
    let r: any;
    if (target === 'users') r = await api.announceUsers(payload);
    else r = await api.announce(payload);
    if (r?.success) toast.success('Announcement sent', `Sent to: ${target}`);
    else toast.error('Failed to send', r?.error);
    setSending(false);
  };

  const sendOwners = async () => {
    if (!ownersMsg.trim()) { toast.error('Message is required'); return; }
    setSendingOwners(true);
    const r: any = await api.dmAllOwners(ownersMsg);
    if (r?.success) { toast.success('DM sent to all owners'); setOwnersMsg(''); }
    else toast.error('Failed', r?.error);
    setSendingOwners(false);
  };

  return (
    <div className="space-y-5">
      <PageHeader title="Global Announcement" description="Broadcast to all servers or DM users directly." />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Compose */}
        <Card title="Compose Announcement">
          <div className="space-y-4">
            <Select label="Target Audience" options={targetOpts} value={target} onValueChange={setTarget} />
            <Input label="Title" value={title} onChange={e => setTitle(e.target.value)} placeholder="Announcement title" />
            <Textarea label="Message" value={msg} onChange={e => setMsg(e.target.value)}
              placeholder="Write your announcement…" rows={5} />
            <div className="grid grid-cols-2 gap-3">
              <Input label="Embed Color" value={color} onChange={e => setColor(e.target.value)}
                placeholder="#6D5AE6" type="text" />
              <Select label="Format" options={fmtOpts} value={fmt} onValueChange={setFmt} />
            </div>
            <Button variant="accent" size="lg" className="w-full" loading={sending} icon={<Send size={14} />}
              onClick={send}>
              Send Announcement
            </Button>
          </div>
        </Card>

        {/* Preview + DM owners */}
        <div className="space-y-4">
          <Card title="Live Preview">
            <div className="rounded-lg bg-[#36393f] p-4 relative overflow-hidden min-h-28">
              <div className="absolute left-0 top-0 bottom-0 w-1 rounded-l-lg" style={{ background: color }} />
              <div className="ml-4">
                <p className="font-bold text-white mb-1">{title || 'Announcement'}</p>
                <p className="text-sm text-[#dcddde] leading-relaxed whitespace-pre-wrap">
                  {msg || 'Your message will appear here…'}
                </p>
              </div>
            </div>
            <p className="text-xs text-[var(--fg-3)] mt-2">
              Sent to the first writable #general or #announcements channel in each server.
            </p>
          </Card>

          <Card title="DM All Server Owners">
            <div className="space-y-3">
              <Textarea value={ownersMsg} onChange={e => setOwnersMsg(e.target.value)}
                placeholder="Message to all server owners…" rows={3} />
              <Button variant="ghost" size="md" className="w-full" loading={sendingOwners}
                icon={<Send size={13} />} onClick={sendOwners}>
                Send to All Owners
              </Button>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
