/**
 * router.js — Client-side section router. Handles nav highlights and section visibility.
 */

import { PAGES } from './config.js';

let currentPageId = 'overview';
const listeners = [];

/**
 * Navigate to a section.
 * @param {string} pageId
 */
export function navigate(pageId) {
  if (currentPageId === pageId) return;
  currentPageId = pageId;

  // Hide all sections
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));

  // Show target
  const target = document.getElementById(`section-${pageId}`);
  if (target) target.classList.add('active');

  // Update sidebar nav
  document.querySelectorAll('.nav-item[data-page]').forEach(el => {
    el.classList.toggle('active', el.dataset.page === pageId);
  });

  // Update bottom nav
  document.querySelectorAll('.bottom-nav-item[data-page]').forEach(el => {
    el.classList.toggle('active', el.dataset.page === pageId);
  });

  // Update topbar title
  const page = PAGES.find(p => p.id === pageId);
  const titleEl = document.getElementById('topbar-title');
  if (titleEl) titleEl.textContent = page?.title ?? pageId;

  // Notify listeners
  listeners.forEach(fn => fn(pageId));
}

/**
 * Register a callback for route changes.
 * @param {Function} fn
 */
export function onNavigate(fn) {
  listeners.push(fn);
}

/** @returns {string} */
export function currentPage() {
  return currentPageId;
}

/**
 * Build sidebar nav items from PAGES config.
 * @param {HTMLElement} container
 */
export function buildSidebarNav(container) {
  // Group pages
  const groups = {};
  PAGES.forEach(p => {
    if (!groups[p.group]) groups[p.group] = [];
    groups[p.group].push(p);
  });

  let html = '';
  for (const [groupName, pages] of Object.entries(groups)) {
    html += `<div class="nav-group">
      <span class="nav-group-label">${groupName}</span>`;
    pages.forEach(p => {
      html += `
        <div class="nav-item" data-page="${p.id}" role="button" tabindex="0"
             onclick="window._navigate('${p.id}')">
          <span class="nav-icon">${p.icon}</span>
          <span>${p.label}</span>
          ${p.id === 'lockdown' ? '<span class="nav-badge" id="lockdown-badge-nav"></span>' : ''}
        </div>`;
    });
    html += `</div>`;
  }
  container.innerHTML = html;
}

/**
 * Build the bottom nav bar items (mobile).
 * @param {HTMLElement} container
 */
export function buildBottomNav(container) {
  const html = PAGES.map(p => `
    <div class="bottom-nav-item" data-page="${p.id}" role="button" tabindex="0"
         onclick="window._navigate('${p.id}')">
      <span class="bottom-nav-icon">${p.icon}</span>
      <span class="bottom-nav-label">${p.label}</span>
      ${p.id === 'lockdown' ? '<span class="bottom-nav-pip" id="lockdown-pip"></span>' : ''}
    </div>
  `).join('');
  container.innerHTML = html;
}

/** Set/clear the lockdown indicator across all nav elements */
export function setLockdownIndicator(active) {
  const badges = document.querySelectorAll('#lockdown-badge-nav, #lockdown-pip');
  badges.forEach(el => el?.classList.toggle('visible', active));

  const chip = document.getElementById('lockdown-chip');
  chip?.classList.toggle('visible', active);
}
