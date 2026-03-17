import { api } from './api.js';
import { toastOk, toastErr } from './toast.js';

let _servers = [];
let _filtered = [];
let _page = 1;
const PAGE_SIZE = 12;

export async function loadServers() {
  const grid = document.getElementById('servers-grid');
  if (grid) grid.innerHTML = '<div class="loading-msg">Loading servers...</div>';
  const pg = document.getElementById('servers-pagination');
  if (pg) pg.innerHTML = '';

  const res = await api.getServers().catch(() => null);
  if (!res?.data) {
    if (grid) grid.innerHTML = '<div class="loading-msg">Failed to load servers.</div>';
    return;
  }
  _servers = res.data;
  _filtered = _servers;
  _page = 1;
  renderServers();
  const cnt = document.getElementById('servers-count');
  if (cnt) cnt.textContent = `${_servers.length} servers`;
}

export function filterServers(q) {
  _filtered = q
    ? _servers.filter(s => s.name.toLowerCase().includes(q.toLowerCase()) || s.id.includes(q))
    : _servers;
  _page = 1;
  renderServers();
}

export function svPage(p) {
  const total = Math.ceil(_filtered.length / PAGE_SIZE);
  if (p < 1 || p > total) return;
  _page = p;
  renderServers();
  document.getElementById('section-servers')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderServers() {
  const grid = document.getElementById('servers-grid');
  if (!grid) return;
  if (!_filtered.length) {
    grid.innerHTML = '<div class="loading-msg">No servers found.</div>';
    renderPagination(0);
    return;
  }
  const totalPages = Math.ceil(_filtered.length / PAGE_SIZE);
  if (_page > totalPages) _page = totalPages;
  const start = (_page - 1) * PAGE_SIZE;
  const slice = _filtered.slice(start, start + PAGE_SIZE);

  grid.innerHTML = slice.map(s => {
    const icon = s.iconURL
      ? `<div class="server-icon"><img src="${s.iconURL}" onerror="this.parentElement.innerHTML='<div class=\\'server-icon-fb\\'>${esc(s.name[0].toUpperCase())}</div>'"/></div>`
      : `<div class="server-icon"><div class="server-icon-fb">${esc(s.name[0]?.toUpperCase()||'?')}</div></div>`;
    const bl = s.blacklisted ?? 0;
    const joined = s.joinedAt ? new Date(s.joinedAt).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}) : '—';
    return `
      <div class="server-card" id="sc-${s.id}">
        <div class="server-card-top">
          ${icon}
          <div style="flex:1;min-width:0">
            <div class="server-name">${esc(s.name)}</div>
            <div class="server-id mono">${s.id}</div>
          </div>
          <button class="sv-refresh-btn" title="Refresh this server" onclick="window._refreshServer('${s.id}')">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="11" height="11"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/></svg>
          </button>
        </div>
        <div class="server-stats">
          <div class="sv-stat"><div class="sv-stat-lbl">Members</div><div class="sv-stat-val">${(s.memberCount||0).toLocaleString()}</div></div>
          <div class="sv-stat"><div class="sv-stat-lbl">Blacklisted</div><div class="sv-stat-val">${bl}</div></div>
          <div class="sv-stat"><div class="sv-stat-lbl">Joined</div><div class="sv-stat-val" style="font-size:10px">${joined}</div></div>
          <div class="sv-stat"><div class="sv-stat-lbl">Owner</div><div class="sv-stat-val" style="font-size:10px">${s.ownerId?.slice(-6)||'—'}</div></div>
        </div>
        <div class="server-actions-full">
          <button class="sv-full-btn" onclick="window._resetServer('${s.id}','${esc(s.name).replace(/'/g,"\\'")}')">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="11" height="11"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 102.13-9.36L1 10"/></svg>
            Reset Settings
          </button>
          <button class="sv-full-btn danger" onclick="window._leaveServer('${s.id}','${esc(s.name).replace(/'/g,"\\'")}')">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="11" height="11"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9"/></svg>
            Leave Server
          </button>
        </div>
      </div>`;
  }).join('');
  renderPagination(totalPages);
}

function renderPagination(totalPages) {
  const wrap = document.getElementById('servers-pagination');
  if (!wrap) return;
  if (totalPages <= 1) { wrap.innerHTML = ''; return; }
  const start = (_page-1)*PAGE_SIZE+1;
  const end = Math.min(_page*PAGE_SIZE, _filtered.length);
  const pages = [];
  for (let i = 1; i <= totalPages; i++) {
    if (i === 1 || i === totalPages || (i >= _page-2 && i <= _page+2)) {
      pages.push(i);
    } else if (pages[pages.length-1] !== '…') {
      pages.push('…');
    }
  }
  wrap.innerHTML = `
    <div class="pagination">
      <button class="pg-btn" onclick="window._svPage(${_page-1})" ${_page===1?'disabled':''}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="13" height="13"><polyline points="15 18 9 12 15 6"/></svg>
      </button>
      <div class="pg-pages">
        ${pages.map(p => p==='…'
          ? `<span class="pg-ellipsis">…</span>`
          : `<button class="pg-num ${p===_page?'active':''}" onclick="window._svPage(${p})">${p}</button>`
        ).join('')}
      </div>
      <button class="pg-btn" onclick="window._svPage(${_page+1})" ${_page===totalPages?'disabled':''}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="13" height="13"><polyline points="9 18 15 12 9 6"/></svg>
      </button>
      <span class="pg-info">${start}–${end} of ${_filtered.length}</span>
    </div>`;
}

export async function refreshSingleServer(guildId) {
  const card = document.getElementById(`sc-${guildId}`);
  const btn = card?.querySelector('.sv-refresh-btn');
  if (btn) btn.style.animation = 'spin 0.6s linear infinite';
  const res = await api.getServers().catch(() => null);
  if (btn) btn.style.animation = '';
  if (res?.data) {
    _servers = res.data;
    const q = document.getElementById('server-search')?.value || '';
    _filtered = q ? _servers.filter(s => s.name.toLowerCase().includes(q.toLowerCase()) || s.id.includes(q)) : _servers;
    renderServers();
    toastOk('Server data refreshed');
  } else toastErr('Failed to refresh');
}

export async function leaveServer(guildId, name) {
  if (!confirm(`Leave server "${name}"?\n\nThe bot will have to be re-invited to rejoin.`)) return;
  const r = await api.leaveServer(guildId).catch(e => ({ error: e.message }));
  if (r?.success) { toastOk(r.message || 'Left server'); await loadServers(); }
  else toastErr(r?.error || 'Failed to leave server');
}

export async function resetServer(guildId, name) {
  if (!confirm(`Reset all settings for "${name}"?`)) return;
  const r = await api.resetServer(guildId).catch(e => ({ error: e.message }));
  if (r?.success) toastOk(r.message || 'Settings reset');
  else toastErr(r?.error || 'Failed to reset');
}

function esc(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
