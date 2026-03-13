import { api } from './api.js';
import { toastOk, toastErr } from './toast.js';

export function initAnnounce() {
  const update = () => updatePreview();
  ['ann-title','ann-message','ann-color'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', update);
  });
  updatePreview();
}

function updatePreview() {
  const title = document.getElementById('ann-title')?.value || 'Announcement';
  const msg   = document.getElementById('ann-message')?.value || 'Your message will appear here...';
  const color = document.getElementById('ann-color')?.value || '#6D5AE6';
  const bar   = document.getElementById('ann-preview-bar');
  const t     = document.getElementById('ann-preview-title');
  const b     = document.getElementById('ann-preview-body');
  if (bar) bar.style.background = color;
  if (t)   t.textContent = title;
  if (b)   b.textContent = msg;
}

export async function sendAnnouncement() {
  const message = document.getElementById('ann-message')?.value?.trim();
  if (!message) { toastErr('Message is required'); return; }

  const btn = document.getElementById('ann-btn');
  const result = document.getElementById('ann-result');
  if (btn) { btn.disabled = true; btn.textContent = 'Sending...'; }
  if (result) result.classList.add('hidden');

  const r = await api.announce({
    message,
    title:     document.getElementById('ann-title')?.value  || 'Announcement',
    embedColor:document.getElementById('ann-color')?.value  || '#6D5AE6',
    useEmbed: (document.getElementById('ann-format')?.value ?? 'true') === 'true',
  }).catch(e => ({ error: e.message }));

  if (btn) { btn.disabled = false; btn.textContent = 'Send to All Servers'; }

  if (result) {
    result.className = `cmd-result ${r?.success ? 'ok' : 'err'}`;
    result.textContent = r?.message || r?.error || (r?.success ? 'Sent!' : 'Error');
    result.classList.remove('hidden');
  }

  if (r?.success) toastOk(r.message || 'Announcement sent');
  else            toastErr(r?.error || 'Failed to send');
}
