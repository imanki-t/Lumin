'use client';
import { useEffect, useState } from 'react';
import { Database, Search, Trash2, Save } from 'lucide-react';
import { api } from '@/lib/api';
import { PageHeader, Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/providers/toast-provider';
import { cn } from '@/lib/utils';

export default function DatabasePage() {
  const toast = useToast();
  const [collections, setCollections] = useState<string[]>([]);
  const [selected, setSelected] = useState('');
  const [docs, setDocs] = useState<any[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<{ id: string; raw: string } | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api.dbCollections().then((r: any) => setCollections(r?.collections || []));
  }, []);

  const loadDocs = async (col: string, p = 1) => {
    setLoading(true); setEditing(null);
    const r: any = await api.dbCollection(col, p);
    setDocs(r?.documents || []);
    setTotal(r?.total || 0);
    setPage(p);
    setLoading(false);
  };

  const selectCol = (col: string) => {
    setSelected(col); setSearch(''); loadDocs(col, 1);
  };

  const filtered = search
    ? docs.filter(d => JSON.stringify(d).toLowerCase().includes(search.toLowerCase()))
    : docs;

  const saveDoc = async () => {
    if (!editing) return;
    try {
      const data = JSON.parse(editing.raw);
      const r: any = await api.dbUpdateDoc(selected, editing.id, data);
      if (r?.success) { toast.success('Document updated'); loadDocs(selected, page); setEditing(null); }
      else toast.error('Failed to update', r?.error);
    } catch { toast.error('Invalid JSON'); }
  };

  const deleteDoc = async (id: string) => {
    if (!confirm('Delete this document?')) return;
    const r: any = await api.dbDeleteDoc(selected, id);
    if (r?.success) { toast.success('Document deleted'); loadDocs(selected, page); }
    else toast.error('Failed to delete', r?.error);
  };

  const pages = Math.ceil(total / 50);

  return (
    <div className="space-y-5">
      <PageHeader title="Database Browser" description="Browse and edit MongoDB collections." action={
        <Button size="sm" variant="ghost" onClick={() => api.dbCollections().then((r: any) => setCollections(r?.collections || []))}>
          Refresh
        </Button>
      } />

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        {/* Collections list */}
        <Card title="Collections">
          <div className="space-y-0.5">
            {collections.length === 0 ? (
              <p className="text-xs text-[var(--fg-3)] py-2">No collections found</p>
            ) : collections.map(col => (
              <button key={col}
                onClick={() => selectCol(col)}
                className={cn(
                  'w-full text-left px-2.5 py-2 rounded-md text-sm font-mono transition-colors',
                  selected === col
                    ? 'bg-[var(--accent-bg)] text-[var(--accent)] font-medium'
                    : 'text-[var(--fg-2)] hover:bg-[var(--gray-1)] hover:text-[var(--fg)]'
                )}
              >
                {col}
              </button>
            ))}
          </div>
        </Card>

        {/* Documents */}
        <div className="lg:col-span-3 space-y-3">
          {selected ? (
            <>
              <Card title={`${selected} · ${total} documents`} action={
                <div className="relative">
                  <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-[var(--fg-3)]" aria-hidden />
                  <input
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder="Filter…"
                    className="h-7 pl-6 pr-2.5 text-xs rounded-md border border-[var(--border)] bg-[var(--bg-1)] text-[var(--fg)] placeholder:text-[var(--fg-3)] outline-none focus:border-[var(--accent)] w-36"
                    style={{ fontSize: '13px' }}
                  />
                </div>
              }>
                {loading ? (
                  <div className="space-y-2">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <div key={i} className="h-10 rounded-md bg-[var(--gray-1)] animate-pulse" />
                    ))}
                  </div>
                ) : filtered.length === 0 ? (
                  <p className="text-sm text-[var(--fg-3)] text-center py-6">No documents found.</p>
                ) : (
                  <div className="space-y-1.5">
                    {filtered.map((doc, i) => {
                      const id = doc._id || doc.id || i;
                      const isEditing = editing?.id === String(id);
                      return (
                        <div key={String(id)}
                          className={cn(
                            'rounded-md border transition-colors',
                            isEditing ? 'border-[var(--accent-border)]' : 'border-[var(--border)]'
                          )}>
                          <div
                            className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-[var(--gray-1)] rounded-md"
                            onClick={() => setEditing(isEditing ? null : { id: String(id), raw: JSON.stringify(doc, null, 2) })}
                          >
                            <Database size={12} className="text-[var(--fg-3)] shrink-0" aria-hidden />
                            <span className="text-xs font-mono text-[var(--fg)] flex-1 truncate">{String(id)}</span>
                            <Button size="sm" variant="danger" icon={<Trash2 size={11} />}
                              aria-label="Delete document"
                              onClick={e => { e.stopPropagation(); deleteDoc(String(id)); }} />
                          </div>
                          {isEditing && (
                            <div className="border-t border-[var(--accent-border)] p-3 space-y-2">
                              <textarea
                                value={editing.raw}
                                onChange={e => setEditing(prev => prev ? { ...prev, raw: e.target.value } : null)}
                                rows={8}
                                spellCheck={false}
                                className="code-editor text-[11px]"
                              />
                              <div className="flex gap-2">
                                <Button size="sm" variant="accent" icon={<Save size={11} />} onClick={saveDoc}>Save</Button>
                                <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </Card>

              {pages > 1 && (
                <div className="flex items-center gap-1.5">
                  <Button size="sm" variant="ghost" disabled={page === 1} onClick={() => loadDocs(selected, page - 1)}>←</Button>
                  <span className="text-xs text-[var(--fg-3)] tabular-nums">{page}/{pages}</span>
                  <Button size="sm" variant="ghost" disabled={page === pages} onClick={() => loadDocs(selected, page + 1)}>→</Button>
                </div>
              )}
            </>
          ) : (
            <div className="flex flex-col items-center justify-center py-20 text-[var(--fg-3)] rounded-lg border border-[var(--border)]">
              <Database size={36} className="mb-3 opacity-30" />
              <p className="text-sm">Select a collection to browse documents.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
