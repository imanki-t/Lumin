'use client';
import { useState } from 'react';
import { FileText, Folder, ChevronRight, Save, Trash2, Home } from 'lucide-react';
import { api } from '@/lib/api';
import { PageHeader, Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/providers/toast-provider';
import { cn } from '@/lib/utils';

interface FsEntry { name: string; type: 'file' | 'dir'; path: string; size?: number; }

export default function FilesPage() {
  const toast = useToast();
  const [pathParts, setPathParts] = useState<string[]>([]);
  const [entries, setEntries] = useState<FsEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [file, setFile] = useState<{ path: string; content: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const nav = async (path: string) => {
    setLoading(true); setFile(null);
    const r: any = await api.files(path);
    setEntries(r?.files || r?.entries || []);
    setPathParts(path ? path.split('/').filter(Boolean) : []);
    setLoading(false);
  };

  const openFile = async (entry: FsEntry) => {
    if (entry.type === 'dir') { nav(entry.path); return; }
    const r: any = await api.files(entry.path);
    if (r?.content !== undefined) setFile({ path: entry.path, content: r.content });
    else toast.error('Could not open file');
  };

  const save = async () => {
    if (!file) return;
    setSaving(true);
    const r: any = await api.saveFile(file.path, file.content);
    if (r?.success) toast.success('File saved');
    else toast.error('Failed to save', r?.error);
    setSaving(false);
  };

  const deleteFile = async () => {
    if (!file) return;
    if (!confirm(`Delete ${file.path}?`)) return;
    const r: any = await api.deleteFile(file.path);
    if (r?.success) { toast.success('File deleted'); setFile(null); nav(pathParts.slice(0, -1).join('/')); }
    else toast.error('Failed to delete');
  };

  const currentPath = pathParts.join('/');

  return (
    <div className="space-y-5">
      <PageHeader title="File Browser" description="Browse, view, and edit bot files. Backups are created on save." action={
        <Button size="sm" variant="ghost" icon={<Home size={12} />} onClick={() => nav('')}>Root</Button>
      } />

      {/* Breadcrumb */}
      <nav aria-label="File path" className="flex items-center gap-1 text-xs text-[var(--fg-2)]">
        <button onClick={() => nav('')} className="hover:text-[var(--fg)] transition-colors">root</button>
        {pathParts.map((part, i) => (
          <span key={i} className="flex items-center gap-1">
            <ChevronRight size={10} className="text-[var(--fg-3)]" aria-hidden />
            <button
              onClick={() => nav(pathParts.slice(0, i + 1).join('/'))}
              className="hover:text-[var(--fg)] transition-colors font-mono"
            >{part}</button>
          </span>
        ))}
      </nav>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        {/* File list */}
        <div className="lg:col-span-2">
          <Card title="Files">
            {loading ? (
              <div className="space-y-1">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className="h-8 rounded-md bg-[var(--gray-1)] animate-pulse" />
                ))}
              </div>
            ) : entries.length === 0 ? (
              <div className="text-center py-8">
                <p className="text-sm text-[var(--fg-3)]">
                  {currentPath ? 'Empty directory' : 'Click "Root" to browse files'}
                </p>
                {!currentPath && (
                  <Button size="sm" variant="ghost" className="mt-3" onClick={() => nav('')}>Load Files</Button>
                )}
              </div>
            ) : (
              <div className="space-y-0.5">
                {entries.map(entry => (
                  <button
                    key={entry.path}
                    onClick={() => openFile(entry)}
                    className={cn(
                      'w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-left text-sm transition-colors',
                      file?.path === entry.path
                        ? 'bg-[var(--accent-bg)] text-[var(--accent)]'
                        : 'text-[var(--fg-2)] hover:bg-[var(--gray-1)] hover:text-[var(--fg)]'
                    )}
                  >
                    {entry.type === 'dir'
                      ? <Folder size={13} className="shrink-0 text-[var(--warning)]" aria-hidden />
                      : <FileText size={13} className="shrink-0 text-[var(--fg-3)]" aria-hidden />
                    }
                    <span className="font-mono truncate text-xs">{entry.name}</span>
                    {entry.type === 'dir' && <ChevronRight size={11} className="ml-auto text-[var(--fg-3)]" aria-hidden />}
                  </button>
                ))}
              </div>
            )}
          </Card>
        </div>

        {/* Editor */}
        <div className="lg:col-span-3">
          {file ? (
            <Card title={file.path.split('/').pop() || file.path} action={
              <div className="flex gap-1.5">
                <Button size="sm" variant="accent" loading={saving} icon={<Save size={11} />} onClick={save}>Save</Button>
                <Button size="sm" variant="danger" icon={<Trash2 size={11} />} onClick={deleteFile}>Delete</Button>
              </div>
            }>
              <textarea
                value={file.content}
                onChange={e => setFile(prev => prev ? { ...prev, content: e.target.value } : null)}
                rows={28}
                spellCheck={false}
                className="code-editor text-[11px]"
                aria-label={`Edit ${file.path}`}
              />
            </Card>
          ) : (
            <div className="flex flex-col items-center justify-center rounded-lg border border-[var(--border)] h-64 text-[var(--fg-3)]">
              <FileText size={36} className="mb-3 opacity-30" />
              <p className="text-sm">Select a file to view and edit.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
