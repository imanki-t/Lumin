import { BASE_URL } from './config.js';

// ── Core fetch wrapper ────────────────────────────────────────────────────────
async function req(method, path, body) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin', // HttpOnly cookie sent automatically
  };
  if (body !== undefined) opts.body = JSON.stringify(body);

  const res = await fetch(`${BASE_URL}${path}`, opts);
  let data;
  try { data = await res.json(); } catch { data = { error: `HTTP ${res.status}` }; }
  if (res.status === 401) data._authError = true;
  return data;
}

const get  = path        => req('GET',    path);
const post = (path, body) => req('POST',   path, body);
const put  = (path, body) => req('PUT',    path, body);
const del  = (path, body) => req('DELETE', path, body);

// ── API surface ───────────────────────────────────────────────────────────────
export const api = {
  // Auth
  authMe:              ()                    => get('/auth/me'),
  authLogout:          ()                    => post('/auth/logout'),
  authConfig:          ()                    => get('/auth/config'),
  verifyRecaptcha:     token                 => post('/auth/verify-recaptcha', { token }),

  // Stats / Overview
  getStats:            ()                    => get('/api/stats'),
  stateSnapshot:       ()                    => get('/api/cmd/state-snapshot'),
  usageStats:          ()                    => get('/api/cmd/usage-stats'),
  botInfo:             ()                    => get('/api/cmd/bot-info'),
  inviteLink:          ()                    => get('/api/cmd/invite-link'),

  // Servers
  getServers:          ()                    => get('/api/cmd/servers'),
  leaveServer:         guildId               => post('/api/cmd/leave-server',   { guildId }),
  resetServer:         guildId               => post('/api/cmd/reset-server',   { guildId }),
  getServerSettings:   guildId               => get(`/api/cmd/server-settings/${guildId}`),
  setServerSettings:   (guildId, data)       => put(`/api/cmd/server-settings/${guildId}`, data),
  getGuildInfo:        guildId               => get(`/api/cmd/guild-info/${guildId}`),
  getChannels:         guildId               => get(`/api/cmd/channels/${guildId}`),
  getMembers:          guildId               => get(`/api/cmd/members/${guildId}`),
  sendChannel:         (channelId, msg, embed) => post('/api/cmd/send-channel', { channelId, message: msg, embed }),

  // Users
  fetchUserProfile:    userId                => get(`/api/cmd/user-profile/${userId}`),
  resolveUsername:     username              => post('/api/cmd/resolve-username', { username }),
  getUserSettings:     userId                => get(`/api/cmd/user-settings/${userId}`),
  setUserSettings:     (userId, data)        => put(`/api/cmd/user-settings/${userId}`, data),
  resetUserSettings:   userId                => post('/api/cmd/reset-user-settings', { userId }),
  sendDm:              (userId, message)     => post('/api/cmd/send-dm', { userId, message }),
  dmAllOwners:         message               => post('/api/cmd/dm-all-owners', { message }),
  kickMember:          (guildId, userId, reason) => post('/api/cmd/kick-member', { guildId, userId, reason }),
  banMember:           (guildId, userId, reason) => post('/api/cmd/ban-member',  { guildId, userId, reason }),
  setNickname:         (guildId, nickname)   => post('/api/cmd/set-nickname', { guildId, nickname }),

  // History
  getChatHistory:      id                    => get(`/api/cmd/chat-history/${id}`),
  allHistories:        ()                    => get('/api/cmd/all-histories'),
  clearHistory:        id                    => post('/api/cmd/clear-history', id ? { id } : {}),

  // Memory
  getMemory:           (userId, page)        => get(`/api/cmd/memory/${userId}?page=${page || 1}&limit=50`),
  deleteMemory:        userId                => del(`/api/cmd/memory/${userId}`),

  // Blacklist
  blacklistUser:       (userId, guildId)     => post('/api/cmd/blacklist',   { userId, guildId }),
  unblacklistUser:     (userId, guildId)     => post('/api/cmd/unblacklist', { userId, guildId }),
  getBlacklisted:      ()                    => get('/api/cmd/blacklisted-users'),
  purgeBlacklist:      ()                    => post('/api/cmd/purge-blacklist'),

  // Presence
  getPresence:         ()                    => get('/api/cmd/get-presence'),
  setPresence:         payload               => post('/api/cmd/set-presence', payload),

  // Announcements
  announce:            payload               => post('/api/cmd/announce', payload),
  announceUsers:       payload               => post('/api/cmd/announce-users', payload),

  // Lockdown
  setLockdown:         enabled               => post('/api/cmd/lockdown', { enabled }),

  // API Keys
  switchApiKey:        ()                    => post('/api/cmd/switch-api-key'),
  switchToKey:         idx                   => post(`/api/cmd/switch-to-key/${idx}`),
  getApiKeyStats:      ()                    => get('/api/cmd/api-key-stats'),

  // Models & Feature Flags
  getModels:           ()                    => get('/api/cmd/models'),
  setModel:            model                 => post('/api/cmd/set-model', { model }),
  getFeatureFlags:     ()                    => get('/api/cmd/feature-flags'),
  toggleFeature:       (feature, enabled)    => post('/api/cmd/toggle-feature', { feature, enabled }),
  setEmbedColor:       (color, guildId)      => post('/api/cmd/set-embed-color', { color, guildId }),

  // Reminders / Birthdays
  getReminders:        ()                    => get('/api/cmd/reminders'),
  getBirthdays:        ()                    => get('/api/cmd/birthdays'),
  clearReminders:      ()                    => post('/api/cmd/clear-reminders'),
  clearBirthdays:      ()                    => post('/api/cmd/clear-birthdays'),

  // Usage counters
  clearImageUsage:     ()                    => post('/api/cmd/clear-image-usage'),
  clearSummaryUsage:   ()                    => post('/api/cmd/clear-summary-usage'),
  clearQuoteUsage:     ()                    => post('/api/cmd/clear-quote-usage'),
  clearStarterUsage:   ()                    => post('/api/cmd/clear-starter-usage'),
  clearComplimentUsage:()                    => post('/api/cmd/clear-compliment-usage'),
  clearAllUsage:       ()                    => post('/api/cmd/clear-all-usage'),

  // Bot controls
  saveState:           ()                    => post('/api/cmd/save-state'),
  reloadState:         ()                    => post('/api/cmd/reload-state'),
  toggleDebug:         ()                    => post('/api/cmd/toggle-debug'),
  restart:             ()                    => post('/api/cmd/restart'),
  reloadCommands:      ()                    => post('/api/cmd/reload-commands'),

  // Config
  getActivities:       ()                    => get('/api/config/activities'),
  getRuntimeConfig:    ()                    => get('/api/config/runtime'),
  setRuntimeConfig:    data                  => put('/api/config/runtime', data),
  clearRuntimeConfig:  ()                    => del('/api/config/runtime'),
  getModulesConfig:    ()                    => get('/api/config/modules'),
  setModulesConfig:    content               => put('/api/config/modules', { content }),
  resetModulesConfig:  ()                    => post('/api/config/modules/reset'),
  getBaseConfig:       ()                    => get('/api/config/base'),
  setBaseConfig:       content               => put('/api/config/base', { content }),
  resetBaseConfig:     ()                    => post('/api/config/base/reset'),
  getRateLimits:       ()                    => get('/api/config/rate-limits'),
  setRateLimits:       data                  => put('/api/config/rate-limits', data),
  getAllConfig:         ()                    => get('/api/config/all'),

  // Bot / Migration config
  getMigrationConfig:  ()                    => get('/api/cmd/migration-config'),
  setMigrationConfig:  data                  => put('/api/cmd/migration-config', data),
  getBotConfig:        ()                    => get('/api/cmd/bot-config'),
  setBotConfig:        data                  => put('/api/cmd/bot-config', data),
  runMigration:        data                  => post('/api/cmd/migrate', data),
  getMigrateFields:    ()                    => get('/api/cmd/migrate/fields'),

  // Database Browser
  dbCollections:       ()                    => get('/api/db/collections'),
  dbCollection:        (name, page)          => get(`/api/db/collection/${name}?page=${page || 1}&limit=50`),
  dbUpdateDoc:         (col, id, data)       => put(`/api/db/collection/${col}/${id}`, data),
  dbDeleteDoc:         (col, id)             => del(`/api/db/collection/${col}/${id}`),

  // File Browser
  files:               path                  => get(`/api/files?path=${encodeURIComponent(path || '')}`),
  saveFile:            (filePath, content)   => put('/api/files', { filePath, content }),
  deleteFile:          filePath              => del('/api/files', { filePath }),
};
