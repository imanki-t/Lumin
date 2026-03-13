const DUR = 4000;
function toast(type, msg) {
  if (!msg) return;
  const region = document.getElementById('toast-region');
  if (!region) return;
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = String(msg).slice(0, 160);
  el.addEventListener('click', () => remove(el));
  region.appendChild(el);
  el._t = setTimeout(() => remove(el), DUR);
}
function remove(el) {
  clearTimeout(el._t);
  el.style.transition = 'opacity 0.2s, transform 0.2s';
  el.style.opacity = '0';
  el.style.transform = 'translateX(12px)';
  setTimeout(() => el.remove(), 200);
}
export const toastOk   = m => toast('ok',   m);
export const toastErr  = m => toast('err',  m);
export const toastInfo = m => toast('info', m);
export const toastWarn = m => toast('warn', m);
