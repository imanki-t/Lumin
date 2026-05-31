'use client';
import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';

// Vercel triangle logo
const VercelTriangle = ({ size = 32 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 116 100" fill="currentColor" aria-hidden>
    <path d="M57.5 0L115 100H0L57.5 0z" />
  </svg>
);

const GoogleIcon = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden>
    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
  </svg>
);

function GateContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const token = sessionStorage.getItem('lumin_dash_token');
    if (token) { router.replace('/app'); return; }

    const urlToken = searchParams.get('token');
    if (urlToken) {
      sessionStorage.setItem('lumin_dash_token', urlToken);
      router.replace('/app');
      return;
    }

    const authErr = searchParams.get('auth');
    if (authErr === 'denied') setError('Access denied. Only the authorized account may sign in.');
    else if (authErr === 'error') setError('Authentication error. Please try again.');
    else if (authErr === 'invalid_state') setError('Session expired during sign-in. Please try again.');
  }, [router, searchParams]);

  const handleLogin = () => {
    setLoading(true);
    window.location.href = '/dashboard/auth/google';
  };

  return (
    <div className="min-h-dvh flex items-center justify-center bg-[var(--bg-1)] relative overflow-hidden">
      {/* Background grid */}
      <div className="absolute inset-0 pointer-events-none" aria-hidden>
        <div
          className="absolute inset-0 opacity-[0.04]"
          style={{
            backgroundImage: 'linear-gradient(var(--fg) 1px, transparent 1px), linear-gradient(90deg, var(--fg) 1px, transparent 1px)',
            backgroundSize: '48px 48px',
          }}
        />
        <div
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full"
          style={{ background: 'radial-gradient(circle, rgba(109,90,230,0.06) 0%, transparent 70%)' }}
        />
      </div>

      {/* Card */}
      <div className="relative z-10 w-full max-w-sm mx-4">
        <div
          className="rounded-xl border border-[var(--border-2)] bg-[var(--bg-2)] dark:bg-[var(--gray-1)] p-8"
          style={{ boxShadow: '0 8px 32px rgba(0,0,0,0.12), 0 24px 80px rgba(0,0,0,0.08)' }}
        >
          {/* Brand */}
          <div className="flex items-center gap-3 mb-8">
            <div className="w-9 h-9 rounded-lg flex items-center justify-center bg-[var(--fg)] text-[var(--bg-1)] shrink-0">
              <VercelTriangle size={18} />
            </div>
            <div>
              <div className="text-base font-bold tracking-widest text-[var(--fg)] uppercase">Lumin</div>
              <div className="text-[10px] text-[var(--fg-3)] uppercase tracking-widest">Control Panel</div>
            </div>
          </div>

          {/* Error */}
          {error && (
            <div
              role="alert"
              className="mb-5 px-3.5 py-2.5 rounded-lg border border-[color:rgba(239,68,68,0.3)] bg-[var(--error-bg)] text-[var(--error)] text-sm"
            >
              {error}
            </div>
          )}

          <h1 className="text-heading-20 text-[var(--fg)] mb-1.5">Sign in</h1>
          <p className="text-copy-13 text-[var(--fg-2)] mb-7 leading-relaxed">
            Use your authorized Google account to access the control panel.
          </p>

          <button
            onClick={handleLogin}
            disabled={loading}
            className="w-full flex items-center justify-center gap-3 px-4 py-2.5 rounded-lg bg-white text-[#3c4043] text-sm font-semibold border border-[rgba(0,0,0,0.1)] cursor-pointer transition-all hover:shadow-md hover:-translate-y-px active:translate-y-0 disabled:opacity-60 disabled:cursor-not-allowed"
            style={{ boxShadow: '0 1px 4px rgba(0,0,0,0.15)' }}
          >
            <GoogleIcon />
            {loading ? 'Redirecting…' : 'Continue with Google'}
          </button>

          <p className="text-center text-[11px] text-[var(--fg-3)] mt-5">
            Protected by Google OAuth ·{' '}
            <a href="https://policies.google.com/privacy" target="_blank" rel="noopener" className="underline hover:text-[var(--fg-2)]">Privacy</a>
            {' · '}
            <a href="https://policies.google.com/terms" target="_blank" rel="noopener" className="underline hover:text-[var(--fg-2)]">Terms</a>
          </p>
        </div>
      </div>
    </div>
  );
}

export default function GatePage() {
  return (
    <Suspense>
      <GateContent />
    </Suspense>
  );
}
