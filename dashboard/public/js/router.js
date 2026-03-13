/**
 * router.js — Client-side navigation. SVG icons, no emojis.
 */

import { PAGES } from './config.js';

let currentPageId = 'overview';
const listeners   = [];

export function navigate(pageId) {
  if (currentPageId === pageId) return;
  currentPageId = pageId;

  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  document.getElementById(`section-${pageId}`)?.classList.add('active');

  document.querySelectorAll('.nav-item[data-page]').forEach(el => {
    el.classList.toggle('active', el.dataset.page === pageId);
  });

  const page = PAGES.find(p => p.id === pageId);
  if (page) {
    const titleEl = document.getElementById('topbar-title');
    const crumbEl = document.getElementById('topbar-breadcrumb');
    if (titleEl) titleEl.textContent = page.title;
    if (crumbEl) crumbEl.textContent = page.breadcrumb;
  }

  listeners.forEach(fn => fn(pageId));
}

export function onNavigate(fn) { listeners.push(fn); }
export function currentPage()  { return currentPageId; }

export function buildSidebarNav(container) {
  if (!container) return;

  const groups = {};
  PAGES.forEach(p => {
    if (!groups[p.group]) groups[p.group] = [];
    groups[p.group].push(p);
  });

  let html = '';
  for (const [groupName, pages] of Object.entries(groups)) {
    html += `<div class="nav-group"><span class="nav-group-label">${groupName}</span>`;
    pages.forEach(p => {
      html += `
        <div class="nav-item" data-page="${p.id}" role="button" tabindex="0"
             onclick="window._navigate('${p.id}')"
             onkeydown="if(event.key==='Enter')window._navigate('${p.id}')">
          ${p.icon}
          <span>${p.label}</span>
          ${p.id === 'lockdown' ? '<div class="nav-lockdown-dot" id="nav-lockdown-dot"></div>' : ''}
        </div>`;
    });
    html += `</div>`;
  }
  container.innerHTML = html;
}

export function setLockdownIndicator(active) {
  document.getElementById('nav-lockdown-dot')?.classList.toggle('visible', active);
  document.getElementById('lockdown-chip')?.classList.toggle('visible', active);

  // Also update the lockdown panel if visible
  const dot   = document.getElementById('lockdown-indicator-dot');
  const label = document.getElementById('lockdown-status-label');
  if (dot)   dot.classList.toggle('active', active);
  if (label) label.textContent = active ? 'LOCKDOWN ACTIVE' : 'Bot is Live';
}
