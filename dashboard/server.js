/**
 * @fileoverview Admin Dashboard — mounts onto the existing Express app.
 *
 * Usage in index.js:
 *   import { mountDashboard, isGlobalLockdown } from './dashboard/server.js';
 *   // after creating httpServer and before server.listen():
 *   mountDashboard(app, httpServer);
 *
 * Dashboard is then available at:
 *   https://<your-render-url>/dashboard
 *
 * Env vars:
 *   DASHBOARD_SECRET — auth token (default: 'changeme123')
 */

import express              from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import { spawn }            from 'child_process';
import { execSync }         from 'child_process';
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

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// ============================================================================
// CONFIG
// ============================================================================

const SECRET = process.env.DASHBOARD_SECRET || 'changeme123';

// Inject dashboard-only flags into shared bot state
if (state.globalLockdown === undefined) state.globalLockdown = false;
if (state.debugMode      === undefined) state.debugMode      = false;

// ============================================================================
// HELPERS
// ============================================================================

function getDiskUsage() {
  try {
    const out = execSync("df -h / | tail -1 | awk '{print $3\",\"$4\",\"$5}'")
      .toString().trim();
    const [used, available, percent] = out.split(',');
    return { used, available, percent };
  } catch {
    return { used: 'N/A', available: 'N/A', percent: 'N/A' };
  }
}

function safeCount(obj) {
  try { return Object.keys(obj || {}).length; } catch { return 0; }
}

// ============================================================================
// AUTH MIDDLEWARE
// ============================================================================

function authenticate(req, res, next) {
  const tok = req.headers['x-token'] || req.query.token;
  if (!tok || tok !== SECRET) {
    return res.status(401).json({ error: 'Unauthorized — wrong or missing DASHBOARD_SECRET' });
  }
  next();
}

// ============================================================================
// ROUTER  (all paths are relative — will be mounted at /dashboard)
// ============================================================================

const router = express.Router();

// ── Static files — serves dashboard/public at /dashboard ────────────────────
router.use(express.static(path.join(__dirname, 'public')));

// ── JSON body parsing for this router ───────────────────────────────────────
router.use(express.json());

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
      username:      client?.user?.username || 'N/A',
      tag:           client?.user?.tag      || 'N/A',
      id:            client?.user?.id       || 'N/A',
      avatarURL:     client?.user?.displayAvatarURL?.({ size: 256, extension: 'png' }) || null,
      discriminator: client?.user?.discriminator || '0',
      wsStatus:      WS_LABELS[client?.ws?.status] || 'Unknown',
      serverCount:   guilds.size,
      totalUsers,
      ping:          client?.ws?.ping ?? -1,
      uptime:        process.uptime(),
      nodeVersion:   process.version,
      platform:      `${os.platform()} ${os.arch()}`,
      cpuCores:      os.cpus().length,
      cpuModel:      os.cpus()[0]?.model || 'Unknown',
      ram: {
        heapUsed:  mem.heapUsed,  heapTotal:  mem.heapTotal,
        rss:       mem.rss,       external:   mem.external,
        sysFree:   os.freemem(),  sysTotal:   os.totalmem(),
      },
      disk,
      mongoStatus,
      apiKeyStats:          apiStats,
      totalChatHistories:   safeCount(state.chatHistories),
      totalServerSettings:  safeCount(state.serverSettings),
      totalUserSettings:    safeCount(state.userSettings),
      totalReminders:       safeCount(state.reminders),
      totalBlacklisted:     Object.values(state.blacklistedUsers || {}).flat().length,
      globalLockdown:       state.globalLockdown || false,
      debugMode:            state.debugMode      || false,
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── 2. Force save state ──────────────────────────────────────────────────────
router.post('/api/cmd/save-state', authenticate, async (req, res) => {
  try {
    await saveStateToFile();
    res.json({ success: true, message: '✅ State saved to database successfully.' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── 3. Reload state (info only) ──────────────────────────────────────────────
router.post('/api/cmd/reload-state', authenticate, async (_req, res) => {
  res.json({ success: true, message: '⚠️ Full reload requires restart. Use the Restart command.' });
});

// ── 4. Clear all chat histories ──────────────────────────────────────────────
router.post('/api/cmd/clear-all-histories', authenticate, async (req, res) => {
  try {
    const count = safeCount(state.chatHistories);
    state.chatHistories = {};
    await saveStateToFile();
    res.json({ success: true, message: `✅ Cleared ${count} chat history entries.` });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── 5. Clear specific user history ───────────────────────────────────────────
router.post('/api/cmd/clear-user-history', authenticate, async (req, res) => {
  try {
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ error: 'userId is required' });
    const existed = !!state.chatHistories[userId];
    delete state.chatHistories[userId];
    if (db.saveChatHistory) await db.saveChatHistory(userId, {});
    res.json({ success: true, message: existed
      ? `✅ History cleared for user ${userId}.`
      : `ℹ️ No history found for user ${userId}.` });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── 6. Blacklist user ─────────────────────────────────────────────────────────
router.post('/api/cmd/blacklist-user', authenticate, async (req, res) => {
  try {
    const { userId, guildId } = req.body;
    if (!userId || !guildId) return res.status(400).json({ error: 'userId and guildId are required' });
    if (!state.blacklistedUsers[guildId]) state.blacklistedUsers[guildId] = [];
    if (state.blacklistedUsers[guildId].includes(userId))
      return res.json({ success: false, message: 'User is already blacklisted.' });
    state.blacklistedUsers[guildId].push(userId);
    if (db.saveBlacklistedUsers) await db.saveBlacklistedUsers(guildId, state.blacklistedUsers[guildId]);
    res.json({ success: true, message: `✅ User ${userId} blacklisted in guild ${guildId}.` });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── 7. Unblacklist user ───────────────────────────────────────────────────────
router.post('/api/cmd/unblacklist-user', authenticate, async (req, res) => {
  try {
    const { userId, guildId } = req.body;
    if (!userId || !guildId) return res.status(400).json({ error: 'userId and guildId are required' });
    const list   = state.blacklistedUsers[guildId] || [];
    const before = list.length;
    state.blacklistedUsers[guildId] = list.filter(id => id !== userId);
    if (db.saveBlacklistedUsers) await db.saveBlacklistedUsers(guildId, state.blacklistedUsers[guildId]);
    const removed = before - state.blacklistedUsers[guildId].length;
    res.json({ success: true, message: removed > 0
      ? `✅ User ${userId} removed from blacklist.`
      : `ℹ️ User ${userId} was not blacklisted.` });
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
    res.json({ success: true, message: `✅ Switched to Key ${stats.currentKey}.`, stats });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── 10. Get API key stats ─────────────────────────────────────────────────────
router.get('/api/cmd/api-key-stats', authenticate, (req, res) => {
  try {
    res.json({ success: true, data: getApiKeyStats() });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── 11. Global lockdown toggle ────────────────────────────────────────────────
router.post('/api/cmd/lockdown', authenticate, (req, res) => {
  try {
    const { enabled } = req.body;
    state.globalLockdown = Boolean(enabled);
    res.json({
      success: true,
      message: `🔒 Global lockdown ${enabled ? 'ENABLED — bot will not respond.' : 'DISABLED — bot is active.'}`,
      enabled: state.globalLockdown,
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── 12. Global announcement ───────────────────────────────────────────────────
router.post('/api/cmd/announce', authenticate, async (req, res) => {
  try {
    const { message, title = '📢 Announcement', embedColor = '#5B7C99', useEmbed = true } = req.body;
    if (!message) return res.status(400).json({ error: 'message is required' });

    const { EmbedBuilder, ChannelType } = await import('discord.js');
    let sentCount = 0, failCount = 0, skipCount = 0;

    for (const [, guild] of (client?.guilds?.cache ?? new Map())) {
      try {
        const channel = guild.channels.cache.find(ch =>
          ch.type === ChannelType.GuildText &&
          ch.permissionsFor(guild.members.me)?.has('SendMessages') &&
          ch.permissionsFor(guild.members.me)?.has('ViewChannel')
        );
        if (!channel) { skipCount++; continue; }
        if (useEmbed) {
          await channel.send({ embeds: [
            new EmbedBuilder()
              .setColor(embedColor).setTitle(title)
              .setDescription(message).setTimestamp()
              .setFooter({ text: 'Admin Announcement' })
          ]});
        } else {
          await channel.send(`**${title}**\n\n${message}`);
        }
        sentCount++;
      } catch { failCount++; }
    }
    res.json({
      success: true,
      message: `📢 Sent to ${sentCount} servers. Skipped: ${skipCount}. Failed: ${failCount}.`,
      sentCount, failCount, skipCount,
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── 13. Leave server ──────────────────────────────────────────────────────────
router.post('/api/cmd/leave-server', authenticate, async (req, res) => {
  try {
    const { guildId } = req.body;
    if (!guildId) return res.status(400).json({ error: 'guildId is required' });
    const guild = client?.guilds?.cache.get(guildId);
    if (!guild)  return res.status(404).json({ error: 'Guild not found in cache' });
    const name = guild.name;
    await guild.leave();
    res.json({ success: true, message: `✅ Left server "${name}" (${guildId}).` });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── 14. Get all servers detail ────────────────────────────────────────────────
router.get('/api/cmd/servers-detail', authenticate, (req, res) => {
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
    if (!guildId) return res.status(400).json({ error: 'guildId is required' });
    delete state.serverSettings[guildId];
    if (db.saveServerSettings) await db.saveServerSettings(guildId, {});
    res.json({ success: true, message: `✅ Server settings reset for ${guildId}.` });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── 16. Get user settings ─────────────────────────────────────────────────────
router.get('/api/cmd/user-settings/:userId', authenticate, (req, res) => {
  try {
    const settings = state.userSettings[req.params.userId] || {};
    res.json({ success: true, data: settings, found: Object.keys(settings).length > 0 });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── 17. Clear image usage ─────────────────────────────────────────────────────
router.post('/api/cmd/clear-image-usage', authenticate, async (req, res) => {
  try {
    const count = safeCount(state.imageUsage);
    state.imageUsage = {};
    await saveStateToFile();
    res.json({ success: true, message: `✅ Cleared image usage for ${count} users.` });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── 18. Clear summary usage ───────────────────────────────────────────────────
router.post('/api/cmd/clear-summary-usage', authenticate, async (req, res) => {
  try {
    const count = safeCount(state.summaryUsage);
    state.summaryUsage = {};
    await saveStateToFile();
    res.json({ success: true, message: `✅ Cleared summary usage for ${count} users.` });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── 19. Toggle debug mode ─────────────────────────────────────────────────────
router.post('/api/cmd/toggle-debug', authenticate, (req, res) => {
  try {
    state.debugMode = !state.debugMode;
    res.json({ success: true,
      message: `🐛 Debug mode ${state.debugMode ? 'ON' : 'OFF'}.`,
      enabled: state.debugMode });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── 20. Force daily reset ─────────────────────────────────────────────────────
router.post('/api/cmd/force-daily-reset', authenticate, async (req, res) => {
  try {
    state.imageUsage = {}; state.summaryUsage = {}; state.quoteUsage = {};
    await saveStateToFile();
    res.json({ success: true, message: '✅ Daily reset forced — usage counters cleared.' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── 21. View all reminders ────────────────────────────────────────────────────
router.get('/api/cmd/reminders', authenticate, (req, res) => {
  try {
    const allReminders = [];
    for (const [userId, userReminders] of Object.entries(state.reminders || {})) {
      if (Array.isArray(userReminders)) {
        userReminders.forEach(r => allReminders.push({ userId, ...r }));
      }
    }
    allReminders.sort((a, b) => (a.time || 0) - (b.time || 0));
    res.json({ success: true, data: allReminders, count: allReminders.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── 22. Purge old memory entries ──────────────────────────────────────────────
router.post('/api/cmd/purge-memory', authenticate, async (req, res) => {
  try {
    const { daysOld = 30 } = req.body;
    const cutoff = new Date(Date.now() - daysOld * 86_400_000);
    let deletedCount = 0;
    try {
      const col = db.getCollection?.('memoryEntries');
      if (col) {
        const result = await col.deleteMany({ timestamp: { $lt: cutoff } });
        deletedCount = result.deletedCount;
      }
    } catch { /* getCollection may not be exported */ }
    res.json({ success: true, message: `✅ Purged ${deletedCount} memory entries older than ${daysOld} days.` });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── 23. Set bot presence ──────────────────────────────────────────────────────
router.post('/api/cmd/set-presence', authenticate, async (req, res) => {
  try {
    const { status = 'online', activity = '', activityType = 0 } = req.body;
    const { ActivityType } = await import('discord.js');
    await client?.user?.setPresence({
      status,
      activities: activity ? [{ name: activity, type: activityType }] : [],
    });
    res.json({ success: true, message: `✅ Presence set to "${status}"${activity ? ` — ${activity}` : ''}.` });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── 24. Send DM to user ───────────────────────────────────────────────────────
router.post('/api/cmd/send-dm', authenticate, async (req, res) => {
  try {
    const { userId, message } = req.body;
    if (!userId || !message) return res.status(400).json({ error: 'userId and message are required' });
    const user = await client?.users?.fetch(userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    await user.send(message);
    res.json({ success: true, message: `✅ DM sent to ${user.tag}.` });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── 25. Clear quote usage ─────────────────────────────────────────────────────
router.post('/api/cmd/clear-quote-usage', authenticate, async (req, res) => {
  try {
    const count = safeCount(state.quoteUsage);
    state.quoteUsage = {};
    await saveStateToFile();
    res.json({ success: true, message: `✅ Cleared quote usage for ${count} users.` });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Restart ───────────────────────────────────────────────────────────────────
router.post('/api/cmd/restart', authenticate, async (req, res) => {
  try {
    await saveStateToFile();
    res.json({ success: true, message: '🔄 Restarting… Render will auto-restart the service.' });
    setTimeout(() => process.exit(0), 1500);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ============================================================================
// WEBSOCKET TERMINALS
// ============================================================================

const wss = new WebSocketServer({ noServer: true });

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, 'http://localhost');
  if      (url.pathname.endsWith('/ws/node'))  handleNodeRepl(ws);
  else if (url.pathname.endsWith('/ws/mongo')) handleMongoRepl(ws);
  else ws.close(1008, 'Unknown terminal type');
});

function handleNodeRepl(ws) {
  const send = d => { if (ws.readyState === WebSocket.OPEN) ws.send(d); };

  const proc = spawn('node', ['--experimental-repl-await'], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env:   { ...process.env },
    shell: false,
  });

  proc.stdout.on('data', d => send(d.toString()));
  proc.stderr.on('data', d => send(d.toString()));
  proc.on('error', e => send(`\r\n[Spawn error: ${e.message}]\r\n`));
  proc.on('exit',  () => { send('\r\n[Node.js process exited]\r\n'); ws.close(); });

  ws.on('message', msg => { try { proc.stdin.write(msg); } catch {} });
  ws.on('close',   ()  => { try { proc.kill('SIGTERM'); }  catch {} });
  ws.on('error',   ()  => { try { proc.kill('SIGTERM'); }  catch {} });
}

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
    process.stdout.write('Use: db, client, ObjectId, await listCollections()\\r\\n\\r\\n');
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
    stdio: ['pipe', 'pipe', 'pipe'],
    env:   { ...process.env },
    shell: false,
  });

  proc.stdout.on('data', d => send(d.toString()));
  proc.stderr.on('data', d => send(d.toString()));
  proc.on('error', e => send(`\r\n[Spawn error: ${e.message}]\r\n`));
  proc.on('exit',  () => { send('\r\n[MongoDB session ended]\r\n'); ws.close(); });

  ws.on('message', msg => { try { proc.stdin.write(msg); } catch {} });
  ws.on('close',   ()  => { try { proc.kill('SIGTERM'); }  catch {} });
  ws.on('error',   ()  => { try { proc.kill('SIGTERM'); }  catch {} });
}

// ============================================================================
// MOUNT FUNCTION  — call this from index.js
// ============================================================================

/**
 * Mount the dashboard onto an existing Express app and HTTP server.
 *
 * @param {import('express').Application} app        — your existing Express app
 * @param {import('http').Server}         httpServer  — your existing http.createServer(app)
 */
export function mountDashboard(app, httpServer) {
  // Mount router at /dashboard
  app.use('/dashboard', router);

  // Redirect bare /dashboard to /dashboard/ so relative assets resolve correctly
  app.get('/dashboard', (_req, res) => res.redirect('/dashboard/'));

  // Attach WebSocket upgrade handler to the shared HTTP server
  httpServer.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, 'http://localhost');

    // Only handle /dashboard/ws/* paths
    if (!url.pathname.startsWith('/dashboard/ws/')) return;

    const tok = url.searchParams.get('token');
    if (tok !== SECRET) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req));
  });

  const masked = SECRET.length > 4
    ? SECRET.slice(0, 3) + '***' + SECRET.slice(-2)
    : '***';
  console.log(`🖥️  Admin Dashboard → /dashboard`);
  console.log(`🔐 Secret: ${masked}`);
}

// ============================================================================
// LOCKDOWN ACCESSOR  — imported by index.js messageCreate handler
// ============================================================================

export const isGlobalLockdown = () => state.globalLockdown === true;
