'use client';
import { useState } from 'react';
import { Terminal, Trash2, Save, RefreshCw, Bug, Power, Users, UserX, Hash } from 'lucide-react';
import { api } from '@/lib/api';
import { PageHeader, Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/providers/toast-provider';

interface CmdDef {
  id: string;
  title: string;
  desc: string;
  icon: React.ElementType;
  color?: string;
  inputs?: { id: string; label: string; placeholder: string; type?: string }[];
  action: (vals: string[]) => Promise<any>;
  danger?: boolean;
}

export default function CommandsPage() {
  const toast = useToast();
  const [loading, setLoading] = useState<string | null>(null);
  const [vals, setVals] = useState<Record<string, string>>({});

  const run = async (cmd: CmdDef, inputs: string[]) => {
    setLoading(cmd.id);
    try {
      const r: any = await cmd.action(inputs);
      if (r?.success || r?.ok) toast.success(`${cmd.title} completed`);
      else toast.error(`${cmd.title} failed`, r?.error || r?.message || 'Unknown error');
    } catch (e: any) { toast.error(`${cmd.title} failed`, e.message); }
    setLoading(null);
  };

  const v = (key: string) => vals[key] || '';
  const setV = (key: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setVals(prev => ({ ...prev, [key]: e.target.value }));

  const commands: CmdDef[] = [
    {
      id: 'save-state', title: 'Save State', icon: Save,
      desc: 'Persist in-memory bot state to disk.',
      action: () => api.saveState(),
    },
    {
      id: 'reload-commands', title: 'Reload Commands', icon: RefreshCw,
      desc: 'Hot-reload slash command definitions.',
      action: () => api.reloadCommands(),
    },
    {
      id: 'toggle-debug', title: 'Toggle Debug', icon: Bug,
      desc: 'Enable or disable verbose debug logging.',
      action: () => api.toggleDebug(),
    },
    {
      id: 'restart', title: 'Restart Bot', icon: Power, danger: true,
      desc: 'Restart the bot process. All connections will drop briefly.',
      action: () => api.restart(),
    },
    {
      id: 'clear-history', title: 'Clear Chat History', icon: Trash2,
      desc: 'Clear chat history for a user or channel.',
      inputs: [{ id: 'hist-id', label: 'User / Channel ID', placeholder: 'ID (leave blank for all)' }],
      action: ([id]) => api.clearHistory(id || undefined),
    },
    {
      id: 'clear-image', title: 'Clear Image Usage', icon: Trash2,
      desc: 'Reset image usage counters across all users.',
      action: () => api.clearImageUsage(),
    },
    {
      id: 'clear-all-usage', title: 'Clear All Usage', icon: Trash2, danger: true,
      desc: 'Reset ALL usage counters (summary, quotes, starters, compliments).',
      action: () => api.clearAllUsage(),
    },
    {
      id: 'clear-reminders', title: 'Clear Reminders', icon: Trash2,
      desc: 'Delete all pending reminders.',
      action: () => api.clearReminders(),
    },
    {
      id: 'dm-all-owners', title: 'DM All Server Owners', icon: Users,
      desc: 'Send a direct message to every server owner.',
      inputs: [{ id: 'owners-msg', label: 'Message', placeholder: 'Message to all owners…' }],
      action: ([msg]) => msg ? api.dmAllOwners(msg) : Promise.reject(new Error('Message required')),
    },
    {
      id: 'purge-blacklist', title: 'Purge Blacklist', icon: UserX, danger: true,
      desc: 'Remove all entries from the global blacklist.',
      action: () => api.purgeBlacklist(),
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader title="Admin Commands" description="Run bot controls directly without Discord. User ID or username works for user fields." />
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
        {commands.map(cmd => {
          const Icon = cmd.icon;
          const isLoading = loading === cmd.id;
          return (
            <div key={cmd.id}
              className="rounded-lg border border-[var(--border)] bg-[var(--bg-2)] dark:bg-[var(--gray-1)] p-4 flex flex-col gap-3 hover:border-[var(--border-2)] transition-colors">
              <div className="flex items-start gap-2.5">
                <div className={`w-8 h-8 rounded-md flex items-center justify-center shrink-0 ${cmd.danger ? 'bg-[var(--error-bg)]' : 'bg-[var(--accent-bg)]'}`}>
                  <Icon size={15} className={cmd.danger ? 'text-[var(--error)]' : 'text-[var(--accent)]'} aria-hidden />
                </div>
                <div className="min-w-0">
                  <p className="text-label-13 font-semibold text-[var(--fg)]">{cmd.title}</p>
                  <p className="text-xs text-[var(--fg-3)] mt-0.5 leading-relaxed">{cmd.desc}</p>
                </div>
              </div>

              {cmd.inputs?.map(inp => (
                <Input key={inp.id} label={inp.label} placeholder={inp.placeholder}
                  value={v(inp.id)} onChange={setV(inp.id)} type={inp.type} />
              ))}

              <Button
                variant={cmd.danger ? 'danger' : 'accent'}
                size="md"
                className="w-full mt-auto"
                loading={isLoading}
                onClick={() => run(cmd, cmd.inputs?.map(inp => v(inp.id)) || [])}
              >
                {cmd.title}
              </Button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
