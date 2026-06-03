// ── Toast notification system ─────────────────────────────────────────────────

const region = () => document.getElementById('toast-r');

/**
 * Show a toast notification.
 * @param {string} msg   - Message text (truncated to 200 chars)
 * @param {'ok'|'err'|'info'|'warn'} type
 * @param {number} ms    - Auto-dismiss duration
 */
function show(msg, type, ms = 3500) {
  const r = region();
  if (!r) return;

  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.setAttribute('role', 'status');
  t.textContent = String(msg).slice(0, 200);
  r.appendChild(t);

  // Dismiss
  const dismiss = () => {
    t.style.transition = 'opacity 250ms ease, transform 250ms ease';
    t.style.opacity = '0';
    t.style.transform = 'translateX(8px)';
    setTimeout(() => t.remove(), 260);
  };

  // Click to dismiss early
  t.addEventListener('click', dismiss, { once: true });

  const timer = setTimeout(dismiss, ms);

  // Pause on hover
  t.addEventListener('mouseenter', () => clearTimeout(timer));
  t.addEventListener('mouseleave', () => setTimeout(dismiss, 800));
}

export const toastOk   = msg => show(msg, 'ok');
export const toastErr  = msg => show(msg, 'err',  4500);
export const toastInfo = msg => show(msg, 'info');
export const toastWarn = msg => show(msg, 'warn', 4000);

/**
 * Non-blocking toast confirmation — replaces window.confirm().
 * @param {string} msg
 * @returns {Promise<boolean>}
 */
export function toastConfirm(msg) {
  return new Promise(resolve => {
    const r = region();
    if (!r) { resolve(window.confirm(msg)); return; }

    const t = document.createElement('div');
    t.className = 'toast confirm';
    t.setAttribute('role', 'alertdialog');
    t.setAttribute('aria-modal', 'true');
    t.innerHTML = `
      <span class="toast-msg">${String(msg).slice(0, 160)}</span>
      <div class="toast-btns">
        <button class="toast-yes" autofocus>Confirm</button>
        <button class="toast-no">Cancel</button>
      </div>`;

    r.appendChild(t);
    t.querySelector('.toast-yes').focus();

    const cleanup = val => { t.remove(); resolve(val); };
    t.querySelector('.toast-yes').addEventListener('click', () => cleanup(true),  { once: true });
    t.querySelector('.toast-no').addEventListener('click',  () => cleanup(false), { once: true });

    // Keyboard: Escape → cancel, Enter on focused button → handled natively
    t.addEventListener('keydown', e => {
      if (e.key === 'Escape') { e.preventDefault(); cleanup(false); }
    });
  });
}
