import { api } from './api.js';
import { toastOk, toastErr } from './toast.js';

export function initAnnounce() {
  ['ann-title','ann-message','ann-color'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', updatePreview);
  });
  // Format toggle — hide title row when plain text
  document.getElementById('ann-format')?.addEventListener('change', e => {
    const isPlain = e.target.value === 'false';
    const titleRow = document.getElementById('ann-title-row');
    const colorRow = document.getElementById('ann-color-row');
    if (titleRow) titleRow.style.visibility = isPlain ? 'hidden' : 'visible';
    if (colorRow) colorRow.style.visibility = isPlain ? 'hidden' : 'visible';
    const preview = document.getElementById('ann-preview');
    if (preview) {
      const bar = document.getElementById('ann-preview-bar');
      const ttl = document.getElementById('ann-preview-title');
      if (bar) bar.style.display = isPlain ? 'none' : 'block';
      if (ttl) ttl.style.display = isPlain ? 'none' : 'block';
    }
    updatePreview();
  });
  updatePreview();
  updateTargetLabel();
  document.querySelectorAll('.ann-target-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.ann-target-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      updateTargetLabel();
    });
  });
}

function updateTargetLabel() {
  const active = document.querySelector('.ann-target-btn.active');
  const label = document.getElementById('ann-send-label');
  if (!label || !active) return;
  const map = { 'both': 'Send to All Servers', 'servers': 'Send to Servers Only', 'users': 'DM All Users' };
  label.textContent = map[active.dataset.target] || 'Send Announcement';
}

function updatePreview() {
  const title = document.getElementById('ann-title')?.value || 'Announcement';
  const msg   = document.getElementById('ann-message')?.value || 'Your message will appear here...';
  const color = document.getElementById('ann-color')?.value || '#6D5AE6';
  const isPlain = document.getElementById('ann-format')?.value === 'false';
  const bar   = document.getElementById('ann-preview-bar');
  const t     = document.getElementById('ann-preview-title');
  const b     = document.getElementById('ann-preview-body');
  if (bar) { bar.style.background = color; bar.style.display = isPlain ? 'none' : 'block'; }
  if (t)   { t.textContent = title; t.style.display = isPlain ? 'none' : 'block'; }
  if (b)   b.textContent = msg;
}

export async function sendAnnouncement() {
  const message = document.getElementById('ann-message')?.value?.trim();
  if (!message) { toastErr('Message is required'); return; }

  const target  = document.querySelector('.ann-target-btn.active')?.dataset?.target || 'both';
  const btn     = document.getElementById('ann-btn');
  const result  = document.getElementById('ann-result');
  if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }
  if (result) result.classList.add('hidden');

  let r;
  if (target === 'users') {
    r = await api.announceUsers({
      message,
      title:     document.getElementById('ann-title')?.value || 'Announcement',
      embedColor:document.getElementById('ann-color')?.value || '#6D5AE6',
      useEmbed: (document.getElementById('ann-format')?.value ?? 'true') === 'true',
    }).catch(e => ({ error: e.message }));
  } else {
    r = await api.announce({
      message,
      title:     document.getElementById('ann-title')?.value || 'Announcement',
      embedColor:document.getElementById('ann-color')?.value || '#6D5AE6',
      useEmbed: (document.getElementById('ann-format')?.value ?? 'true') === 'true',
      target,
    }).catch(e => ({ error: e.message }));
  }

  const label = document.getElementById('ann-send-label');
  if (btn) { btn.disabled = false; if (label) btn.textContent = label.textContent || 'Send'; else btn.textContent = 'Send to All Servers'; }

  if (result) {
    result.className = `cmd-result ${r?.success ? 'ok' : 'err'}`;
    result.textContent = r?.message || r?.error || (r?.success ? 'Sent!' : 'Error');
    result.classList.remove('hidden');
  }
  if (r?.success) toastOk(r.message || 'Announcement sent');
  else            toastErr(r?.error || 'Failed to send');
}
