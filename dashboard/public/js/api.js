/**
 * api.js — Centralized API client. All requests go through here.
 */

import { getToken, BASE_URL } from './config.js';

/**
 * Core fetch wrapper. Throws on network error.
 * @param {string} method
 * @param {string} path
 * @param {object} [body]
 * @returns {Promise<object>}
 */
async function request(method, path, body) {
  const opts = {
    method,
    headers: {
      'Content-Type': 'application/json',
      'x-token': getToken(),
    },
  };

  if (body !== undefined) {
    opts.body = JSON.stringify(body);
  }

  const res = await fetch(`${BASE_URL}${path}`, opts);

  // Try to parse JSON even on error responses
  let data;
  try {
    data = await res.json();
  } catch {
    data = { error: `HTTP ${res.status}: ${res.statusText}` };
  }

  if (res.status === 401) {
    // Token is wrong — trigger re-auth
    data._authError = true;
  }

  return data;
}

// ── Convenience wrappers ──────────────────────────────────────────────────────

export const get  = (path)        => request('GET',  path);
export const post = (path, body)  => request('POST', path, body);

// ── Named API calls ───────────────────────────────────────────────────────────

export const api = {
  // Overview
  getStats:          ()         => get('/api/stats'),
  getServers:        ()         => get('/api/cmd/servers-detail'),

  // Admin commands
  saveState:         ()         => post('/api/cmd/save-state'),
  reloadState:       ()         => post('/api/cmd/reload-state'),
  clearAllHistories: ()         => post('/api/cmd/clear-all-histories'),
  clearUserHistory:  (userId)   => post('/api/cmd/clear-user-history',   { userId }),
  blacklistUser:     (userId, guildId) => post('/api/cmd/blacklist-user', { userId, guildId }),
  unblacklistUser:   (userId, guildId) => post('/api/cmd/unblacklist-user', { userId, guildId }),
  getBlacklisted:    ()         => get('/api/cmd/blacklisted-users'),
  switchApiKey:      ()         => post('/api/cmd/switch-api-key'),
  getApiKeyStats:    ()         => get('/api/cmd/api-key-stats'),
  setLockdown:       (enabled)  => post('/api/cmd/lockdown',            { enabled }),
  announce:          (payload)  => post('/api/cmd/announce',            payload),
  leaveServer:       (guildId)  => post('/api/cmd/leave-server',        { guildId }),
  resetServer:       (guildId)  => post('/api/cmd/reset-server',        { guildId }),
  getUserSettings:   (userId)   => get(`/api/cmd/user-settings/${userId}`),
  clearImageUsage:   ()         => post('/api/cmd/clear-image-usage'),
  clearSummaryUsage: ()         => post('/api/cmd/clear-summary-usage'),
  clearQuoteUsage:   ()         => post('/api/cmd/clear-quote-usage'),
  toggleDebug:       ()         => post('/api/cmd/toggle-debug'),
  forceDailyReset:   ()         => post('/api/cmd/force-daily-reset'),
  getReminders:      ()         => get('/api/cmd/reminders'),
  purgeMemory:       (daysOld)  => post('/api/cmd/purge-memory',        { daysOld }),
  setPresence:       (status, activity) => post('/api/cmd/set-presence', { status, activity }),
  sendDM:            (userId, message)  => post('/api/cmd/send-dm',      { userId, message }),
  restart:           ()         => post('/api/cmd/restart'),
};
