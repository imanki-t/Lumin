import { api } from './api.js';
import { setLockdownIndicator } from './router.js';
import { toastOk, toastErr, toastConfirm } from './toast.js';

// ── Load current lockdown state ───────────────────────────────────────────────
export async function loadLockdownState() {
  const r = await api.getStats().catch(() => null);
  if (r?.globalLockdown !== undefined) {
    setLockdownIndicator(!!r.globalLockdown);
  }
}

// ── Toggle ────────────────────────────────────────────────────────────────────
export async function toggleLockdown(enabled) {
  const resEl = document.getElementById('lkd-result');

  // Ask for confirmation before engaging lockdown
  if (enabled) {
    const ok = await toastConfirm('Enable GLOBAL LOCKDOWN? The bot will stop responding to all users immediately.');
    if (!ok) {
      // Revert the toggle visually
      const toggle = document.getElementById('lkd-toggle');
      if (toggle) toggle.checked = false;
      return;
    }
  }

  if (resEl) { resEl.className = 'result-box info'; resEl.classList.remove('hidden'); resEl.textContent = 'Applying…'; }

  const r = await api.setLockdown(enabled).catch(e => ({ error: e.message }));

  if (r?.success) {
    setLockdownIndicator(enabled);
    toastOk(r.message || (enabled ? 'Lockdown enabled' : 'Lockdown lifted'));
    if (resEl) { resEl.className = 'result-box ok'; resEl.textContent = r.message || 'Done'; }
  } else {
    // Revert toggle on failure
    const toggle = document.getElementById('lkd-toggle');
    if (toggle) toggle.checked = !enabled;
    toastErr(r?.error || 'Failed to update lockdown');
    if (resEl) { resEl.className = 'result-box err'; resEl.textContent = r?.error || 'Failed'; }
  }
}

// ── Global hook ───────────────────────────────────────────────────────────────
window._toggleLockdown = enabled => toggleLockdown(enabled);
