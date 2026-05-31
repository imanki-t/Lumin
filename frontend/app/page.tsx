'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function RootPage() {
  const router = useRouter();
  useEffect(() => {
    const token = sessionStorage.getItem('lumin_dash_token');
    router.replace(token ? '/app' : '/gate');
  }, [router]);
  return null;
}
