import { api } from './api.js';
import { toastOk, toastErr } from './toast.js';

let _servers = [];

export async function loadServers() {
  const grid = document.getElementById('servers-grid');
  if (grid) grid.innerHTML = '<div class="loading-msg">Loading servers...</div>';

  const res = await api.getServers().catch(() => null);
  if (!res?.data) {
    if (grid) grid.innerHTML = '<div class="loading-msg">Failed to load servers. Check API.</div>';
    return;
  }

  _servers = res.data;
  renderServers(_servers);
}

export function filterServers(q) {
  const filtered = q
    ? _servers.filter(s => s.name.toLowerCase().includes(q.toLowerCase()) || s.id.includes(q))
    : _servers;
  renderServers(filtered);
}

function renderServers(servers) {
  const grid = document.getElementById('servers-grid');
  if (!grid) return;

  if (!servers.length) {
    grid.innerHTML = '<div class="loading-msg">No servers found.</div>';
    return;
  }

  grid.innerHTML = servers.map(s => {
    const icon = s.iconURL
      ? `<div class="server-icon"><img src="${s.iconURL}" onerror="this.parentElement.innerHTML='<div class=\\'server-icon-fb\\'>${esc(s.name[0].toUpperCase())}</div>'"/></div>`
      : `<div class="server-icon"><div class="server-icon-fb">${esc(s.name[0]?.toUpperCase() || '?')}</div></div>`;
    const bl = s.blacklisted ?? 0;
    const joined = s.joinedAt ? new Date(s.joinedAt).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}) : '—';
    return `
      <div class="server-card">
        <div class="server-card-top">
          ${icon}
          <div>
            <div class="server-name">${esc(s.name)}</div>
            <div class="server-id">${s.id}</div>
          </div>
        </div>
        <div class="server-stats">
          <div class="sv-stat"><div class="sv-stat-lbl">Members</div><div class="sv-stat-val">${(s.memberCount||0).toLocaleString()}</div></div>
          <div class="sv-stat"><div class="sv-stat-lbl">Blacklisted</div><div class="sv-stat-val">${bl}</div></div>
          <div class="sv-stat"><div class="sv-stat-lbl">Joined</div><div class="sv-stat-val" style="font-size:10px">${joined}</div></div>
          <div class="sv-stat"><div class="sv-stat-lbl">Owner</div><div class="sv-stat-val" style="font-size:10px">${s.ownerId?.slice(-6) || '—'}</div></div>
        </div>
        <div class="server-actions">
          <button class="sv-btn" onclick="window._resetServer('${s.id}','${esc(s.name).replace(/'/g,"\\'")}')">Reset Settings</button>
          <button class="sv-btn danger" onclick="window._leaveServer('${s.id}','${esc(s.name).replace(/'/g,"\\'")}')">Leave</button>
        </div>
      </div>`;
  }).join('');
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
