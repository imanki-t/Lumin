import express                        from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import { spawn }                      from 'child_process';
import { execSync }                   from 'child_process';
import crypto                         from 'crypto';
import os                             from 'os';
import path                           from 'path';
import fs                             from 'fs';
import { fileURLToPath }              from 'url';

import {
  client,
  state,
  getApiKeyStats,
  switchToNextKey,
  rotateToNextKey,
  saveStateToFile,
} from '../managers/BotManager.js';
import { DEFAULT_SERVER_SETTINGS, DEFAULT_USER_SETTINGS } from '../managers/StateManager.js';
import * as db from '../database.js';
import { Logger } from '../core/Logger.js';

const logger     = Logger.get('Dashboard');
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const ROOT_DIR   = path.resolve(__dirname, '..');

const GOOGLE_CLIENT_ID     = process.env.GOOGLE_CLIENT_ID     || '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const RECAPTCHA_SECRET     = process.env.RECAPTCHA_SECRET_KEY  || '';
const RECAPTCHA_SITE_KEY   = process.env.RECAPTCHA_SITE_KEY    || '';
const ALLOWED_EMAIL        = 'imitsankit@gmail.com';
const SESSION_TTL          = 24 * 60 * 60 * 1000;

const RUNTIME_CONFIG_PATH  = path.join(__dirname, 'runtime-config.json');
const MODULES_CONFIG_PATH  = path.join(ROOT_DIR, 'modules', 'config.js');
const BASE_CONFIG_PATH     = path.join(ROOT_DIR, 'config.js');

if (state.globalLockdown === undefined) state.globalLockdown = false;
if (state.debugMode      === undefined) state.debugMode      = false;

let runtimeConfig = {};
try {
  if (fs.existsSync(RUNTIME_CONFIG_PATH)) {
    runtimeConfig = JSON.parse(fs.readFileSync(RUNTIME_CONFIG_PATH, 'utf8'));
  }
} catch {}

function saveRuntimeConfig() {
  try { fs.writeFileSync(RUNTIME_CONFIG_PATH, JSON.stringify(runtimeConfig, null, 2)); } catch {}
}

const sessions    = new Map();
const oauthStates = new Map();

function makeToken() { return crypto.randomBytes(32).toString('hex'); }
function parseCookies(h) {
  if (!h) return {};
  return Object.fromEntries(h.split(';').map(c => { const [k,...v]=c.trim().split('='); return [k.trim(),decodeURIComponent(v.join('=').trim())]; }));
}
function getSessionToken(req) {
  return req.headers['x-token'] || req.query.token || parseCookies(req.headers.cookie).lumin_session || null;
}
function lookupSession(tok) {
  if (!tok) return null;
  const s = sessions.get(tok);
  if (!s) return null;
  if (Date.now() > s.expires) { sessions.delete(tok); return null; }
  return s;
}
function getDiskUsage() {
  try {
    const out = execSync("df -h / | tail -1 | awk '{print $3\",\"$4\",\"$5}'").toString().trim();
    const [used,available,percent] = out.split(',');
    return { used, available, percent };
  } catch { return { used:'N/A', available:'N/A', percent:'N/A' }; }
}
function safeCount(obj) { try { return Object.keys(obj||{}).length; } catch { return 0; } }
function getCallbackUrl(req) {
  const proto = req.headers['x-forwarded-proto'] || req.protocol;
  const host  = req.headers['x-forwarded-host']  || req.get('host');
  return `${proto}://${host}/dashboard/auth/google/callback`;
}

function authenticate(req, res, next) {
  const tok     = getSessionToken(req);
  const session = lookupSession(tok);
  if (!session) return res.status(401).json({ error: 'Unauthorized' });
  session.expires  = Date.now() + SESSION_TTL;
  req.sessionToken = tok;
  req.sessionUser  = session;
  next();
}

const router = express.Router();
router.use(express.static(path.join(__dirname, 'public')));
router.use(express.json({ limit: '10mb' }));

router.get('/auth/config', (_req, res) => {
  res.json({ recaptchaSiteKey: RECAPTCHA_SITE_KEY, hasGoogleOAuth: !!(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET) });
});

router.post('/auth/verify-recaptcha', async (req, res) => {
  const { token } = req.body;
  if (!token || !RECAPTCHA_SECRET) return res.json({ success: true, score: 1 });
  try {
    const r    = await fetch('https://www.google.com/recaptcha/api/siteverify', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ secret: RECAPTCHA_SECRET, response: token }),
    });
    const data = await r.json();
    res.json({ success: data.success, score: data.score ?? 0 });
  } catch { res.json({ success: true, score: 0.5 }); }
});

router.get('/auth/google', (req, res) => {
  if (!GOOGLE_CLIENT_ID) return res.status(500).send('GOOGLE_CLIENT_ID not configured.');
  const stateKey    = makeToken();
  const callbackUrl = getCallbackUrl(req);
  oauthStates.set(stateKey, { callbackUrl, created: Date.now() });
  for (const [k,v] of oauthStates) { if (Date.now() - v.created > 600_000) oauthStates.delete(k); }
  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authUrl.searchParams.set('client_id',     GOOGLE_CLIENT_ID);
  authUrl.searchParams.set('redirect_uri',  callbackUrl);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope',         'openid email profile');
  authUrl.searchParams.set('state',         stateKey);
  authUrl.searchParams.set('prompt',        'select_account');
  res.redirect(authUrl.toString());
});

router.get('/auth/google/callback', async (req, res) => {
  const { code, state: stateKey, error } = req.query;
  if (error || !code) return res.redirect('/dashboard/?auth=error');
  const stateData = oauthStates.get(stateKey);
  if (!stateData) return res.redirect('/dashboard/?auth=invalid_state');
  oauthStates.delete(stateKey);
  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code, client_id: GOOGLE_CLIENT_ID, client_secret: GOOGLE_CLIENT_SECRET, redirect_uri: stateData.callbackUrl, grant_type: 'authorization_code' }),
    });
    const tokens = await tokenRes.json();
    if (!tokens.access_token) throw new Error(`Token exchange failed: ${JSON.stringify(tokens)}`);
    const userRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', { headers: { Authorization: `Bearer ${tokens.access_token}` } });
    const user    = await userRes.json();
    if (user.email !== ALLOWED_EMAIL) return res.redirect('/dashboard/?auth=denied');
    const sessionToken = makeToken();
    sessions.set(sessionToken, { email: user.email, name: user.name, picture: user.picture, expires: Date.now() + SESSION_TTL });
    const secure    = req.headers['x-forwarded-proto'] === 'https';
    const cookieVal = `lumin_session=${sessionToken}; Path=/dashboard; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL/1000}${secure?'; Secure':''}`;
    res.setHeader('Set-Cookie', cookieVal);
    const dest = `/dashboard/?token=${encodeURIComponent(sessionToken)}`;
    res.send(`<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width,initial-scale=1.0,maximum-scale=1.0,viewport-fit=cover"><script>location.replace(${JSON.stringify(dest)})</script></head></html>`);
  } catch (err) { logger.error('OAuth callback error', err); res.redirect('/dashboard/?auth=error'); }
});

router.get('/auth/me', authenticate, (req, res) => {
  res.json({ success: true, user: req.sessionUser, token: req.sessionToken });
});

router.post('/auth/logout', (req, res) => {
  const tok = getSessionToken(req);
  if (tok) sessions.delete(tok);
  res.setHeader('Set-Cookie', 'lumin_session=; Path=/dashboard; HttpOnly; Max-Age=0');
  res.json({ success: true });
});

router.get('/api/stats', authenticate, async (req, res) => {
  try {
    const mem      = process.memoryUsage();
    const guilds   = client?.guilds?.cache ?? new Map();
    const apiStats = getApiKeyStats();
    const disk     = getDiskUsage();
    let totalUsers = 0;
    guilds.forEach(g => { totalUsers += (g.memberCount || 0); });
    let mongoStatus = 'Unknown';
    try { await db.connectDB(); mongoStatus = 'Connected'; } catch { mongoStatus = 'Disconnected'; }
    const WS_LABELS = ['READY','CONNECTING','RECONNECTING','IDLE','NEARLY','DISCONNECTED','WAITING_FOR_GUILDS','IDENTIFYING','RESUMING'];
    res.json({
      username: client?.user?.username || 'N/A', tag: client?.user?.tag || 'N/A', id: client?.user?.id || 'N/A',
      avatarURL: client?.user?.displayAvatarURL?.({ size: 256, extension: 'png' }) || null,
      wsStatus: WS_LABELS[client?.ws?.status] || 'Unknown', serverCount: guilds.size, totalUsers,
      ping: client?.ws?.ping ?? -1, uptime: process.uptime(), nodeVersion: process.version,
      platform: `${os.platform()} ${os.arch()}`, cpuCores: os.cpus().length, cpuModel: os.cpus()[0]?.model || 'Unknown',
      ram: { heapUsed: mem.heapUsed, heapTotal: mem.heapTotal, rss: mem.rss, external: mem.external, sysFree: os.freemem(), sysTotal: os.totalmem() },
      disk, mongoStatus, apiKeyStats: apiStats,
      totalChatHistories: safeCount(state.chatHistories), totalServerSettings: safeCount(state.serverSettings),
      totalUserSettings: safeCount(state.userSettings), totalReminders: safeCount(state.reminders),
      totalBlacklisted: Object.values(state.blacklistedUsers || {}).flat().length,
      globalLockdown: state.globalLockdown || false, debugMode: state.debugMode || false,
      runtimeConfig,
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/api/cmd/save-state', authenticate, async (req, res) => {
  try { await saveStateToFile(); res.json({ success: true, message: 'State saved.' }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/api/cmd/reload-state', authenticate, async (_req, res) => {
  res.json({ success: true, message: 'Full reload requires restart.' });
});

router.post('/api/cmd/clear-history', authenticate, async (req, res) => {
  try {
    const { id } = req.body;
    if (id) {
      delete state.chatHistories[id];
      if (db.deleteChatHistory) await db.deleteChatHistory(id);
      res.json({ success: true, message: `History cleared for ${id}.` });
    } else {
      const count = safeCount(state.chatHistories);
      state.chatHistories = {};
      await saveStateToFile();
      res.json({ success: true, message: `Cleared ${count} chat histories.` });
    }
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/api/cmd/chat-history/:id', authenticate, (req, res) => {
  try {
    // chatHistories[id] is { [messagesId]: [...entries] } — flatten into a single array.
    // Works for both user IDs and guild/server IDs.
    const historyObj = state.chatHistories[req.params.id];
    if (!historyObj || typeof historyObj !== 'object' || Object.keys(historyObj).length === 0) {
      return res.status(404).json({ success: false, error: 'No history found.' });
    }
    const flat = Object.values(historyObj).flat().filter(Boolean);
    flat.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
    res.json({ success: true, data: flat, channels: Object.keys(historyObj).length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/api/cmd/all-histories', authenticate, (req, res) => {
  try {
    const ids = Object.keys(state.chatHistories || {});
    const summaries = ids.map(id => ({
      id,
      messageCount: Array.isArray(state.chatHistories[id]) ? state.chatHistories[id].length : 0,
    }));
    res.json({ success: true, data: summaries, total: ids.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/api/cmd/blacklist', authenticate, async (req, res) => {
  try {
    const { guildId, userId } = req.body;
    if (!guildId || !userId) return res.status(400).json({ error: 'guildId and userId required.' });
    if (!state.blacklistedUsers[guildId]) state.blacklistedUsers[guildId] = [];
    if (!state.blacklistedUsers[guildId].includes(userId)) {
      state.blacklistedUsers[guildId].push(userId);
      if (db.saveBlacklistedUsers) await db.saveBlacklistedUsers(guildId, state.blacklistedUsers[guildId]);
    }
    res.json({ success: true, message: `User ${userId} blacklisted in ${guildId}.` });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/api/cmd/unblacklist', authenticate, async (req, res) => {
  try {
    const { guildId, userId } = req.body;
    if (!guildId || !userId) return res.status(400).json({ error: 'guildId and userId required.' });
    const list = state.blacklistedUsers[guildId] || [];
    state.blacklistedUsers[guildId] = list.filter(u => u !== userId);
    if (db.saveBlacklistedUsers) await db.saveBlacklistedUsers(guildId, state.blacklistedUsers[guildId]);
    res.json({ success: true, message: `User ${userId} unblacklisted.` });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/api/cmd/blacklisted-users', authenticate, (req, res) => {
  try {
    const data = state.blacklistedUsers || {};
    res.json({ success: true, data, total: Object.values(data).flat().length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/api/cmd/switch-api-key', authenticate, (req, res) => {
  try {
    rotateToNextKey();
    const stats = getApiKeyStats();
    res.json({ success: true, message: `Switched to Key ${stats.currentKey}.`, stats });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/api/cmd/switch-to-key/:index', authenticate, (req, res) => {
  try {
    const idx   = parseInt(req.params.index, 10);
    const stats = getApiKeyStats();
    if (isNaN(idx) || idx < 1 || idx > stats.totalKeys)
      return res.status(400).json({ error: `Key index must be 1-${stats.totalKeys}.` });
    const needed = idx - stats.currentKey;
    if (needed !== 0) {
      const times = ((needed % stats.totalKeys) + stats.totalKeys) % stats.totalKeys;
      for (let i = 0; i < times; i++) rotateToNextKey();
    }
    res.json({ success: true, message: `Switched to Key ${idx}.`, stats: getApiKeyStats() });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/api/cmd/api-key-stats', authenticate, (req, res) => {
  try { res.json({ success: true, data: getApiKeyStats() }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/api/cmd/lockdown', authenticate, (req, res) => {
  try {
    const { enabled } = req.body;
    state.globalLockdown = Boolean(enabled);
    res.json({ success: true, message: `Global lockdown ${enabled ? 'ENABLED' : 'DISABLED'}.`, enabled: state.globalLockdown });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/api/cmd/announce', authenticate, async (req, res) => {
  try {
    const { message, title = 'Announcement', embedColor = '#6D5AE6', useEmbed = true } = req.body;
    if (!message) return res.status(400).json({ error: 'message required.' });
    const { EmbedBuilder, ChannelType } = await import('discord.js');
    let sentCount = 0, failCount = 0, skipCount = 0;
    for (const [, guild] of (client?.guilds?.cache ?? new Map())) {
      try {
        const channels = guild.channels.cache.filter(c =>
          c.type === ChannelType.GuildText && c.permissionsFor(guild.members.me)?.has(['SendMessages','ViewChannel'])
        );
        const target = channels.find(c => ['general','announcements','bot','chat','main'].includes(c.name.toLowerCase())) || channels.first();
        if (!target) { skipCount++; continue; }
        if (useEmbed) {
          const embed = new EmbedBuilder().setColor(embedColor).setTitle(title).setDescription(message).setTimestamp();
          await target.send({ embeds: [embed] });
        } else { await target.send(message); }
        sentCount++;
      } catch { failCount++; }
    }
    res.json({ success: true, message: `Sent to ${sentCount} servers. Failed: ${failCount}. Skipped: ${skipCount}.` });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/api/cmd/leave-server', authenticate, async (req, res) => {
  try {
    const { guildId } = req.body;
    if (!guildId) return res.status(400).json({ error: 'guildId required.' });
    const guild = client?.guilds?.cache?.get(guildId);
    if (!guild) return res.status(404).json({ error: 'Guild not found.' });
    await guild.leave();
    res.json({ success: true, message: `Left server: ${guild.name}.` });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/api/cmd/servers', authenticate, (req, res) => {
  try {
    const servers = [];
    for (const [, g] of (client?.guilds?.cache ?? new Map())) {
      servers.push({
        id: g.id, name: g.name, memberCount: g.memberCount, iconURL: g.iconURL(),
        ownerId: g.ownerId, createdAt: g.createdAt, joinedAt: g.joinedAt,
        settings: state.serverSettings[g.id] || {}, blacklisted: (state.blacklistedUsers[g.id] || []).length,
      });
    }
    servers.sort((a,b) => b.memberCount - a.memberCount);
    res.json({ success: true, data: servers, count: servers.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/api/cmd/reset-server', authenticate, async (req, res) => {
  try {
    const { guildId } = req.body;
    if (!guildId) return res.status(400).json({ error: 'guildId required.' });
    delete state.serverSettings[guildId];
    if (db.saveServerSettings) await db.saveServerSettings(guildId, {});
    res.json({ success: true, message: `Server settings reset for ${guildId}.` });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/api/cmd/server-settings/:guildId', authenticate, (req, res) => {
  try {
    const settings = state.serverSettings[req.params.guildId] || {};
    res.json({ success: true, data: { ...DEFAULT_SERVER_SETTINGS, ...settings } });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/api/cmd/server-settings/:guildId', authenticate, async (req, res) => {
  try {
    const { guildId } = req.params;
    if (!state.serverSettings[guildId]) state.serverSettings[guildId] = { ...DEFAULT_SERVER_SETTINGS };
    Object.assign(state.serverSettings[guildId], req.body);
    if (db.saveServerSettings) await db.saveServerSettings(guildId, state.serverSettings[guildId]);
    res.json({ success: true, data: state.serverSettings[guildId] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/api/cmd/user-settings/:userId', authenticate, (req, res) => {
  try {
    const settings = state.userSettings[req.params.userId] || {};
    res.json({ success: true, data: { ...DEFAULT_USER_SETTINGS, ...settings }, found: Object.keys(settings).length > 0 });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/api/cmd/user-settings/:userId', authenticate, async (req, res) => {
  try {
    const { userId } = req.params;
    if (!state.userSettings[userId]) state.userSettings[userId] = { ...DEFAULT_USER_SETTINGS };
    Object.assign(state.userSettings[userId], req.body);
    if (db.saveUserSettings) await db.saveUserSettings(userId, state.userSettings[userId]);
    res.json({ success: true, data: state.userSettings[userId] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/api/cmd/reset-user-settings', authenticate, async (req, res) => {
  try {
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ error: 'userId required.' });
    delete state.userSettings[userId];
    if (db.saveUserSettings) await db.saveUserSettings(userId, {});
    res.json({ success: true, message: `User settings reset for ${userId}.` });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/api/cmd/clear-image-usage', authenticate, async (req, res) => {
  try { const c = safeCount(state.imageUsage); state.imageUsage = {}; await saveStateToFile(); res.json({ success: true, message: `Cleared image usage for ${c} users.` }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/api/cmd/clear-summary-usage', authenticate, async (req, res) => {
  try { const c = safeCount(state.summaryUsage); state.summaryUsage = {}; await saveStateToFile(); res.json({ success: true, message: `Cleared summary usage for ${c} users.` }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/api/cmd/toggle-debug', authenticate, (req, res) => {
  try { state.debugMode = !state.debugMode; res.json({ success: true, message: `Debug mode ${state.debugMode ? 'ON' : 'OFF'}.`, enabled: state.debugMode }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/api/cmd/set-presence', authenticate, async (req, res) => {
  try {
    const { status = 'online', activity = '', activityType = 0 } = req.body;
    const ActivityType = (await import('discord.js')).ActivityType;
    client?.user?.setPresence({ status, activities: activity ? [{ name: activity, type: activityType }] : [] });
    runtimeConfig.presence = { status, activity, activityType };
    saveRuntimeConfig();
    res.json({ success: true, message: 'Presence set.' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/api/cmd/get-presence', authenticate, (req, res) => {
  try {
    const presence = client?.user?.presence;
    if (!presence) return res.json({ success: true, presence: null });
    res.json({ success: true, presence: { status: presence.status, activities: presence.activities?.map(a => ({ name: a.name, type: a.type })) || [] } });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/api/cmd/send-dm', authenticate, async (req, res) => {
  try {
    const { userId, message } = req.body;
    if (!userId || !message) return res.status(400).json({ error: 'userId and message required.' });
    const user = await client?.users?.fetch(userId);
    if (!user) return res.status(404).json({ error: 'User not found.' });
    await user.send(message);
    res.json({ success: true, message: `DM sent to ${user.tag}.` });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/api/cmd/clear-quote-usage', authenticate, async (req, res) => {
  try { const c = safeCount(state.quoteUsage); state.quoteUsage = {}; await saveStateToFile(); res.json({ success: true, message: `Cleared quote usage for ${c} users.` }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/api/cmd/restart', authenticate, async (req, res) => {
  try { await saveStateToFile(); res.json({ success: true, message: 'Restarting...' }); setTimeout(() => process.exit(0), 1500); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/api/cmd/resolve-username', authenticate, async (req, res) => {
  try {
    const { username } = req.body;
    if (!username) return res.status(400).json({ error: 'username required.' });

    // Pass 1: check in-memory cache (zero API calls, instant)
    for (const [, guild] of (client?.guilds?.cache ?? new Map())) {
      const member = guild.members.cache.find(m =>
        m.user.username?.toLowerCase() === username.toLowerCase() ||
        m.user.tag?.toLowerCase()      === username.toLowerCase()
      );
      if (member) return res.json({ success: true, id: member.user.id, tag: member.user.tag });
    }

    // Pass 2: query Discord's search API per guild (handles uncached members)
    for (const [, guild] of (client?.guilds?.cache ?? new Map())) {
      try {
        const results = await guild.members.search({ query: username, limit: 5 });
        const member = results.find(m =>
          m.user.username?.toLowerCase() === username.toLowerCase() ||
          m.user.tag?.toLowerCase()      === username.toLowerCase()
        );
        if (member) return res.json({ success: true, id: member.user.id, tag: member.user.tag });
      } catch { /* guild may not support search – continue */ }
    }

    res.status(404).json({ success: false, error: 'User not found in any guild.' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/api/cmd/user-profile/:userId', authenticate, async (req, res) => {
  try {
    const { userId } = req.params;
    const user = await client?.users?.fetch(userId, { force: true }).catch(() => null);
    if (!user) return res.status(404).json({ success: false, error: 'User not found.' });
    let mutualGuilds = 0;
    for (const [, guild] of (client?.guilds?.cache ?? new Map())) { if (guild.members.cache.has(userId)) mutualGuilds++; }
    res.json({
      success: true,
      user: {
        id: user.id, username: user.username, displayName: user.displayName || user.globalName || user.username,
        tag: user.tag, avatarURL: user.displayAvatarURL({ size: 128, extension: 'png' }),
        bot: user.bot, system: user.system, createdAt: user.createdAt?.toISOString(),
        mutualGuilds, hasSettings: !!(state.userSettings?.[userId] && Object.keys(state.userSettings[userId]).length),
        hasHistory: !!(state.chatHistories?.[userId]),
        blacklistedGuilds: Object.entries(state.blacklistedUsers || {}).filter(([,v]) => v.includes(userId)).map(([k]) => k),
      }
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/api/config/activities', authenticate, (req, res) => {
  try {
    const content = fs.readFileSync(BASE_CONFIG_PATH, 'utf8');
    const match = content.match(/activities\s*:\s*\[([\s\S]*?)\]/);
    const activities = [];
    if (match) {
      const entries = match[1].matchAll(/\{\s*name\s*:\s*["'`]([^"'`]+)["'`]\s*,\s*type\s*:\s*["'`]([^"'`]+)["'`]\s*\}/g);
      for (const e of entries) activities.push({ name: e[1], type: e[2] });
    }
    res.json({ success: true, data: activities });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/api/cmd/guild-info/:guildId', authenticate, async (req, res) => {
  try {
    const guild = client?.guilds?.cache?.get(req.params.guildId);
    if (!guild) return res.status(404).json({ success: false, error: 'Guild not found.' });
    res.json({
      success: true,
      guild: {
        id: guild.id, name: guild.name, ownerId: guild.ownerId, memberCount: guild.memberCount,
        iconURL: guild.iconURL(), createdAt: guild.createdAt?.toLocaleDateString(),
        premiumSubscriptionCount: guild.premiumSubscriptionCount || 0, description: guild.description || null,
      }
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/api/cmd/clear-reminders', authenticate, async (req, res) => {
  try { const count = safeCount(state.reminders); state.reminders = {}; await saveStateToFile(); res.json({ success: true, message: `Cleared ${count} reminder(s).` }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/api/cmd/reminders', authenticate, (req, res) => {
  try { res.json({ success: true, data: state.reminders || {}, total: safeCount(state.reminders) }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/api/cmd/clear-birthdays', authenticate, async (req, res) => {
  try { const count = safeCount(state.birthdays); state.birthdays = {}; await saveStateToFile(); res.json({ success: true, message: `Cleared ${count} birthday(s).` }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/api/cmd/birthdays', authenticate, (req, res) => {
  try { res.json({ success: true, data: state.birthdays || {}, total: safeCount(state.birthdays) }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/api/cmd/clear-starter-usage', authenticate, async (req, res) => {
  try { const count = safeCount(state.starterUsage); state.starterUsage = {}; await saveStateToFile(); res.json({ success: true, message: `Cleared starter usage for ${count} users.` }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/api/cmd/clear-compliment-usage', authenticate, async (req, res) => {
  try { const count = safeCount(state.complimentUsage); state.complimentUsage = {}; await saveStateToFile(); res.json({ success: true, message: `Cleared compliment usage for ${count} users.` }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/api/cmd/dm-all-owners', authenticate, async (req, res) => {
  try {
    const { message } = req.body;
    if (!message) return res.status(400).json({ error: 'message required.' });
    let sent = 0, failed = 0;
    const seenOwners = new Set();
    for (const [, guild] of (client?.guilds?.cache ?? new Map())) {
      if (seenOwners.has(guild.ownerId)) continue;
      seenOwners.add(guild.ownerId);
      try { const owner = await client.users.fetch(guild.ownerId); await owner.send(message); sent++; } catch { failed++; }
    }
    res.json({ success: true, message: `DM sent to ${sent} owners. Failed: ${failed}.` });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/api/cmd/reload-commands', authenticate, async (req, res) => {
  try {
    const { REST, Routes } = await import('discord.js');
    const token   = process.env.DISCORD_TOKEN || process.env.TOKEN || '';
    const rest    = new REST().setToken(token);
    const cmdModule = await import('../commands.js');
    const cmds    = cmdModule.commands || cmdModule.default || [];
    await rest.put(Routes.applicationCommands(client.user.id), { body: cmds });
    res.json({ success: true, message: 'Slash commands reloaded.' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/api/cmd/purge-blacklist', authenticate, async (req, res) => {
  try {
    const total = Object.values(state.blacklistedUsers || {}).flat().length;
    state.blacklistedUsers = {}; await saveStateToFile();
    res.json({ success: true, message: `Purged ${total} blacklist entries.` });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/api/cmd/announce-users', authenticate, async (req, res) => {
  try {
    const { message, title = 'Announcement', embedColor = '#6D5AE6', useEmbed = true } = req.body;
    if (!message) return res.status(400).json({ error: 'message required.' });
    const { EmbedBuilder } = await import('discord.js');
    const seen = new Set(); let sent = 0, failed = 0;
    for (const [, guild] of (client?.guilds?.cache ?? new Map())) {
      for (const [uid, member] of guild.members.cache) {
        if (member.user.bot || seen.has(uid)) continue;
        seen.add(uid);
        try {
          if (useEmbed) {
            const embed = new EmbedBuilder().setColor(embedColor).setTitle(title).setDescription(message).setTimestamp();
            await member.user.send({ embeds: [embed] });
          } else { await member.user.send(message); }
          sent++;
        } catch { failed++; }
      }
    }
    res.json({ success: true, message: `DM sent to ${sent} users. Failed: ${failed}.` });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/api/cmd/channels/:guildId', authenticate, async (req, res) => {
  try {
    const { ChannelType } = await import('discord.js');
    const guild = client?.guilds?.cache?.get(req.params.guildId);
    if (!guild) return res.status(404).json({ error: 'Guild not found.' });
    const channels = guild.channels.cache
      .filter(c => c.type === ChannelType.GuildText || c.type === ChannelType.GuildVoice)
      .map(c => ({ id: c.id, name: c.name, type: c.type, position: c.position, parentId: c.parentId }))
      .sort((a,b) => a.position - b.position);
    res.json({ success: true, data: channels, count: channels.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/api/cmd/members/:guildId', authenticate, async (req, res) => {
  try {
    const guild = client?.guilds?.cache?.get(req.params.guildId);
    if (!guild) return res.status(404).json({ error: 'Guild not found.' });
    const members = guild.members.cache.map(m => ({
      id: m.user.id, username: m.user.username, displayName: m.displayName,
      bot: m.user.bot, joinedAt: m.joinedAt?.toISOString(),
      roles: m.roles.cache.map(r => r.name).filter(n => n !== '@everyone'),
    }));
    res.json({ success: true, data: members, count: members.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/api/cmd/send-channel', authenticate, async (req, res) => {
  try {
    const { channelId, message, embed } = req.body;
    if (!channelId || !message) return res.status(400).json({ error: 'channelId and message required.' });
    const channel = client?.channels?.cache?.get(channelId) || await client?.channels?.fetch(channelId).catch(() => null);
    if (!channel) return res.status(404).json({ error: 'Channel not found.' });
    if (embed) {
      const { EmbedBuilder } = await import('discord.js');
      const e = new EmbedBuilder().setDescription(message);
      if (embed.title) e.setTitle(embed.title);
      if (embed.color) e.setColor(embed.color);
      await channel.send({ embeds: [e] });
    } else { await channel.send(message); }
    res.json({ success: true, message: `Message sent to #${channel.name}.` });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/api/cmd/kick-member', authenticate, async (req, res) => {
  try {
    const { guildId, userId, reason = 'Admin action via dashboard' } = req.body;
    if (!guildId || !userId) return res.status(400).json({ error: 'guildId and userId required.' });
    const guild  = client?.guilds?.cache?.get(guildId);
    if (!guild) return res.status(404).json({ error: 'Guild not found.' });
    const member = guild.members.cache.get(userId) || await guild.members.fetch(userId).catch(() => null);
    if (!member) return res.status(404).json({ error: 'Member not found.' });
    await member.kick(reason);
    res.json({ success: true, message: `Kicked ${member.user.tag} from ${guild.name}.` });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/api/cmd/ban-member', authenticate, async (req, res) => {
  try {
    const { guildId, userId, reason = 'Admin action via dashboard', deleteMessageDays = 0 } = req.body;
    if (!guildId || !userId) return res.status(400).json({ error: 'guildId and userId required.' });
    const guild = client?.guilds?.cache?.get(guildId);
    if (!guild) return res.status(404).json({ error: 'Guild not found.' });
    await guild.bans.create(userId, { reason, deleteMessageSeconds: deleteMessageDays * 86400 });
    res.json({ success: true, message: `Banned user ${userId} from ${guild.name}.` });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/api/cmd/set-nickname', authenticate, async (req, res) => {
  try {
    const { guildId, nickname } = req.body;
    if (!guildId) return res.status(400).json({ error: 'guildId required.' });
    const guild = client?.guilds?.cache?.get(guildId);
    if (!guild) return res.status(404).json({ error: 'Guild not found.' });
    await guild.members.me.setNickname(nickname || null);
    res.json({ success: true, message: `Nickname set in ${guild.name}.` });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/api/cmd/invite-link', authenticate, (req, res) => {
  try {
    const id = client?.user?.id;
    if (!id) return res.status(500).json({ error: 'Bot not ready.' });
    const link = `https://discord.com/api/oauth2/authorize?client_id=${id}&permissions=8&scope=bot%20applications.commands`;
    res.json({ success: true, link });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/api/cmd/state-snapshot', authenticate, (req, res) => {
  try {
    res.json({
      success: true,
      data: {
        chatHistoriesCount: safeCount(state.chatHistories), serverSettingsCount: safeCount(state.serverSettings),
        userSettingsCount: safeCount(state.userSettings), remindersCount: safeCount(state.reminders),
        birthdaysCount: safeCount(state.birthdays), blacklistedCount: Object.values(state.blacklistedUsers || {}).flat().length,
        imageUsageCount: safeCount(state.imageUsage), summaryUsageCount: safeCount(state.summaryUsage),
        globalLockdown: state.globalLockdown, debugMode: state.debugMode,
      }
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/api/cmd/clear-all-usage', authenticate, async (req, res) => {
  try {
    state.imageUsage = {}; state.summaryUsage = {}; state.quoteUsage = {};
    state.starterUsage = {}; state.complimentUsage = {};
    await saveStateToFile();
    res.json({ success: true, message: 'All usage counters cleared.' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/api/cmd/models', authenticate, async (req, res) => {
  try {
    const cfg = await import('../modules/config.js');
    const effectiveDefault = cfg.ENABLE_GEMMA
      ? (cfg.MODELS?.[cfg.GEMMA_DEFAULT_MODEL] || cfg.GEMMA_DEFAULT_MODEL || cfg.DEFAULT_MODEL)
      : cfg.DEFAULT_MODEL;
    res.json({
      success: true, models: cfg.MODELS || {}, defaultModel: cfg.DEFAULT_MODEL,
      effectiveDefault,
      fallbackChain: cfg.MODEL_FALLBACK_CHAIN, enableGemma: cfg.ENABLE_GEMMA,
      gemmaDefault: cfg.GEMMA_DEFAULT_MODEL, runtimeOverride: runtimeConfig.activeModel || null,
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/api/cmd/set-model', authenticate, async (req, res) => {
  try {
    const { model } = req.body;
    if (!model) return res.status(400).json({ error: 'model required.' });
    const cfg = await import('../modules/config.js');
    const resolvedModel = (cfg.MODELS || {})[model] || model;
    runtimeConfig.activeModel = resolvedModel;
    saveRuntimeConfig();
    res.json({ success: true, message: `Runtime model set to ${resolvedModel}. Takes effect on next request.`, model: resolvedModel });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/api/config/runtime', authenticate, (req, res) => {
  res.json({ success: true, data: runtimeConfig });
});

router.put('/api/config/runtime', authenticate, (req, res) => {
  try {
    Object.assign(runtimeConfig, req.body);
    saveRuntimeConfig();
    res.json({ success: true, data: runtimeConfig });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/api/config/runtime', authenticate, (req, res) => {
  try { runtimeConfig = {}; saveRuntimeConfig(); res.json({ success: true, message: 'Runtime config cleared.' }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/api/config/modules', authenticate, (req, res) => {
  try {
    const content = fs.readFileSync(MODULES_CONFIG_PATH, 'utf8');
    res.json({ success: true, content, path: MODULES_CONFIG_PATH });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/api/config/modules', authenticate, (req, res) => {
  try {
    const { content } = req.body;
    if (typeof content !== 'string') return res.status(400).json({ error: 'content string required.' });
    fs.copyFileSync(MODULES_CONFIG_PATH, MODULES_CONFIG_PATH + '.bak');
    fs.writeFileSync(MODULES_CONFIG_PATH, content, 'utf8');
    res.json({ success: true, message: 'modules/config.js updated. Restart to apply.' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/api/config/modules/reset', authenticate, (req, res) => {
  try {
    const bak = MODULES_CONFIG_PATH + '.bak';
    if (!fs.existsSync(bak)) return res.status(404).json({ error: 'No backup found.' });
    fs.writeFileSync(MODULES_CONFIG_PATH, fs.readFileSync(bak, 'utf8'), 'utf8');
    res.json({ success: true, message: 'modules/config.js restored from backup.' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/api/config/base', authenticate, (req, res) => {
  try {
    const content = fs.readFileSync(BASE_CONFIG_PATH, 'utf8');
    res.json({ success: true, content, path: BASE_CONFIG_PATH });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/api/config/base', authenticate, (req, res) => {
  try {
    const { content } = req.body;
    if (typeof content !== 'string') return res.status(400).json({ error: 'content string required.' });
    fs.copyFileSync(BASE_CONFIG_PATH, BASE_CONFIG_PATH + '.bak');
    fs.writeFileSync(BASE_CONFIG_PATH, content, 'utf8');
    res.json({ success: true, message: 'config.js updated. Restart to apply.' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/api/config/base/reset', authenticate, (req, res) => {
  try {
    const bak = BASE_CONFIG_PATH + '.bak';
    if (!fs.existsSync(bak)) return res.status(404).json({ error: 'No backup found.' });
    fs.writeFileSync(BASE_CONFIG_PATH, fs.readFileSync(bak, 'utf8'), 'utf8');
    res.json({ success: true, message: 'config.js restored from backup.' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/api/db/collections', authenticate, async (req, res) => {
  try {
    await db.connectDB();
    let conn; try { conn = db.getDB ? db.getDB() : null; } catch { conn = null; }
    if (!conn) return res.status(503).json({ error: 'DB not connected.' });
    const collections = await conn.listCollections().toArray();
    const result = await Promise.all(collections.map(async c => {
      const count = await conn.collection(c.name).countDocuments().catch(() => 0);
      return { name: c.name, count };
    }));
    res.json({ success: true, data: result });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/api/db/collection/:name', authenticate, async (req, res) => {
  try {
    await db.connectDB();
    let conn; try { conn = db.getDB ? db.getDB() : null; } catch { conn = null; }
    if (!conn) return res.status(503).json({ error: 'DB not available.' });
    const { page = 1, limit = 50 } = req.query;
    const skip  = (parseInt(page) - 1) * parseInt(limit);
    const total = await conn.collection(req.params.name).countDocuments();
    const docs  = await conn.collection(req.params.name).find({}).skip(skip).limit(parseInt(limit)).toArray();
    res.json({ success: true, data: docs, total, page: parseInt(page), limit: parseInt(limit) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/api/db/collection/:name/:id', authenticate, async (req, res) => {
  try {
    await db.connectDB();
    let conn; try { conn = db.getDB ? db.getDB() : null; } catch { conn = null; }
    if (!conn) return res.status(503).json({ error: 'DB not available.' });
    const { ObjectId } = await import('mongodb');
    const filter = ObjectId.isValid(req.params.id) ? { _id: new ObjectId(req.params.id) } : { _id: req.params.id };
    const result = await conn.collection(req.params.name).replaceOne(filter, req.body, { upsert: false });
    res.json({ success: true, modified: result.modifiedCount });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/api/db/collection/:name/:id', authenticate, async (req, res) => {
  try {
    await db.connectDB();
    let conn; try { conn = db.getDB ? db.getDB() : null; } catch { conn = null; }
    if (!conn) return res.status(503).json({ error: 'DB not available.' });
    const { ObjectId } = await import('mongodb');
    const filter = ObjectId.isValid(req.params.id) ? { _id: new ObjectId(req.params.id) } : { _id: req.params.id };
    const result = await conn.collection(req.params.name).deleteOne(filter);
    res.json({ success: true, deleted: result.deletedCount });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/api/files', authenticate, (req, res) => {
  try {
    const reqPath  = req.query.path || '';
    const safePath = path.resolve(ROOT_DIR, reqPath);
    if (!safePath.startsWith(ROOT_DIR)) return res.status(403).json({ error: 'Access denied.' });
    if (!fs.existsSync(safePath)) return res.status(404).json({ error: 'Path not found.' });
    const stat = fs.statSync(safePath);
    if (stat.isDirectory()) {
      const entries = fs.readdirSync(safePath).map(name => {
        const fp = path.join(safePath, name);
        const s  = fs.statSync(fp);
        return { name, type: s.isDirectory() ? 'dir' : 'file', size: s.size, mtime: s.mtime, path: path.relative(ROOT_DIR, fp) };
      });
      res.json({ success: true, type: 'dir', entries, currentPath: path.relative(ROOT_DIR, safePath) });
    } else {
      const content = fs.readFileSync(safePath, 'utf8');
      res.json({ success: true, type: 'file', content, path: path.relative(ROOT_DIR, safePath), size: stat.size, mtime: stat.mtime });
    }
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/api/files', authenticate, (req, res) => {
  try {
    const { filePath, content } = req.body;
    if (!filePath || content === undefined) return res.status(400).json({ error: 'filePath and content required.' });
    const safePath = path.resolve(ROOT_DIR, filePath);
    if (!safePath.startsWith(ROOT_DIR)) return res.status(403).json({ error: 'Access denied.' });
    if (fs.existsSync(safePath)) fs.copyFileSync(safePath, safePath + '.bak');
    fs.mkdirSync(path.dirname(safePath), { recursive: true });
    fs.writeFileSync(safePath, content, 'utf8');
    res.json({ success: true, message: `Saved: ${filePath}` });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/api/files', authenticate, (req, res) => {
  try {
    const { filePath } = req.body;
    if (!filePath) return res.status(400).json({ error: 'filePath required.' });
    const safePath = path.resolve(ROOT_DIR, filePath);
    if (!safePath.startsWith(ROOT_DIR)) return res.status(403).json({ error: 'Access denied.' });
    if (!fs.existsSync(safePath)) return res.status(404).json({ error: 'File not found.' });
    fs.unlinkSync(safePath);
    res.json({ success: true, message: `Deleted: ${filePath}` });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/api/cmd/memory/:userId', authenticate, async (req, res) => {
  try {
    const { userId } = req.params;
    const { page = 1, limit = 50 } = req.query;
    let data = [], total = 0;
    if (db.getMemoryEntries) {
      const result = await db.getMemoryEntries(userId, 500);
      data  = Array.isArray(result) ? result : [];
      total = data.length;
    }
    const skip  = (parseInt(page) - 1) * parseInt(limit);
    const paged = data.slice(skip, skip + parseInt(limit));
    res.json({ success: true, data: paged, total, userId });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/api/cmd/memory/:userId', authenticate, async (req, res) => {
  try {
    const uid = req.params.userId;
    await db.connectDB();
    let conn; try { conn = db.getDB ? db.getDB() : null; } catch { conn = null; }
    if (conn) {
      await conn.collection('memoryEntries').deleteMany({ historyId: uid });
    }
    res.json({ success: true, message: `Memories cleared for ${uid}.` });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/api/cmd/usage-stats', authenticate, (req, res) => {
  try {
    res.json({
      success: true,
      data: {
        image: state.imageUsage || {}, summary: state.summaryUsage || {},
        quote: state.quoteUsage || {}, starter: state.starterUsage || {},
        compliment: state.complimentUsage || {},
      }
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/api/cmd/toggle-feature', authenticate, async (req, res) => {
  try {
    const { feature, enabled } = req.body;
    if (!feature) return res.status(400).json({ error: 'feature required.' });
    const allowed = ['ENABLE_GEMMA','CACHE_ENABLED','PDF_ENABLED_FOR_GEMINI','CYCLE_GEMMA_WITH_GEMINI','WEEKLY_SUMMARY_ENABLED','CROSS_CONTEXT_ENABLED'];
    if (!allowed.includes(feature)) return res.status(400).json({ error: `Allowed: ${allowed.join(', ')}` });
    if (!runtimeConfig.featureFlags) runtimeConfig.featureFlags = {};
    runtimeConfig.featureFlags[feature] = Boolean(enabled);
    saveRuntimeConfig();
    res.json({ success: true, message: `${feature} set to ${enabled}.`, flags: runtimeConfig.featureFlags });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/api/cmd/feature-flags', authenticate, async (req, res) => {
  try {
    const cfg = await import('../modules/config.js');
    const configDefaults = {
      ENABLE_GEMMA:            cfg.ENABLE_GEMMA            ?? false,
      CACHE_ENABLED:           cfg.CACHE_ENABLED           ?? false,
      PDF_ENABLED_FOR_GEMINI:  cfg.PDF_ENABLED_FOR_GEMINI  ?? false,
      CYCLE_GEMMA_WITH_GEMINI: cfg.CYCLE_GEMMA_WITH_GEMINI ?? false,
      WEEKLY_SUMMARY_ENABLED:  cfg.WEEKLY_SUMMARY_ENABLED  ?? true,
      CROSS_CONTEXT_ENABLED:   cfg.CROSS_CONTEXT_ENABLED   ?? false,
    };
    const flags = { ...configDefaults, ...(runtimeConfig.featureFlags || {}) };
    res.json({ success: true, data: flags });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Migration config ────────────────────────────────────────────────────────
router.get('/api/cmd/migration-config', authenticate, async (req, res) => {
  try {
    const cfg = await import('../modules/config.js');
    const defaults = {
      ENABLE_MIGRATION: cfg.MIGRATION_CONFIG?.ENABLE_MIGRATION ?? false,
      BATCH_SIZE:       cfg.MIGRATION_CONFIG?.BATCH_SIZE       ?? 50,
      BATCH_DELAY_MS:   cfg.MIGRATION_CONFIG?.BATCH_DELAY_MS   ?? 100,
    };
    const overrides = runtimeConfig.migrationConfig || {};
    res.json({ success: true, data: { ...defaults, ...overrides } });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/api/cmd/migration-config', authenticate, (req, res) => {
  try {
    if (!runtimeConfig.migrationConfig) runtimeConfig.migrationConfig = {};
    const { ENABLE_MIGRATION, BATCH_SIZE, BATCH_DELAY_MS } = req.body;
    if (ENABLE_MIGRATION !== undefined) runtimeConfig.migrationConfig.ENABLE_MIGRATION = Boolean(ENABLE_MIGRATION);
    if (BATCH_SIZE       !== undefined) runtimeConfig.migrationConfig.BATCH_SIZE       = Number(BATCH_SIZE);
    if (BATCH_DELAY_MS   !== undefined) runtimeConfig.migrationConfig.BATCH_DELAY_MS   = Number(BATCH_DELAY_MS);
    saveRuntimeConfig();
    res.json({ success: true, data: runtimeConfig.migrationConfig, message: 'Migration config saved. Restart to apply.' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Bot / State / Queue config ───────────────────────────────────────────────
router.get('/api/cmd/bot-config', authenticate, async (req, res) => {
  try {
    const cfg = await import('../modules/config.js');
    const defaults = {
      DEFAULT_RESPONSE_FORMAT:        cfg.BOT_CONFIG?.DEFAULT_RESPONSE_FORMAT        ?? 'Normal',
      WORK_IN_DMS:                    cfg.BOT_CONFIG?.WORK_IN_DMS                    ?? true,
      DEFAULT_MODEL:                  cfg.DEFAULT_MODEL                               ?? '',
      MAX_QUEUE_DEPTH_PER_USER:       cfg.MAX_QUEUE_DEPTH_PER_USER                   ?? 5,
      KEY_SWITCH_HOLD_MS:             cfg.KEY_SWITCH_HOLD_MS                         ?? 1500,
      RAM_MEDIA_SUSPEND_THRESHOLD_MB: cfg.RAM_MEDIA_SUSPEND_THRESHOLD_MB              ?? 380,
      STATE_MAX_MESSAGES:             cfg.STATE_CONFIG?.MAX_MESSAGES                 ?? 50,
      CONTEXT_BREAK_THRESHOLD_MIN:    Math.round((cfg.STATE_CONFIG?.CONTEXT_BREAK_THRESHOLD ?? 1_800_000) / 60_000),
      GEMMA_DAILY_LIMIT_PER_KEY:      cfg.GEMMA_DAILY_LIMIT_PER_KEY                  ?? 1500,
      GEMMA_DEFAULT_MODEL:            cfg.GEMMA_DEFAULT_MODEL                        ?? '',
      GEMMA_FALLBACK_MODEL:           cfg.GEMMA_FALLBACK_MODEL                       ?? '',
    };
    const overrides = runtimeConfig.botConfig || {};
    res.json({ success: true, data: { ...defaults, ...overrides } });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/api/cmd/bot-config', authenticate, (req, res) => {
  try {
    if (!runtimeConfig.botConfig) runtimeConfig.botConfig = {};
    const allowed = [
      'DEFAULT_RESPONSE_FORMAT','WORK_IN_DMS','MAX_QUEUE_DEPTH_PER_USER',
      'KEY_SWITCH_HOLD_MS','RAM_MEDIA_SUSPEND_THRESHOLD_MB',
      'STATE_MAX_MESSAGES','CONTEXT_BREAK_THRESHOLD_MIN',
      'GEMMA_DAILY_LIMIT_PER_KEY','GEMMA_DEFAULT_MODEL','GEMMA_FALLBACK_MODEL'
    ];
    for (const key of allowed) {
      if (req.body[key] !== undefined) runtimeConfig.botConfig[key] = req.body[key];
    }
    saveRuntimeConfig();
    res.json({ success: true, data: runtimeConfig.botConfig, message: 'Bot config saved. Restart to apply.' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/api/cmd/set-embed-color', authenticate, async (req, res) => {
  try {
    const { color, guildId } = req.body;
    if (!color) return res.status(400).json({ error: 'color required.' });
    if (guildId) {
      if (!state.serverSettings[guildId]) state.serverSettings[guildId] = { ...DEFAULT_SERVER_SETTINGS };
      state.serverSettings[guildId].embedColor = color;
      if (db.saveServerSettings) await db.saveServerSettings(guildId, state.serverSettings[guildId]);
    } else {
      runtimeConfig.globalEmbedColor = color;
      saveRuntimeConfig();
    }
    res.json({ success: true, message: `Embed color set to ${color}.` });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/api/cmd/bot-info', authenticate, (req, res) => {
  try {
    const id = client?.user?.id;
    res.json({
      success: true,
      bot: {
        id, username: client?.user?.username, tag: client?.user?.tag,
        avatarURL: client?.user?.displayAvatarURL?.({ size: 256, extension: 'png' }),
        createdAt: client?.user?.createdAt?.toISOString(),
        inviteLink: id ? `https://discord.com/api/oauth2/authorize?client_id=${id}&permissions=8&scope=bot%20applications.commands` : null,
        guilds: client?.guilds?.cache?.size || 0, wsStatus: client?.ws?.status,
        ping: client?.ws?.ping, uptime: process.uptime(), nodeVersion: process.version,
      }
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

const wss         = new WebSocketServer({ noServer: true });
const logBuffer   = [];
const logListeners = new Set();

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, 'http://localhost');
  if      (url.pathname.endsWith('/ws/node'))  handleNodeRepl(ws);
  else if (url.pathname.endsWith('/ws/mongo')) handleMongoRepl(ws);
  else if (url.pathname.endsWith('/ws/shell')) handleShellRepl(ws, url.searchParams.get('cmd'));
  else if (url.pathname.endsWith('/ws/stats')) handleStatsStream(ws);
  else if (url.pathname.endsWith('/ws/logs'))  handleLogStream(ws);
  else ws.close(1008, 'Unknown path');
});

function sendWs(ws, data) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(typeof data === 'string' ? data : JSON.stringify(data));
  }
}

function handleStatsStream(ws) {
  const tick = () => {
    try {
      const mem    = process.memoryUsage();
      const guilds = client?.guilds?.cache ?? new Map();
      let totalUsers = 0;
      guilds.forEach(g => { totalUsers += (g.memberCount || 0); });
      sendWs(ws, {
        type: 'stats',
        data: {
          ping: client?.ws?.ping ?? -1, uptime: process.uptime(), serverCount: guilds.size, totalUsers,
          heapUsed: mem.heapUsed, heapTotal: mem.heapTotal, rss: mem.rss,
          sysFree: os.freemem(), sysTotal: os.totalmem(),
          globalLockdown: state.globalLockdown, debugMode: state.debugMode,
          wsStatus: client?.ws?.status === 0 ? 'READY' : 'DEGRADED',
          totalHistories: safeCount(state.chatHistories),
          totalUsers_s: safeCount(state.userSettings),
          totalServers_s: safeCount(state.serverSettings),
          disk: getDiskUsage(),
        },
        ts: Date.now(),
      });
    } catch {}
  };
  const interval = setInterval(tick, 1000);
  tick();
  ws.on('close', () => clearInterval(interval));
  ws.on('error', () => clearInterval(interval));
}

function handleLogStream(ws) {
  logBuffer.forEach(entry => sendWs(ws, JSON.stringify({ type: 'log', data: entry })));
  const listener = entry => sendWs(ws, JSON.stringify({ type: 'log', data: entry }));
  logListeners.add(listener);
  ws.on('close', () => logListeners.delete(listener));
  ws.on('error', () => logListeners.delete(listener));
}

function spawnTerminal(ws, cmd, args, env = {}) {
  const proc = spawn(cmd, args, {
    stdio: ['pipe','pipe','pipe'],
    env: { ...process.env, TERM: 'xterm-256color', ...env },
    shell: false,
  });

  const send = d => {
    const str = Buffer.isBuffer(d) ? d.toString('utf8') : String(d);
    sendWs(ws, str);
  };

  proc.stdout.on('data', send);
  proc.stderr.on('data', send);
  proc.on('error', e => send(`\r\n[Error: ${e.message}]\r\n`));
  proc.on('exit',  code => { send(`\r\n[Process exited with code ${code ?? 0}]\r\n`); try { ws.close(); } catch {} });

  ws.on('message', msg => {
    try {
      const raw = Buffer.isBuffer(msg) ? msg.toString('utf8') : String(msg);
      proc.stdin.write(raw);
    } catch {}
  });
  ws.on('close', () => { try { proc.kill('SIGTERM'); } catch {} });
  ws.on('error', () => { try { proc.kill('SIGTERM'); } catch {} });

  return proc;
}

function handleNodeRepl(ws) {
  sendWs(ws, '\r\nNode.js REPL — Ctrl+C to break, .exit to quit\r\n\r\n');
  spawnTerminal(ws, 'node', ['--experimental-repl-await', '--interactive']);
}

function handleMongoRepl(ws) {
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017';
  sendWs(ws, '\r\nConnecting to MongoDB...\r\n');
  const script = `const{MongoClient,ObjectId}=require('mongodb');const repl=require('repl');(async()=>{const c=new MongoClient(${JSON.stringify(uri)},{serverSelectionTimeoutMS:8000});try{await c.connect();const db=c.db();process.stdout.write('Connected: '+db.databaseName+'\\r\\nHelpers: db, client, ObjectId, listCollections()\\r\\n\\r\\n');const r=repl.start({prompt:'mongo> ',useColors:false,ignoreUndefined:true});Object.assign(r.context,{db,client:c,ObjectId,listCollections:async()=>(await db.listCollections().toArray()).map(x=>x.name)});r.on('exit',async()=>{await c.close();process.exit(0)});}catch(e){process.stderr.write('Error: '+e.message+'\\r\\n');process.exit(1);}})();`;
  spawnTerminal(ws, 'node', ['-e', script]);
}

function handleShellRepl(ws, initialCmd) {
  sendWs(ws, '\r\nBash shell — type exit to quit\r\n\r\n');
  const proc = spawnTerminal(ws, '/bin/bash', [], { PS1: '\\w $ ' });
  if (initialCmd) setTimeout(() => { try { proc.stdin.write(initialCmd + '\n'); } catch {} }, 300);
}

export function mountDashboard(app, httpServer) {
  app.use('/dashboard', router);
  app.get('/dashboard', (_req, res) => res.redirect('/dashboard/'));

  httpServer.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, 'http://localhost');
    if (!url.pathname.startsWith('/dashboard/ws/')) return;
    const tok     = url.searchParams.get('token');
    const session = lookupSession(tok);
    if (!session) { socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n'); socket.destroy(); return; }
    wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req));
  });

  logger.info('Dashboard mounted at /dashboard');
}

export const isGlobalLockdown = () => state.globalLockdown === true;
