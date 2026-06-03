import Head from 'next/head';

export default function Dashboard() {
  return (
    <>
      <Head>
        <title>Lumin — Control Panel</title>
        <meta name="viewport" content="width=device-width,initial-scale=1.0,viewport-fit=cover" />
      </Head>

      {/* ── Skip link ── */}
      <a
        href="#content"
        style={{
          position: 'absolute', top: '-40px', left: '8px', zIndex: 10000,
          background: 'var(--ac)', color: '#fff', padding: '6px 12px',
          borderRadius: 'var(--r8)', fontSize: '12px', fontWeight: 600,
          transition: 'top 120ms',
        }}
        onFocus={e => (e.currentTarget.style.top = '8px')}
        onBlur={e => (e.currentTarget.style.top = '-40px')}
      >
        Skip to content
      </a>

      {/* ══ LOGIN ══════════════════════════════════════════════════════════ */}
      <div id="login-page">
        <div className="lg-bg">
          <div className="lg-grid" />
          <div className="lg-radial" />
        </div>

        <div className="login-card" role="main">
          <div className="lc-brand">
            <img
              src="/lumin.png"
              className="lc-logo"
              alt="Lumin"
              width={44} height={44}
              onError={e => (e.currentTarget.style.display = 'none')}
            />
            <div>
              <div className="lc-name">Lumin</div>
              <div className="lc-sub">Control Panel</div>
            </div>
          </div>

          <div id="login-alert" className="hidden" role="alert" />

          <h1 className="lc-h">Administrator Access</h1>
          <p className="lc-p">Sign in with your authorised Google account to access the dashboard.</p>

          <button
            className="btn-google"
            id="google-btn"
            onClick={() => window._initiateLogin?.()}
            type="button"
          >
            {/* Google G mark */}
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
            </svg>
            Continue with Google
          </button>

          <p className="lc-note">
            Protected by reCAPTCHA&nbsp;&middot;&nbsp;
            <a href="https://policies.google.com/privacy" target="_blank" rel="noreferrer">Privacy</a>
            &nbsp;&middot;&nbsp;
            <a href="https://policies.google.com/terms" target="_blank" rel="noreferrer">Terms</a>
          </p>
        </div>
      </div>

      {/* ══ APP ════════════════════════════════════════════════════════════ */}
      <div id="app" className="hidden">

        {/* ── Sidebar ─────────────────────────────────────────────────── */}
        <nav id="sidebar" aria-label="Main navigation">
          {/* Brand */}
          <div className="sb-brand">
            <img
              src="/lumin.png"
              className="sb-logo"
              alt=""
              width={32} height={32}
              onError={e => (e.currentTarget.style.display = 'none')}
            />
            <div>
              <div className="sb-name">Lumin</div>
              <div className="sb-sub">Control Panel</div>
            </div>
          </div>

          {/* Connection status */}
          <div className="sb-status" aria-live="polite">
            <div className="sb-dot" id="sb-dot" aria-hidden="true" />
            <span className="sb-ping mono" id="sb-ping">—</span>
            <span className="sb-sep" aria-hidden="true">·</span>
            <span className="sb-ws" id="sb-status">Connecting</span>
          </div>

          {/* Nav items rendered by router.js */}
          <div className="sb-nav" id="sb-nav" role="list" />

          {/* User footer */}
          <div className="sb-footer">
            <img
              className="sb-av"
              id="sb-av"
              src=""
              alt="Your avatar"
              width={28} height={28}
              onError={e => (e.currentTarget.style.display = 'none')}
            />
            <div className="sb-ui">
              <div className="sb-un" id="sb-un">—</div>
              <div className="sb-ue mono" id="sb-ue">—</div>
            </div>
            <button
              className="sb-out"
              aria-label="Sign out"
              onClick={() => window._logout?.()}
              type="button"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9"/>
              </svg>
            </button>
          </div>
        </nav>

        {/* ── Main ────────────────────────────────────────────────────── */}
        <div id="main">

          {/* Topbar */}
          <header id="topbar">
            <button
              className="tb-menu"
              id="tb-menu"
              aria-label="Toggle sidebar"
              onClick={() => window._toggleSidebar?.()}
              type="button"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <line x1="3" y1="6" x2="21" y2="6"/>
                <line x1="3" y1="12" x2="21" y2="12"/>
                <line x1="3" y1="18" x2="21" y2="18"/>
              </svg>
            </button>

            <h2 className="tb-title" id="tb-title">Overview</h2>

            <div className="tb-right">
              <span className="tb-stat mono" id="tb-ping" aria-label="WebSocket ping">— ms</span>
              <time className="tb-clk mono" id="tb-clk" aria-live="off" />
              <div className="tb-chip hidden" id="tb-chip" role="status" aria-live="assertive">LOCKDOWN</div>
            </div>
          </header>

          {/* Content area */}
          <div id="content">

            {/* ══ OVERVIEW ════════════════════════════════════════════ */}
            <section className="section active" id="section-overview" aria-labelledby="ovr-heading">
              <h2 id="ovr-heading" className="hidden">Overview</h2>

              {/* Bot Identity Hero — prominent, at top */}
              <div className="bot-hero">
                <div className="bot-hero-banner" aria-hidden="true" />

                <div className="bot-hero-body">
                  <div className="bot-hero-left">
                    <div className="bot-hero-av-wrap">
                      <img
                        className="bot-av"
                        id="bot-av"
                        src=""
                        alt="Bot avatar"
                        width={80} height={80}
                        style={{ display: 'none' }}
                      />
                      <div className="bot-hero-status-ring" id="bot-status-ring" aria-hidden="true" />
                    </div>

                    <div className="bot-hero-info">
                      <div className="bot-hero-name-row">
                        <div className="bot-name" id="bot-name">—</div>
                      </div>
                      <div className="bot-tag" id="bot-tag">—</div>
                      <div className="bot-id mono" id="bot-id">—</div>

                      <div className="bot-hero-badges">
                        <span className="bot-badge bot-badge-verified" aria-label="Verified Bot">
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                            <path d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"/>
                          </svg>
                          Verified Bot
                        </span>
                        <span className="bot-badge bot-badge-slash">/ Slash Commands</span>
                        <span className="bot-badge bot-badge-app">Application</span>
                      </div>
                    </div>
                  </div>

                  <div className="bot-hero-right">
                    {/* DB status */}
                    <div className="bot-hero-db">
                      <div className="db-dot" id="db-dot" aria-hidden="true" />
                      <span id="db-status-text" style={{ fontSize: '11px' }}>Checking…</span>
                    </div>

                    {/* Hero quick actions */}
                    <div className="bot-hero-actions">
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => window._copyInvite?.()}
                        type="button"
                      >
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                          <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/>
                          <path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/>
                        </svg>
                        Copy Invite
                      </button>
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => window._navigate?.('presence')}
                        type="button"
                      >
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                          <circle cx="12" cy="12" r="10"/>
                          <path d="M12 8v4l3 3"/>
                        </svg>
                        Set Presence
                      </button>
                      <button
                        className="btn btn-danger btn-sm"
                        onClick={() => window.CMD?.restart?.()}
                        type="button"
                      >
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                          <path d="M23 4v6h-6"/><path d="M1 20v-6h6"/>
                          <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/>
                        </svg>
                        Restart
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {/* Stats row */}
              <div className="hero-grid" role="list" aria-label="Key metrics">
                <div className="hc" role="listitem">
                  <div className="hc-lbl">Servers</div>
                  <div className="hc-val mono" id="hc-servers">—</div>
                  <div className="hc-sub">Active guilds</div>
                  <svg className="hc-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" aria-hidden="true">
                    <circle cx="12" cy="12" r="10"/><ellipse cx="12" cy="12" rx="4" ry="10"/><path d="M2 12h20"/>
                  </svg>
                </div>
                <div className="hc" role="listitem">
                  <div className="hc-lbl">Members</div>
                  <div className="hc-val mono" id="hc-members">—</div>
                  <div className="hc-sub">Total across guilds</div>
                  <svg className="hc-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" aria-hidden="true">
                    <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/>
                    <path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/>
                  </svg>
                </div>
                <div className="hc" role="listitem">
                  <div className="hc-lbl">WS Ping</div>
                  <div className="hc-val mono" id="hc-ping">—</div>
                  <div className="hc-sub" id="hc-ping-q">WebSocket latency</div>
                  <svg className="hc-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" aria-hidden="true">
                    <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
                  </svg>
                </div>
                <div className="hc" role="listitem">
                  <div className="hc-lbl">Uptime</div>
                  <div className="hc-val mono" id="hc-uptime">—</div>
                  <div className="hc-sub">Since last restart</div>
                  <svg className="hc-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" aria-hidden="true">
                    <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
                  </svg>
                </div>
              </div>

              {/* System stats grid — populated by JS */}
              <div className="stat-grid" id="stat-grid" role="list" aria-label="System stats" />

              {/* Lower panels */}
              <div className="g3">
                {/* API Keys */}
                <div className="panel">
                  <div className="panel-h">
                    API Keys
                    <button className="btn btn-sm btn-ghost" onClick={() => window.CMD?.switchApiKey?.()} type="button">Rotate</button>
                  </div>
                  <div id="api-keys-list"><div className="loading">Loading…</div></div>
                </div>

                {/* Quick Actions */}
                <div className="panel">
                  <div className="panel-h">Quick Actions</div>
                  <div className="qs">
                    <button className="q-btn" onClick={() => window.CMD?.saveState?.()} type="button">💾 Save State</button>
                    <button className="q-btn" onClick={() => window.CMD?.toggleDebug?.()} type="button">🔧 Toggle Debug</button>
                    <button className="q-btn" onClick={() => window.CMD?.reloadCommands?.()} type="button">🔄 Reload Commands</button>
                    <button className="q-btn danger" onClick={() => window.CMD?.restart?.()} type="button">⚠️ Restart Bot</button>
                  </div>
                </div>

                {/* Current Presence */}
                <div className="panel">
                  <div className="panel-h">
                    Current Presence
                    <button className="btn btn-sm btn-ghost" onClick={() => window._navigate?.('presence')} type="button">Edit</button>
                  </div>
                  <div className="pres-cur" id="presence-cur">
                    <span style={{ color: 'var(--t4)', fontSize: '12px' }}>Loading…</span>
                  </div>
                </div>
              </div>
            </section>

            {/* ══ SERVERS ═════════════════════════════════════════════ */}
            <section className="section" id="section-servers" aria-labelledby="srv-heading">
              <div className="sh">
                <div className="sh-l">
                  <h2 id="srv-heading" className="sh-title">
                    Servers <span className="sh-cnt" id="servers-cnt" />
                  </h2>
                  <p className="sh-desc">All guilds the bot is in, sorted by member count.</p>
                </div>
                <div className="sh-r">
                  <div className="srv-search-wrap">
                    <svg className="srv-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                      <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
                    </svg>
                    <input
                      className="srv-search-i"
                      id="server-search"
                      placeholder="Search servers…"
                      aria-label="Search servers"
                      onInput={e => window._filterServers?.(e.currentTarget.value)}
                    />
                  </div>
                  <button className="srv-refresh-btn" onClick={() => window._loadServers?.()} type="button">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                      <path d="M23 4v6h-6"/><path d="M1 20v-6h6"/>
                      <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/>
                    </svg>
                    Refresh
                  </button>
                </div>
              </div>
              <div id="servers-grid" className="sv-grid"><div className="loading">Loading servers…</div></div>
              <div id="servers-pg" />
            </section>

            {/* ══ USERS ════════════════════════════════════════════════ */}
            <section className="section" id="section-users" aria-labelledby="usr-heading">
              <div className="sh">
                <div className="sh-l">
                  <h2 id="usr-heading" className="sh-title">User Management</h2>
                  <p className="sh-desc">Look up users, manage blacklists, view history and settings.</p>
                </div>
              </div>
              <div className="users-g">
                <div className="panel">
                  <div className="panel-h">Lookup User</div>
                  <div className="form-g">
                    <label className="form-l" htmlFor="user-lookup-id">User ID or Username</label>
                    <input className="form-i" id="user-lookup-id" placeholder="123456789 or username" autoComplete="off" />
                  </div>
                  <button className="btn btn-accent btn-full" onClick={() => window._lookupUser?.()} type="button">Lookup</button>
                  <div id="user-lookup-result" className="hidden mt8" />
                </div>
                <div className="panel">
                  <div className="panel-h">Send DM</div>
                  <div className="form-g">
                    <label className="form-l" htmlFor="dm-user-id">User ID</label>
                    <input className="form-i" id="dm-user-id" placeholder="User ID or username" autoComplete="off" />
                  </div>
                  <div className="form-g">
                    <label className="form-l" htmlFor="dm-message">Message</label>
                    <textarea className="form-ta" id="dm-message" rows={4} placeholder="Your message…" />
                  </div>
                  <button className="btn btn-accent btn-full" onClick={() => window._sendDm?.()} type="button">Send DM</button>
                  <div id="dm-result" className="hidden mt8" />
                </div>
                <div className="panel">
                  <div className="panel-h">Blacklist</div>
                  <div className="form-g">
                    <label className="form-l" htmlFor="bl-user-id">User ID</label>
                    <input className="form-i" id="bl-user-id" placeholder="User ID or username" autoComplete="off" />
                  </div>
                  <div className="form-g">
                    <label className="form-l" htmlFor="bl-guild-id">Guild ID</label>
                    <input className="form-i" id="bl-guild-id" placeholder="Guild ID" autoComplete="off" />
                  </div>
                  <div className="form-row mt8">
                    <div className="form-g" style={{ flex: 1 }}>
                      <button className="btn btn-danger btn-full" onClick={() => window._blacklistUser?.()} type="button">Blacklist</button>
                    </div>
                    <div className="form-g" style={{ flex: 1 }}>
                      <button className="btn btn-ghost btn-full" onClick={() => window._unblacklistUser?.()} type="button">Unblacklist</button>
                    </div>
                  </div>
                  <div id="bl-result" className="hidden mt8" />
                </div>
              </div>
              <div className="panel mt12">
                <div className="panel-h">
                  Chat History Viewer
                  <button className="btn btn-ghost btn-sm" onClick={() => window._loadHistories?.()} type="button">Load All</button>
                </div>
                <div className="form-row">
                  <div className="form-g" style={{ flex: 1 }}>
                    <label className="hidden" htmlFor="hist-user-id">User or Channel ID</label>
                    <input className="form-i" id="hist-user-id" placeholder="User/Channel ID" autoComplete="off" />
                  </div>
                  <button className="btn btn-accent btn-sm" onClick={() => window._viewHistory?.()} type="button">View</button>
                  <button className="btn btn-danger btn-sm" onClick={() => window._clearHistory?.()} type="button">Clear</button>
                </div>
                <div id="hist-result" className="hidden mt8" />
                <div id="hist-all" className="hidden mt8" />
              </div>
              <div className="panel mt12">
                <div className="panel-h">
                  Blacklisted Users
                  <div style={{ display: 'flex', gap: '6px' }}>
                    <button className="btn btn-ghost btn-sm" onClick={() => window._loadBlacklist?.()} type="button">Refresh</button>
                    <button className="btn btn-danger btn-sm" onClick={() => window._purgeBlacklist?.()} type="button">Purge All</button>
                  </div>
                </div>
                <div id="blacklist-content" className="bl-list"><div className="empty">Click Refresh to load</div></div>
              </div>
            </section>

            {/* ══ MODELS & API KEYS ════════════════════════════════════ */}
            <section className="section" id="section-models" aria-labelledby="mdl-heading">
              <div className="sh">
                <div className="sh-l">
                  <h2 id="mdl-heading" className="sh-title">Models &amp; API Keys</h2>
                  <p className="sh-desc">Switch active AI model, manage API key rotation and view per-key stats.</p>
                </div>
                <div className="sh-r">
                  <button className="btn btn-ghost btn-sm" onClick={() => window._loadModels?.()} type="button">Refresh</button>
                </div>
              </div>

              <div className="panel" style={{ marginBottom: '14px' }}>
                <div className="panel-h">AI Models — click to set active</div>
                <div id="mdl-grid" className="mdl-grid"><div className="loading">Loading…</div></div>
                <div className="mt8" style={{ fontSize: '11px', color: 'var(--t4)' }} id="mdl-active-info" />
              </div>

              <div className="mdl-flags-grid" style={{ marginBottom: '14px' }}>
                <div className="panel">
                  <div className="panel-h">Generation Settings</div>
                  {[
                    ['Gemma Enabled',            'ff-gemma',    'ENABLE_GEMMA'],
                    ['Auto RAG (memory search)', 'ff-rag',      'ENABLE_RAG'],
                    ['Redis Cache',              'ff-cache',    'CACHE_ENABLED'],
                    ['Cycle Gemma+Gemini',        'ff-cycle',    'CYCLE_GEMMA_WITH_GEMINI'],
                    ['Weekly Summary',            'ff-weekly',   'WEEKLY_SUMMARY_ENABLED'],
                    ['Web Search / Grounding',    'ff-websearch','ENABLE_WEB_SEARCH'],
                    ['Function / Tool Calling',   'ff-funcall',  'ENABLE_FUNCTION_CALLING'],
                    ['Cross-Context Memory',      'ff-cross',    'CROSS_CONTEXT_ENABLED'],
                  ].map(([label, id, flag]) => (
                    <div className="form-g" key={id}>
                      <label className="form-l" htmlFor={id}>{label}</label>
                      <select
                        className="form-sel"
                        id={id}
                        onChange={e => window._toggleFlag?.(flag, e.target.value === 'true')}
                      >
                        <option value="true">Enabled</option>
                        <option value="false">Disabled</option>
                      </select>
                    </div>
                  ))}
                </div>

                <div className="panel">
                  <div className="panel-h">Media Processing</div>
                  <p style={{ fontSize: '11px', color: 'var(--t4)', marginBottom: '10px' }}>
                    Control which attachment types the bot accepts. Changes apply immediately.
                  </p>
                  {[
                    ['🖼 Images (png/jpeg)',   'ff-image', 'ENABLE_IMAGE_PROCESSING'],
                    ['🎥 Video (mp4/mov)',     'ff-video', 'ENABLE_VIDEO_PROCESSING'],
                    ['🎵 Audio (mp3/wav)',     'ff-audio', 'ENABLE_AUDIO_PROCESSING'],
                    ['📁 Generic Files',      'ff-file',  'ENABLE_FILE_PROCESSING'],
                    ['📄 PDF (Gemini)',        'ff-pdf',   'PDF_ENABLED_FOR_GEMINI'],
                  ].map(([label, id, flag]) => (
                    <div className="form-g" key={id}>
                      <label className="form-l" htmlFor={id}>{label}</label>
                      <select
                        className="form-sel"
                        id={id}
                        onChange={e => window._toggleFlag?.(flag, e.target.value === 'true')}
                      >
                        <option value="false">Disabled</option>
                        <option value="true">Enabled</option>
                      </select>
                    </div>
                  ))}
                </div>
              </div>

              <div className="cfg-row" style={{ marginBottom: '14px' }}>
                {/* Migration Config */}
                <div className="panel cfg-panel-sm">
                  <div className="panel-h">Migration Config</div>
                  <div className="form-g">
                    <label className="form-l" htmlFor="mc-enable">Enable Migration</label>
                    <select className="form-sel" id="mc-enable">
                      <option value="false">Disabled</option><option value="true">Enabled</option>
                    </select>
                  </div>
                  <div className="form-g">
                    <label className="form-l" htmlFor="mc-batch-size">Batch Size</label>
                    <input className="form-inp" type="number" id="mc-batch-size" min={1} max={500} placeholder="50" />
                  </div>
                  <div className="form-g">
                    <label className="form-l" htmlFor="mc-batch-delay">Batch Delay (ms)</label>
                    <input className="form-inp" type="number" id="mc-batch-delay" min={0} max={5000} placeholder="100" />
                  </div>
                  <p style={{ fontSize: '10px', color: 'var(--t4)', marginTop: '4px' }}>
                    Enable once to migrate, auto-disables after.
                  </p>
                  <button
                    className="btn btn-accent"
                    style={{ marginTop: '8px', width: '100%' }}
                    onClick={() => window._saveMigrationConfig?.()}
                    type="button"
                  >Save Migration Config</button>
                  <div id="mc-result" className="result-box hidden" />
                </div>

                {/* Bot & State Config */}
                <div className="panel cfg-panel-lg">
                  <div className="panel-h">Bot &amp; State Config</div>
                  <div className="cfg-grid">
                    {/* Response Format */}
                    <div className="form-g">
                      <label className="form-l" htmlFor="bc-resp-format">Response Format</label>
                      <select className="form-sel" id="bc-resp-format">
                        <option value="Normal">Normal</option><option value="Markdown">Markdown</option><option value="Plain">Plain</option>
                      </select>
                    </div>
                    {/* Work in DMs */}
                    <div className="form-g">
                      <label className="form-l" htmlFor="bc-dms">Work in DMs</label>
                      <select className="form-sel" id="bc-dms">
                        <option value="true">Enabled</option><option value="false">Disabled</option>
                      </select>
                    </div>
                    {/* Number fields */}
                    {[
                      ['Max Queue / User',      'bc-queue',        1,   50,    '5'],
                      ['Key Switch Hold (ms)',  'bc-key-hold',     0,   10000, '1500'],
                      ['RAM Suspend (MB)',      'bc-ram',          50,  2000,  '380'],
                      ['Max History Messages',  'bc-max-msg',      10,  500,   '50'],
                      ['Context Break (min)',   'bc-ctx-break',    1,   1440,  '30'],
                      ['Gemma Daily Limit/Key', 'bc-gemma-limit',  100, 10000, '1500'],
                    ].map(([lbl, eid, mn, mx, ph]) => (
                      <div className="form-g" key={eid}>
                        <label className="form-l" htmlFor={eid}>{lbl}</label>
                        <input className="form-inp" type="number" id={eid} min={mn} max={mx} placeholder={ph} />
                      </div>
                    ))}
                    {/* Text fields */}
                    <div className="form-g">
                      <label className="form-l" htmlFor="bc-gemma-default">Gemma Default Model</label>
                      <input className="form-inp" type="text" id="bc-gemma-default" placeholder="e.g. gemma-4-26b" />
                    </div>
                    <div className="form-g">
                      <label className="form-l" htmlFor="bc-gemma-fallback">Gemma Fallback Model</label>
                      <input className="form-inp" type="text" id="bc-gemma-fallback" placeholder="e.g. gemma-4-31b" />
                    </div>
                  </div>
                  <button
                    className="btn btn-accent"
                    style={{ marginTop: '10px', width: '100%' }}
                    onClick={() => window._saveBotConfig?.()}
                    type="button"
                  >Save Bot Config</button>
                  <div id="bc-result" className="result-box hidden" />
                </div>
              </div>

              {/* Rate Limits */}
              <div className="panel" style={{ marginTop: '14px' }}>
                <div className="panel-h">
                  Rate Limits — per key per model
                  <span style={{ fontSize: '10px', fontWeight: 400, color: 'var(--wa)' }}>⚠ Restart to apply</span>
                </div>
                <div className="cfg-grid">
                  {[
                    ['Default RPM',               'rl-rpm',    1,    2000,   '15'],
                    ['Window Duration (ms)',       'rl-window', 5000, 300000, '60000'],
                    ['Cooldown After 429 (ms)',    'rl-cool',   1000, 300000, '60000'],
                    ['Retry: Forbidden (ms)',      'rl-fd',     100,  30000,  '3000'],
                    ['Retry: Rate Limit (ms)',     'rl-rl',     100,  30000,  '2500'],
                    ['Retry: Server Error (ms)',   'rl-se',     100,  30000,  '1000'],
                  ].map(([label, id, min, max, ph]) => (
                    <div className="form-g" key={id}>
                      <label className="form-l" htmlFor={id}>{label}</label>
                      <input className="form-inp" type="number" id={id} min={min} max={max} placeholder={ph} />
                    </div>
                  ))}
                </div>
                <div className="form-g" style={{ marginTop: '8px' }}>
                  <label className="form-l" htmlFor="rl-model-overrides">
                    Per-Model RPM Overrides <span style={{ fontSize: '10px', color: 'var(--t4)' }}>(JSON — null = Infinity)</span>
                  </label>
                  <textarea
                    className="cfg-ed"
                    id="rl-model-overrides"
                    rows={4}
                    spellCheck={false}
                    placeholder={'{"gemini-3.1-flash-lite": null}'}
                  />
                </div>
                <button
                  className="btn btn-accent"
                  style={{ marginTop: '8px', width: '100%' }}
                  onClick={() => window._saveRateLimits?.()}
                  type="button"
                >Save Rate Limits</button>
                <div id="rl-result" className="result-box hidden" />
              </div>

              {/* Migration */}
              <div className="panel" style={{ marginTop: '14px' }}>
                <div className="panel-h">
                  Migration
                  <span style={{ fontSize: '10px', fontWeight: 400, color: 'var(--t4)' }}>— push default settings to all users/servers</span>
                </div>
                <div className="mig-layout">
                  {['server', 'user'].map(scope => (
                    <div className="mig-col" key={scope}>
                      <div className="mig-col-h">
                        {scope === 'server' ? 'Server' : 'User'} Fields
                        <div className="mig-sel-btns">
                          <button className="btn btn-ghost btn-sm" onClick={() => window._selectAllMigFields?.(`mig-${scope}-fields`, true)} type="button">All</button>
                          <button className="btn btn-ghost btn-sm" onClick={() => window._selectAllMigFields?.(`mig-${scope}-fields`, false)} type="button">None</button>
                        </div>
                      </div>
                      <div id={`mig-${scope}-fields`} className="mig-fields"><div className="loading">Loading…</div></div>
                    </div>
                  ))}
                </div>
                <div className="mig-opts">
                  <label className="cb-row force-row" htmlFor="mig-force">
                    <input type="checkbox" id="mig-force" />
                    <span>Force overwrite <span style={{ color: 'var(--t4)', fontSize: '10px' }}>(even if user/server already has this field set)</span></span>
                  </label>
                </div>
                <div className="mig-btns">
                  <button className="btn btn-ghost" onClick={() => window._runMigration?.('servers')} type="button">↑ Servers only</button>
                  <button className="btn btn-ghost" onClick={() => window._runMigration?.('users')} type="button">↑ Users only</button>
                  <button className="btn btn-accent" onClick={() => window._runMigration?.('both')} type="button">↑ Both (servers + users)</button>
                </div>
                <div id="mig-result" className="result-box hidden" />
                <p style={{ fontSize: '10px', color: 'var(--t4)', marginTop: '8px' }}>
                  Leave all fields unchecked to migrate ALL fields.
                </p>
              </div>

              {/* API Keys Detail */}
              <div className="panel" style={{ marginTop: '14px' }}>
                <div className="panel-h">
                  API Keys Detail
                  <button className="btn btn-accent btn-sm" onClick={() => window.CMD?.switchApiKey?.()} type="button">Rotate to Next</button>
                </div>
                <div id="keys-detail"><div className="loading">Loading…</div></div>
              </div>
            </section>

            {/* ══ COMMANDS ════════════════════════════════════════════ */}
            <section className="section" id="section-commands" aria-labelledby="cmd-heading">
              <div className="sh">
                <div className="sh-l">
                  <h2 id="cmd-heading" className="sh-title">Admin Commands</h2>
                  <p className="sh-desc">All bot controls without Discord. Use User ID or username for user fields.</p>
                </div>
              </div>
              <div id="cmd-grid" className="cmd-grid" />
            </section>

            {/* ══ PRESENCE ════════════════════════════════════════════ */}
            <section className="section" id="section-presence" aria-labelledby="pres-heading">
              <div className="sh">
                <div className="sh-l">
                  <h2 id="pres-heading" className="sh-title">Bot Presence</h2>
                  <p className="sh-desc">Control what status and activity the bot shows.</p>
                </div>
              </div>
              <div style={{ maxWidth: '580px' }}>
                <div className="panel" style={{ marginBottom: '12px' }}>
                  <div className="panel-h">Current Presence</div>
                  <div className="pres-cur" id="presence-cur-2">
                    <span style={{ color: 'var(--t4)', fontSize: '12px' }}>Loading…</span>
                  </div>
                </div>
                <div className="panel">
                  <div className="panel-h">Override Presence</div>
                  <div className="form-g">
                    <label className="form-l" htmlFor="pres-status">Status</label>
                    <select className="form-sel" id="pres-status">
                      <option value="online">Online</option>
                      <option value="idle">Idle</option>
                      <option value="dnd">Do Not Disturb</option>
                      <option value="invisible">Invisible</option>
                    </select>
                  </div>
                  <div className="form-row">
                    <div className="form-g" style={{ flex: 1 }}>
                      <label className="form-l" htmlFor="pres-activity">Activity Text</label>
                      <input className="form-i" id="pres-activity" placeholder="e.g. with 1000 servers" />
                    </div>
                    <div className="form-g" style={{ width: '160px' }}>
                      <label className="form-l" htmlFor="pres-type">Type</label>
                      <select className="form-sel" id="pres-type">
                        <option value="0">Playing</option>
                        <option value="1">Streaming</option>
                        <option value="2">Listening to</option>
                        <option value="3">Watching</option>
                        <option value="5">Competing in</option>
                      </select>
                    </div>
                  </div>
                  <button className="btn btn-accent btn-full" onClick={() => window._setPresence?.()} type="button">Update Presence</button>
                  <div id="pres-result" className="hidden mt8" />
                  <div className="p-presets">
                    <div className="p-pl">Quick Presets</div>
                    <div className="p-pb">
                      {[
                        ['🟢 Online',        'online',     '',               '0'],
                        ['🟡 Idle',          'idle',       '',               '0'],
                        ['🔴 DND',           'dnd',        '',               '0'],
                        ['⚫ Invisible',      'invisible',  '',               '0'],
                        ['🔧 Maintenance',   'dnd',        'Bot maintenance','3'],
                        ['🎧 Listening',     'online',     'your messages',  '2'],
                        ['📺 Watching Anime','online',     'anime',          '3'],
                        ['📚 Homework Help', 'online',     'homework help',  '2'],
                        ['🎮 Gaming',        'online',     'video games',    '0'],
                        ['💤 AFK',           'idle',       'be right back',  '0'],
                        ['🎵 J-Pop',         'online',     'j-pop',          '2'],
                        ['💔 Over You',      'online',     'over you',       '3'],
                      ].map(([label, s, a, t]) => (
                        <button key={label} className="p-p" onClick={() => window._preset?.(s, a, t)} type="button">
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </section>

            {/* ══ ANNOUNCE ════════════════════════════════════════════ */}
            <section className="section" id="section-announce" aria-labelledby="ann-heading">
              <div className="sh">
                <div className="sh-l">
                  <h2 id="ann-heading" className="sh-title">Global Announcement</h2>
                  <p className="sh-desc">Broadcast to all servers or DM users directly.</p>
                </div>
              </div>
              <div className="ann-g">
                <div className="panel">
                  <div className="panel-h">Compose</div>
                  <div className="ann-tg" id="ann-tg" role="group" aria-label="Target audience">
                    {[['All','both'],['Servers','servers'],['Users DM','users']].map(([lbl, tgt]) => (
                      <button
                        key={tgt}
                        className={`ann-t${tgt === 'both' ? ' active' : ''}`}
                        data-target={tgt}
                        onClick={e => window._setAnnTarget?.(e.currentTarget)}
                        type="button"
                      >{lbl}</button>
                    ))}
                  </div>
                  <div className="form-g">
                    <label className="form-l" htmlFor="ann-title">Title</label>
                    <input className="form-i" id="ann-title" defaultValue="Announcement" onInput={() => window._updateAnnPreview?.()} />
                  </div>
                  <div className="form-g">
                    <label className="form-l" htmlFor="ann-msg">Message</label>
                    <textarea className="form-ta" id="ann-msg" rows={5} placeholder="Write your announcement…" onInput={() => window._updateAnnPreview?.()} />
                  </div>
                  <div className="form-row">
                    <div className="form-g" style={{ flex: 1 }}>
                      <label className="form-l" htmlFor="ann-color">Color</label>
                      <input className="form-i" id="ann-color" defaultValue="#8b5cf6" onInput={() => window._updateAnnPreview?.()} />
                    </div>
                    <div className="form-g" style={{ width: '130px' }}>
                      <label className="form-l" htmlFor="ann-fmt">Format</label>
                      <select className="form-sel" id="ann-fmt">
                        <option value="true">Rich Embed</option>
                        <option value="false">Plain Text</option>
                      </select>
                    </div>
                  </div>
                  <button className="btn btn-accent btn-full" onClick={() => window._sendAnnounce?.()} type="button">Send Announcement</button>
                  <div id="ann-result" className="hidden mt8" />
                </div>
                <div className="panel">
                  <div className="panel-h">Live Preview</div>
                  <div className="ann-prev" id="ann-prev" role="presentation">
                    <div className="ann-pb" id="ann-pb" />
                    <div className="ann-pt" id="ann-pt">Announcement</div>
                    <div className="ann-pm" id="ann-pm">Your message will appear here…</div>
                  </div>
                  <p className="ann-note mt8">Sent to first writable #general / #announcements in each server.</p>
                  <div className="divider" />
                  <div className="panel-h" style={{ marginTop: '8px' }}>DM All Server Owners</div>
                  <div className="form-g">
                    <label className="hidden" htmlFor="ann-owners-msg">Message to owners</label>
                    <textarea className="form-ta" id="ann-owners-msg" rows={3} placeholder="Message to all server owners…" />
                  </div>
                  <button className="btn btn-ghost btn-full" onClick={() => window._dmAllOwners?.()} type="button">Send to All Owners</button>
                  <div id="ann-owners-result" className="hidden mt8" />
                </div>
              </div>
            </section>

            {/* ══ LOCKDOWN ════════════════════════════════════════════ */}
            <section className="section" id="section-lockdown" aria-labelledby="lkd-heading">
              <div className="sh">
                <div className="sh-l">
                  <h2 id="lkd-heading" className="sh-title">Global Lockdown</h2>
                  <p className="sh-desc">Instantly halt or resume all bot activity across every server.</p>
                </div>
              </div>
              <div className="panel" style={{ maxWidth: '500px' }}>
                <div className="lkd-s">
                  <div className="lkd-l">
                    <div className="lkd-dot" id="lkd-dot" aria-hidden="true" />
                    <span className="lkd-lbl" id="lkd-lbl">Loading…</span>
                  </div>
                  <label className="toggle" aria-label="Toggle global lockdown">
                    <input type="checkbox" id="lkd-toggle" onChange={e => window._toggleLockdown?.(e.currentTarget.checked)} />
                    <span className="tg-t" />
                  </label>
                </div>
                <div id="lkd-result" className="hidden mt8" />
                <div className="lkd-info" role="list">
                  {[
                    ['err', 'Blocks all message responses globally'],
                    ['err', 'Slash commands show a lockdown message'],
                    ['ok',  'Zero data loss — all state preserved'],
                  ].map(([type, text]) => (
                    <div className="lkd-ir" key={text} role="listitem">
                      <svg viewBox="0 0 24 24" fill="none" stroke={type === 'ok' ? 'var(--ok)' : 'var(--er)'} strokeWidth="1.5" aria-hidden="true">
                        {type === 'ok'
                          ? <><circle cx="12" cy="12" r="10"/><polyline points="9 12 11 14 15 10"/></>
                          : <><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></>
                        }
                      </svg>
                      <span>{text}</span>
                    </div>
                  ))}
                </div>
              </div>
            </section>

            {/* ══ CONFIG EDITOR ═══════════════════════════════════════ */}
            <section className="section" id="section-config" aria-labelledby="cfg-heading">
              <div className="sh">
                <div className="sh-l">
                  <h2 id="cfg-heading" className="sh-title">Config Editor</h2>
                  <p className="sh-desc">Edit config files directly. Changes require restart. Backups are created automatically.</p>
                </div>
              </div>
              <div className="cfg-tabs" role="tablist">
                {[['runtime','Runtime Config'],['modules','modules/config.js'],['base','config.js (base)']].map(([tab, label], i) => (
                  <div
                    key={tab}
                    className={`cfg-tab${i === 0 ? ' active' : ''}`}
                    data-tab={tab}
                    role="tab"
                    tabIndex={0}
                    aria-selected={i === 0}
                    onClick={e => window._cfgTab?.(e.currentTarget)}
                    onKeyDown={e => e.key === 'Enter' && window._cfgTab?.(e.currentTarget)}
                  >{label}</div>
                ))}
              </div>

              {/* Runtime pane */}
              <div id="cfg-runtime-pane">
                <div className="panel" style={{ marginBottom: '10px' }}>
                  <div className="panel-h">
                    Runtime Config
                    <span style={{ fontSize: '10px', fontWeight: 400, color: 'var(--t4)' }}>persists across restarts</span>
                  </div>
                  <div className="form-g">
                    <label className="form-l" htmlFor="rt-model">Active Model Override</label>
                    <input className="form-i" id="rt-model" placeholder="e.g. gemini-3.5-flash" />
                  </div>
                  <div className="form-g">
                    <label className="form-l" htmlFor="rt-color">Global Embed Color</label>
                    <input className="form-i" id="rt-color" placeholder="#8b5cf6" />
                  </div>
                  <div className="cfg-acts">
                    <button className="btn btn-accent" onClick={() => window._saveRuntimeConfig?.()} type="button">Save</button>
                    <button className="btn btn-danger" onClick={() => window._clearRuntimeConfig?.()} type="button">Reset</button>
                  </div>
                  <div id="rt-result" className="hidden mt8" />
                </div>
                <div className="panel">
                  <div className="panel-h">Raw JSON</div>
                  <textarea className="cfg-ed" id="rt-raw" rows={10} spellCheck={false} />
                  <div className="cfg-acts">
                    <button className="btn btn-accent" onClick={() => window._saveRuntimeRaw?.()} type="button">Save Raw JSON</button>
                    <button className="btn btn-ghost" onClick={() => window._loadRuntimeConfig?.()} type="button">Reload</button>
                  </div>
                </div>
              </div>

              {/* modules/config.js pane */}
              <div id="cfg-modules-pane" className="hidden">
                <div className="panel">
                  <div className="panel-h">
                    modules/config.js
                    <span style={{ fontSize: '10px', fontWeight: 400, color: 'var(--wa)' }}>⚠ Restart required</span>
                  </div>
                  <textarea className="cfg-ed" id="cfg-modules-ta" spellCheck={false} />
                  <div className="cfg-acts">
                    <button className="btn btn-accent" onClick={() => window._saveCfg?.('modules')} type="button">Save File</button>
                    <button className="btn btn-ghost" onClick={() => window._loadCfg?.('modules')} type="button">Reload</button>
                    <button className="btn btn-danger" onClick={() => window._resetCfg?.('modules')} type="button">Restore Backup</button>
                  </div>
                  <div className="cfg-info" id="cfg-modules-info" />
                  <div id="cfg-modules-result" className="hidden mt8" />
                </div>
              </div>

              {/* config.js base pane */}
              <div id="cfg-base-pane" className="hidden">
                <div className="panel">
                  <div className="panel-h">
                    config.js (base)
                    <span style={{ fontSize: '10px', fontWeight: 400, color: 'var(--wa)' }}>⚠ Restart required</span>
                  </div>
                  <textarea className="cfg-ed" id="cfg-base-ta" spellCheck={false} />
                  <div className="cfg-acts">
                    <button className="btn btn-accent" onClick={() => window._saveCfg?.('base')} type="button">Save File</button>
                    <button className="btn btn-ghost" onClick={() => window._loadCfg?.('base')} type="button">Reload</button>
                    <button className="btn btn-danger" onClick={() => window._resetCfg?.('base')} type="button">Restore Backup</button>
                  </div>
                  <div className="cfg-info" id="cfg-base-info" />
                  <div id="cfg-base-result" className="hidden mt8" />
                </div>
              </div>
            </section>

            {/* ══ DATABASE BROWSER ════════════════════════════════════ */}
            <section className="section" id="section-database" aria-labelledby="db-heading">
              <div className="sh">
                <div className="sh-l">
                  <h2 id="db-heading" className="sh-title">Database Browser</h2>
                  <p className="sh-desc">Browse and edit MongoDB collections. Double-click a document to edit it inline.</p>
                </div>
                <div className="sh-r">
                  <button className="btn btn-ghost btn-sm" onClick={() => window._loadCollections?.()} type="button">Refresh</button>
                </div>
              </div>
              <div className="db-g">
                <div>
                  <div className="panel" style={{ marginBottom: '8px' }}>
                    <div className="panel-h">Collections</div>
                    <div id="db-coll-list" className="db-coll-list"><div className="loading">Loading…</div></div>
                  </div>
                </div>
                <div>
                  <div className="panel">
                    <div className="panel-h" id="db-docs-h">Select a collection</div>
                    <div id="db-docs-search" className="hidden" style={{ marginBottom: '8px' }}>
                      <label className="hidden" htmlFor="db-search">Filter documents</label>
                      <input className="form-i" id="db-search" placeholder="Filter by ID…" onInput={e => window._dbSearch?.(e.currentTarget.value)} />
                    </div>
                    <div id="db-doc-list" className="db-doc-list"><div className="empty">Select a collection from the left</div></div>
                    <div id="db-pg" className="db-pg" />
                  </div>
                </div>
              </div>
            </section>

            {/* ══ FILE BROWSER ════════════════════════════════════════ */}
            <section className="section" id="section-files" aria-labelledby="fb-heading">
              <div className="sh">
                <div className="sh-l">
                  <h2 id="fb-heading" className="sh-title">File Browser</h2>
                  <p className="sh-desc">Browse, view and edit bot files. Backups created on save.</p>
                </div>
                <div className="sh-r">
                  <button className="btn btn-ghost btn-sm" onClick={() => window._fbNav?.('')} type="button">Root</button>
                </div>
              </div>
              <div className="fb-g">
                <div>
                  <nav className="fb-path" id="fb-path" aria-label="File path">
                    <span className="fb-path-seg" onClick={() => window._fbNav?.('')} role="button" tabIndex={0}>root</span>
                  </nav>
                  <div id="fb-list" className="fb-list"><div className="loading">Loading…</div></div>
                </div>
                <div>
                  <div className="fb-editor" id="fb-editor" style={{ display: 'none' }}>
                    <div className="fb-editor-h">
                      <span className="fb-fn mono" id="fb-fn">—</span>
                      <div className="fb-acts">
                        <button className="btn btn-accent btn-sm" onClick={() => window._fbSave?.()} type="button">Save</button>
                        <button className="btn btn-danger btn-sm" onClick={() => window._fbDelete?.()} type="button">Delete</button>
                      </div>
                    </div>
                    <label className="hidden" htmlFor="fb-ta">File content</label>
                    <textarea className="fb-ta" id="fb-ta" spellCheck={false} />
                  </div>
                  <div id="fb-no-file" style={{ color: 'var(--t4)', fontSize: '12px', padding: '20px', textAlign: 'center' }}>
                    Select a file to edit
                  </div>
                </div>
              </div>
            </section>

            {/* ══ NODE CONSOLE ════════════════════════════════════════ */}
            <section className="section" id="section-node-console" aria-labelledby="node-heading">
              <div className="term-hdr">
                <div className="sh-l">
                  <h2 id="node-heading" className="sh-title">Node.js REPL</h2>
                  <p className="sh-desc">Live interactive shell. Full access to bot internals.</p>
                </div>
                <div className="term-ctl">
                  <div className="conn-pill" id="node-badge"><div className="conn-pill-dot" /><span className="conn-pill-lbl">Disconnected</span></div>
                  <button className="btn btn-ghost btn-sm hidden" id="node-disconnect" onClick={() => window.TERM?.disconnectNode?.()} type="button">Disconnect</button>
                  <button className="btn btn-ok btn-sm hidden" id="node-reconnect" onClick={() => window.TERM?.reconnectNode?.()} type="button">Reconnect</button>
                  <button className="btn btn-ghost btn-sm" onClick={() => window.TERM?.clearNode?.()} type="button">Clear</button>
                </div>
              </div>
              <div className="term-wrap" role="region" aria-label="Node.js terminal">
                <div className="term-bar" aria-hidden="true">
                  <div className="tl-d"><span className="tl r"/><span className="tl y"/><span className="tl g"/></div>
                  <span className="term-bar-t">node — Runtime REPL</span>
                </div>
                <div className="term-body" id="node-body" />
              </div>
            </section>

            {/* ══ MONGO CONSOLE ═══════════════════════════════════════ */}
            <section className="section" id="section-mongo-console" aria-labelledby="mongo-heading">
              <div className="term-hdr">
                <div className="sh-l">
                  <h2 id="mongo-heading" className="sh-title">MongoDB Shell</h2>
                  <p className="sh-desc">Interactive shell using bot's MONGODB_URI. Use <code className="ic">db</code> to query.</p>
                </div>
                <div className="term-ctl">
                  <div className="conn-pill" id="mongo-badge"><div className="conn-pill-dot" /><span className="conn-pill-lbl">Disconnected</span></div>
                  <button className="btn btn-ghost btn-sm hidden" id="mongo-disconnect" onClick={() => window.TERM?.disconnectMongo?.()} type="button">Disconnect</button>
                  <button className="btn btn-ok btn-sm hidden" id="mongo-reconnect" onClick={() => window.TERM?.reconnectMongo?.()} type="button">Reconnect</button>
                  <button className="btn btn-ghost btn-sm" onClick={() => window.TERM?.clearMongo?.()} type="button">Clear</button>
                </div>
              </div>
              <div className="term-wrap" role="region" aria-label="MongoDB terminal">
                <div className="term-bar" aria-hidden="true">
                  <div className="tl-d"><span className="tl r"/><span className="tl y"/><span className="tl g"/></div>
                  <span className="term-bar-t">mongosh — Bot Database</span>
                </div>
                <div className="term-body" id="mongo-body" />
              </div>
            </section>

            {/* ══ SHELL CONSOLE ═══════════════════════════════════════ */}
            <section className="section" id="section-shell-console" aria-labelledby="shell-heading">
              <div className="term-hdr">
                <div className="sh-l">
                  <h2 id="shell-heading" className="sh-title">Bash Shell</h2>
                  <p className="sh-desc">Full bash shell on the server. Type exit to end session.</p>
                </div>
                <div className="term-ctl">
                  <div className="conn-pill" id="shell-badge"><div className="conn-pill-dot" /><span className="conn-pill-lbl">Disconnected</span></div>
                  <button className="btn btn-ghost btn-sm hidden" id="shell-disconnect" onClick={() => window.TERM?.disconnectShell?.()} type="button">Disconnect</button>
                  <button className="btn btn-ok btn-sm hidden" id="shell-reconnect" onClick={() => window.TERM?.reconnectShell?.()} type="button">Reconnect</button>
                  <button className="btn btn-ghost btn-sm" onClick={() => window.TERM?.clearShell?.()} type="button">Clear</button>
                </div>
              </div>
              <div className="term-wrap" role="region" aria-label="Bash terminal">
                <div className="term-bar" aria-hidden="true">
                  <div className="tl-d"><span className="tl r"/><span className="tl y"/><span className="tl g"/></div>
                  <span className="term-bar-t">bash — System Shell</span>
                </div>
                <div className="term-body" id="shell-body" />
              </div>
            </section>

          </div>{/* /content */}
        </div>{/* /main */}

        {/* Sidebar overlay (mobile) */}
        <div
          id="sb-ov"
          className="hidden"
          onClick={() => window._closeSidebar?.()}
          aria-hidden="true"
        />

      </div>{/* /app */}

      {/* Toast region */}
      <div id="toast-r" role="status" aria-live="polite" aria-atomic="false" />

      {/* Bottom nav — rendered by router.js on mobile */}
      <nav id="bnav" aria-label="Mobile navigation">
        <div id="bnav-i" />
      </nav>
    </>
  );
}
