'use client';
import { useState, useCallback } from 'react';
import { Search, UserX, MessageSquare, Trash2, Eye, RefreshCw } from 'lucide-react';
import { api } from '@/lib/api';
import { PageHeader, Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Textarea } from '@/components/ui/input';
import { Badge } from '@/components/ui/card';
import { useToast } from '@/components/providers/toast-provider';

export default function UsersPage() {
  const toast = useToast();

  // Lookup
  const [lookupId, setLookupId] = useState('');
  const [lookupResult, setLookupResult] = useState<any>(null);
  const [looking, setLooking] = useState(false);

  // DM
  const [dmId, setDmId] = useState('');
  const [dmMsg, setDmMsg] = useState('');
  const [sendingDm, setSendingDm] = useState(false);

  // Blacklist
  const [blId, setBlId] = useState('');
  const [blGuild, setBlGuild] = useState('');
  const [blistLoading, setBlistLoading] = useState<string | null>(null);
  const [blacklist, setBlacklist] = useState<any[]>([]);
  const [blLoading, setBlLoading] = useState(false);

  // History
  const [histId, setHistId] = useState('');
  const [history, setHistory] = useState<any[]>([]);
  const [histLoading, setHistLoading] = useState(false);

  const lookup = async () => {
    if (!lookupId.trim()) return;
    setLooking(true); setLookupResult(null);
    const r: any = await api.fetchUserProfile(lookupId.trim()).catch(() => null);
    setLookupResult(r?.user || r?.data || null);
    if (!r?.success) toast.error('User not found');
    setLooking(false);
  };

  const sendDm = async () => {
    if (!dmId.trim() || !dmMsg.trim()) return;
    setSendingDm(true);
    const r: any = await api.sendDm(dmId.trim(), dmMsg.trim());
    if (r?.success) { toast.success('DM sent'); setDmMsg(''); }
    else toast.error('DM failed', r?.error);
    setSendingDm(false);
  };

  const blacklistUser = async (action: 'add' | 'remove') => {
    if (!blId.trim()) { toast.error('Enter a User ID'); return; }
    setBlistLoading(action);
    const fn = action === 'add' ? api.blacklistUser : api.unblacklistUser;
    const r: any = await fn(blId.trim(), blGuild.trim() || undefined);
    if (r?.success) { toast.success(action === 'add' ? 'User blacklisted' : 'User removed from blacklist'); setBlId(''); setBlGuild(''); }
    else toast.error('Failed', r?.error);
    setBlistLoading(null);
  };

  const loadBlacklist = async () => {
    setBlLoading(true);
    const r: any = await api.getBlacklisted();
    setBlacklist(r?.data || []);
    setBlLoading(false);
  };

  const purgeBlacklist = async () => {
    if (!confirm('Purge all blacklisted users?')) return;
    const r: any = await api.purgeBlacklist();
    if (r?.success) { toast.success('Blacklist purged'); setBlacklist([]); }
    else toast.error('Failed');
  };

  const loadHistory = async () => {
    if (!histId.trim()) return;
    setHistLoading(true);
    const r: any = await api.getChatHistory(histId.trim());
    setHistory(r?.data || r?.history || []);
    setHistLoading(false);
  };

  const clearHistory = async () => {
    if (!histId.trim()) return;
    const r: any = await api.clearHistory(histId.trim());
    if (r?.success) { toast.success('History cleared'); setHistory([]); }
    else toast.error('Failed');
  };

  return (
    <div className="space-y-5">
      <PageHeader title="User Management" description="Look up users, manage blacklists, view chat history." />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Lookup */}
        <Card title="Look Up User">
          <div className="space-y-3">
            <Input
              label="User ID or Username"
              value={lookupId}
              onChange={e => setLookupId(e.target.value)}
              placeholder="123456789"
              onKeyDown={e => e.key === 'Enter' && lookup()}
            />
            <Button variant="accent" size="md" className="w-full" loading={looking} onClick={lookup}
              icon={<Search />}>
              Look Up
            </Button>
            {lookupResult && (
              <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-1)] p-3 space-y-2">
                <div className="flex items-center gap-2.5">
                  {lookupResult.avatar && (
                    <img src={lookupResult.avatar} alt="" width={36} height={36}
                      className="w-9 h-9 rounded-full border border-[var(--border)]" />
                  )}
                  <div>
                    <p className="text-label-13 font-semibold text-[var(--fg)]">{lookupResult.username || lookupResult.name || '—'}</p>
                    <p className="text-[10px] font-mono text-[var(--fg-3)]">{lookupResult.id || lookupId}</p>
                  </div>
                </div>
                {lookupResult.bot && <Badge variant="info">Bot</Badge>}
              </div>
            )}
          </div>
        </Card>

        {/* Send DM */}
        <Card title="Send DM">
          <div className="space-y-3">
            <Input label="User ID" value={dmId} onChange={e => setDmId(e.target.value)} placeholder="User ID" />
            <Textarea label="Message" value={dmMsg} onChange={e => setDmMsg(e.target.value)}
              placeholder="Write your message…" rows={4} />
            <Button variant="accent" size="md" className="w-full" loading={sendingDm} onClick={sendDm}
              icon={<MessageSquare />}>
              Send DM
            </Button>
          </div>
        </Card>

        {/* Blacklist */}
        <Card title="Blacklist">
          <div className="space-y-3">
            <Input label="User ID" value={blId} onChange={e => setBlId(e.target.value)} placeholder="User ID" />
            <Input label="Guild ID (optional)" value={blGuild} onChange={e => setBlGuild(e.target.value)} placeholder="Guild ID" />
            <div className="flex gap-2">
              <Button variant="danger" size="md" className="flex-1" loading={blistLoading === 'add'}
                onClick={() => blacklistUser('add')}>Blacklist</Button>
              <Button variant="ghost" size="md" className="flex-1" loading={blistLoading === 'remove'}
                onClick={() => blacklistUser('remove')}>Remove</Button>
            </div>
          </div>
        </Card>
      </div>

      {/* Chat History */}
      <Card title="Chat History" action={
        <div className="flex items-center gap-2">
          <input
            value={histId}
            onChange={e => setHistId(e.target.value)}
            placeholder="User / Channel ID"
            onKeyDown={e => e.key === 'Enter' && loadHistory()}
            className="h-7 px-2.5 text-sm rounded-md border border-[var(--border)] bg-[var(--bg-1)] text-[var(--fg)] placeholder:text-[var(--fg-3)] outline-none focus:border-[var(--accent)] w-44"
            style={{ fontSize: '14px' }}
          />
          <Button size="sm" variant="accent" loading={histLoading} onClick={loadHistory} icon={<Eye />}>View</Button>
          <Button size="sm" variant="danger" onClick={clearHistory} icon={<Trash2 />}>Clear</Button>
        </div>
      }>
        {history.length === 0 ? (
          <p className="text-sm text-[var(--fg-3)] text-center py-4">Enter a User or Channel ID above to view history.</p>
        ) : (
          <div className="space-y-2 max-h-72 overflow-y-auto">
            {history.map((msg: any, i) => (
              <div key={i} className="flex gap-2 text-xs rounded-md bg-[var(--bg-1)] border border-[var(--border)] px-2.5 py-2">
                <Badge variant={msg.role === 'user' ? 'info' : 'accent'} className="shrink-0 self-start mt-0.5">{msg.role}</Badge>
                <p className="text-[var(--fg-2)] leading-relaxed">{String(msg.content || '').slice(0, 200)}</p>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Blacklisted Users */}
      <Card title="Blacklisted Users" action={
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" loading={blLoading} onClick={loadBlacklist} icon={<RefreshCw />}>Load</Button>
          <Button size="sm" variant="danger" onClick={purgeBlacklist} icon={<Trash2 />}>Purge All</Button>
        </div>
      }>
        {blacklist.length === 0 ? (
          <p className="text-sm text-[var(--fg-3)] text-center py-4">Click Load to view blacklisted users.</p>
        ) : (
          <div className="space-y-1.5">
            {blacklist.map((entry: any, i) => (
              <div key={i} className="flex items-center justify-between gap-3 px-2.5 py-2 rounded-md bg-[var(--bg-1)] border border-[var(--border)] text-xs">
                <span className="font-mono text-[var(--fg)]">{entry.userId || entry.id}</span>
                {entry.guildId && <Badge variant="default">{entry.guildId}</Badge>}
                <Button size="sm" variant="ghost"
                  onClick={async () => {
                    await api.unblacklistUser(entry.userId || entry.id, entry.guildId);
                    toast.success('Removed'); loadBlacklist();
                  }}>
                  Remove
                </Button>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
