import { api } from './api.js';
import { toastOk, toastErr } from './toast.js';
import { setLockdownIndicator } from './router.js';

let _state = false;

export async function loadLockdownState() {
  const r = await api.getStats().catch(() => null);
  if (!r) return;
  _apply(!!r.globalLockdown);
}

export async function toggleLockdown(enabled) {
  const result = document.getElementById('lockdown-result');
  if (result) result.classList.add('hidden');
  const r = await api.setLockdown(enabled).catch(e => ({ error: e.message }));
  if (r?.success) {
    _apply(!!r.enabled);
    toastOk(r.message || (enabled ? 'Lockdown enabled' : 'Lockdown disabled'));
    if (result) { result.className='cmd-result ok'; result.textContent=r.message||''; result.classList.remove('hidden'); }
  } else {
    const t = document.getElementById('lockdown-toggle');
    if (t) t.checked = _state;
    toastErr(r?.error || 'Failed');
    if (result) { result.className='cmd-result err'; result.textContent=r?.error||'Failed'; result.classList.remove('hidden'); }
  }
}

function _apply(active) {
  _state = active;
  setLockdownIndicator(active);
}
