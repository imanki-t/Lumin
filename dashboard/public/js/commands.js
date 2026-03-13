/**
 * commands.js — 25 admin command cards: render + execute.
 */

import { api } from './api.js';
import { toastOk, toastErr, toastInfo } from './toast.js';
import { setLockdownIndicator } from './router.js';

// ── Generic helpers ───────────────────────────────────────────────────────────

function v(id) {
  return (document.getElementById(id)?.value ?? '').trim();
}

function setResult(id, type, msg) {
  const el = document.getElementById(id);
  if (!el) return;
  el.className = `cmd-result ${type}`;
  el.textContent = msg?.slice(0, 300) ?? '';
}

async function run(callFn, resultId) {
  setResult(resultId, '', 'Running…');
  document.getElementById(resultId).style.display = 'block';
  try {
    const r = await callFn();
    if (r.success) {
      setResult(resultId, 'ok', r.message ?? '✓ Done');
      toastOk(r.message ?? 'Done');
    } else {
      setResult(resultId, 'err', r.error ?? r.message ?? 'Error');
      toastErr(r.error ?? r.message ?? 'Error');
    }
    return r;
  } catch (err) {
    setResult(resultId, 'err', err.message);
    toastErr(err.message);
    return null;
  }
}

async function confirm_run(msg, callFn, resultId) {
  if (!confirm(msg)) return;
  return run(callFn, resultId);
}

// ── Command definitions ───────────────────────────────────────────────────────

const COMMANDS = [
  {
    id: 'c1', icon: '💾', name: 'Force Save State',
    desc: 'Persist current in-memory state to MongoDB immediately.',
    render: () => `<button class="btn btn-secondary btn-sm" onclick="CMD.saveState()">Save Now</button>`,
  },
  {
    id: 'c2', icon: '🗑️', name: 'Clear All Chat Histories',
    desc: 'Wipe every user & channel chat history from memory and database.',
    render: () => `<button class="btn btn-danger btn-sm" onclick="CMD.clearAllHistories()">Clear All</button>`,
  },
  {
    id: 'c3', icon: '👤', name: 'Clear User History',
    desc: 'Clear the chat history of one specific user.',
    render: () => `
      <input class="form-input" id="c3-userId" placeholder="User ID" />
      <button class="btn btn-secondary btn-sm" onclick="CMD.clearUserHistory()">Clear</button>`,
  },
  {
    id: 'c4', icon: '🚫', name: 'Blacklist User',
    desc: 'Block a user from using the bot in a specific server.',
    render: () => `
      <input class="form-input" id="c4-userId"  placeholder="User ID"  />
      <input class="form-input" id="c4-guildId" placeholder="Guild ID" />
      <button class="btn btn-danger btn-sm" onclick="CMD.blacklistUser()">Blacklist</button>`,
  },
  {
    id: 'c5', icon: '✅', name: 'Unblacklist User',
    desc: 'Restore bot access for a previously blacklisted user.',
    render: () => `
      <input class="form-input" id="c5-userId"  placeholder="User ID"  />
      <input class="form-input" id="c5-guildId" placeholder="Guild ID" />
      <button class="btn btn-success btn-sm" onclick="CMD.unblacklistUser()">Unblacklist</button>`,
  },
  {
    id: 'c6', icon: '📋', name: 'View Blacklisted Users',
    desc: 'List all blacklisted users across every server.',
    render: () => `<button class="btn btn-secondary btn-sm" onclick="CMD.viewBlacklisted()">View List</button>`,
  },
  {
    id: 'c7', icon: '🔄', name: 'Switch API Key',
    desc: 'Force rotate to the next available Gemini API key.',
    render: () => `<button class="btn btn-secondary btn-sm" onclick="CMD.switchApiKey()">Rotate Key</button>`,
  },
  {
    id: 'c8', icon: '🔒', name: 'Toggle Global Lockdown',
    desc: 'Instantly enable or disable bot responses across all servers.',
    render: () => `
      <div style="display:flex;gap:8px">
        <button class="btn btn-danger  btn-sm" onclick="CMD.setLockdown(true)">Enable</button>
        <button class="btn btn-success btn-sm" onclick="CMD.setLockdown(false)">Disable</button>
      </div>`,
  },
  {
    id: 'c9', icon: '🚪', name: 'Leave Server',
    desc: 'Make the bot leave a specific server by Guild ID.',
    render: () => `
      <input class="form-input" id="c9-guildId" placeholder="Guild ID" />
      <button class="btn btn-danger btn-sm" onclick="CMD.leaveServer()">Leave</button>`,
  },
  {
    id: 'c10', icon: '↩️', name: 'Reset Server Settings',
    desc: 'Restore a server\'s config to factory defaults.',
    render: () => `
      <input class="form-input" id="c10-guildId" placeholder="Guild ID" />
      <button class="btn btn-secondary btn-sm" onclick="CMD.resetServer()">Reset</button>`,
  },
  {
    id: 'c11', icon: '🔍', name: 'Lookup User Settings',
    desc: 'Fetch stored settings for any user by ID.',
    render: () => `
      <input class="form-input" id="c11-userId" placeholder="User ID" />
      <button class="btn btn-secondary btn-sm" onclick="CMD.lookupUser()">Lookup</button>`,
  },
  {
    id: 'c12', icon: '🖼️', name: 'Clear Image Usage',
    desc: 'Reset image generation usage counters for all users.',
    render: () => `<button class="btn btn-secondary btn-sm" onclick="CMD.clearImageUsage()">Clear Counters</button>`,
  },
  {
    id: 'c13', icon: '📄', name: 'Clear Summary Usage',
    desc: 'Reset digest/summary usage counters for all users.',
    render: () => `<button class="btn btn-secondary btn-sm" onclick="CMD.clearSummaryUsage()">Clear Counters</button>`,
  },
  {
    id: 'c14', icon: '💭', name: 'Clear Quote Usage',
    desc: 'Reset daily quote counters for all users.',
    render: () => `<button class="btn btn-secondary btn-sm" onclick="CMD.clearQuoteUsage()">Clear Counters</button>`,
  },
  {
    id: 'c15', icon: '🐛', name: 'Toggle Debug Mode',
    desc: 'Flip verbose logging on or off in the running process.',
    render: () => `<button class="btn btn-secondary btn-sm" onclick="CMD.toggleDebug()">Toggle</button>`,
  },
  {
    id: 'c16', icon: '🌅', name: 'Force Daily Reset',
    desc: 'Trigger the midnight reset immediately — clears all daily usage.',
    render: () => `<button class="btn btn-secondary btn-sm" onclick="CMD.forceDailyReset()">Force Reset</button>`,
  },
  {
    id: 'c17', icon: '⏰', name: 'View All Reminders',
    desc: 'List all active reminders across every user.',
    render: () => `<button class="btn btn-secondary btn-sm" onclick="CMD.viewReminders()">View</button>`,
  },
  {
    id: 'c18', icon: '🧹', name: 'Purge Old Memory',
    desc: 'Delete RAG memory entries older than N days.',
    render: () => `
      <input class="form-input" id="c18-days" type="number" value="30" min="1" placeholder="Days" />
      <button class="btn btn-secondary btn-sm" onclick="CMD.purgeMemory()">Purge</button>`,
  },
  {
    id: 'c19', icon: '🎭', name: 'Set Bot Presence',
    desc: 'Update the bot\'s Discord status and activity text.',
    render: () => `
      <select class="form-select" id="c19-status">
        <option value="online">Online</option>
        <option value="idle">Idle</option>
        <option value="dnd">Do Not Disturb</option>
        <option value="invisible">Invisible</option>
      </select>
      <input class="form-input" id="c19-activity" placeholder="Activity text (optional)" />
      <button class="btn btn-secondary btn-sm" onclick="CMD.setPresence()">Update</button>`,
  },
  {
    id: 'c20', icon: '✉️', name: 'Send DM to User',
    desc: 'Send a direct message to any Discord user by ID.',
    render: () => `
      <input class="form-input" id="c20-userId" placeholder="User ID" />
      <input class="form-input" id="c20-msg"    placeholder="Message content" />
      <button class="btn btn-secondary btn-sm" onclick="CMD.sendDM()">Send DM</button>`,
  },
  {
    id: 'c21', icon: '📊', name: 'API Key Statistics',
    desc: 'View detailed usage breakdown for all Gemini API keys.',
    render: () => `<button class="btn btn-secondary btn-sm" onclick="CMD.getApiKeyStats()">Fetch Stats</button>`,
  },
  {
    id: 'c22', icon: '📢', name: 'Quick Broadcast',
    desc: 'Send a plain-text message to all servers instantly.',
    render: () => `
      <input class="form-input" id="c22-msg" placeholder="Announcement text…" />
      <button class="btn btn-primary btn-sm" onclick="CMD.quickBroadcast()">Broadcast</button>`,
  },
  {
    id: 'c23', icon: '🔎', name: 'Server Detail Lookup',
    desc: 'Fetch full settings and info for a specific server.',
    render: () => `
      <input class="form-input" id="c23-guildId" placeholder="Guild ID" />
      <button class="btn btn-secondary btn-sm" onclick="CMD.lookupServer()">Lookup</button>`,
  },
  {
    id: 'c24', icon: '♻️', name: 'Reload State',
    desc: 'Attempt to re-sync in-memory state with the database.',
    render: () => `<button class="btn btn-secondary btn-sm" onclick="CMD.reloadState()">Reload</button>`,
  },
  {
    id: 'c25', icon: '🔄', name: 'Restart Bot',
    desc: 'Save state then exit — Render will auto-restart the service.',
    render: () => `
      <button class="btn btn-danger btn-sm" onclick="CMD.restart()">Restart Process</button>`,
  },
];

// ── Render ────────────────────────────────────────────────────────────────────

export function renderCommands() {
  const grid = document.getElementById('cmd-grid');
  if (!grid) return;

  grid.innerHTML = COMMANDS.map(c => `
    <div class="cmd-card">
      <div class="cmd-card-header">
        <div class="cmd-icon-wrap">${c.icon}</div>
        <div class="cmd-info">
          <div class="cmd-name">${c.name}</div>
          <div class="cmd-desc">${c.desc}</div>
        </div>
      </div>
      <div class="cmd-body">
        ${c.render()}
        <div class="cmd-result" id="${c.id}-result"></div>
      </div>
    </div>
  `).join('');
}

// ── Command handlers (exposed globally as CMD.*) ───────────────────────────────

window.CMD = {
  saveState:         () => run(() => api.saveState(), 'c1-result'),

  clearAllHistories: () => confirm_run(
    'This will delete ALL chat histories. Are you sure?',
    () => api.clearAllHistories(), 'c2-result'),

  clearUserHistory:  () => run(() => api.clearUserHistory(v('c3-userId')), 'c3-result'),

  blacklistUser:     () => run(() => api.blacklistUser(v('c4-userId'), v('c4-guildId')), 'c4-result'),

  unblacklistUser:   () => run(() => api.unblacklistUser(v('c5-userId'), v('c5-guildId')), 'c5-result'),

  viewBlacklisted: async () => {
    const r = await api.getBlacklisted();
    const el = document.getElementById('c6-result');
    if (!el) return;
    const total = r.total ?? 0;
    if (!total) {
      setResult('c6-result', 'ok', 'No blacklisted users.');
    } else {
      const lines = Object.entries(r.data || {})
        .filter(([, users]) => users.length)
        .map(([gid, users]) => `Guild ${gid}:\n  ${users.join(', ')}`)
        .join('\n');
      setResult('c6-result', 'ok', `${total} blacklisted:\n${lines}`);
    }
  },

  switchApiKey: () => run(() => api.switchApiKey(), 'c7-result'),

  setLockdown: async (enabled) => {
    const r = await run(() => api.setLockdown(enabled), 'c8-result');
    if (r?.success) setLockdownIndicator(!!r.enabled);
  },

  leaveServer: () => confirm_run(
    `Leave this server? This cannot be undone.`,
    () => api.leaveServer(v('c9-guildId')), 'c9-result'),

  resetServer: () => run(() => api.resetServer(v('c10-guildId')), 'c10-result'),

  lookupUser: async () => {
    const r = await api.getUserSettings(v('c11-userId'));
    setResult('c11-result',
      r.success ? 'ok' : 'err',
      r.success
        ? JSON.stringify(r.data, null, 2)
        : (r.error ?? 'Not found'));
  },

  clearImageUsage:   () => run(() => api.clearImageUsage(),   'c12-result'),
  clearSummaryUsage: () => run(() => api.clearSummaryUsage(), 'c13-result'),
  clearQuoteUsage:   () => run(() => api.clearQuoteUsage(),   'c14-result'),
  toggleDebug:       () => run(() => api.toggleDebug(),       'c15-result'),

  forceDailyReset: () => confirm_run(
    'This clears all daily usage counters now. Continue?',
    () => api.forceDailyReset(), 'c16-result'),

  viewReminders: async () => {
    const r = await api.getReminders();
    const items = (r.data ?? []).slice(0, 15);
    if (!items.length) {
      setResult('c17-result', 'ok', 'No pending reminders.');
    } else {
      const lines = items.map(rem =>
        `• ${rem.userId}: "${(rem.content ?? rem.message ?? '?').slice(0, 50)}" @ ${
          rem.time ? new Date(rem.time).toLocaleString() : 'unknown'}`
      ).join('\n');
      setResult('c17-result', 'ok', `${r.count} total:\n${lines}`);
    }
  },

  purgeMemory: () => run(() => api.purgeMemory(parseInt(v('c18-days')) || 30), 'c18-result'),

  setPresence: () => run(() => api.setPresence(v('c19-status'), v('c19-activity')), 'c19-result'),

  sendDM: () => run(() => api.sendDM(v('c20-userId'), v('c20-msg')), 'c20-result'),

  getApiKeyStats: async () => {
    const r = await api.getApiKeyStats();
    const d = r.data ?? {};
    const keys = (d.keys ?? []).map(k =>
      `Key ${k.keyNumber} [${k.status}] — ${k.totalRequests} req, ${k.errors} err${k.isCurrent ? ' ⭐' : ''}`
    ).join('\n');
    setResult('c21-result', 'ok', `Total: ${d.totalKeys}, Current: Key ${d.currentKey}\n${keys}`);
  },

  quickBroadcast: () => run(
    () => api.announce({ message: v('c22-msg'), title: '📢 Announcement', useEmbed: true }),
    'c22-result'),

  lookupServer: async () => {
    const gid = v('c23-guildId');
    const res = await api.getServers();
    const s = (res.data ?? []).find(x => x.id === gid);
    setResult('c23-result',
      s ? 'ok' : 'err',
      s ? JSON.stringify({ name: s.name, members: s.memberCount, settings: s.settings }, null, 2)
        : 'Server not found.');
  },

  reloadState: () => run(() => api.reloadState(), 'c24-result'),

  restart: () => confirm_run(
    'This will restart the entire bot process. Render will auto-restart it. Continue?',
    () => api.restart(), 'c25-result'),
};
