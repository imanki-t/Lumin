/**
 * toast.js — Lightweight toast notification system.
 */

const ICONS = { ok: '✓', err: '✕', info: 'ℹ', warn: '⚠' };
const DURATION = 4000;

/**
 * Show a toast notification.
 * @param {'ok'|'err'|'info'|'warn'} type
 * @param {string} message
 * @param {number} [duration]
 */
export function toast(type, message, duration = DURATION) {
  if (!message) return;

  const region = document.getElementById('toast-region');
  if (!region) return;

  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `
    <span class="toast-icon">${ICONS[type] ?? 'ℹ'}</span>
    <span class="toast-text">${escHtml(String(message).slice(0, 160))}</span>
  `;

  el.addEventListener('click', () => remove(el));
  region.appendChild(el);

  const timer = setTimeout(() => remove(el), duration);
  el._timer = timer;
}

function remove(el) {
  clearTimeout(el._timer);
  el.style.animation = 'none';
  el.style.opacity = '0';
  el.style.transform = 'translateX(100%)';
  el.style.transition = 'opacity 200ms ease, transform 200ms ease';
  setTimeout(() => el.remove(), 200);
}

function escHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// Shorthand helpers
export const toastOk   = (m) => toast('ok',   m);
export const toastErr  = (m) => toast('err',  m);
export const toastInfo = (m) => toast('info', m);
export const toastWarn = (m) => toast('warn', m);
