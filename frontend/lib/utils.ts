import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const fmtBytes = (b: number, d = 1): string => {
  if (!b || b < 0) return '—';
  if (b < 1024) return `${b} B`;
  if (b < 1048576) return `${(b / 1024).toFixed(d)} KB`;
  if (b < 1073741824) return `${(b / 1048576).toFixed(d)} MB`;
  return `${(b / 1073741824).toFixed(d)} GB`;
};

export const fmtUptime = (s: number): string => {
  s = Math.floor(s || 0);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${sec}s`;
};

export const fmtNum = (n: number | null | undefined): string => {
  if (n == null) return '—';
  return Number(n).toLocaleString();
};

export const fmtPing = (ms: number): string =>
  ms < 0 ? '—' : `${ms} ms`;

export const pingQuality = (ms: number): string => {
  if (ms < 0) return 'Offline';
  if (ms < 150) return 'Excellent';
  if (ms < 300) return 'Good';
  return 'High latency';
};
