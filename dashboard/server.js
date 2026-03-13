/**
 * @fileoverview Admin Dashboard — Google OAuth + reCAPTCHA v3 + real-time WebSocket stats.
 *
 * ENV VARS REQUIRED:
 *   GOOGLE_CLIENT_ID       — from Google Cloud Console
 *   GOOGLE_CLIENT_SECRET   — from Google Cloud Console
 *   RECAPTCHA_SECRET_KEY   — reCAPTCHA v3 secret key
 *   RECAPTCHA_SITE_KEY     — reCAPTCHA v3 site key (sent to frontend via /auth/config)
 *   SESSION_SECRET         — random string for signing session tokens
 *
 * Google Cloud Console setup:
 *   - Authorized redirect URI: https://YOUR_RENDER_URL/dashboard/auth/google/callback
 *   - Allowed email: imitsankit@gmail.com
 */

import express              from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import { spawn }            from 'child_process';
import { execSync }         from 'child_process';
import crypto               from 'crypto';
import os                   from 'os';
import path                 from 'path';
import { fileURLToPath }    from 'url';

import {
  client,
  state,
  getApiKeyStats,
  switchToNextKey,
  saveStateToFile,
} from '../managers/BotManager.js';
import * as db from '../database.js';
import { Logger } from '../core/Logger.js';

const logger     = Logger.get('Dashboard');
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// ============================================================================
// CONFIG
// ============================================================================

const GOOGLE_CLIENT_ID     = process.env.GOOGLE_CLIENT_ID     || '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const RECAPTCHA_SECRET     = process.env.RECAPTCHA_SECRET_KEY || '';
const RECAPTCHA_SITE_KEY   = process.env.RECAPTCHA_SITE_KEY   || '';
const ALLOWED_EMAIL        = 'imitsankit@gmail.com';
const SESSION_TTL          = 24 * 60 * 60 * 1000; // 24 hours

// Inject dashboard-only flags into shared bot state
if (state.globalLockdown === undefined) state.globalLockdown = false;
if (state.debugMode      === undefined) state.debugMode      = false;

// ============================================================================
// SESSION STORE
// ============================================================================

/** In-memory session store: token → { email, name, picture, expires } */
const sessions   = new Map();
/** CSRF state store for OAuth: state → { callbackUrl, created } */
const oauthStates = new Map();

function makeToken() {
  return crypto.randomBytes(32).toString('hex');
}

function parseCookies(cookieHeader) {
  if (!cookieHeader) return {};
  return Object.fromEntries(
    cookieHeader.split(';').map(c => {
      const [k, ...v] = c.trim().split('=');
      return [k.trim(), decodeURIComponent(v.join('=').trim())];
    })
  );
}

function getSessionToken(req) {
  return (
    req.headers['x-token'] ||
    req.query.token         ||
    parseCookies(req.headers.cookie).lumin_session ||
    null
  );
}

function lookupSession(tok) {
  if (!tok) return null;
  const s = sessions.get(tok);
  if (!s) return null;
  if (Date.now() > s.expires) { sessions.delete(tok); return null; }
  return s;
}

// ============================================================================
// HELPERS
// ============================================================================

function getDiskUsage() {
  try {
    const out = execSync("df -h / | tail -1 | awk '{print $3\",\"$4\",\"$5}'")
      .toString().trim();
    const [used, available, percent] = out.split(',');
    return { used, available, percent };
  } catch { return { used: 'N/A', available: 'N/A', percent: 'N/A' }; }
}

function safeCount(obj) {
  try { return Object.keys(obj || {}).length; } catch { return 0; }
}

function getCallbackUrl(req) {
  const proto = req.headers['x-forwarded-proto'] || req.protocol;
  const host  = req.headers['x-forwarded-host']  || req.get('host');
  return `${proto}://${host}/dashboard/auth/google/callback`;
}

// ============================================================================
// AUTH MIDDLEWARE
// ============================================================================

function authenticate(req, res, next) {
  const tok = getSessionToken(req);
  const session = lookupSession(tok);
  if (!session) {
    return res.status(401).json({ error: 'Unauthorized — please sign in via Google OAuth.' });
  }
  session.expires = Date.now() + SESSION_TTL; // rolling refresh
  req.sessionToken = tok;
  req.sessionUser  = session;
  next();
}

// ============================================================================
// ROUTER
// ============================================================================

const router = express.Router();
router.use(express.static(path.join(__dirname, 'public')));
router.use(express.json());

// ── Auth: frontend config (public) ───────────────────────────────────────────
router.get('/auth/config', (_req, res) => {
  res.json({
    recaptchaSiteKey: RECAPTCHA_SITE_KEY,
    hasGoogleOAuth:   !!(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET),
  });
});

// ── Auth: reCAPTCHA v3 verify ────────────────────────────────────────────────
router.post('/auth/verify-recaptcha', async (req, res) => {
  const { token } = req.body;
  if (!token || !RECAPTCHA_SECRET) return res.json({ success: true, score: 1 });
  try {
    const r = await fetch('https://www.google.com/recaptcha/api/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ secret: RECAPTCHA_SECRET, response: token }),
    });
    const data = await r.json();
    res.json({ success: data.success, score: data.score ?? 0 });
  } catch {
    res.json({ success: true, score: 0.5 });
  }
});

// ── Auth: initiate Google OAuth ──────────────────────────────────────────────
router.get('/auth/google', (req, res) => {
  if (!GOOGLE_CLIENT_ID) {
    return res.status(500).send('GOOGLE_CLIENT_ID is not configured.');
  }
  const stateKey   = makeToken();
  const callbackUrl = getCallbackUrl(req);
  oauthStates.set(stateKey, { callbackUrl, created: Date.now() });

  // Cleanup stale states (>10 min old)
  for (const [k, v] of oauthStates) {
    if (Date.now() - v.created > 600_000) oauthStates.delete(k);
  }

  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authUrl.searchParams.set('client_id',     GOOGLE_CLIENT_ID);
  authUrl.searchParams.set('redirect_uri',  callbackUrl);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope',         'openid email profile');
  authUrl.searchParams.set('state',         stateKey);
  authUrl.searchParams.set('prompt',        'select_account');
  res.redirect(authUrl.toString());
});

// ── Auth: Google OAuth callback ──────────────────────────────────────────────
router.get('/auth/google/callback', async (req, res) => {
  const { code, state: stateKey, error } = req.query;

  if (error || !code) {
    logger.warn(`OAuth error: ${error}`);
    return res.redirect('/dashboard/?auth=error');
  }

  const stateData = oauthStates.get(stateKey);
  if (!stateData) return res.redirect('/dashboard/?auth=invalid_state');
  oauthStates.delete(stateKey);

  try {
    // Exchange code for tokens
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id:     GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri:  stateData.callbackUrl,
        grant_type:    'authorization_code',
      }),
    });
    const tokens = await tokenRes.json();
    if (!tokens.access_token) throw new Error(`Token exchange failed: ${JSON.stringify(tokens)}`);

    // Fetch user info
    const userRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const user = await userRes.json();

    if (user.email !== ALLOWED_EMAIL) {
      logger.warn(`Access denied for: ${user.email}`);
      return res.redirect('/dashboard/?auth=denied');
    }

    // Create session
    const sessionToken = makeToken();
    sessions.set(sessionToken, {
      email:   user.email,
      name:    user.name,
      picture: user.picture,
      expires: Date.now() + SESSION_TTL,
    });

    // Set secure cookie
    const secure   = req.headers['x-forwarded-proto'] === 'https';
    const cookieVal = `lumin_session=${sessionToken}; Path=/dashboard; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL / 1000}${secure ? '; Secure' : ''}`;
    res.setHeader('Set-Cookie', cookieVal);

    // Pass token to frontend via URL so it can store in sessionStorage
    res.redirect(`/dashboard/?token=${encodeURIComponent(sessionToken)}`);
  } catch (err) {
    logger.error('OAuth callback error', err);
    res.redirect('/dashboard/?auth=error');
  }
});

// ── Auth: current session info ───────────────────────────────────────────────
router.get('/auth/me', authenticate, (req, res) => {
  res.json({ success: true, user: req.sessionUser, token: req.sessionToken });
});

// ── Auth: logout ─────────────────────────────────────────────────────────────
router.post('/auth/logout', (req, res) => {
  const tok = getSessionToken(req);
  if (tok) sessions.delete(tok);
  res.setHeader('Set-Cookie', 'lumin_session=; Path=/dashboard; HttpOnly; Max-Age=0');
  res.json({ success: true });
});

// ============================================================================
// API ROUTES (all require session auth)
// ============================================================================

// ── 1. Bot stats overview ────────────────────────────────────────────────────
router.get('/api/stats', authenticate, async (req, res) => {
  try {
    const mem      = process.memoryUsage();
    const guilds   = client?.guilds?.cache ?? new Map();
    const apiStats = getApiKeyStats();
    const disk     = getDiskUsage();

    let totalUsers = 0;
    guilds.forEach(g => { totalUsers += (g.memberCount || 0); });

    let mongoStatus = 'Unknown';
    try { await db.connectDB(); mongoStatus = 'Connected'; }
    catch { mongoStatus = 'Disconnected'; }

    const WS_LABELS = ['READY','CONNECTING','RECONNECTING','IDLE','NEARLY',
                       'DISCONNECTED','WAITING_FOR_GUILDS','IDENTIFYING','RESUMING'];
    res.json({
      username:    client?.user?.username || 'N/A',
      tag:         client?.user?.tag      || 'N/A',
      id:          client?.user?.id       || 'N/A',
      avatarURL:   client?.user?.displayAvatarURL?.({ size: 256, extension: 'png' }) || null,
      wsStatus:    WS_LABELS[client?.ws?.status] || 'Unknown',
      serverCount: guilds.size,
      totalUsers,
      ping:        client?.ws?.ping ?? -1,
      uptime:      process.uptime(),
      nodeVersion: process.version,
      platform:    `${os.platform()} ${os.arch()}`,
      cpuCores:    os.cpus().length,
      cpuModel:    os.cpus()[0]?.model || 'Unknown',
      ram: {
        heapUsed: mem.heapUsed, heapTotal: mem.heapTotal,
        rss:      mem.rss,      external:  mem.external,
        sysFree:  os.freemem(), sysTotal:  os.totalmem(),
      },
      disk,
      mongoStatus,
      apiKeyStats:         apiStats,
      totalChatHistories:  safeCount(state.chatHistories),
      totalServerSettings: safeCount(state.serverSettings),
      totalUserSettings:   safeCount(state.userSettings),
      totalReminders:      safeCount(state.reminders),
      totalBlacklisted:    Object.values(state.blacklistedUsers || {}).flat().length,
      globalLockdown:      state.globalLockdown || false,
      debugMode:           state.debugMode      || false,
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── 2. Force save state ──────────────────────────────────────────────────────
router.post('/api/cmd/save-state', authenticate, async (req, res) => {
  try {
    await saveStateToFile();
    res.json({ success: true, message: 'State saved successfully.' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── 3. Reload state ──────────────────────────────────────────────────────────
router.post('/api/cmd/reload-state', authenticate, async (_req, res) => {
  res.json({ success: true, message: 'Full reload requires restart. Use the Restart command.' });
});

// ── 4. Clear chat history ─────────────────────────────────────────────────────
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

// ── 5. Get chat history ───────────────────────────────────────────────────────
router.get('/api/cmd/chat-history/:id', authenticate, (req, res) => {
  try {
    const history = state.chatHistories[req.params.id];
    if (!history) return res.status(404).json({ error: 'No history found for this ID.' });
    res.json({ success: true, data: history });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── 6. Blacklist user ─────────────────────────────────────────────────────────
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

// ── 7. Unblacklist user ───────────────────────────────────────────────────────
router.post('/api/cmd/unblacklist', authenticate, async (req, res) => {
  try {
    const { guildId, userId } = req.body;
    if (!guildId || !userId) return res.status(400).json({ error: 'guildId and userId required.' });
    const list = state.blacklistedUsers[guildId] || [];
    const had  = list.includes(userId);
    state.blacklistedUsers[guildId] = list.filter(u => u !== userId);
    if (db.saveBlacklistedUsers) await db.saveBlacklistedUsers(guildId, state.blacklistedUsers[guildId]);
    res.json({ success: true, message: had ? `User ${userId} removed from blacklist.` : `User ${userId} was not blacklisted.` });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── 8. Get all blacklisted users ──────────────────────────────────────────────
router.get('/api/cmd/blacklisted-users', authenticate, (req, res) => {
  try {
    const data  = state.blacklistedUsers || {};
    const total = Object.values(data).flat().length;
    res.json({ success: true, data, total });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── 9. Switch API key ─────────────────────────────────────────────────────────
router.post('/api/cmd/switch-api-key', authenticate, (req, res) => {
  try {
    switchToNextKey();
    const stats = getApiKeyStats();
    res.json({ success: true, message: `Switched to Key ${stats.currentKey}.`, stats });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── 10. API key stats ─────────────────────────────────────────────────────────
router.get('/api/cmd/api-key-stats', authenticate, (req, res) => {
  try { res.json({ success: true, data: getApiKeyStats() }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// ── 11. Global lockdown toggle ────────────────────────────────────────────────
router.post('/api/cmd/lockdown', authenticate, (req, res) => {
  try {
    const { enabled } = req.body;
    state.globalLockdown = Boolean(enabled);
    res.json({ success: true, message: `Global lockdown ${enabled ? 'ENABLED' : 'DISABLED'}.`, enabled: state.globalLockdown });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── 12. Global announcement ───────────────────────────────────────────────────
router.post('/api/cmd/announce', authenticate, async (req, res) => {
  try {
    const { message, title = 'Announcement', embedColor = '#6D5AE6', useEmbed = true } = req.body;
    if (!message) return res.status(400).json({ error: 'message is required.' });
    const { EmbedBuilder, ChannelType } = await import('discord.js');
    let sentCount = 0, failCount = 0, skipCount = 0;
    for (const [, guild] of (client?.guilds?.cache ?? new Map())) {
      try {
        const channels = guild.channels.cache.filter(c =>
          c.type === ChannelType.GuildText && c.permissionsFor(guild.members.me)?.has(['SendMessages', 'ViewChannel'])
        );
        const target = channels.find(c => ['general','announcements','bot','chat','main'].includes(c.name.toLowerCase()))
          || channels.first();
        if (!target) { skipCount++; continue; }
        if (useEmbed) {
          const embed = new EmbedBuilder().setColor(embedColor).setTitle(title).setDescription(message).setTimestamp();
          await target.send({ embeds: [embed] });
        } else {
          await target.send(message);
        }
        sentCount++;
      } catch { failCount++; }
    }
    res.json({ success: true, message: `Sent to ${sentCount} servers. Failed: ${failCount}. Skipped: ${skipCount}.` });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── 13. Leave server ──────────────────────────────────────────────────────────
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

// ── 14. Get server list ───────────────────────────────────────────────────────
router.get('/api/cmd/servers', authenticate, (req, res) => {
  try {
    const servers = [];
    for (const [, g] of (client?.guilds?.cache ?? new Map())) {
      servers.push({
        id: g.id, name: g.name, memberCount: g.memberCount,
        iconURL: g.iconURL(), ownerId: g.ownerId,
        createdAt: g.createdAt, joinedAt: g.joinedAt,
        settings:    state.serverSettings[g.id]   || {},
        blacklisted: (state.blacklistedUsers[g.id] || []).length,
      });
    }
    servers.sort((a, b) => b.memberCount - a.memberCount);
    res.json({ success: true, data: servers, count: servers.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── 15. Reset server settings ─────────────────────────────────────────────────
router.post('/api/cmd/reset-server', authenticate, async (req, res) => {
  try {
    const { guildId } = req.body;
    if (!guildId) return res.status(400).json({ error: 'guildId required.' });
    delete state.serverSettings[guildId];
    if (db.saveServerSettings) await db.saveServerSettings(guildId, {});
    res.json({ success: true, message: `Server settings reset for ${guildId}.` });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── 16. Get user settings ─────────────────────────────────────────────────────
router.get('/api/cmd/user-settings/:userId', authenticate, (req, res) => {
  try {
    const settings = state.userSettings[req.params.userId] || {};
    res.json({ success: true, data: settings, found: Object.keys(settings).length > 0 });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── 17–19. Clear various usages ───────────────────────────────────────────────
router.post('/api/cmd/clear-image-usage', authenticate, async (req, res) => {
  try { const c = safeCount(state.imageUsage); state.imageUsage = {}; await saveStateToFile();
    res.json({ success: true, message: `Cleared image usage for ${c} users.` }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/api/cmd/clear-summary-usage', authenticate, async (req, res) => {
  try { const c = safeCount(state.summaryUsage); state.summaryUsage = {}; await saveStateToFile();
    res.json({ success: true, message: `Cleared summary usage for ${c} users.` }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/api/cmd/toggle-debug', authenticate, (req, res) => {
  try { state.debugMode = !state.debugMode;
    res.json({ success: true, message: `Debug mode ${state.debugMode ? 'ON' : 'OFF'}.`, enabled: state.debugMode }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// ── 20–25. Presence, DM, quote, restart ──────────────────────────────────────
router.post('/api/cmd/set-presence', authenticate, async (req, res) => {
  try {
    const { status = 'online', activity = '', activityType = 0 } = req.body;
    const ActivityType = (await import('discord.js')).ActivityType;
    client?.user?.setPresence({
      status,
      activities: activity ? [{ name: activity, type: activityType }] : [],
    });
    res.json({ success: true, message: `Presence set.` });
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
  try { const c = safeCount(state.quoteUsage); state.quoteUsage = {}; await saveStateToFile();
    res.json({ success: true, message: `Cleared quote usage for ${c} users.` }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/api/cmd/restart', authenticate, async (req, res) => {
  try {
    await saveStateToFile();
    res.json({ success: true, message: 'Restarting... Render will auto-restart the service.' });
    setTimeout(() => process.exit(0), 1500);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ============================================================================
// WEBSOCKET — TERMINALS + REAL-TIME STATS
// ============================================================================

const wss = new WebSocketServer({ noServer: true });

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, 'http://localhost');
  if      (url.pathname.endsWith('/ws/node'))  handleNodeRepl(ws);
  else if (url.pathname.endsWith('/ws/mongo')) handleMongoRepl(ws);
  else if (url.pathname.endsWith('/ws/stats')) handleStatsStream(ws);
  else ws.close(1008, 'Unknown path');
});

// ── Real-time stats stream (1s interval) ─────────────────────────────────────
function handleStatsStream(ws) {
  const send = d => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(d));
  };

  const tick = () => {
    try {
      const mem    = process.memoryUsage();
      const guilds = client?.guilds?.cache ?? new Map();
      let totalUsers = 0;
      guilds.forEach(g => { totalUsers += (g.memberCount || 0); });

      send({
        type: 'stats',
        data: {
          ping:          client?.ws?.ping ?? -1,
          uptime:        process.uptime(),
          serverCount:   guilds.size,
          totalUsers,
          heapUsed:      mem.heapUsed,
          heapTotal:     mem.heapTotal,
          rss:           mem.rss,
          sysFree:       os.freemem(),
          sysTotal:      os.totalmem(),
          globalLockdown: state.globalLockdown,
          debugMode:      state.debugMode,
          wsStatus:       client?.ws?.status === 0 ? 'READY' : 'DEGRADED',
          totalHistories: safeCount(state.chatHistories),
          totalUsers_s:   safeCount(state.userSettings),
          totalServers_s: safeCount(state.serverSettings),
          disk:           getDiskUsage(),
        },
        ts: Date.now(),
      });
    } catch {}
  };

  const interval = setInterval(tick, 1000);
  tick(); // immediate first push

  ws.on('close', () => clearInterval(interval));
  ws.on('error', () => clearInterval(interval));
}

// ── Node.js REPL terminal ─────────────────────────────────────────────────────
function handleNodeRepl(ws) {
  const send = d => { if (ws.readyState === WebSocket.OPEN) ws.send(d); };
  const proc = spawn('node', ['--experimental-repl-await'], {
    stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env }, shell: false,
  });
  proc.stdout.on('data', d => send(d.toString()));
  proc.stderr.on('data', d => send(d.toString()));
  proc.on('error', e => send(`\r\n[Spawn error: ${e.message}]\r\n`));
  proc.on('exit',  () => { send('\r\n[Node.js process exited]\r\n'); ws.close(); });
  ws.on('message', msg => { try { proc.stdin.write(msg); } catch {} });
  ws.on('close',   () =>  { try { proc.kill('SIGTERM'); }  catch {} });
  ws.on('error',   () =>  { try { proc.kill('SIGTERM'); }  catch {} });
}

// ── MongoDB REPL terminal ─────────────────────────────────────────────────────
function handleMongoRepl(ws) {
  const send = d => { if (ws.readyState === WebSocket.OPEN) ws.send(d); };
  const uri  = process.env.MONGODB_URI || 'mongodb://localhost:27017';

  const script = `
(async () => {
  const { MongoClient, ObjectId } = require('mongodb');
  const repl = require('repl');
  process.stdout.write('Connecting to MongoDB...\\r\\n');
  const client = new MongoClient(${JSON.stringify(uri)}, { serverSelectionTimeoutMS: 8000 });
  try {
    await client.connect();
    const db = client.db();
    process.stdout.write('Connected: ' + db.databaseName + '\\r\\n');
    process.stdout.write('Available: db, client, ObjectId, await listCollections()\\r\\n\\r\\n');
    async function listCollections() {
      return (await db.listCollections().toArray()).map(c => c.name);
    }
    const r = repl.start({ prompt: 'mongo> ', useColors: true, ignoreUndefined: true });
    Object.assign(r.context, { db, client, ObjectId, listCollections });
    r.on('exit', async () => { await client.close(); process.exit(0); });
  } catch (err) {
    process.stderr.write('MongoDB Error: ' + err.message + '\\r\\n');
    process.exit(1);
  }
})();`.trim();

  const proc = spawn('node', ['-e', script], {
    stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env }, shell: false,
  });
  proc.stdout.on('data', d => send(d.toString()));
  proc.stderr.on('data', d => send(d.toString()));
  proc.on('error', e => send(`\r\n[Spawn error: ${e.message}]\r\n`));
  proc.on('exit',  () => { send('\r\n[MongoDB session ended]\r\n'); ws.close(); });
  ws.on('message', msg => { try { proc.stdin.write(msg); } catch {} });
  ws.on('close',   () =>  { try { proc.kill('SIGTERM'); }  catch {} });
  ws.on('error',   () =>  { try { proc.kill('SIGTERM'); }  catch {} });
}

// ============================================================================
// MOUNT
// ============================================================================

export function mountDashboard(app, httpServer) {
  app.use('/dashboard', router);
  app.get('/dashboard', (_req, res) => res.redirect('/dashboard/'));

  httpServer.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, 'http://localhost');
    if (!url.pathname.startsWith('/dashboard/ws/')) return;

    // Authenticate via session token in query param
    const tok     = url.searchParams.get('token');
    const session = lookupSession(tok);
    if (!session) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req));
  });

  logger.info('Admin Dashboard mounted at /dashboard (Google OAuth)');
}

export const isGlobalLockdown = () => state.globalLockdown === true;
