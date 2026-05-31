'use client';
import { createContext, useContext, useCallback, useState, useEffect, useRef } from 'react';
import { X, CheckCircle, AlertCircle, AlertTriangle, Info } from 'lucide-react';
import { cn } from '@/lib/utils';

type ToastType = 'success' | 'error' | 'warning' | 'info';

interface Toast {
  id: string;
  type: ToastType;
  title: string;
  message?: string;
  duration?: number;
}

interface ToastContextValue {
  toast: (opts: Omit<Toast, 'id'>) => void;
  success: (title: string, message?: string) => void;
  error: (title: string, message?: string) => void;
  warning: (title: string, message?: string) => void;
  info: (title: string, message?: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}

const icons: Record<ToastType, React.ElementType> = {
  success: CheckCircle,
  error: AlertCircle,
  warning: AlertTriangle,
  info: Info,
};

const styles: Record<ToastType, string> = {
  success: 'border-[var(--success)] bg-[var(--success-bg)] text-[var(--success)]',
  error:   'border-[var(--error)] bg-[var(--error-bg)] text-[var(--error)]',
  warning: 'border-[var(--warning)] bg-[var(--warning-bg)] text-[var(--warning)]',
  info:    'border-[var(--info)] bg-[var(--info-bg)] text-[var(--info)]',
};

function ToastItem({ toast, onRemove }: { toast: Toast; onRemove: (id: string) => void }) {
  const timerRef = useRef<NodeJS.Timeout>();
  const Icon = icons[toast.type];

  useEffect(() => {
    timerRef.current = setTimeout(() => onRemove(toast.id), toast.duration ?? 4000);
    return () => clearTimeout(timerRef.current);
  }, [toast, onRemove]);

  return (
    <div
      role="alert"
      aria-live="polite"
      className={cn(
        'flex items-start gap-3 w-full max-w-sm rounded-lg border p-3.5 shadow-dark-md',
        'bg-[var(--bg-1)] border-[var(--border-2)]',
        'animate-slide-up text-[var(--fg)]',
        'transition-opacity duration-200'
      )}
    >
      <Icon
        size={16}
        className={cn('mt-0.5 shrink-0', {
          'text-[var(--success)]': toast.type === 'success',
          'text-[var(--error)]':   toast.type === 'error',
          'text-[var(--warning)]': toast.type === 'warning',
          'text-[var(--info)]':    toast.type === 'info',
        })}
        aria-hidden
      />
      <div className="flex-1 min-w-0">
        <p className="text-label-13 font-medium text-[var(--fg)]">{toast.title}</p>
        {toast.message && (
          <p className="text-copy-13 text-[var(--fg-2)] mt-0.5">{toast.message}</p>
        )}
      </div>
      <button
        onClick={() => onRemove(toast.id)}
        aria-label="Dismiss notification"
        className="shrink-0 p-0.5 rounded text-[var(--fg-3)] hover:text-[var(--fg)] hover:bg-[var(--gray-2)] transition-colors"
      >
        <X size={12} />
      </button>
    </div>
  );
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const remove = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const add = useCallback((opts: Omit<Toast, 'id'>) => {
    const id = crypto.randomUUID();
    setToasts(prev => [...prev.slice(-4), { ...opts, id }]);
  }, []);

  const value: ToastContextValue = {
    toast: add,
    success: (title, message) => add({ type: 'success', title, message }),
    error:   (title, message) => add({ type: 'error',   title, message }),
    warning: (title, message) => add({ type: 'warning', title, message }),
    info:    (title, message) => add({ type: 'info',    title, message }),
  };

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        aria-label="Notifications"
        className="fixed bottom-4 right-4 z-[9999] flex flex-col gap-2 items-end pointer-events-none"
      >
        {toasts.map(t => (
          <div key={t.id} className="pointer-events-auto w-full">
            <ToastItem toast={t} onRemove={remove} />
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
