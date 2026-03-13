import { getToken, BASE_URL } from './config.js';

async function request(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json', 'x-token': getToken() } };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const res  = await fetch(`${BASE_URL}${path}`, opts);
  let data;
  try { data = await res.json(); } catch { data = { error: `HTTP ${res.status}` }; }
  if (res.status === 401) data._authError = true;
  return data;
}

const get  = path       => request('GET',  path);
const post = (path, b)  => request('POST', path, b);

export const api = {
  getStats:          ()           => get('/api/stats'),
  getServers:        ()           => get('/api/cmd/servers'),
  saveState:         ()           => post('/api/cmd/save-state'),
  reloadState:       ()           => post('/api/cmd/reload-state'),
  clearHistory:      (id)         => post('/api/cmd/clear-history', id ? {id} : {}),
  blacklistUser:     (userId,guildId) => post('/api/cmd/blacklist',    {userId,guildId}),
  unblacklistUser:   (userId,guildId) => post('/api/cmd/unblacklist',  {userId,guildId}),
  getBlacklisted:    ()           => get('/api/cmd/blacklisted-users'),
  switchApiKey:      ()           => post('/api/cmd/switch-api-key'),
  getApiKeyStats:    ()           => get('/api/cmd/api-key-stats'),
  setLockdown:       (enabled)    => post('/api/cmd/lockdown',         {enabled}),
  announce:          (payload)    => post('/api/cmd/announce',         payload),
  leaveServer:       (guildId)    => post('/api/cmd/leave-server',     {guildId}),
  resetServer:       (guildId)    => post('/api/cmd/reset-server',     {guildId}),
  getUserSettings:   (userId)     => get(`/api/cmd/user-settings/${userId}`),
  clearImageUsage:   ()           => post('/api/cmd/clear-image-usage'),
  clearSummaryUsage: ()           => post('/api/cmd/clear-summary-usage'),
  clearQuoteUsage:   ()           => post('/api/cmd/clear-quote-usage'),
  toggleDebug:       ()           => post('/api/cmd/toggle-debug'),
  setPresence:       (payload)    => post('/api/cmd/set-presence',     payload),
  sendDm:            (userId,msg) => post('/api/cmd/send-dm',          {userId,message:msg}),
  restart:           ()           => post('/api/cmd/restart'),
  authMe:            ()           => get('/auth/me'),
  authLogout:        ()           => post('/auth/logout'),
  authConfig:        ()           => get('/auth/config'),
  verifyRecaptcha:   (token)      => post('/auth/verify-recaptcha',    {token}),
};
