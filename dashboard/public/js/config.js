/**
 * config.js — Dashboard configuration and session management.
 * Session token is stored in sessionStorage (cleared on tab close).
 */

export const SESSION_KEY = 'lumin_dash_token';
export const BASE_URL    = window.location.origin + '/dashboard';

export function getToken()         { return sessionStorage.getItem(SESSION_KEY) || ''; }
export function setToken(token)    { sessionStorage.setItem(SESSION_KEY, token); }
export function clearToken()       { sessionStorage.removeItem(SESSION_KEY); }
export function hasToken()         { return !!getToken(); }

/** Nav page definitions with inline SVG icons */
export const PAGES = [
  {
    id: 'overview', label: 'Overview', group: 'Monitor', title: 'Overview', breadcrumb: 'Monitor',
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="13" width="7" height="8" rx="1"/><rect x="14" y="3" width="7" height="18" rx="1"/><rect x="3" y="3" width="7" height="6" rx="1"/></svg>`,
  },
  {
    id: 'servers', label: 'Servers', group: 'Monitor', title: 'Servers', breadcrumb: 'Monitor',
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><ellipse cx="12" cy="12" rx="4" ry="10"/><path d="M2 12h20"/></svg>`,
  },
  {
    id: 'commands', label: 'Commands', group: 'Control', title: 'Admin Commands', breadcrumb: 'Control',
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>`,
  },
  {
    id: 'announce', label: 'Announce', group: 'Control', title: 'Global Announcement', breadcrumb: 'Control',
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 11l19-9-9 19-2-8-8-2z"/></svg>`,
  },
  {
    id: 'lockdown', label: 'Lockdown', group: 'Control', title: 'Global Lockdown', breadcrumb: 'Control',
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>`,
  },
  {
    id: 'node-console', label: 'Node.js', group: 'Consoles', title: 'Node.js REPL', breadcrumb: 'Consoles',
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>`,
  },
  {
    id: 'mongo-console', label: 'MongoDB', group: 'Consoles', title: 'MongoDB Shell', breadcrumb: 'Consoles',
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v6c0 1.66 3.58 3 8 3s8-1.34 8-3V6"/><path d="M4 12v6c0 1.66 3.58 3 8 3s8-1.34 8-3v-6"/></svg>`,
  },
];
