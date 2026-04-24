const region = () => document.getElementById('toast-r');

function show(msg, type, ms=3500) {
  const r = region(); if (!r) return;
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.textContent = String(msg).slice(0, 200);
  r.appendChild(t);
  setTimeout(() => { t.style.opacity='0'; t.style.transition='opacity 0.3s'; setTimeout(()=>t.remove(),300); }, ms);
}

export const toastOk   = msg => show(msg, 'ok');
export const toastErr  = msg => show(msg, 'err', 4500);
export const toastInfo = msg => show(msg, 'info');
export const toastWarn = msg => show(msg, 'warn');
