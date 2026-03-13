import { PAGES } from './config.js';

let current = 'overview';
const listeners = [];

export function navigate(id) {
  if (current === id) return;
  current = id;
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  document.getElementById(`section-${id}`)?.classList.add('active');
  document.querySelectorAll('.nav-item[data-page]').forEach(el => el.classList.toggle('active', el.dataset.page === id));
  document.querySelectorAll('.bnav-item[data-page]').forEach(el => el.classList.toggle('active', el.dataset.page === id));
  const page = PAGES.find(p => p.id === id);
  const tb = document.getElementById('tb-title');
  if (tb && page) tb.textContent = page.title;
  listeners.forEach(fn => fn(id));
  // Close mobile sidebar on navigate
  document.getElementById('sidebar')?.classList.remove('open');
  document.getElementById('sb-overlay')?.classList.add('hidden');
}
export function onNavigate(fn) { listeners.push(fn); }
export function currentPage() { return current; }

export function buildSidebarNav(container) {
  if (!container) return;
  const groups = {};
  PAGES.forEach(p => { if (!groups[p.group]) groups[p.group] = []; groups[p.group].push(p); });
  let html = '';
  for (const [g, pages] of Object.entries(groups)) {
    html += `<div class="nav-group"><span class="nav-group-lbl">${g}</span>`;
    pages.forEach(p => {
      html += `<div class="nav-item" data-page="${p.id}" onclick="window._navigate('${p.id}')">${p.icon}<span>${p.label}</span>${p.lockdown ? '<div class="nav-ldot" id="nav-ldot"></div>' : ''}</div>`;
    });
    html += `</div>`;
  }
  container.innerHTML = html;
}

export function buildBottomNav(container) {
  if (!container) return;
  container.innerHTML = PAGES.map(p =>
    `<button class="bnav-item" data-page="${p.id}" onclick="window._navigate('${p.id}')">${p.icon}<span class="bnav-item-lbl">${p.label}</span>${p.lockdown ? '<div class="bnav-ldot" id="bnav-ldot"></div>' : ''}</button>`
  ).join('');
}

export function setLockdownIndicator(active) {
  document.getElementById('nav-ldot')?.classList.toggle('on', active);
  document.getElementById('bnav-ldot')?.classList.toggle('on', active);
  const chip = document.getElementById('lockdown-chip');
  if (chip) chip.classList.toggle('hidden', !active);
  const dot = document.getElementById('lockdown-dot');
  if (dot) dot.classList.toggle('active', active);
  const lbl = document.getElementById('lockdown-label');
  if (lbl) lbl.textContent = active ? 'LOCKDOWN ACTIVE' : 'Bot is Live';
  const toggle = document.getElementById('lockdown-toggle');
  if (toggle) toggle.checked = active;
}
