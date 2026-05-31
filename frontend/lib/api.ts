const BASE = '/dashboard';

function getToken(): string {
  if (typeof window === 'undefined') return '';
  return sessionStorage.getItem('lumin_dash_token') || '';
}

async function req<T = unknown>(
  method: string,
  path: string,
  body?: unknown
): Promise<T> {
  const opts: RequestInit = {
    method,
    headers: {
      'Content-Type': 'application/json',
      'x-token': getToken(),
    },
  };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const res = await fetch(`${BASE}${path}`, opts);
  let data: T;
  try { data = await res.json(); }
  catch (_e) { data = { error: `HTTP ${res.status}` } as T; }
  if (res.status === 401) {
    sessionStorage.removeItem('lumin_dash_token');
    window.location.href = '/gate';
  }
  return data;
}

const get  = <T = unknown>(p: string) => req<T>('GET', p);
const post = <T = unknown>(p: string, b?: unknown) => req<T>('POST', p, b);
const put  = <T = unknown>(p: string, b?: unknown) => req<T>('PUT', p, b);
const del  = <T = unknown>(p: string, b?: unknown) => req<T>('DELETE', p, b);

export const api = {
  // Auth
  authMe:              () => get('/auth/me'),
  authLogout:          () => post('/auth/logout'),
  authConfig:          () => get('/auth/config'),

  // Stats & Bot
  getStats:            () => get('/api/stats'),
  botInfo:             () => get('/api/cmd/bot-info'),
  inviteLink:          () => get('/api/cmd/invite-link'),
  saveState:           () => post('/api/cmd/save-state'),
  reloadCommands:      () => post('/api/cmd/reload-commands'),
  restart:             () => post('/api/cmd/restart'),
  toggleDebug:         () => post('/api/cmd/toggle-debug'),
  stateSnapshot:       () => get('/api/cmd/state-snapshot'),

  // Servers
  getServers:          () => get('/api/cmd/servers'),
  leaveServer:         (guildId: string) => post('/api/cmd/leave-server', { guildId }),
  resetServer:         (guildId: string) => post('/api/cmd/reset-server', { guildId }),
  getServerSettings:   (guildId: string) => get(`/api/cmd/server-settings/${guildId}`),
  setServerSettings:   (guildId: string, data: unknown) => put(`/api/cmd/server-settings/${guildId}`, data),
  getChannels:         (guildId: string) => get(`/api/cmd/channels/${guildId}`),
  getMembers:          (guildId: string) => get(`/api/cmd/members/${guildId}`),
  getGuildInfo:        (guildId: string) => get(`/api/cmd/guild-info/${guildId}`),
  sendChannel:         (channelId: string, msg: string, embed?: unknown) => post('/api/cmd/send-channel', { channelId, message: msg, embed }),
  kickMember:          (guildId: string, userId: string, reason?: string) => post('/api/cmd/kick-member', { guildId, userId, reason }),
  banMember:           (guildId: string, userId: string, reason?: string) => post('/api/cmd/ban-member', { guildId, userId, reason }),
  setNickname:         (guildId: string, nickname: string) => post('/api/cmd/set-nickname', { guildId, nickname }),

  // Users
  fetchUserProfile:    (userId: string) => get(`/api/cmd/user-profile/${userId}`),
  resolveUsername:     (username: string) => post('/api/cmd/resolve-username', { username }),
  getUserSettings:     (userId: string) => get(`/api/cmd/user-settings/${userId}`),
  setUserSettings:     (userId: string, data: unknown) => put(`/api/cmd/user-settings/${userId}`, data),
  resetUserSettings:   (userId: string) => post('/api/cmd/reset-user-settings', { userId }),
  blacklistUser:       (userId: string, guildId?: string) => post('/api/cmd/blacklist', { userId, guildId }),
  unblacklistUser:     (userId: string, guildId?: string) => post('/api/cmd/unblacklist', { userId, guildId }),
  getBlacklisted:      () => get('/api/cmd/blacklisted-users'),
  purgeBlacklist:      () => post('/api/cmd/purge-blacklist'),
  sendDm:              (userId: string, msg: string) => post('/api/cmd/send-dm', { userId, message: msg }),
  dmAllOwners:         (message: string) => post('/api/cmd/dm-all-owners', { message }),
  clearHistory:        (id?: string) => post('/api/cmd/clear-history', id ? { id } : {}),
  allHistories:        () => get('/api/cmd/all-histories'),
  getChatHistory:      (id: string) => get(`/api/cmd/chat-history/${id}`),
  getMemory:           (userId: string, page = 1) => get(`/api/cmd/memory/${userId}?page=${page}&limit=50`),
  deleteMemory:        (userId: string) => del(`/api/cmd/memory/${userId}`),

  // Models & Feature flags
  getModels:           () => get('/api/cmd/models'),
  setModel:            (model: string) => post('/api/cmd/set-model', { model }),
  getFeatureFlags:     () => get('/api/cmd/feature-flags'),
  toggleFeature:       (feature: string, enabled: boolean) => post('/api/cmd/toggle-feature', { feature, enabled }),
  getApiKeyStats:      () => get('/api/cmd/api-key-stats'),
  switchApiKey:        () => post('/api/cmd/switch-api-key'),
  switchToKey:         (idx: number) => post(`/api/cmd/switch-to-key/${idx}`),
  setEmbedColor:       (color: string, guildId?: string) => post('/api/cmd/set-embed-color', { color, guildId }),

  // Usage
  usageStats:          () => get('/api/cmd/usage-stats'),
  clearImageUsage:     () => post('/api/cmd/clear-image-usage'),
  clearSummaryUsage:   () => post('/api/cmd/clear-summary-usage'),
  clearQuoteUsage:     () => post('/api/cmd/clear-quote-usage'),
  clearStarterUsage:   () => post('/api/cmd/clear-starter-usage'),
  clearComplimentUsage:() => post('/api/cmd/clear-compliment-usage'),
  clearAllUsage:       () => post('/api/cmd/clear-all-usage'),
  clearReminders:      () => post('/api/cmd/clear-reminders'),
  clearBirthdays:      () => post('/api/cmd/clear-birthdays'),
  getReminders:        () => get('/api/cmd/reminders'),
  getBirthdays:        () => get('/api/cmd/birthdays'),

  // Presence
  setPresence:         (p: unknown) => post('/api/cmd/set-presence', p),
  getPresence:         () => get('/api/cmd/get-presence'),

  // Lockdown
  setLockdown:         (enabled: boolean) => post('/api/cmd/lockdown', { enabled }),

  // Announce
  announce:            (p: unknown) => post('/api/cmd/announce', p),
  announceUsers:       (p: unknown) => post('/api/cmd/announce-users', p),

  // Config
  getActivities:       () => get('/api/config/activities'),
  getRuntimeConfig:    () => get('/api/config/runtime'),
  setRuntimeConfig:    (data: unknown) => put('/api/config/runtime', data),
  clearRuntimeConfig:  () => del('/api/config/runtime'),
  getModulesConfig:    () => get('/api/config/modules'),
  setModulesConfig:    (content: string) => put('/api/config/modules', { content }),
  resetModulesConfig:  () => post('/api/config/modules/reset'),
  getBaseConfig:       () => get('/api/config/base'),
  setBaseConfig:       (content: string) => put('/api/config/base', { content }),
  resetBaseConfig:     () => post('/api/config/base/reset'),

  // Database
  dbCollections:       () => get('/api/db/collections'),
  dbCollection:        (name: string, page = 1) => get(`/api/db/collection/${name}?page=${page}&limit=50`),
  dbUpdateDoc:         (col: string, id: string, data: unknown) => put(`/api/db/collection/${col}/${id}`, data),
  dbDeleteDoc:         (col: string, id: string) => del(`/api/db/collection/${col}/${id}`),

  // Files
  files:               (path: string) => get(`/api/files?path=${encodeURIComponent(path || '')}`),
  saveFile:            (filePath: string, content: string) => put('/api/files', { filePath, content }),
  deleteFile:          (filePath: string) => del('/api/files', { filePath }),
};
