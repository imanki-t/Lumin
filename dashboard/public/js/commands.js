import { api } from './api.js';
import { toastOk, toastErr, toastInfo } from './toast.js';
import { setLockdownIndicator } from './router.js';

function v(id) { return (document.getElementById(id)?.value || '').trim(); }

function res(id, type, msg) {
  const el = document.getElementById(id);
  if (!el) return;
  el.className = `cmd-result ${type}`;
  el.textContent = String(msg || '').slice(0, 400);
  el.classList.remove('hidden');
}

async function run(fn, resultId) {
  res(resultId, '', 'Running…');
  try {
    const r = await fn();
    if (r?._authError) { toastErr('Session expired — please sign in again'); return null; }
    if (r?.success !== false && !r?.error) {
      res(resultId, 'ok', r?.message || 'Done');
      toastOk(r?.message || 'Done');
    } else {
      res(resultId, 'err', r?.error || r?.message || 'Error');
      toastErr(r?.error || r?.message || 'Error');
    }
    return r;
  } catch (e) {
    res(resultId, 'err', e.message);
    toastErr(e.message);
    return null;
  }
}

// Check lockdown before running commands
function isLocked() {
  const chip = document.getElementById('lockdown-chip');
  if (chip && !chip.classList.contains('hidden')) {
    toastErr('🔒 Global lockdown is active. Disable lockdown first.');
    return true;
  }
  return false;
}

const CMDS = [
  // ── Existing 19 ──────────────────────────────────────────────────────────
  {
    id:'c-save', name:'Force Save State', desc:'Persist current in-memory bot state to MongoDB immediately.',
    render: () => `<button class="cmd-btn" onclick="CMD.saveState()">Save Now</button>`,
  },
  {
    id:'c-clear-all', name:'Clear All Chat Histories', desc:'Wipe every user chat history from memory and database.',
    render: () => `<button class="cmd-btn danger" onclick="CMD.clearAllHistories()">Clear All Histories</button>`,
  },
  {
    id:'c-clear-user', name:'Clear User History', desc:"Clear one user's chat history. Accepts User ID or username.",
    render: () => `<input class="cmd-input" id="ci-userId" placeholder="User ID or username#tag"/><button class="cmd-btn" onclick="CMD.clearUserHistory()">Clear History</button>`,
  },
  {
    id:'c-apikey', name:'Rotate API Key', desc:'Switch to the next available Gemini API key in the rotation.',
    render: () => `<button class="cmd-btn" onclick="CMD.switchApiKey()">Rotate to Next Key</button>`,
  },
  {
    id:'c-apikey-stats', name:'API Key Stats', desc:'View usage statistics for all configured API keys.',
    render: () => `<button class="cmd-btn" onclick="CMD.getApiKeyStats()">View Stats</button>`,
  },
  {
    id:'c-img', name:'Clear Image Usage', desc:'Reset the image generation usage counters for all users.',
    render: () => `<button class="cmd-btn danger" onclick="CMD.clearImageUsage()">Clear Image Usage</button>`,
  },
  {
    id:'c-sum', name:'Clear Summary Usage', desc:'Reset the summary feature usage counters for all users.',
    render: () => `<button class="cmd-btn danger" onclick="CMD.clearSummaryUsage()">Clear Summary Usage</button>`,
  },
  {
    id:'c-quote', name:'Clear Quote Usage', desc:'Reset the quote command usage counters for all users.',
    render: () => `<button class="cmd-btn danger" onclick="CMD.clearQuoteUsage()">Clear Quote Usage</button>`,
  },
  {
    id:'c-debug', name:'Toggle Debug Mode', desc:'Enable or disable verbose debug logging on the bot.',
    render: () => `<button class="cmd-btn" onclick="CMD.toggleDebug()">Toggle Debug</button>`,
  },
  {
    id:'c-restart', name:'Restart Bot', desc:'Gracefully save state and restart the bot process.',
    render: () => `<button class="cmd-btn danger" onclick="CMD.restart()">Restart Now</button>`,
  },
  {
    id:'c-presence', name:'Set Presence', desc:"Update the bot's Discord online status and activity text.",
    render: () => `
      <select class="cmd-input" id="cp-status"><option value="online">Online</option><option value="idle">Idle</option><option value="dnd">DND</option><option value="invisible">Invisible</option></select>
      <input class="cmd-input" id="cp-activity" placeholder="Activity text (optional)"/>
      <select class="cmd-input" id="cp-type"><option value="0">Playing</option><option value="2">Listening to</option><option value="3">Watching</option><option value="5">Competing in</option></select>
      <button class="cmd-btn" onclick="CMD.setPresence()">Update Presence</button>`,
  },
  {
    id:'c-dm', name:'Send DM', desc:'Send a direct message to a user by their ID or username.',
    render: () => `
      <input class="cmd-input" id="cd-user" placeholder="User ID or username#tag"/>
      <input class="cmd-input" id="cd-msg"  placeholder="Message to send"/>
      <button class="cmd-btn" onclick="CMD.sendDm()">Send DM</button>`,
  },
  {
    id:'c-bl', name:'Blacklist User', desc:'Block a user from using the bot in a specific server. Accepts ID or username.',
    render: () => `
      <input class="cmd-input" id="cbl-user"  placeholder="User ID or username#tag"/>
      <input class="cmd-input" id="cbl-guild" placeholder="Guild ID (or ALL)"/>
      <button class="cmd-btn danger" onclick="CMD.blacklistUser()">Blacklist</button>`,
  },
  {
    id:'c-unbl', name:'Unblacklist User', desc:'Restore bot access for a previously blacklisted user.',
    render: () => `
      <input class="cmd-input" id="cubl-user"  placeholder="User ID or username#tag"/>
      <input class="cmd-input" id="cubl-guild" placeholder="Guild ID"/>
      <button class="cmd-btn" onclick="CMD.unblacklistUser()">Unblacklist</button>`,
  },
  {
    id:'c-user-settings', name:'View User Settings', desc:"Look up a user's custom bot config by ID or username.",
    render: () => `
      <input class="cmd-input" id="cus-id" placeholder="User ID or username#tag"/>
      <button class="cmd-btn" onclick="CMD.getUserSettings()">Fetch Settings</button>`,
  },
  {
    id:'c-server-settings', name:'Reset Server Settings', desc:'Wipe all custom settings for a specific server back to defaults.',
    render: () => `
      <input class="cmd-input" id="css-guild" placeholder="Guild ID"/>
      <button class="cmd-btn danger" onclick="CMD.resetServerSettings()">Reset Settings</button>`,
  },
  {
    id:'c-leave', name:'Leave Server', desc:'Force the bot to leave a specific server by its Guild ID.',
    render: () => `
      <input class="cmd-input" id="cl-guild" placeholder="Guild ID"/>
      <button class="cmd-btn danger" onclick="CMD.leaveServer()">Leave Server</button>`,
  },
  {
    id:'c-announce-quick', name:'Quick Announcement', desc:'Send a plain text announcement to all servers fast.',
    render: () => `
      <input class="cmd-input" id="caq-msg" placeholder="Announcement text"/>
      <button class="cmd-btn" onclick="CMD.quickAnnounce()">Announce</button>`,
  },
  {
    id:'c-clear-hist-id', name:'Clear History by ID', desc:'Clear chat history for a specific channel or user ID.',
    render: () => `
      <input class="cmd-input" id="cchi-id" placeholder="Channel/User ID"/>
      <button class="cmd-btn" onclick="CMD.clearHistoryById()">Clear</button>`,
  },

  // ── 15 NEW COMMANDS ───────────────────────────────────────────────────────
  {
    id:'c-fetch-user', name:'Fetch User Profile', desc:'Retrieve a Discord user profile including avatar, creation date, and mutual servers.',
    render: () => `
      <input class="cmd-input" id="cfu-id" placeholder="User ID or username#tag"/>
      <button class="cmd-btn" onclick="CMD.fetchUserProfile()">Fetch Profile</button>`,
  },
  {
    id:'c-guild-info', name:'Server Info', desc:'Get detailed information about a server by its Guild ID.',
    render: () => `
      <input class="cmd-input" id="cgi-id" placeholder="Guild ID"/>
      <button class="cmd-btn" onclick="CMD.getGuildInfo()">Get Info</button>`,
  },
  {
    id:'c-clear-reminders', name:'Clear All Reminders', desc:'Wipe all scheduled reminders from memory and database.',
    render: () => `<button class="cmd-btn danger" onclick="CMD.clearReminders()">Clear Reminders</button>`,
  },
  {
    id:'c-clear-birthdays', name:'Clear All Birthdays', desc:'Remove all birthday entries from the bot database.',
    render: () => `<button class="cmd-btn danger" onclick="CMD.clearBirthdays()">Clear Birthdays</button>`,
  },
  {
    id:'c-clear-user-settings', name:'Reset User Settings', desc:"Reset a specific user's bot settings back to defaults by ID or username.",
    render: () => `
      <input class="cmd-input" id="ccus-id" placeholder="User ID or username#tag"/>
      <button class="cmd-btn danger" onclick="CMD.resetUserSettings()">Reset Settings</button>`,
  },
  {
    id:'c-bot-stats', name:'Bot Statistics', desc:'View comprehensive runtime statistics: memory, guilds, users, and performance.',
    render: () => `<button class="cmd-btn" onclick="CMD.getBotStats()">Fetch Stats</button>`,
  },
  {
    id:'c-dm-all', name:'DM All Servers (Owner)', desc:'Send a DM to the owner of every server the bot is in. Use with caution.',
    render: () => `
      <input class="cmd-input" id="cdma-msg" placeholder="Message to server owners"/>
      <button class="cmd-btn danger" onclick="CMD.dmAllOwners()">DM All Owners</button>`,
  },
  {
    id:'c-reload-commands', name:'Reload Slash Commands', desc:'Re-register all slash commands with Discord API without restarting.',
    render: () => `<button class="cmd-btn" onclick="CMD.reloadCommands()">Reload Commands</button>`,
  },
  {
    id:'c-clear-starter', name:'Clear Starter Usage', desc:'Reset conversation starter usage counters for all users.',
    render: () => `<button class="cmd-btn danger" onclick="CMD.clearStarterUsage()">Clear Starter Usage</button>`,
  },
  {
    id:'c-clear-compliment', name:'Clear Compliment Usage', desc:'Reset daily compliment usage counters for all users.',
    render: () => `<button class="cmd-btn danger" onclick="CMD.clearComplimentUsage()">Clear Compliment Usage</button>`,
  },
  {
    id:'c-get-history', name:'View Chat History', desc:"Retrieve the most recent messages from a user's chat history.",
    render: () => `
      <input class="cmd-input" id="cgh-id" placeholder="User ID or username#tag"/>
      <input class="cmd-input" id="cgh-limit" placeholder="Limit (default 20)" type="number"/>
      <button class="cmd-btn" onclick="CMD.getChatHistory()">Get History</button>`,
  },
  {
    id:'c-broadcast-status', name:'Broadcast Status Message', desc:'Send a status message to one channel per server (embed format).',
    render: () => `
      <input class="cmd-input" id="cbs-title" placeholder="Status title"/>
      <input class="cmd-input" id="cbs-msg" placeholder="Status message"/>
      <select class="cmd-input" id="cbs-color"><option value="#22C55E">🟢 Green (OK)</option><option value="#F59E0B">🟡 Yellow (Warning)</option><option value="#EF4444">🔴 Red (Critical)</option><option value="#6D5AE6">🟣 Purple (Info)</option></select>
      <button class="cmd-btn" onclick="CMD.broadcastStatus()">Broadcast</button>`,
  },
  {
    id:'c-user-count', name:'User Count by Server', desc:'List the top 10 servers by member count.',
    render: () => `<button class="cmd-btn" onclick="CMD.topServers()">Get Top Servers</button>`,
  },
  {
    id:'c-purge-blacklist', name:'Purge Entire Blacklist', desc:'Remove ALL blacklist entries across all servers. This cannot be undone.',
    render: () => `<button class="cmd-btn danger" onclick="CMD.purgeBlacklist()">Purge Blacklist</button>`,
  },
  {
    id:'c-ping-check', name:'Force Ping Check', desc:'Manually trigger a WebSocket ping check and return the current latency.',
    render: () => `<button class="cmd-btn" onclick="CMD.pingCheck()">Check Ping</button>`,
  },
];

export function renderCommands() {
  const grid = document.getElementById('cmd-grid');
  if (!grid) return;
  grid.innerHTML = CMDS.map(c => `
    <div class="cmd-card">
      <div class="cmd-name">${c.name}</div>
      <div class="cmd-desc">${c.desc}</div>
      ${c.render()}
      <div class="cmd-result hidden" id="${c.id}-result"></div>
    </div>
  `).join('');
}

// ── Resolve username → user ID helper ────────────────────────────────────────
async function resolveUser(raw) {
  if (!raw) return null;
  if (/^\d{17,20}$/.test(raw)) return raw; // already an ID
  const r = await api.resolveUsername(raw).catch(() => null);
  if (r?.success && r.id) return r.id;
  toastErr(`Could not resolve "${raw}" to a user ID`);
  return null;
}

// ── CMD handlers ──────────────────────────────────────────────────────────────
window.CMD = {
  saveState:          () => run(() => api.saveState(), 'c-save-result'),
  clearAllHistories:  () => { if(!confirm('Clear ALL chat histories?')) return; run(() => api.clearHistory(), 'c-clear-all-result'); },
  clearUserHistory:   async() => {
    const raw=v('ci-userId'); if(!raw){toastErr('Enter a User ID or username');return;}
    const id = await resolveUser(raw); if(!id) return;
    run(() => api.clearHistory(id), 'c-clear-user-result');
  },
  switchApiKey:       () => run(() => api.switchApiKey(), 'c-apikey-result'),
  getApiKeyStats:     async() => {
    const r = await api.getApiKeyStats();
    const id = 'c-apikey-stats-result';
    if (r?.success) {
      const d = r.data;
      res(id, 'ok', `Total Keys: ${d.totalKeys} | Current: Key ${d.currentKey} | Reqs: ${d.keys?.map(k=>`K${k.keyNumber}:${k.totalRequests}`).join(' ')}`);
      renderApiKeysPanel(d);
    } else res(id, 'err', r?.error || 'Error');
  },
  clearImageUsage:    () => run(() => api.clearImageUsage(), 'c-img-result'),
  clearSummaryUsage:  () => run(() => api.clearSummaryUsage(), 'c-sum-result'),
  clearQuoteUsage:    () => run(() => api.clearQuoteUsage(), 'c-quote-result'),
  toggleDebug:        () => run(() => api.toggleDebug(), 'c-debug-result'),
  restart:            () => { if(!confirm('Restart the bot process?')) return; run(() => api.restart(), 'c-restart-result'); },
  setPresence:        () => run(() => api.setPresence({ status: v('cp-status'), activity: v('cp-activity'), activityType: parseInt(v('cp-type')||'0') }), 'c-presence-result'),
  sendDm:             async() => {
    const raw=v('cd-user'),m=v('cd-msg');
    if(!raw||!m){toastErr('User and message required');return;}
    const id = await resolveUser(raw); if(!id) return;
    run(() => api.sendDm(id, m), 'c-dm-result');
  },
  blacklistUser:      async() => {
    const raw=v('cbl-user'),g=v('cbl-guild');
    if(!raw||!g){toastErr('User and Guild ID required');return;}
    const id = await resolveUser(raw); if(!id) return;
    run(() => api.blacklistUser(id, g), 'c-bl-result');
  },
  unblacklistUser:    async() => {
    const raw=v('cubl-user'),g=v('cubl-guild');
    if(!raw||!g){toastErr('User and Guild ID required');return;}
    const id = await resolveUser(raw); if(!id) return;
    run(() => api.unblacklistUser(id, g), 'c-unbl-result');
  },
  getUserSettings:    async() => {
    const raw=v('cus-id'); if(!raw){toastErr('Enter a User ID or username');return;}
    const id = await resolveUser(raw); if(!id) return;
    const r = await api.getUserSettings(id);
    const rid='c-user-settings-result';
    if(r?.success) res(rid,'ok', r.found ? JSON.stringify(r.data,null,2) : `No custom settings found for user ${id}`);
    else res(rid,'err',r?.error||'Error');
  },
  resetServerSettings:() => { const g=v('css-guild'); if(!g){toastErr('Enter a Guild ID');return;} if(!confirm('Reset all settings for this server?')) return; run(()=>api.resetServer(g),'c-server-settings-result'); },
  leaveServer:        () => { const g=v('cl-guild'); if(!g){toastErr('Enter a Guild ID');return;} if(!confirm('Leave this server?')) return; run(()=>api.leaveServer(g),'c-leave-result'); },
  quickAnnounce:      () => { const m=v('caq-msg'); if(!m){toastErr('Enter a message');return;} run(()=>api.announce({message:m,title:'Announcement',useEmbed:false}),'c-announce-quick-result'); },
  clearHistoryById:   () => { const id=v('cchi-id'); if(!id){toastErr('Enter an ID');return;} run(()=>api.clearHistory(id),'c-clear-hist-id-result'); },

  // ── New commands ───────────────────────────────────────────────────────────
  fetchUserProfile: async() => {
    const raw=v('cfu-id'); if(!raw){toastErr('Enter a User ID or username');return;}
    const id = await resolveUser(raw); if(!id) return;
    const r = await api.fetchUserProfile(id);
    if(r?.success && r.user) {
      const u = r.user;
      res('c-fetch-user-result','ok',
        `${u.tag} (${u.id})\nCreated: ${u.createdAt}\nBot: ${u.bot}\nAvatar: ${u.avatarURL}`);
    } else res('c-fetch-user-result','err',r?.error||'User not found');
  },
  getGuildInfo: async() => {
    const g=v('cgi-id'); if(!g){toastErr('Enter a Guild ID');return;}
    const r = await api.getGuildInfo(g);
    if(r?.success && r.guild) {
      const gd=r.guild;
      res('c-guild-info-result','ok',
        `${gd.name} (${gd.id})\nOwner: ${gd.ownerId}\nMembers: ${gd.memberCount}\nCreated: ${gd.createdAt}\nBoosts: ${gd.premiumSubscriptionCount}`);
    } else res('c-guild-info-result','err',r?.error||'Guild not found');
  },
  clearReminders:     () => { if(!confirm('Clear ALL reminders?')) return; run(()=>api.clearReminders(),'c-clear-reminders-result'); },
  clearBirthdays:     () => { if(!confirm('Clear ALL birthdays?')) return; run(()=>api.clearBirthdays(),'c-clear-birthdays-result'); },
  resetUserSettings:  async() => {
    const raw=v('ccus-id'); if(!raw){toastErr('Enter a User ID or username');return;}
    const id = await resolveUser(raw); if(!id) return;
    if(!confirm(`Reset settings for user ${id}?`)) return;
    run(()=>api.resetUserSettings(id),'c-clear-user-settings-result');
  },
  getBotStats: async() => {
    const r = await api.getStats().catch(e=>({error:e.message}));
    if(r?.serverCount !== undefined) {
      res('c-bot-stats-result','ok',
        `Servers: ${r.serverCount} | Users: ${r.totalUsers} | Ping: ${r.ping}ms | Uptime: ${Math.floor(r.uptime/3600)}h${Math.floor((r.uptime%3600)/60)}m\nHeap: ${Math.round((r.ram?.heapUsed||0)/1048576)}MB / ${Math.round((r.ram?.heapTotal||0)/1048576)}MB | RSS: ${Math.round((r.ram?.rss||0)/1048576)}MB`);
    } else res('c-bot-stats-result','err',r?.error||'Error');
  },
  dmAllOwners: () => {
    const m=v('cdma-msg'); if(!m){toastErr('Enter a message');return;}
    if(!confirm('DM ALL server owners? This may rate-limit the bot.')) return;
    run(()=>api.dmAllOwners(m),'c-dm-all-result');
  },
  reloadCommands:     () => run(()=>api.reloadCommands(),'c-reload-commands-result'),
  clearStarterUsage:  () => { if(!confirm('Clear starter usage?')) return; run(()=>api.clearStarterUsage(),'c-clear-starter-result'); },
  clearComplimentUsage:() => { if(!confirm('Clear compliment usage?')) return; run(()=>api.clearComplimentUsage(),'c-clear-compliment-result'); },
  getChatHistory: async() => {
    const raw=v('cgh-id'); if(!raw){toastErr('Enter a User ID or username');return;}
    const id = await resolveUser(raw); if(!id) return;
    const limit = parseInt(v('cgh-limit')||'20')||20;
    const r = await api.getChatHistory(id, limit);
    if(r?.success) {
      const msgs = r.messages || [];
      if(!msgs.length) { res('c-get-history-result','ok','No history found'); return; }
      res('c-get-history-result','ok', msgs.map(m=>`[${m.role}]: ${String(m.content||'').slice(0,80)}`).join('\n'));
    } else res('c-get-history-result','err',r?.error||'Error');
  },
  broadcastStatus: () => {
    const title=v('cbs-title'),msg=v('cbs-msg'),color=v('cbs-color')||'#6D5AE6';
    if(!msg){toastErr('Enter a status message');return;}
    if(!confirm('Broadcast status to all servers?')) return;
    run(()=>api.announce({message:msg, title:title||'Status Update', embedColor:color, useEmbed:true}),'c-broadcast-status-result');
  },
  topServers: async() => {
    const r = await api.getServers().catch(e=>({error:e.message}));
    if(r?.data) {
      const top = r.data.sort((a,b)=>b.memberCount-a.memberCount).slice(0,10);
      res('c-user-count-result','ok', top.map((s,i)=>`${i+1}. ${s.name} — ${s.memberCount?.toLocaleString()} members`).join('\n'));
    } else res('c-user-count-result','err',r?.error||'Error');
  },
  purgeBlacklist: () => {
    if(!confirm('PURGE all blacklist entries across ALL servers? This cannot be undone.')) return;
    run(()=>api.purgeBlacklist(),'c-purge-blacklist-result');
  },
  pingCheck: async() => {
    const r = await api.getStats().catch(e=>({error:e.message}));
    if(r?.ping !== undefined) res('c-ping-check-result','ok',`WS Ping: ${r.ping >= 0 ? r.ping+'ms' : 'Offline'} | Status: ${r.wsStatus}`);
    else res('c-ping-check-result','err',r?.error||'Error');
  },
};

function renderApiKeysPanel(d) {
  const el = document.getElementById('api-keys-list');
  if (!el || !d?.keys) return;
  el.innerHTML = d.keys.map(k => `
    <div class="api-key-row ${k.isCurrent?'current':''}">
      <span class="api-key-name">Key ${k.keyNumber}${k.isCurrent?' (active)':''}</span>
      <span class="api-key-meta">${k.totalRequests||0} req</span>
    </div>`).join('') || '<div style="color:var(--tm);font-size:12px">No keys</div>';
}

export { renderApiKeysPanel };
