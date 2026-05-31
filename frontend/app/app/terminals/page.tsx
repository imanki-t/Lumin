'use client';
import { useEffect, useRef, useState } from 'react';
import { Terminal, Database, Code2, RotateCcw } from 'lucide-react';
import { PageHeader, Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/providers/toast-provider';
import { cn } from '@/lib/utils';

type TermTab = 'node' | 'mongo' | 'shell';

const TABS: { id: TermTab; label: string; icon: React.ElementType; desc: string; color: string }[] = [
  { id: 'node',  label: 'Node.js REPL',  icon: Code2,     desc: 'Evaluate JS/TS in the bot process context', color: 'text-[#83cd29]' },
  { id: 'mongo', label: 'MongoDB Shell', icon: Database,   desc: 'Run raw MongoDB queries', color: 'text-[#4db33d]' },
  { id: 'shell', label: 'Bash Shell',    icon: Terminal,   desc: 'System shell — handle with care', color: 'text-[var(--warning)]' },
];

const WELCOME: Record<TermTab, string[]> = {
  node:  ['Lumin Node.js REPL', 'Connected to bot process. Type JavaScript and press Enter.', 'Examples: bot.guilds.cache.size  |  require("./utils").fmtBytes(1024)'],
  mongo: ['Lumin MongoDB Shell', 'Connected to bot database. Type MongoDB commands.', 'Examples: db.getCollectionNames()  |  db.users.findOne({})'],
  shell: ['Lumin Bash Shell', '⚠  Be careful — commands run as the bot user.', 'Examples: ls -la  |  ps aux  |  cat logs/bot.log'],
};

interface Line { type: 'in' | 'out' | 'err' | 'info'; text: string; }

function TerminalPane({ tab, active }: { tab: TermTab; active: boolean }) {
  const toast = useToast();
  const [lines, setLines] = useState<Line[]>(() =>
    WELCOME[tab].map((t, i) => ({ type: i === 0 ? 'info' : 'out' as Line['type'], text: t }))
  );
  const [input, setInput] = useState('');
  const [history, setHistory] = useState<string[]>([]);
  const [histIdx, setHistIdx] = useState(-1);
  const [running, setRunning] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [lines]);

  useEffect(() => {
    if (active) inputRef.current?.focus();
  }, [active]);

  const push = (type: Line['type'], text: string) =>
    setLines(prev => [...prev, { type, text }]);

  const run = async () => {
    const cmd = input.trim();
    if (!cmd) return;
    push('in', cmd);
    setHistory(h => [cmd, ...h.slice(0, 49)]);
    setHistIdx(-1);
    setInput('');
    setRunning(true);

    try {
      const token = sessionStorage.getItem('lumin_dash_token') || '';
      const endpoint = tab === 'node' ? 'eval' : tab === 'mongo' ? 'mongo' : 'exec';
      const body = tab === 'node' ? { code: cmd } : tab === 'mongo' ? { command: cmd } : { command: cmd };
      const res = await fetch(`/dashboard/api/terminal/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-token': token },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.output !== undefined) push('out', String(data.output));
      else if (data.result !== undefined) push('out', typeof data.result === 'string' ? data.result : JSON.stringify(data.result, null, 2));
      else if (data.error) push('err', data.error);
      else push('out', JSON.stringify(data, null, 2));
    } catch (e: any) {
      push('err', e.message || 'Request failed');
    }
    setRunning(false);
  };

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') { run(); return; }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      const next = Math.min(histIdx + 1, history.length - 1);
      setHistIdx(next); setInput(history[next] || '');
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const next = Math.max(histIdx - 1, -1);
      setHistIdx(next); setInput(next === -1 ? '' : history[next]);
    }
    if (e.key === 'l' && e.ctrlKey) { e.preventDefault(); setLines([]); }
  };

  const lineColor: Record<Line['type'], string> = {
    in:   'text-[var(--accent)]',
    out:  'text-[#e2e8f0]',
    err:  'text-[var(--error)]',
    info: 'text-[var(--fg-3)]',
  };

  const prompts: Record<TermTab, string> = {
    node:  '▸ ',
    mongo: '> ',
    shell: '$ ',
  };

  return (
    <div className={cn('flex flex-col h-[480px]', !active && 'hidden')} role="region" aria-label={`${tab} terminal`}>
      {/* Output */}
      <div
        className="flex-1 overflow-y-auto bg-[#0d0d0d] rounded-t-lg p-4 font-mono text-xs leading-relaxed"
        onClick={() => inputRef.current?.focus()}
        aria-live="polite"
        aria-label="Terminal output"
      >
        {lines.map((l, i) => (
          <div key={i} className={cn('whitespace-pre-wrap break-all', lineColor[l.type])}>
            {l.type === 'in' ? <span className="text-[var(--fg-3)]">{prompts[tab]}</span> : null}
            {l.text}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="flex items-center gap-0 bg-[#111111] border-t border-[var(--border)] rounded-b-lg px-3 py-2">
        <span className="font-mono text-xs text-[var(--accent)] shrink-0 mr-1.5" aria-hidden>
          {prompts[tab]}
        </span>
        <input
          ref={inputRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={onKey}
          disabled={running}
          aria-label={`${tab} terminal input`}
          placeholder={running ? 'Running…' : 'Type a command and press Enter · Ctrl+L to clear · ↑↓ history'}
          className="flex-1 bg-transparent text-xs font-mono text-[#e2e8f0] outline-none placeholder:text-[#444] disabled:opacity-50"
          autoComplete="off"
          spellCheck={false}
        />
        {running && (
          <span className="text-[10px] text-[var(--fg-3)] animate-pulse shrink-0">Running…</span>
        )}
      </div>
    </div>
  );
}

export default function TerminalsPage() {
  const [tab, setTab] = useState<TermTab>('node');

  return (
    <div className="space-y-5">
      <PageHeader
        title="Terminals"
        description="Node.js REPL, MongoDB shell, and Bash — all in-browser."
      />

      <Card>
        {/* Tab bar */}
        <div className="flex items-center gap-1 border-b border-[var(--border)] mb-4 -mt-1 pb-0">
          {TABS.map(t => {
            const Icon = t.icon;
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                role="tab"
                aria-selected={active}
                aria-controls={`panel-${t.id}`}
                onClick={() => setTab(t.id)}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-2 text-xs font-medium transition-colors border-b-2 -mb-px',
                  active
                    ? 'border-[var(--accent)] text-[var(--fg)]'
                    : 'border-transparent text-[var(--fg-3)] hover:text-[var(--fg-2)]'
                )}
              >
                <Icon size={12} className={active ? t.color : ''} aria-hidden />
                {t.label}
              </button>
            );
          })}
        </div>

        {/* Desc */}
        <p className="text-xs text-[var(--fg-3)] mb-3">
          {TABS.find(t => t.id === tab)?.desc}
        </p>

        {/* Panels */}
        {TABS.map(t => (
          <div key={t.id} id={`panel-${t.id}`} role="tabpanel">
            <TerminalPane tab={t.id} active={tab === t.id} />
          </div>
        ))}
      </Card>

      {/* Tips */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {TABS.map(t => {
          const Icon = t.icon;
          return (
            <div key={t.id} className="rounded-lg border border-[var(--border)] p-3.5 bg-[var(--bg-2)] dark:bg-[var(--gray-1)]">
              <div className="flex items-center gap-2 mb-2">
                <Icon size={13} className={t.color} aria-hidden />
                <span className="text-label-12 font-semibold text-[var(--fg)]">{t.label}</span>
              </div>
              <ul className="space-y-1 text-[11px] font-mono text-[var(--fg-3)]">
                {t.id === 'node'  && <><li>bot.guilds.cache.size</li><li>Date.now()</li><li>require('./config')</li></>}
                {t.id === 'mongo' && <><li>db.users.count()</li><li>db.servers.findOne()</li><li>db.getCollectionNames()</li></>}
                {t.id === 'shell' && <><li>pm2 status</li><li>df -h</li><li>tail -f logs/bot.log</li></>}
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
}
