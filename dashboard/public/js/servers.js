/**
 * servers.js — Render the servers list table.
 */

import { api } from './api.js';
import { toastOk, toastErr } from './toast.js';

export async function loadServers() {
  const tbody = document.getElementById('servers-tbody');
  const countEl = document.getElementById('servers-count');

  if (tbody) {
    tbody.innerHTML = `
      <tr><td colspan="5">
        <div class="loading-row"><div class="spinner"></div> Loading servers…</div>
      </td></tr>`;
  }

  const res = await api.getServers().catch(() => null);
  if (!res?.data) {
    if (tbody) {
      tbody.innerHTML = `<tr><td colspan="5">
        <div class="empty-state">
          <div class="empty-state-icon">⚠️</div>
          <div class="empty-state-text">Failed to load servers</div>
        </div>
      </td></tr>`;
    }
    return;
  }

  const servers = res.data;
  if (countEl) countEl.textContent = servers.length;

  if (!servers.length) {
    tbody.innerHTML = `<tr><td colspan="5">
      <div class="empty-state">
        <div class="empty-state-icon">🌐</div>
        <div class="empty-state-text">No servers found</div>
      </div>
    </td></tr>`;
    return;
  }

  tbody.innerHTML = servers.map(s => {
    const memberCount = (s.memberCount ?? 0).toLocaleString();
    const icon = s.iconURL
      ? `<img class="guild-avatar" src="${s.iconURL}" onerror="this.outerHTML='<div class=\\'guild-avatar\\'>🌐</div>'" alt=""/>`
      : `<div class="guild-avatar">🌐</div>`;
    const blCount = s.blacklisted ?? 0;

    return `
      <tr>
        <td>
          <div class="guild-row-name">
            ${icon}
            <div>
              <div class="guild-name">${escHtml(s.name)}</div>
              <div class="guild-id">${s.id}</div>
            </div>
          </div>
        </td>
        <td>${memberCount}</td>
        <td style="font-family:var(--font-mono);font-size:12px;color:var(--text-secondary)">${s.ownerId}</td>
        <td>
          <span class="badge ${blCount > 0 ? 'badge-danger' : 'badge-neutral'}">
            ${blCount} user${blCount !== 1 ? 's' : ''}
          </span>
        </td>
        <td>
          <button class="btn btn-danger btn-sm"
            onclick="window._leaveServer('${s.id}', '${escHtml(s.name).replace(/'/g, "\\'")}')"
          >Leave</button>
        </td>
      </tr>
    `;
  }).join('');
}

export async function leaveServer(guildId, name) {
  if (!confirm(`Leave server "${name}"?\n\nThis cannot be undone.`)) return;
  const r = await api.leaveServer(guildId);
  if (r.success) {
    toastOk(r.message);
    await loadServers();
  } else {
    toastErr(r.error || 'Failed to leave server');
  }
}

function escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
