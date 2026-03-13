/**
 * app.js — Main entry point. Orchestrates all modules.
 */

import { getToken, setToken, clearToken, hasToken, BASE_URL } from './config.js';
import { buildSidebarNav, buildBottomNav, navigate, onNavigate } from './router.js';
import { loadOverview, startOverviewPoll, stopOverviewPoll } from './overview.js';
import { loadServers, leaveServer } from './servers.js';
import { renderCommands } from './commands.js';
import { initAnnounce, sendAnnouncement } from './announce.js';
import { loadLockdownState, toggleLockdown } from './lockdown.js';
import { initNodeTerminal, initMongoTerminal } from './terminals.js';

// ── Clock ──────────────────────────────────────────────────────────────────────

function startClock() {
  const update = () => {
    const now = new Date();
    const timeStr = now.toLocaleTimeString('en-US', { hour12: false });
    const dateStr = now.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const el  = document.getElementById('topbar-clock');
    const el2 = document.getElementById('sidebar-clock');
    if (el)  el.textContent  = `${dateStr} · ${timeStr}`;
    if (el2) el2.textContent = timeStr;
  };
  update();
  setInterval(update, 1000);
}

// ── Auth ───────────────────────────────────────────────────────────────────────

async function verifyToken(token) {
  try {
    const res = await fetch(`${BASE_URL}/api/stats`, {
      headers: { 'x-token': token }
    });
    return res.status !== 401;
  } catch {
    return false;
  }
}

async function attemptLogin() {
  const input = document.getElementById('auth-secret-input');
  const errorEl = document.getElementById('auth-error');
  const btn = document.getElementById('auth-submit-btn');

  const token = input?.value?.trim();
  if (!token) return;

  btn.disabled = true;
  btn.textContent = 'Verifying…';
  errorEl.classList.remove('visible');

  const valid = await verifyToken(token);

  if (valid) {
    setToken(token);
    showDashboard();
  } else {
    btn.disabled = false;
    btn.textContent = 'Enter Dashboard';
    errorEl.textContent = 'Incorrect secret — check your DASHBOARD_SECRET env var.';
    errorEl.classList.add('visible');
    input.focus();
  }
}

function showAuthOverlay() {
  document.getElementById('auth-overlay')?.classList.remove('hidden');
  document.getElementById('auth-secret-input')?.focus();
}

function showDashboard() {
  document.getElementById('auth-overlay')?.classList.add('hidden');

  // First load
  loadOverview();
  renderCommands();
  initAnnounce();
}

function logout() {
  clearToken();
  showAuthOverlay();
}

// ── Navigation wiring ──────────────────────────────────────────────────────────

onNavigate((pageId) => {
  stopOverviewPoll();

  switch (pageId) {
    case 'overview':
      loadOverview();
      startOverviewPoll();
      break;
    case 'servers':
      loadServers();
      break;
    case 'lockdown':
      loadLockdownState();
      break;
    case 'node-console':
      initNodeTerminal();
      break;
    case 'mongo-console':
      initMongoTerminal();
      break;
  }
});

// ── Global bindings ────────────────────────────────────────────────────────────
// (used by inline onclick attrs in HTML to avoid module scope issues)

window._navigate      = navigate;
window._leaveServer   = leaveServer;
window._logout        = logout;
window._refresh       = () => {
  const page = document.querySelector('.nav-item.active, .bottom-nav-item.active')?.dataset?.page;
  if (page) navigate(page);
};
window._sendAnnounce  = sendAnnouncement;
window._toggleLockdown = toggleLockdown;
window._attemptLogin  = attemptLogin;

// ── Boot ───────────────────────────────────────────────────────────────────────

async function boot() {
  // Build nav
  const sidebarNav = document.getElementById('sidebar-nav');
  const bottomNavInner = document.getElementById('bottom-nav-inner');
  if (sidebarNav)    buildSidebarNav(sidebarNav);
  if (bottomNavInner) buildBottomNav(bottomNavInner);

  // Keyboard: Enter on auth input
  document.getElementById('auth-secret-input')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') attemptLogin();
  });

  // Start clock
  startClock();

  // Check existing session
  if (hasToken()) {
    const valid = await verifyToken(getToken());
    if (valid) {
      showDashboard();
      navigate('overview');
      startOverviewPoll();
    } else {
      clearToken();
      showAuthOverlay();
    }
  } else {
    showAuthOverlay();
  }
}

document.addEventListener('DOMContentLoaded', boot);
