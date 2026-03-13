/**
 * announce.js — Global announcement form handling and live preview.
 */

import { api } from './api.js';
import { toastOk, toastErr } from './toast.js';

function el(id) { return document.getElementById(id); }

export function initAnnounce() {
  // Live preview binding
  const titleInput   = el('ann-title');
  const msgInput     = el('ann-message');
  const colorInput   = el('ann-color');

  if (!titleInput) return;

  const update = () => updatePreview();
  titleInput.addEventListener('input', update);
  msgInput.addEventListener('input', update);
  colorInput.addEventListener('input', update);

  updatePreview();
}

function updatePreview() {
  const title  = el('ann-title')?.value   || 'Announcement';
  const msg    = el('ann-message')?.value || 'Your message will appear here…';
  const color  = el('ann-color')?.value   || '#CF6A37';

  const preview = el('ann-preview');
  if (!preview) return;

  preview.style.borderLeftColor = color;
  el('ann-preview-title').textContent = title;
  el('ann-preview-body').textContent  = msg;
}

export async function sendAnnouncement() {
  const message = el('ann-message')?.value?.trim();
  if (!message) { toastErr('Message is required'); return; }

  const btn = el('ann-send-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }

  const resultEl = el('ann-result');
  if (resultEl) { resultEl.className = 'result-banner'; resultEl.textContent = ''; }

  const r = await api.announce({
    message,
    title:    el('ann-title')?.value    || '📢 Announcement',
    embedColor: el('ann-color')?.value  || '#CF6A37',
    useEmbed: (el('ann-format')?.value ?? 'true') === 'true',
  }).catch(err => ({ success: false, error: err.message }));

  if (btn) { btn.disabled = false; btn.textContent = 'Send to All Servers'; }

  if (resultEl) {
    resultEl.className = `result-banner visible ${r.success ? 'ok' : 'err'}`;
    resultEl.textContent = r.message || r.error || (r.success ? 'Sent!' : 'Error');
  }

  if (r.success) toastOk(r.message ?? 'Announcement sent');
  else            toastErr(r.error ?? 'Failed to send');
}
