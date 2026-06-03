import { PAGES } from './config.js';

// ── State ─────────────────────────────────────────────────────────────────────
let current   = 'overview';
const listeners = [];

// ── Core navigation ───────────────────────────────────────────────────────────
/**
 * Navigate to a page by its ID.
 * Deactivates all sections, activates the target, updates nav highlights,
 * updates the topbar title, and closes the mobile sidebar.
 */
export function navigate(id) {
  if (current === id) return;
  current = id;

  // Sections
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  document.getElementById(`section-${id}`)?.classList.add('active');

  // Sidebar nav items
  document.querySelectorAll('.nav-item[data-page]').forEach(el =>
    el.classList.toggle('active', el.dataset.page === id),
  );

  // Bottom nav items (mobile)
  document.querySelectorAll('.bn-item[data-page]').forEach(el =>
    el.classList.toggle('active', el.dataset.page === id),
  );

  // Topbar title
  const page = PAGES.find(p => p.id === id);
  const tb = document.getElementById('tb-title');
  if (tb && page) tb.textContent = page.title;

  // Notify listeners (used by app.js to lazy-init sections)
  listeners.forEach(fn => fn(id));

  // Close mobile sidebar
  document.getElementById('sidebar')?.classList.remove('open');
  document.getElementById('sb-ov')?.classList.add('hidden');

  // Scroll content to top
  document.getElementById('content')?.scrollTo({ top: 0, behavior: 'instant' });
}

export const onNavigate   = fn => listeners.push(fn);
export const currentPage  = ()  => current;

// ── Sidebar nav builder ───────────────────────────────────────────────────────
/**
 * Renders grouped nav items into the sidebar container.
 */
export function buildSidebarNav(container) {
  if (!container) return;

  const groups = {};
  PAGES.forEach(p => {
    if (!groups[p.group]) groups[p.group] = [];
    groups[p.group].push(p);
  });

  let html = '';
  for (const [groupName, pages] of Object.entries(groups)) {
    html += `<div class="nav-group" role="list">
      <span class="ng-lbl">${groupName}</span>`;

    pages.forEach(p => {
      const badge = p.lockdown
        ? `<div class="nav-badge" id="nav-ldot" aria-label="Lockdown active"></div>`
        : '';
      html += `
        <div class="nav-item${p.id === current ? ' active' : ''}"
             data-page="${p.id}"
             role="listitem"
             tabindex="0"
             aria-label="${p.label}"
             onclick="window._navigate('${p.id}')"
             onkeydown="if(event.key==='Enter'||event.key===' ')window._navigate('${p.id}')">
          ${p.icon}
          <span>${p.label}</span>
          ${badge}
        </div>`;
    });

    html += `</div>`;
  }

  container.innerHTML = html;
}

// ── Bottom nav builder (mobile) ───────────────────────────────────────────────
export function buildBottomNav(container) {
  if (!container) return;

  container.innerHTML = PAGES.map(p => {
    const dot = p.lockdown
      ? `<div class="bn-ldot" id="bn-ldot" aria-hidden="true"></div>`
      : '';
    return `
      <button class="bn-item${p.id === current ? ' active' : ''}"
              data-page="${p.id}"
              aria-label="${p.label}"
              onclick="window._navigate('${p.id}')">
        ${p.icon}
        <span class="bn-item-l">${p.label}</span>
        ${dot}
      </button>`;
  }).join('');
}

// ── Lockdown indicator ────────────────────────────────────────────────────────
/**
 * Syncs all lockdown UI chrome: nav badge, chip, toggle, label, status dot.
 */
export function setLockdownIndicator(active) {
  document.getElementById('nav-ldot')?.classList.toggle('on', active);
  document.getElementById('bn-ldot')?.classList.toggle('on',  active);
  document.getElementById('tb-chip')?.classList.toggle('hidden', !active);

  const dot    = document.getElementById('lkd-dot');
  const lbl    = document.getElementById('lkd-lbl');
  const toggle = document.getElementById('lkd-toggle');
  const sbDot  = document.getElementById('sb-dot');

  if (dot)    dot.classList.toggle('active', active);
  if (lbl)    lbl.textContent = active ? '🔒 LOCKDOWN ACTIVE' : 'Bot is Live';
  if (toggle) toggle.checked  = active;

  // Make sidebar status dot pulse red when locked down
  if (sbDot) {
    sbDot.classList.toggle('err',  active);
    sbDot.classList.toggle('warn', false);
  }
}
