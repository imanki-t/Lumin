/**
 * overview.js — Fetch and render the 20 bot overview stats.
 */

import { api } from './api.js';
import { toastErr } from './toast.js';
import { setLockdownIndicator } from './router.js';

// ── Formatters ────────────────────────────────────────────────────────────────

function fmtBytes(b, dec = 1) {
  if (!b || b < 0) return '—';
  if (b < 1024)       return `${b} B`;
  if (b < 1048576)    return `${(b / 1024).toFixed(dec)} KB`;
  if (b < 1073741824) return `${(b / 1048576).toFixed(dec)} MB`;
  return `${(b / 1073741824).toFixed(dec)} GB`;
}

function fmtUptime(s) {
  s = Math.floor(s);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${sec}s`;
}

function fmtNum(n) {
  if (n === undefined || n === null) return '—';
  return Number(n).toLocaleString();
}

// ── Stat definitions ──────────────────────────────────────────────────────────

function buildStats(d) {
  const heapPct = d.ram?.heapTotal
    ? Math.round((d.ram.heapUsed / d.ram.heapTotal) * 100)
    : 0;
  const ramPct = d.ram?.sysTotal
    ? Math.round(((d.ram.sysTotal - d.ram.sysFree) / d.ram.sysTotal) * 100)
    : 0;

  return [
    /* 1  */ {
      icon: '🏷️', label: 'Bot Username',
      value: d.username || '—',
      sub: `ID: ${d.id || '—'}`,
    },
    /* 2  */ {
      icon: '🌐', label: 'Servers',
      value: fmtNum(d.serverCount),
      sub: 'Total guilds',
      badge: null,
    },
    /* 3  */ {
      icon: '👥', label: 'Total Members',
      value: fmtNum(d.totalUsers),
      sub: 'Approx across all servers',
    },
    /* 4  */ {
      icon: '📶', label: 'WS Ping',
      value: d.ping >= 0 ? `${d.ping} ms` : '—',
      sub: 'WebSocket latency',
      badge: d.ping > 300 ? { label: 'HIGH', type: 'warn' }
           : d.ping > 150 ? { label: 'OK',   type: 'warn' }
           : { label: 'GOOD', type: 'success' },
    },
    /* 5  */ {
      icon: '⏱️', label: 'Uptime',
      value: fmtUptime(d.uptime),
      sub: 'Since last restart',
    },
    /* 6  */ {
      icon: '🧠', label: 'Heap Used',
      value: fmtBytes(d.ram?.heapUsed),
      sub: `${heapPct}% of ${fmtBytes(d.ram?.heapTotal)} heap`,
    },
    /* 7  */ {
      icon: '💾', label: 'RSS Memory',
      value: fmtBytes(d.ram?.rss),
      sub: 'Resident set size',
    },
    /* 8  */ {
      icon: '🖥️', label: 'System RAM',
      value: fmtBytes(d.ram?.sysTotal - d.ram?.sysFree),
      sub: `${ramPct}% used of ${fmtBytes(d.ram?.sysTotal)}`,
    },
    /* 9  */ {
      icon: '💿', label: 'Disk Used',
      value: d.disk?.used ?? '—',
      sub: `${d.disk?.percent ?? ''} used · ${d.disk?.available ?? '—'} free`,
    },
    /* 10 */ {
      icon: '⚡', label: 'Node.js',
      value: d.nodeVersion || '—',
      sub: d.platform || '—',
    },
    /* 11 */ {
      icon: '🔲', label: 'CPU Cores',
      value: d.cpuCores ?? '—',
      sub: (d.cpuModel ?? '').slice(0, 30) || '—',
    },
    /* 12 */ {
      icon: '🍃', label: 'MongoDB',
      value: d.mongoStatus || '—',
      sub: 'Database connection',
      badge: d.mongoStatus === 'Connected'
        ? { label: 'LIVE', type: 'success' }
        : { label: 'DOWN', type: 'danger' },
    },
    /* 13 */ {
      icon: '🔑', label: 'API Keys',
      value: `${d.apiKeyStats?.totalKeys ?? 0} keys`,
      sub: `Active: Key ${d.apiKeyStats?.currentKey ?? 1}`,
    },
    /* 14 */ {
      icon: '💬', label: 'Chat Histories',
      value: fmtNum(d.totalChatHistories),
      sub: 'In-memory entries',
    },
    /* 15 */ {
      icon: '🏠', label: 'Server Configs',
      value: fmtNum(d.totalServerSettings),
      sub: 'Saved server settings',
    },
    /* 16 */ {
      icon: '👤', label: 'User Profiles',
      value: fmtNum(d.totalUserSettings),
      sub: 'Saved user settings',
    },
    /* 17 */ {
      icon: '⏰', label: 'Reminders',
      value: fmtNum(d.totalReminders),
      sub: 'Active reminders',
    },
    /* 18 */ {
      icon: '🚫', label: 'Blacklisted',
      value: fmtNum(d.totalBlacklisted),
      sub: 'Users across all servers',
    },
    /* 19 */ {
      icon: '🔒', label: 'Global Lockdown',
      value: d.globalLockdown ? 'ENABLED' : 'Disabled',
      sub: 'Bot response state',
      badge: d.globalLockdown
        ? { label: 'ACTIVE', type: 'danger' }
        : { label: 'OFF', type: 'success' },
    },
    /* 20 */ {
      icon: '🐛', label: 'Debug Mode',
      value: d.debugMode ? 'ON' : 'Off',
      sub: 'Verbose logging flag',
      badge: d.debugMode ? { label: 'ON', type: 'warn' } : null,
    },
  ];
}

// ── Render helpers ────────────────────────────────────────────────────────────

function renderProfileCard(d) {
  const avatar = d.avatarURL || `https://cdn.discordapp.com/embed/avatars/0.png`;
  const offline = d.wsStatus !== 'READY';

  document.getElementById('profile-avatar').src = avatar;
  document.getElementById('profile-name').textContent  = d.username || 'Bot';
  document.getElementById('profile-tag').textContent   = d.tag      || '';
  document.getElementById('sidebar-bot-name').textContent   = d.username || '…';
  document.getElementById('sidebar-bot-avatar').src         = avatar;
  document.getElementById('sidebar-bot-status-dot').className =
    `status-indicator${offline ? ' offline' : ''}`;
  document.getElementById('sidebar-bot-status-label').textContent =
    offline ? 'Offline' : 'Online';

  const metaEl = document.getElementById('profile-meta');
  metaEl.innerHTML = `
    <div class="profile-pill">
      <span class="profile-pill-dot" style="${offline ? 'background:var(--danger)' : ''}"></span>
      ${d.wsStatus || 'Unknown'}
    </div>
    <div class="profile-pill">🌐 ${fmtNum(d.serverCount)} servers</div>
    <div class="profile-pill">⏱️ ${fmtUptime(d.uptime)}</div>
    <div class="profile-pill">📶 ${d.ping >= 0 ? d.ping + ' ms' : '—'}</div>
  `;
}

function renderStatGrid(stats) {
  const grid = document.getElementById('stat-grid');
  grid.innerHTML = stats.map((s, i) => `
    <div class="stat-card" style="animation-delay: ${i * 25}ms" class="animate-in">
      <div class="stat-card-top">
        <div class="stat-icon-wrap">${s.icon}</div>
        ${s.badge ? `<span class="stat-badge ${s.badge.type}">${s.badge.label}</span>` : ''}
      </div>
      <div class="stat-value">${escHtml(String(s.value))}</div>
      <div class="stat-label">${s.label}</div>
      <div class="stat-sub">${escHtml(s.sub ?? '')}</div>
    </div>
  `).join('');
}

function renderSkeleton() {
  const grid = document.getElementById('stat-grid');
  grid.innerHTML = Array.from({ length: 20 }).map(() => `
    <div class="stat-card">
      <div class="stat-card-top">
        <div class="stat-icon-wrap skeleton" style="width:30px;height:30px"></div>
      </div>
      <div class="skeleton" style="height:28px;width:70%;margin:4px 0"></div>
      <div class="skeleton" style="height:14px;width:55%"></div>
      <div class="skeleton" style="height:12px;width:80%;margin-top:4px"></div>
    </div>
  `).join('');
}

// ── Public API ────────────────────────────────────────────────────────────────

let _pollInterval = null;

export async function loadOverview() {
  renderSkeleton();

  const data = await api.getStats().catch(err => {
    toastErr('Failed to load stats');
    return null;
  });

  if (!data) return;
  if (data._authError) return;

  renderProfileCard(data);
  renderStatGrid(buildStats(data));
  setLockdownIndicator(!!data.globalLockdown);
}

/** Start auto-refresh every 30s while on overview page */
export function startOverviewPoll() {
  stopOverviewPoll();
  _pollInterval = setInterval(loadOverview, 30_000);
}

export function stopOverviewPoll() {
  if (_pollInterval) {
    clearInterval(_pollInterval);
    _pollInterval = null;
  }
}

function escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
