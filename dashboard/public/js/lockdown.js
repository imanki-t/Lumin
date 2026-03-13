/**
 * lockdown.js — Global lockdown panel logic.
 */

import { api } from './api.js';
import { toastOk, toastErr } from './toast.js';
import { setLockdownIndicator } from './router.js';

let _currentState = false;

export async function loadLockdownState() {
  const r = await api.getStats().catch(() => null);
  if (!r) return;
  _applyState(!!r.globalLockdown);
}

export async function toggleLockdown(enabled) {
  const resultEl = document.getElementById('lockdown-result');
  if (resultEl) { resultEl.className = 'result-banner'; }

  const r = await api.setLockdown(enabled).catch(err => ({
    success: false, error: err.message
  }));

  if (r.success) {
    _applyState(!!r.enabled);
    toastOk(r.message ?? (enabled ? 'Lockdown enabled' : 'Lockdown disabled'));
    if (resultEl) {
      resultEl.className = 'result-banner visible ok';
      resultEl.textContent = r.message ?? '';
    }
  } else {
    // Revert toggle to correct state
    const toggleEl = document.getElementById('lockdown-toggle');
    if (toggleEl) toggleEl.checked = _currentState;
    toastErr(r.error ?? 'Failed');
    if (resultEl) {
      resultEl.className = 'result-banner visible err';
      resultEl.textContent = r.error ?? 'Failed to update lockdown';
    }
  }
}

function _applyState(active) {
  _currentState = active;

  const hero    = document.getElementById('lockdown-hero');
  const icon    = document.getElementById('lockdown-icon');
  const title   = document.getElementById('lockdown-title');
  const desc    = document.getElementById('lockdown-desc');
  const toggle  = document.getElementById('lockdown-toggle');
  const tLabel  = document.getElementById('lockdown-toggle-label');

  if (hero)   hero.classList.toggle('active', active);
  if (icon)   icon.textContent = active ? '🔒' : '🔓';
  if (title)  title.textContent = active ? '⚠️ Bot is LOCKED DOWN' : 'Bot is Active';
  if (desc)   desc.textContent = active
    ? 'The bot is NOT responding to any messages in any server. Toggle off to resume.'
    : 'The bot is responding normally to all messages across all servers.';
  if (toggle) toggle.checked = active;
  if (tLabel) tLabel.textContent = active ? 'Lockdown ON' : 'Lockdown OFF';

  setLockdownIndicator(active);
}
