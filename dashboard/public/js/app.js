/**
 * app.js — Main entry point.
 * Handles OAuth login, real-time stats WebSocket, navigation, clock.
 */

import { getToken, setToken, clearToken, hasToken, BASE_URL } from './config.js';
import { buildSidebarNav, navigate, onNavigate, setLockdownIndicator } from './router.js';
import { loadServers }      from './servers.js';
import { renderCommands }   from './commands.js';
import { initAnnounce, sendAnnouncement } from './announce.js';
import { loadLockdownState, toggleLockdown } from './lockdown.js';
import { initNodeTerminal, initMongoTerminal } from './terminals.js';

// ── Real-time stats WebSocket ─────────────────────────────────────────────────

let statsWs       = null;
let statsReconnect = null;

function wsUrl(path) {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.host}/dashboard${path}?token=${encodeURIComponent(getToken())}`;
}

function startStatsStream() {
  if (statsWs && statsWs.readyState < 2) return;

  try {
    statsWs = new WebSocket(wsUrl('/ws/stats'));

    statsWs.onopen = () => {
      clearTimeout(statsReconnect);
      document.getElementById('sidebar-status')?.textContent === 'Connecting' &&
        (document.getElementById('sidebar-status').textContent = 'Live');
    };

    statsWs.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === 'stats') updateLiveStats(msg.data);
      } catch {}
    };

    statsWs.onclose = () => {
      statsReconnect = setTimeout(startStatsStream, 3000);
    };

    statsWs.onerror = () => {
      statsWs?.close();
    };
  } catch {
    statsReconnect = setTimeout(startStatsStream, 5000);
  }
}

// ── Format helpers ────────────────────────────────────────────────────────────

function fmtBytes(b, dec = 1) {
  if (!b || b < 0) return '—';
  if (b < 1048576)    return `${(b / 1024).toFixed(dec)} KB`;
  if (b < 1073741824) return `${(b / 1048576).toFixed(dec)} MB`;
  return `${(b / 1073741824).toFixed(dec)} GB`;
}

function fmtUptime(s) {
  s = Math.floor(s);
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${s % 60}s`;
}

function fmtNum(n) {
  return n == null ? '—' : Number(n).toLocaleString();
}

function setText(id, val) {
  const el = document.getElementById(id);
  if (el && el.textContent !== String(val)) el.textContent = val;
}

// ── Live stats rendering ──────────────────────────────────────────────────────

function updateLiveStats(d) {
  // Hero metrics
  setText('mh-servers-val', fmtNum(d.serverCount));
  setText('mh-users-val',   fmtNum(d.totalUsers));
  setText('mh-uptime-val',  fmtUptime(d.uptime));

  // Ping with color
  const pingVal = d.ping >= 0 ? `${d.ping}ms` : '—';
  setText('mh-ping-val', pingVal);
  const pingCard = document.getElementById('mh-ping');
  if (pingCard) {
    pingCard.style.borderTopColor =
      d.ping > 300 ? 'var(--danger)' :
      d.ping > 150 ? 'var(--warn)' :
      'var(--success)';
  }

  // Topbar
  setText('topbar-uptime',  fmtUptime(d.uptime));
  setText('topbar-servers', `${fmtNum(d.serverCount)} servers`);

  // Sidebar
  setText('sidebar-ping',   d.ping >= 0 ? `${d.ping}ms` : '—');
  setText('sidebar-status', d.wsStatus === 'READY' ? 'Live' : 'Degraded');

  // RAM stats grid
  const heapPct = d.heapTotal ? Math.round((d.heapUsed / d.heapTotal) * 100) : 0;
  const ramPct  = d.sysTotal  ? Math.round(((d.sysTotal - d.sysFree) / d.sysTotal) * 100) : 0;

  populateStatsGrid(d, heapPct, ramPct);

  // Lockdown indicator
  if (d.globalLockdown !== undefined) {
    setLockdownIndicator(d.globalLockdown);
  }

  // Mongo dot
  const mongoDot = document.getElementById('mongo-dot');
  if (mongoDot) {
    mongoDot.className = 'status-dot ' + (d.wsStatus === 'READY' ? 'connected' : 'disconnected');
  }
}

let statsGridBuilt = false;

function populateStatsGrid(d, heapPct, ramPct) {
  const grid = document.getElementById('stats-grid');
  if (!grid) return;

  const cards = [
    { label: 'Heap Used',    value: fmtBytes(d.heapUsed),              sub: `${heapPct}% of ${fmtBytes(d.heapTotal)}` },
    { label: 'RSS Memory',   value: fmtBytes(d.rss),                   sub: 'Resident set' },
    { label: 'System RAM',   value: `${ramPct}%`,                      sub: `${fmtBytes(d.sysTotal - d.sysFree)} used` },
    { label: 'Disk',         value: d.disk?.used ?? '—',               sub: `${d.disk?.percent ?? ''} · ${d.disk?.available ?? '—'} free` },
    { label: 'WS Status',    value: d.wsStatus ?? '—',                 sub: 'Discord gateway' },
    { label: 'Chat Histories', value: fmtNum(d.totalHistories),        sub: 'Stored conversations' },
    { label: 'User Settings',  value: fmtNum(d.totalUsers_s),          sub: 'Configured users' },
    { label: 'Server Settings', value: fmtNum(d.totalServers_s),       sub: 'Configured guilds' },
    { label: 'Debug Mode',   value: d.debugMode ? 'ON' : 'OFF',        sub: 'Verbose logging' },
  ];

  if (!statsGridBuilt) {
    statsGridBuilt = true;
    grid.innerHTML = cards.map((c, i) => `
      <div class="stat-card" id="sgc-${i}">
        <div class="stat-label">${c.label}</div>
        <div class="stat-value mono" id="sgv-${i}">${c.value}</div>
        <div class="stat-sub" id="sgs-${i}">${c.sub}</div>
      </div>
    `).join('');
  } else {
    cards.forEach((c, i) => {
      setText(`sgv-${i}`, c.value);
      setText(`sgs-${i}`, c.sub);
    });
  }
}

// ── Full stats load (initial) ─────────────────────────────────────────────────

async function loadFullStats() {
  try {
    const res  = await fetch(`${BASE_URL}/api/stats`, { headers: { 'x-token': getToken() } });
    if (res.status === 401) { logout(); return; }
    const json = await res.json();

    // Bot identity
    const avatar = document.getElementById('overview-avatar');
    if (avatar && json.avatarURL) {
      avatar.src = json.avatarURL;
      const sidebarAvatar = document.getElementById('sidebar-avatar');
      if (sidebarAvatar) sidebarAvatar.src = json.avatarURL;
    }
    setText('overview-username', json.username || '—');
    setText('overview-tag',  json.tag || '—');
    setText('overview-id',   json.id  || '—');
    setText('mongo-status-text', json.mongoStatus || '—');

    const mongoDot = document.getElementById('mongo-dot');
    if (mongoDot) mongoDot.className = `status-dot ${json.mongoStatus === 'Connected' ? 'connected' : 'disconnected'}`;

    // API keys
    renderApiKeys(json.apiKeyStats);
  } catch (err) {
    console.error('Full stats load failed', err);
  }
}

function renderApiKeys(apiStats) {
  const container = document.getElementById('api-keys-content');
  if (!container || !apiStats?.keys) return;
  container.innerHTML = apiStats.keys.map(k => `
    <div class="api-key-row ${k.isCurrent ? 'current' : ''}">
      <span class="api-key-name">Key ${k.keyNumber}</span>
      <span class="api-key-meta">${k.totalRequests} req · ${k.errors} err</span>
    </div>
  `).join('') || '<div style="color:var(--text-muted);font-size:12px">No keys configured</div>';
}

// ── Admin command helper ──────────────────────────────────────────────────────

async function runCmd(cmdName, body = {}) {
  try {
    const res = await fetch(`${BASE_URL}/api/cmd/${cmdName}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-token': getToken() },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    showToast(json.message || (json.error ? `Error: ${json.error}` : 'Done'), json.error ? 'err' : 'ok');
  } catch (err) {
    showToast(`Request failed: ${err.message}`, 'err');
  }
}

// ── Toast ─────────────────────────────────────────────────────────────────────

function showToast(msg, type = 'info') {
  const region = document.getElementById('toast-region');
  if (!region) return;
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  region.appendChild(el);
  setTimeout(() => el.remove(), 4000);
}

// ── Clock ─────────────────────────────────────────────────────────────────────

function startClock() {
  const tick = () => {
    const now = new Date();
    const t   = now.toLocaleTimeString('en-US', { hour12: false });
    const d   = now.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    setText('topbar-clock', `${d}  ${t}`);
  };
  tick();
  setInterval(tick, 1000);
}

// ── Auth ──────────────────────────────────────────────────────────────────────

function initiateGoogleLogin() {
  const btn = document.getElementById('google-sign-in-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Redirecting...'; }
  location.href = `${BASE_URL}/auth/google`;
}
window.initiateGoogleLogin = initiateGoogleLogin;

async function handleOAuthReturn() {
  const params = new URLSearchParams(location.search);
  const token  = params.get('token');
  const auth   = params.get('auth');

  if (token) {
    setToken(token);
    history.replaceState({}, '', location.pathname);
    await showDashboard();
    return true;
  }

  if (auth === 'denied') {
    document.getElementById('auth-denied')?.classList.remove('hidden');
    return false;
  }

  if (auth === 'error' || auth === 'invalid_state') {
    const statusEl = document.getElementById('login-status');
    if (statusEl) {
      statusEl.textContent = 'Authentication error. Please try again.';
      statusEl.classList.remove('hidden');
    }
    return false;
  }

  return false;
}

async function verifyExistingSession() {
  if (!hasToken()) return false;
  try {
    const res = await fetch(`${BASE_URL}/auth/me`, { headers: { 'x-token': getToken() } });
    if (res.status === 401) { clearToken(); return false; }
    const json = await res.json();
    if (json.user) {
      updateUserDisplay(json.user);
      return true;
    }
    return false;
  } catch { return false; }
}

function updateUserDisplay(user) {
  setText('sidebar-user-name', user.name || '—');
  setText('sidebar-user-email', user.email || '—');
  const avatar = document.getElementById('sidebar-avatar');
  if (avatar && user.picture) avatar.src = user.picture;
}

async function logout() {
  try {
    await fetch(`${BASE_URL}/auth/logout`, {
      method: 'POST',
      headers: { 'x-token': getToken() },
    });
  } catch {}
  clearToken();
  statsWs?.close();
  document.getElementById('app')?.classList.add('hidden');
  document.getElementById('login-page')?.classList.remove('hidden');
}

async function showDashboard() {
  document.getElementById('login-page')?.classList.add('hidden');
  document.getElementById('app')?.classList.remove('hidden');

  // Verify + load user
  await verifyExistingSession();

  // Start real-time stats
  startStatsStream();

  // Full initial load
  await loadFullStats();

  // Init page modules
  renderCommands();
  initAnnounce();

  navigate('overview');
}

// ── reCAPTCHA v3 (background) ─────────────────────────────────────────────────

async function initRecaptcha(siteKey) {
  if (!siteKey) return;

  await new Promise(resolve => {
    const s = document.createElement('script');
    s.src = `https://www.google.com/recaptcha/api.js?render=${siteKey}`;
    s.onload = resolve;
    document.head.appendChild(s);
  });

  // Execute silently on login page load — score is logged server-side
  try {
    const token = await window.grecaptcha.execute(siteKey, { action: 'login' });
    await fetch(`${BASE_URL}/auth/verify-recaptcha`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });
  } catch {}
}

// ── Navigation handler ────────────────────────────────────────────────────────

onNavigate((pageId) => {
  switch (pageId) {
    case 'servers':       loadServers();       break;
    case 'lockdown':      loadLockdownState(); break;
    case 'node-console':  initNodeTerminal();  break;
    case 'mongo-console': initMongoTerminal(); break;
  }
});

// ── Global bindings ───────────────────────────────────────────────────────────

window._navigate       = navigate;
window._loadServers    = loadServers;
window._toggleLockdown = toggleLockdown;
window._sendAnnounce   = sendAnnouncement;
window._logout         = logout;
window._runCmd         = runCmd;
window._showToast      = showToast;

// ── Boot ──────────────────────────────────────────────────────────────────────

async function boot() {
  // Build sidebar nav
  buildSidebarNav(document.getElementById('sidebar-nav'));

  // Logout button
  document.getElementById('logout-btn')?.addEventListener('click', logout);

  // Start clock
  startClock();

  // Load auth config (recaptcha key, oauth available)
  try {
    const cfg = await fetch(`${BASE_URL}/auth/config`).then(r => r.json());
    if (cfg.recaptchaSiteKey) initRecaptcha(cfg.recaptchaSiteKey);
  } catch {}

  // Check URL params first (returning from OAuth)
  const handledOAuth = await handleOAuthReturn();
  if (handledOAuth) return;

  // Check existing session
  if (hasToken()) {
    const valid = await verifyExistingSession();
    if (valid) {
      await showDashboard();
      return;
    }
    clearToken();
  }

  // Show login
  document.getElementById('login-page')?.classList.remove('hidden');
}

document.addEventListener('DOMContentLoaded', boot);
