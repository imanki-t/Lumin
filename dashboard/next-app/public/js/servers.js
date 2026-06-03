import { api } from './api.js';
import { toastOk, toastErr, toastConfirm } from './toast.js';

// ── State ─────────────────────────────────────────────────────────────────────
let allServers  = [];
let filtered    = [];
let page        = 1;
const PAGE_SIZE = 24;

// ── Helpers ───────────────────────────────────────────────────────────────────
function iconUrl(guild) {
  return guild.icon
    ? `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.${guild.icon.startsWith('a_') ? 'gif' : 'webp'}?size=64`
    : '';
}

function initials(name) {
  return (name || '?').split(/\s+/).slice(0, 2).map(w => w[0].toUpperCase()).join('');
}

function fmt(n) {
  if (!n && n !== 0) return '—';
  return Number(n).toLocaleString();
}

// ── Card renderer ─────────────────────────────────────────────────────────────
function renderCard(g) {
  const url = iconUrl(g);
  const iconHtml = url
    ? `<img src="${url}" alt="" style="width:100%;height:100%;object-fit:cover;"
            onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'sv-ico-fb',textContent:'${initials(g.name)}'}))">`
    : `<span class="sv-ico-fb">${initials(g.name)}</span>`;

  const memberCount = fmt(g.memberCount ?? g.approximate_member_count);
  const chanCount   = fmt(g.channelCount);
  const roleCount   = fmt(g.roleCount);
  const boost       = g.premiumTier ? `T${g.premiumTier}` : '—';

  return `
    <div class="sv-card" data-id="${g.id}">
      <div class="sv-top">
        <div class="sv-ico">${iconHtml}</div>
        <div style="flex:1;min-width:0;">
          <div class="sv-name" title="${g.name}">${g.name || 'Unknown'}</div>
          <div class="sv-id mono">${g.id}</div>
        </div>
      </div>

      <div class="sv-stats">
        <div class="sv-st"><div class="sv-st-l">Members</div><div class="sv-st-v mono">${memberCount}</div></div>
        <div class="sv-st"><div class="sv-st-l">Channels</div><div class="sv-st-v mono">${chanCount}</div></div>
        <div class="sv-st"><div class="sv-st-l">Roles</div><div class="sv-st-v mono">${roleCount}</div></div>
        <div class="sv-st"><div class="sv-st-l">Boost</div><div class="sv-st-v">${boost}</div></div>
      </div>

      <div class="sv-acts">
        <button class="sv-btn"
                onclick="window._copyServerId('${g.id}')">
          Copy ID
        </button>
        <button class="sv-btn d"
                onclick="window._leaveServer('${g.id}','${(g.name || '').replace(/'/g,'\\\'')}')"
                title="Leave this server">
          Leave Server
        </button>
      </div>
    </div>`;
}

// ── Pagination renderer ───────────────────────────────────────────────────────
function renderPagination() {
  const total  = Math.ceil(filtered.length / PAGE_SIZE);
  const pg     = document.getElementById('servers-pg');
  if (!pg) return;
  if (total <= 1) { pg.innerHTML = ''; return; }

  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
  const cur   = clamp(page, 1, total);

  // Show at most 7 page buttons around the current page
  const buttons = [];
  let lo = Math.max(1, cur - 3);
  let hi = Math.min(total, lo + 6);
  lo = Math.max(1, hi - 6);

  if (lo > 1) buttons.push('<span class="pg-info">1</span>', lo > 2 ? '<span class="pg-info">…</span>' : '');

  for (let p = lo; p <= hi; p++) {
    buttons.push(`<button class="pg-btn${p === cur ? ' active' : ''}"
                          onclick="window._svPage(${p})">${p}</button>`);
  }

  if (hi < total) {
    if (hi < total - 1) buttons.push('<span class="pg-info">…</span>');
    buttons.push(`<button class="pg-btn" onclick="window._svPage(${total})">${total}</button>`);
  }

  pg.innerHTML = `
    <div class="pg">
      <button class="pg-btn" ${cur <= 1 ? 'disabled' : ''} onclick="window._svPage(${cur - 1})">‹</button>
      ${buttons.join('')}
      <button class="pg-btn" ${cur >= total ? 'disabled' : ''} onclick="window._svPage(${cur + 1})">›</button>
      <span class="pg-info">${filtered.length} servers</span>
    </div>`;
}

// ── Main render ───────────────────────────────────────────────────────────────
function render() {
  const grid = document.getElementById('servers-grid');
  const cnt  = document.getElementById('servers-cnt');
  if (!grid) return;

  const start = (page - 1) * PAGE_SIZE;
  const slice = filtered.slice(start, start + PAGE_SIZE);

  if (!slice.length) {
    grid.innerHTML = `<div class="empty">No servers found</div>`;
  } else {
    grid.innerHTML = slice.map(renderCard).join('');
  }

  if (cnt) cnt.textContent = filtered.length ? `(${fmt(filtered.length)})` : '';
  renderPagination();
}

// ── Load ──────────────────────────────────────────────────────────────────────
export async function loadServers() {
  const grid = document.getElementById('servers-grid');
  if (grid) grid.innerHTML = `<div class="loading">Loading servers…</div>`;

  const r = await api.getServers().catch(e => ({ error: e.message }));

  if (r?.error) {
    toastErr(r.error);
    if (grid) grid.innerHTML = `<div class="empty">Failed to load — ${r.error}</div>`;
    return;
  }

  allServers = Array.isArray(r) ? r : (r?.servers ?? []);
  allServers.sort((a, b) => (b.memberCount ?? 0) - (a.memberCount ?? 0));
  filtered   = allServers;
  page       = 1;
  render();
}

// ── Filter ────────────────────────────────────────────────────────────────────
export function filterServers(query) {
  const q = (query || '').toLowerCase().trim();
  filtered = q
    ? allServers.filter(g => (g.name || '').toLowerCase().includes(q) || g.id?.includes(q))
    : allServers;
  page = 1;
  render();
}

// ── Page change ───────────────────────────────────────────────────────────────
export function svPage(n) {
  page = n;
  render();
  document.getElementById('content')?.scrollTo({ top: 0, behavior: 'smooth' });
}

// ── Actions ───────────────────────────────────────────────────────────────────
export async function leaveServer(id, name) {
  const ok = await toastConfirm(`Leave server "${name}"? The bot cannot rejoin without an invite.`);
  if (!ok) return;
  const r = await api.leaveServer(id).catch(e => ({ error: e.message }));
  if (r?.success) {
    toastOk(`Left ${name}`);
    allServers = allServers.filter(g => g.id !== id);
    filtered   = filtered.filter(g => g.id !== id);
    render();
  } else {
    toastErr(r?.error || 'Failed to leave');
  }
}

export async function resetServer(id) {
  const ok = await toastConfirm(`Reset all data for guild ${id}? This cannot be undone.`);
  if (!ok) return;
  const r = await api.resetServer(id).catch(e => ({ error: e.message }));
  r?.success ? toastOk('Server reset') : toastErr(r?.error || 'Failed');
}

// ── Global hooks ─────────────────────────────────────────────────────────────
window._filterServers  = q   => filterServers(q);
window._svPage         = n   => svPage(n);
window._loadServers    = ()  => loadServers();
window._leaveServer    = (id, name) => leaveServer(id, name);
window._resetServer    = id  => resetServer(id);
window._copyServerId   = id  => {
  navigator.clipboard.writeText(id).then(() => toastOk('Copied!'));
};
