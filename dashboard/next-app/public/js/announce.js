import { api } from './api.js';
import { toastOk, toastErr, toastConfirm } from './toast.js';

// ── State ─────────────────────────────────────────────────────────────────────
let target = 'both'; // 'both' | 'servers' | 'users'

// ── Init ──────────────────────────────────────────────────────────────────────
export function initAnnounce() {
  updatePreview();
}

// ── Target selector ───────────────────────────────────────────────────────────
export function setAnnTarget(btn) {
  target = btn?.dataset?.target || 'both';
  document.querySelectorAll('#ann-tg .ann-t').forEach(b =>
    b.classList.toggle('active', b.dataset.target === target),
  );
}

// ── Live preview ──────────────────────────────────────────────────────────────
export function updatePreview() {
  const titleEl = document.getElementById('ann-title');
  const msgEl   = document.getElementById('ann-msg');
  const colorEl = document.getElementById('ann-color');

  const title = titleEl?.value || 'Announcement';
  const msg   = msgEl?.value   || 'Your message will appear here…';
  const color = colorEl?.value || '#8b5cf6';

  const pt = document.getElementById('ann-pt');
  const pm = document.getElementById('ann-pm');
  const pb = document.getElementById('ann-pb');

  if (pt) pt.textContent = title;
  if (pm) pm.textContent = msg;
  if (pb) pb.style.background = isValidColor(color) ? color : '#8b5cf6';
}

function isValidColor(c) {
  return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(c);
}

// ── Send announcement ─────────────────────────────────────────────────────────
export async function sendAnnouncement() {
  const title   = document.getElementById('ann-title')?.value?.trim();
  const message = document.getElementById('ann-msg')?.value?.trim();
  const color   = document.getElementById('ann-color')?.value?.trim() || '#8b5cf6';
  const embed   = document.getElementById('ann-fmt')?.value !== 'false';
  const resEl   = document.getElementById('ann-result');

  if (!message) { toastErr('Message cannot be empty'); return; }

  const targetLabel = { both: 'all servers & DM users', servers: 'all servers', users: 'all users via DM' }[target];
  const ok = await toastConfirm(`Send announcement to ${targetLabel}?`);
  if (!ok) return;

  if (resEl) {
    resEl.className = 'result-box info';
    resEl.classList.remove('hidden');
    resEl.textContent = 'Sending…';
  }

  const payload = { title, message, color, embed };
  const errs    = [];

  if (target === 'servers' || target === 'both') {
    const r = await api.announce(payload).catch(e => ({ error: e.message }));
    if (!r?.success) errs.push(`Servers: ${r?.error || 'failed'}`);
    else toastOk(`Servers: ${r.message || 'sent'}`);
  }

  if (target === 'users' || target === 'both') {
    const r = await api.announceUsers(payload).catch(e => ({ error: e.message }));
    if (!r?.success) errs.push(`Users: ${r?.error || 'failed'}`);
    else toastOk(`Users: ${r.message || 'sent'}`);
  }

  if (resEl) {
    if (errs.length) {
      resEl.className = 'result-box err';
      resEl.textContent = errs.join('\n');
      toastErr('Some sends failed — check details');
    } else {
      resEl.className = 'result-box ok';
      resEl.textContent = `Announcement sent to ${targetLabel}`;
    }
  }
}

// ── DM all owners ─────────────────────────────────────────────────────────────
export async function dmAllOwners() {
  const message = document.getElementById('ann-owners-msg')?.value?.trim();
  const resEl   = document.getElementById('ann-owners-result');
  if (!message) { toastErr('Enter a message'); return; }

  const ok = await toastConfirm('Send this DM to ALL server owners? This cannot be undone.');
  if (!ok) return;

  if (resEl) { resEl.className = 'result-box info'; resEl.classList.remove('hidden'); resEl.textContent = 'Sending…'; }

  const r = await api.dmAllOwners(message).catch(e => ({ error: e.message }));
  if (r?.success) {
    toastOk(`Sent to ${r.count ?? '?'} owners`);
    if (resEl) { resEl.className = 'result-box ok'; resEl.textContent = r.message || `Sent to ${r.count ?? '?'} owners`; }
  } else {
    toastErr(r?.error || 'Failed');
    if (resEl) { resEl.className = 'result-box err'; resEl.textContent = r?.error || 'Failed'; }
  }
}

// ── Global hooks ─────────────────────────────────────────────────────────────
window._setAnnTarget     = btn => setAnnTarget(btn);
window._updateAnnPreview = ()  => updatePreview();
window._sendAnnounce     = ()  => sendAnnouncement();
window._dmAllOwners      = ()  => dmAllOwners();
