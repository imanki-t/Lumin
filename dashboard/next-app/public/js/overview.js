import { api } from './api.js';
import { toastOk, toastErr } from './toast.js';
import { setLockdownIndicator } from './router.js';

// ── Helpers ───────────────────────────────────────────────────────────────────
const el   = id => document.getElementById(id);
const set  = (id, val) => { const e = el(id); if (e) e.textContent = val; };
const fmt  = n => (n == null ? '—' : Number(n).toLocaleString());
const fmtMs = ms => ms == null ? '—' : ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;

function fmtUptime(ms) {
  if (ms == null) return '—';
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function fmtBytes(bytes) {
  if (bytes == null) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

function pingQuality(ms) {
  if (ms == null) return '';
  if (ms <  80)  return '🟢 Excellent';
  if (ms < 150)  return '🟡 Good';
  if (ms < 300)  return '🟠 Fair';
  return '🔴 Poor';
}

function barColor(pct) {
  if (pct < 60) return 'ok';
  if (pct < 85) return 'warn';
  return 'err';
}

function setBar(id, pct) {
  const fill = el(id);
  if (!fill) return;
  const clamped = Math.min(100, Math.max(0, pct ?? 0));
  fill.style.width = `${clamped}%`;
  fill.className   = `sc-fill ${barColor(clamped)}`;
}

// ── Avatar ────────────────────────────────────────────────────────────────────
function setAvatar(url) {
  const av = el('bot-av');
  if (!av) return;
  if (!url) { av.style.display = 'none'; return; }
  av.src   = url;
  av.style.display = 'block';
  av.onerror = () => { av.style.display = 'none'; };
}

// ── Stat mini-cards (dynamic) ─────────────────────────────────────────────────
function buildStatGrid(stats) {
  const grid = el('stat-grid');
  if (!grid) return;

  const cards = [
    {
      label: 'RAM Used',
      value: fmtBytes(stats?.memory?.heapUsed),
      sub:   stats?.memory?.heapTotal ? `of ${fmtBytes(stats.memory.heapTotal)}` : '',
      pct:   stats?.memory?.heapTotal
               ? (stats.memory.heapUsed / stats.memory.heapTotal) * 100
               : null,
    },
    {
      label: 'CPU',
      value: stats?.cpu != null ? `${stats.cpu.toFixed(1)}%` : '—',
      sub:   'Process load',
      pct:   stats?.cpu ?? null,
    },
    {
      label: 'Commands Run',
      value: fmt(stats?.commandsRun ?? stats?.totalCommands),
      sub:   'All time',
      pct:   null,
    },
    {
      label: 'Messages Seen',
      value: fmt(stats?.messagesSeen ?? stats?.totalMessages),
      sub:   'All time',
      pct:   null,
    },
    {
      label: 'API Calls',
      value: fmt(stats?.apiCalls ?? stats?.totalApiCalls),
      sub:   'All time',
      pct:   null,
    },
    {
      label: 'Active Sessions',
      value: fmt(stats?.activeSessions ?? stats?.sessions),
      sub:   'Right now',
      pct:   null,
    },
    {
      label: 'Cache Hits',
      value: stats?.cacheHitRate != null ? `${stats.cacheHitRate.toFixed(1)}%` : '—',
      sub:   'Redis hit rate',
      pct:   stats?.cacheHitRate ?? null,
    },
    {
      label: 'Errors (24h)',
      value: fmt(stats?.errors24h ?? stats?.recentErrors),
      sub:   'Last 24 hours',
      pct:   null,
    },
  ];

  const barId = i => `sg-bar-${i}`;

  grid.innerHTML = cards.map((c, i) => `
    <div class="sc" role="listitem">
      <div class="sc-lbl">${c.label}</div>
      <div class="sc-val mono">${c.value}</div>
      ${c.sub ? `<div class="sc-sub">${c.sub}</div>` : ''}
      ${c.pct != null ? `<div class="hc-bar"><div class="sc-fill" id="${barId(i)}" style="width:0"></div></div>` : ''}
    </div>`).join('');

  // Animate bars after paint
  requestAnimationFrame(() => {
    cards.forEach((c, i) => {
      if (c.pct != null) setBar(barId(i), c.pct);
    });
  });
}

// ── API keys panel ────────────────────────────────────────────────────────────
function buildApiKeys(keys) {
  const container = el('api-keys-list');
  if (!container) return;
  if (!Array.isArray(keys) || !keys.length) {
    container.innerHTML = `<div class="empty">No API keys configured</div>`;
    return;
  }

  container.innerHTML = keys.map((k, i) => {
    const isCurrent = k.current || k.active;
    const masked    = k.key ? `${k.key.slice(0, 8)}…${k.key.slice(-4)}` : `Key #${i + 1}`;
    const model     = k.model || k.currentModel || '—';
    const calls     = k.callsToday != null ? fmt(k.callsToday) : '—';
    const errors    = k.errors     != null ? fmt(k.errors)     : '—';

    return `
      <div class="key-row${isCurrent ? ' current' : ''}">
        <div style="flex:1;min-width:0;">
          <div class="key-n">${masked}</div>
          <div style="font-size:10px;color:var(--t3);margin-top:2px;">${model}</div>
        </div>
        <div style="text-align:right;flex-shrink:0;">
          <div style="font-size:10px;color:var(--t2);">${calls} calls</div>
          <div style="font-size:10px;color:var(--er);">${errors} errors</div>
        </div>
        ${isCurrent
          ? `<span class="tag tag-ok" style="flex-shrink:0;">Active</span>`
          : `<button class="btn btn-ghost btn-sm" style="flex-shrink:0;"
                     onclick="window._switchToKey(${i})">Use</button>`}
      </div>`;
  }).join('');
}

// ── Presence display ──────────────────────────────────────────────────────────
function renderPresence(presence) {
  const ids = ['presence-cur', 'presence-cur-2'];
  ids.forEach(id => {
    const pEl = el(id);
    if (!pEl) return;

    if (!presence || (!presence.status && !presence.activity)) {
      pEl.innerHTML = `<span style="color:var(--t4);font-size:12px;">No active presence set</span>`;
      return;
    }

    const statusColors = { online: 'var(--ok)', idle: 'var(--wa)', dnd: 'var(--er)', invisible: 'var(--t4)' };
    const statusColor  = statusColors[presence.status] || 'var(--t4)';
    const actType      = ['Playing','Streaming','Listening to','Watching','','Competing in'][presence.type ?? 0] || '';
    const actText      = presence.activity || '';

    pEl.innerHTML = `
      <span style="width:8px;height:8px;border-radius:50%;background:${statusColor};flex-shrink:0;display:inline-block;"></span>
      <span style="font-size:12px;color:var(--t2);">${presence.status || 'online'}</span>
      ${actText ? `<span style="font-size:11px;color:var(--t3);">·</span>
                   <span style="font-size:12px;color:var(--t1);">${actType} ${actText}</span>` : ''}`;
  });
}

// ── DB status ─────────────────────────────────────────────────────────────────
function renderDbStatus(connected) {
  const dot  = el('db-dot');
  const text = el('db-status-text');
  if (dot)  { dot.className = `db-dot ${connected ? 'ok' : 'err'}`; }
  if (text) { text.textContent = connected ? 'MongoDB Connected' : 'MongoDB Disconnected'; }
}

// ── Hero stat cards ───────────────────────────────────────────────────────────
function setHeroCards(stats) {
  const ping = stats?.wsPing ?? stats?.ping;
  set('hc-servers', fmt(stats?.guilds    ?? stats?.serverCount));
  set('hc-members', fmt(stats?.members   ?? stats?.memberCount));
  set('hc-ping',    fmtMs(ping));
  set('hc-uptime',  fmtUptime(stats?.uptime));

  const pq = el('hc-ping-q');
  if (pq) pq.textContent = pingQuality(ping);
}

// ── Bot identity hero ─────────────────────────────────────────────────────────
function setBotIdentity(bot) {
  if (!bot) return;

  setAvatar(bot.avatarURL || bot.avatar);
  set('bot-name', bot.username || bot.displayName || '—');

  const tagEl = el('bot-tag');
  if (tagEl) {
    tagEl.textContent = bot.globalName
      ? `${bot.globalName} · Application`
      : 'Discord Bot · Application';
  }

  const idEl = el('bot-id');
  if (idEl) idEl.textContent = bot.id ? `ID: ${bot.id}` : '—';

  // Status ring colour
  const ring = el('bot-status-ring');
  if (ring) {
    const statusColors = {
      online: 'var(--ok)', idle: 'var(--wa)', dnd: 'var(--er)', offline: 'var(--t4)',
    };
    ring.style.background = statusColors[bot.status] || 'var(--ok)';
  }
}

// ── Sidebar identity (small) ──────────────────────────────────────────────────
function setSidebarBot(bot) {
  if (!bot) return;
  const sbName = el('sb-bot-name');
  if (sbName) sbName.textContent = bot.username || '—';
}

// ── Main init ─────────────────────────────────────────────────────────────────
export async function initOverview() {
  // Parallel fetches
  const [statsRes, botRes, keysRes, presRes] = await Promise.allSettled([
    api.getStats(),
    api.botInfo(),
    api.getApiKeyStats(),
    api.getPresence(),
  ]);

  const stats    = statsRes.status   === 'fulfilled' ? statsRes.value   : null;
  const bot      = botRes.status     === 'fulfilled' ? botRes.value     : null;
  const keys     = keysRes.status    === 'fulfilled' ? keysRes.value    : null;
  const presence = presRes.status    === 'fulfilled' ? presRes.value    : null;

  // Populate bot identity hero
  setBotIdentity(bot?.bot ?? bot);

  // Hero metric cards
  const merged = { ...stats, ...(bot?.stats ?? {}) };
  setHeroCards(merged);

  // Stat grid
  buildStatGrid(stats?.system ?? stats);

  // DB status
  renderDbStatus(stats?.dbConnected ?? stats?.mongoConnected ?? true);

  // API keys panel
  buildApiKeys(Array.isArray(keys) ? keys : keys?.keys ?? []);

  // Presence
  renderPresence(presence?.presence ?? presence);

  // Lockdown indicator
  if (stats?.globalLockdown !== undefined) {
    setLockdownIndicator(!!stats.globalLockdown);
  }

  // Sidebar WS ping / status
  const ping = stats?.wsPing ?? stats?.ping;
  const sbPing = el('sb-ping');
  if (sbPing && ping != null) sbPing.textContent = `${ping}ms`;
}

// ── Partial refresh (called by WebSocket events) ──────────────────────────────
export async function refreshStats() {
  const r = await api.getStats().catch(() => null);
  if (!r) return;
  setHeroCards(r);
  buildStatGrid(r.system ?? r);
  renderDbStatus(r.dbConnected ?? r.mongoConnected ?? true);
  if (r.globalLockdown !== undefined) setLockdownIndicator(!!r.globalLockdown);
}

// ── Global hooks ──────────────────────────────────────────────────────────────
window._copyInvite   = async () => {
  const r = await api.inviteLink().catch(() => null);
  const url = r?.invite || r?.url;
  if (url) {
    navigator.clipboard.writeText(url).then(() => toastOk('Invite link copied!'));
  } else {
    toastErr('Could not fetch invite link');
  }
};

window._switchToKey = async idx => {
  const r = await api.switchToKey(idx).catch(e => ({ error: e.message }));
  if (r?.success) { toastOk(`Switched to key #${idx + 1}`); initOverview(); }
  else toastErr(r?.error || 'Failed to switch key');
};
