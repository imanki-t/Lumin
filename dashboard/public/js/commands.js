import { api } from './api.js';
import { toastOk, toastErr, toastInfo } from './toast.js';
import { setLockdownIndicator } from './router.js';

function v(id) { return (document.getElementById(id)?.value || '').trim(); }

function res(id, type, msg) {
  const el = document.getElementById(id);
  if (!el) return;
  el.className = `cmd-result ${type}`;
  el.textContent = String(msg || '').slice(0, 300);
  el.classList.remove('hidden');
}

async function run(fn, resultId) {
  res(resultId, '', 'Running...');
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

const CMDS = [
  {
    id:'c-save', name:'Force Save State', desc:'Persist current in-memory bot state to MongoDB immediately.',
    render: () => `<button class="cmd-btn" onclick="CMD.saveState()">Save Now</button>`,
  },
  {
    id:'c-clear-all', name:'Clear All Chat Histories', desc:'Wipe every user chat history from memory and database.',
    render: () => `<button class="cmd-btn danger" onclick="CMD.clearAllHistories()">Clear All Histories</button>`,
  },
  {
    id:'c-clear-user', name:'Clear User History', desc:"Clear one user's chat history by their Discord ID.",
    render: () => `<input class="cmd-input" id="ci-userId" placeholder="Discord User ID"/><button class="cmd-btn" onclick="CMD.clearUserHistory()">Clear History</button>`,
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
    id:'c-restart', name:'Restart Bot', desc:'Gracefully save state and restart the bot process. Render will auto-restart.',
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
    id:'c-dm', name:'Send DM', desc:'Send a direct message to any user by their Discord user ID.',
    render: () => `
      <input class="cmd-input" id="cd-user" placeholder="Discord User ID"/>
      <input class="cmd-input" id="cd-msg"  placeholder="Message to send"/>
      <button class="cmd-btn" onclick="CMD.sendDm()">Send DM</button>`,
  },
  {
    id:'c-bl', name:'Blacklist User', desc:'Block a user from using the bot in a specific server.',
    render: () => `
      <input class="cmd-input" id="cbl-user"  placeholder="User ID"/>
      <input class="cmd-input" id="cbl-guild" placeholder="Guild ID"/>
      <button class="cmd-btn danger" onclick="CMD.blacklistUser()">Blacklist</button>`,
  },
  {
    id:'c-unbl', name:'Unblacklist User', desc:'Restore bot access for a previously blacklisted user.',
    render: () => `
      <input class="cmd-input" id="cubl-user"  placeholder="User ID"/>
      <input class="cmd-input" id="cubl-guild" placeholder="Guild ID"/>
      <button class="cmd-btn" onclick="CMD.unblacklistUser()">Unblacklist</button>`,
  },
  {
    id:'c-user-settings', name:'View User Settings', desc:"Look up a user's custom bot configuration by their Discord ID.",
    render: () => `
      <input class="cmd-input" id="cus-id" placeholder="Discord User ID"/>
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
    id:'c-clear-hist-id', name:'Clear History by ID', desc:'Clear chat history for a specific channel or conversation ID.',
    render: () => `
      <input class="cmd-input" id="cchi-id" placeholder="Channel/User ID"/>
      <button class="cmd-btn" onclick="CMD.clearHistoryById()">Clear</button>`,
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

// ── CMD handlers ──────────────────────────────────────────────────────────────
window.CMD = {
  saveState:          () => run(() => api.saveState(),           'c-save-result'),
  clearAllHistories:  () => { if(!confirm('Clear ALL chat histories?')) return; run(() => api.clearHistory(), 'c-clear-all-result'); },
  clearUserHistory:   () => { const id=v('ci-userId'); if(!id){toastErr('Enter a User ID');return;} run(() => api.clearHistory(id), 'c-clear-user-result'); },
  switchApiKey:       () => run(() => api.switchApiKey(),        'c-apikey-result'),
  getApiKeyStats:     async() => {
    const r = await api.getApiKeyStats();
    const id = 'c-apikey-stats-result';
    if (r?.success) {
      const d = r.data;
      res(id, 'ok', `Total Keys: ${d.totalKeys} | Current: Key ${d.currentKey} | Reqs: ${d.keys?.map(k=>`K${k.keyNumber}:${k.totalRequests}`).join(' ')}`);
      // Refresh overview panel too
      renderApiKeysPanel(d);
    } else res(id, 'err', r?.error || 'Error');
  },
  clearImageUsage:    () => run(() => api.clearImageUsage(),     'c-img-result'),
  clearSummaryUsage:  () => run(() => api.clearSummaryUsage(),   'c-sum-result'),
  clearQuoteUsage:    () => run(() => api.clearQuoteUsage(),     'c-quote-result'),
  toggleDebug:        () => run(() => api.toggleDebug(),         'c-debug-result'),
  restart:            () => { if(!confirm('Restart the bot process?')) return; run(() => api.restart(), 'c-restart-result'); },
  setPresence:        () => run(() => api.setPresence({ status: v('cp-status'), activity: v('cp-activity'), activityType: parseInt(v('cp-type')||'0') }), 'c-presence-result'),
  sendDm:             () => { const u=v('cd-user'),m=v('cd-msg'); if(!u||!m){toastErr('User ID and message required');return;} run(() => api.sendDm(u,m), 'c-dm-result'); },
  blacklistUser:      () => { const u=v('cbl-user'),g=v('cbl-guild'); if(!u||!g){toastErr('User ID and Guild ID required');return;} run(() => api.blacklistUser(u,g), 'c-bl-result'); },
  unblacklistUser:    () => { const u=v('cubl-user'),g=v('cubl-guild'); if(!u||!g){toastErr('User ID and Guild ID required');return;} run(() => api.unblacklistUser(u,g), 'c-unbl-result'); },
  getUserSettings:    async() => {
    const id=v('cus-id'); if(!id){toastErr('Enter a User ID');return;}
    const r = await api.getUserSettings(id);
    const rid='c-user-settings-result';
    if(r?.success) res(rid,'ok', r.found ? JSON.stringify(r.data,null,2) : 'No custom settings found for this user');
    else res(rid,'err',r?.error||'Error');
  },
  resetServerSettings:() => { const g=v('css-guild'); if(!g){toastErr('Enter a Guild ID');return;} if(!confirm('Reset all settings for this server?')) return; run(()=>api.resetServer(g),'c-server-settings-result'); },
  leaveServer:        () => { const g=v('cl-guild'); if(!g){toastErr('Enter a Guild ID');return;} if(!confirm('Leave this server?')) return; run(()=>api.leaveServer(g),'c-leave-result'); },
  quickAnnounce:      () => { const m=v('caq-msg'); if(!m){toastErr('Enter a message');return;} run(()=>api.announce({message:m,title:'Announcement',useEmbed:false}),'c-announce-quick-result'); },
  clearHistoryById:   () => { const id=v('cchi-id'); if(!id){toastErr('Enter an ID');return;} run(()=>api.clearHistory(id),'c-clear-hist-id-result'); },
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
