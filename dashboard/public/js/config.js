/**
 * config.js — Dashboard configuration and auth token management.
 * Token is stored in sessionStorage (cleared on tab close).
 */

export const SESSION_KEY = 'lumin_dash_token';
// All dashboard API routes are served under /dashboard on the same origin
export const BASE_URL = window.location.origin + '/dashboard';

export function getToken() {
  return sessionStorage.getItem(SESSION_KEY) || '';
}

export function setToken(token) {
  sessionStorage.setItem(SESSION_KEY, token);
}

export function clearToken() {
  sessionStorage.removeItem(SESSION_KEY);
}

export function hasToken() {
  return !!getToken();
}

/** Page definitions — order determines bottom nav order on mobile */
export const PAGES = [
  { id: 'overview',      label: 'Overview',  icon: '📊', group: 'Monitor',  title: 'Bot Overview'     },
  { id: 'servers',       label: 'Servers',   icon: '🌐', group: 'Monitor',  title: 'Servers'          },
  { id: 'commands',      label: 'Commands',  icon: '⚙️', group: 'Control',  title: 'Admin Commands'   },
  { id: 'announce',      label: 'Announce',  icon: '📢', group: 'Control',  title: 'Announcement'     },
  { id: 'lockdown',      label: 'Lockdown',  icon: '🔒', group: 'Control',  title: 'Global Lockdown'  },
  { id: 'node-console',  label: 'Node.js',   icon: '🟢', group: 'Consoles', title: 'Node.js REPL'     },
  { id: 'mongo-console', label: 'MongoDB',   icon: '🍃', group: 'Consoles', title: 'MongoDB Shell'    },
];
