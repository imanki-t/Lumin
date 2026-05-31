import type { Metadata } from 'next';
import AppShellClient from '@/components/layout/app-shell-client';

export const metadata: Metadata = { title: 'App' };

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <AppShellClient>{children}</AppShellClient>;
}
