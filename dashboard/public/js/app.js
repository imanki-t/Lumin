import { getToken, setToken, clearToken, hasToken, BASE_URL } from './config.js';
import { buildSidebarNav, buildBottomNav, navigate, onNavigate, setLockdownIndicator } from './router.js';
import { loadServers, filterServers, leaveServer, resetServer, svPage, refreshSingleServer } from './servers.js';
import { renderCommands, renderApiKeysPanel } from './commands.js';
import { initAnnounce, sendAnnouncement } from './announce.js';
import { loadLockdownState, toggleLockdown } from './lockdown.js';
import { initNodeTerminal, initMongoTerminal } from './terminals.js';
import { toastOk, toastErr, toastWarn } from './toast.js';
import { api } from './api.js';

// Formatters
const fmtBytes=(b,d=1)=>!b||b<0?'—':b<1024?`${b}B`:b<1048576?`${(b/1024).toFixed(d)}KB`:b<1073741824?`${(b/1048576).toFixed(d)}MB`:`${(b/1073741824).toFixed(d)}GB`;
const fmtUptime=s=>{s=Math.floor(s||0);const d=Math.floor(s/86400),h=Math.floor((s%86400)/3600),m=Math.floor((s%3600)/60),sec=s%60;return d>0?`${d}d ${h}h ${m}m`:h>0?`${h}h ${m}m`:`${m}m ${sec}s`;};
const fmtNum=n=>(n==null)?'—':Number(n).toLocaleString();
const setText=(id,v)=>{const el=document.getElementById(id);if(el&&el.textContent!==String(v))el.textContent=String(v);};

// Clock
function startClock() {
  const tick=()=>{const now=new Date();const t=now.toLocaleTimeString('en-US',{hour12:false});const d=now.toLocaleDateString('en-US',{month:'short',day:'numeric'});setText('tb-clock',`${d} · ${t}`);};
  tick(); setInterval(tick,1000);
}

// Stats WebSocket
let statsWs=null;
function startStatsStream() {
  if(statsWs&&statsWs.readyState<2)return;
  const proto=location.protocol==='https:'?'wss':'ws';
  statsWs=new WebSocket(`${proto}://${location.host}/dashboard/ws/stats?token=${encodeURIComponent(getToken())}`);
  statsWs.onmessage=e=>{try{updateStats(JSON.parse(e.data));}catch{}};
  statsWs.onclose=()=>{setTimeout(startStatsStream,3000);};
  statsWs.onerror=()=>{statsWs?.close();};
}

function updateStats(d) {
  setText('hc-servers',fmtNum(d.serverCount));
  setText('hc-members',fmtNum(d.totalUsers));
  setText('hc-ping',d.ping>=0?`${d.ping}ms`:'—');
  setText('hc-uptime',fmtUptime(d.uptime));
  setText('tb-ping',d.ping>=0?`${d.ping}ms`:'—');
  const sub=document.getElementById('hc-ping-sub');
  if(sub)sub.textContent=d.ping<0?'Offline':d.ping<150?'Excellent':d.ping<300?'Good':'High';
  const dot=document.getElementById('sb-dot');
  if(dot)dot.style.background=d.ping<0?'var(--err)':d.ping<300?'var(--ok)':'var(--warn)';
  setText('sb-ping',d.ping>=0?`${d.ping}ms`:'—');
  setText('sb-status',d.ping<0?'Offline':'Online');
  buildStatGrid(d);
  if(d.globalLockdown!==undefined)setLockdownIndicator(!!d.globalLockdown);
}

function buildStatGrid(d) {
  const grid=document.getElementById('stat-grid');
  if(!grid)return;
  const heapUsed=d.ram?.heapUsed||d.heapUsed||0;
  const heapTotal=d.ram?.heapTotal||d.heapTotal||0;
  const rss=d.ram?.rss||d.rss||0;
  const sysFree=d.ram?.sysFree||d.sysFree||0;
  const sysTotal=d.ram?.sysTotal||d.sysTotal||0;
  const heapPct=heapTotal?Math.round((heapUsed/heapTotal)*100):0;
  const ramPct=sysTotal?Math.round(((sysTotal-sysFree)/sysTotal)*100):0;
  const stats=[
    {label:'Heap Used',    value:fmtBytes(heapUsed),        sub:`${heapPct}% of ${fmtBytes(heapTotal)}`,   bar:heapPct,  barColor:heapPct>80?'err':heapPct>60?'warn':'ok'},
    {label:'RSS Memory',   value:fmtBytes(rss),             sub:'Resident set size'},
    {label:'System RAM',   value:fmtBytes(sysTotal-sysFree),sub:`${ramPct}% of ${fmtBytes(sysTotal)} used`, bar:ramPct,   barColor:ramPct>85?'err':ramPct>70?'warn':'ok'},
    {label:'Disk Used',    value:d.disk?.used||'—',         sub:`${d.disk?.percent||'—'} · ${d.disk?.available||'—'} free`},
    {label:'Node.js',      value:d.nodeVersion||'—',        sub:d.platform||'—'},
    {label:'CPU Cores',    value:String(d.cpuCores||'—'),   sub:d.cpuModel?.split(' ').slice(-2).join(' ')||'Available cores'},
    {label:'WS Status',    value:d.wsStatus||'—',           sub:'Discord socket',badge:d.wsStatus==='READY'?'ok':d.wsStatus==='CONNECTING'?'warn':'err',badgeLbl:d.wsStatus||'—'},
    {label:'Lockdown',     value:d.globalLockdown?'ACTIVE':'Off', sub:'Global state',badge:d.globalLockdown?'err':null,badgeLbl:'LOCKDOWN'},
    {label:'Debug Mode',   value:d.debugMode?'ON':'Off',    sub:'Verbose logging'},
    {label:'Chat Sessions',value:fmtNum(d.totalChatHistories||d.historyCount),sub:'Active sessions'},
    {label:'Blacklisted',  value:fmtNum(d.totalBlacklisted||d.blacklistCount),sub:'Users blocked'},
    {label:'Uptime',       value:fmtUptime(d.uptime),       sub:'Since last restart'},
  ];
  grid.innerHTML=stats.map(s=>`
    <div class="stat-card">
      <div class="stat-label">${s.label}</div>
      <div class="stat-value">${s.value}</div>
      <div class="stat-sub">${s.sub}</div>
      ${s.bar!=null?`<div class="stat-bar"><div class="stat-bar-fill ${s.barColor||'ok'}" style="width:${Math.min(s.bar,100)}%"></div></div>`:''}
      ${s.badge&&s.badgeLbl?`<span class="stat-badge ${s.badge}">${s.badgeLbl}</span>`:''}
    </div>`).join('');
}

async function loadFullStats() {
  const r=await api.getStats().catch(()=>null);
  if(!r)return;
  if(r.username)setText('bot-name',r.username);
  if(r.id)setText('bot-id',`ID: ${r.id}`);
  if(r.tag)setText('bot-tag',r.tag);
  const av=document.getElementById('bot-av');
  if(av&&r.avatarURL){av.src=r.avatarURL;av.style.display='block';}
  const dbDot=document.getElementById('db-dot');
  const dbText=document.getElementById('db-status-text');
  const dbOk=r.mongoStatus==='Connected'||r.dbStatus==='connected'||r.dbStatus==='ok';
  if(dbDot)dbDot.className=`status-dot ${dbOk?'ok':'err'}`;
  if(dbText)dbText.textContent=dbOk?'Connected':(r.mongoStatus||r.dbStatus||'Unknown');
  const keyRes=await api.getApiKeyStats().catch(()=>null);
  if(keyRes?.success)renderApiKeysPanel(keyRes.data);
  // Load current presence
  loadCurrentPresence();
}

// ── Presence ─────────────────────────────────────────────────────────────────
async function loadCurrentPresence() {
  const r = await api.getPresence().catch(()=>null);
  if (!r?.success) return;
  const p = r.presence;
  const el = document.getElementById('presence-current-display');
  if (el && p) {
    const typeMap = {0:'Playing',1:'Streaming',2:'Listening to',3:'Watching',5:'Competing in'};
    const status = p.status || 'online';
    const statusDot = {online:'🟢',idle:'🟡',dnd:'🔴',invisible:'⚫'}[status]||'⚪';
    const actType = p.activities?.[0] ? (typeMap[p.activities[0].type]||'') : '';
    const actName = p.activities?.[0]?.name || '';
    el.innerHTML = `
      <div class="presence-live-row">
        <span class="plr-dot">${statusDot}</span>
        <span class="plr-status">${status.charAt(0).toUpperCase()+status.slice(1)}</span>
        ${actName?`<span class="plr-sep">·</span><span class="plr-act">${actType} ${actName}</span>`:''}
      </div>`;
  }
  // Pre-fill form with current values
  if (p?.status) {
    const sel = document.getElementById('presence-status');
    if (sel) sel.value = p.status;
  }
  if (p?.activities?.[0]) {
    const act = p.activities[0];
    const inp = document.getElementById('presence-activity');
    if (inp) inp.value = act.name || '';
    const typ = document.getElementById('presence-type');
    if (typ) typ.value = String(act.type ?? 0);
  }
}

function applyPreset(status, activity, type) {
  const s=document.getElementById('presence-status');
  const a=document.getElementById('presence-activity');
  const t=document.getElementById('presence-type');
  if(s)s.value=status;if(a)a.value=activity;if(t)t.value=type;
}

async function setPresence(){
  const status=document.getElementById('presence-status')?.value||'online';
  const activity=(document.getElementById('presence-activity')?.value||'').trim();
  const type=parseInt(document.getElementById('presence-type')?.value||'0');
  const result=document.getElementById('presence-result');
  const r=await api.setPresence({status,activity,activityType:type}).catch(e=>({error:e.message}));
  if(result){result.className=`cmd-result ${r?.success?'ok':'err'}`;result.textContent=r?.message||r?.error||'';result.classList.remove('hidden');}
  if(r?.success){ toastOk(r.message||'Presence updated'); loadCurrentPresence(); }
  else toastErr(r?.error||'Failed');
}

// ── Users ─────────────────────────────────────────────────────────────────────
let _usersPage = 1;
const USERS_PER_PAGE = 10;
let _blacklistData = [];

async function lookupUser(){
  const raw=(document.getElementById('user-lookup-id')?.value||'').trim();
  if(!raw){toastErr('Enter a User ID or username');return;}

  const el=document.getElementById('user-lookup-result');
  if(el){el.classList.remove('hidden');el.textContent='Looking up…';}

  // Try to resolve username if not numeric
  let userId = raw;
  if(!/^\d{17,20}$/.test(raw)){
    const rv = await api.resolveUsername(raw).catch(()=>null);
    if(rv?.success && rv.id) userId = rv.id;
  }

  // Fetch full profile
  const r = await api.fetchUserProfile(userId).catch(e=>({error:e.message}));
  if(!el)return;
  if(r?.success && r.user){
    const u = r.user;
    const createdDate = new Date(u.createdAt||0).toLocaleDateString('en-US',{year:'numeric',month:'short',day:'numeric'});
    el.innerHTML = `
      <div class="user-profile-card">
        <div class="upc-header">
          <img class="upc-avatar" src="${u.avatarURL||''}" onerror="this.src=''" alt=""/>
          <div class="upc-identity">
            <div class="upc-display">${esc(u.displayName||u.username||'Unknown')}</div>
            <div class="upc-tag mono">${esc(u.tag||u.username||'—')}</div>
            <div class="upc-id mono">${u.id}</div>
          </div>
          <div class="upc-badges">
            ${u.bot?'<span class="upc-badge bot">BOT</span>':''}
            ${u.system?'<span class="upc-badge sys">SYSTEM</span>':''}
          </div>
        </div>
        <div class="upc-grid">
          <div class="upc-field"><div class="upc-flbl">Account Created</div><div class="upc-fval">${createdDate}</div></div>
          <div class="upc-field"><div class="upc-flbl">Mutual Servers</div><div class="upc-fval">${u.mutualGuilds??'—'}</div></div>
          <div class="upc-field"><div class="upc-flbl">Custom Settings</div><div class="upc-fval">${u.hasSettings?'Yes':'No'}</div></div>
          <div class="upc-field"><div class="upc-flbl">Chat History</div><div class="upc-fval">${u.hasHistory?'Yes':'No'}</div></div>
        </div>
        ${u.hasSettings?`<button class="upc-action" onclick="window._viewUserSettings('${u.id}')">View Settings</button>`:''}
      </div>`;
    el.classList.remove('hidden');
  } else {
    // Fallback to settings lookup
    const sr=await api.getUserSettings(userId).catch(e=>({error:e.message}));
    if(sr?.success){
      el.innerHTML = `<div class="upc-fallback"><div class="mono" style="font-size:11px;color:var(--ts)">User ID: ${userId}</div><pre style="margin-top:8px;font-size:11px;color:var(--ts);overflow:auto">${sr.found?JSON.stringify(sr.data,null,2):`No settings for user ${userId}`}</pre></div>`;
    } else {
      el.textContent = r?.error||sr?.error||'User not found';
    }
  }
}

async function viewUserSettings(userId){
  const r=await api.getUserSettings(userId).catch(e=>({error:e.message}));
  const el=document.getElementById('user-lookup-result');
  if(!el)return;
  const data = r?.success ? (r.found ? JSON.stringify(r.data,null,2) : 'No custom settings') : (r?.error||'Error');
  el.innerHTML += `<pre class="upc-settings-pre">${data}</pre>`;
}

async function sendDm(){
  const raw=(document.getElementById('dm-user-id')?.value||'').trim();
  const message=(document.getElementById('dm-message')?.value||'').trim();
  const result=document.getElementById('dm-result');
  if(!raw||!message){toastErr('User and message required');return;}

  let userId = raw;
  if(!/^\d{17,20}$/.test(raw)){
    const rv = await api.resolveUsername(raw).catch(()=>null);
    if(rv?.success && rv.id) userId = rv.id;
    else { toastErr(`Could not resolve "${raw}"`); return; }
  }
  const r=await api.sendDm(userId,message).catch(e=>({error:e.message}));
  if(result){result.className=`cmd-result ${r?.success?'ok':'err'}`;result.textContent=r?.message||r?.error||'';result.classList.remove('hidden');}
  r?.success?toastOk(r.message||'DM sent'):toastErr(r?.error||'Failed');
}

async function blacklistUser(){
  const userId=(document.getElementById('bl-user-id')?.value||'').trim();
  const guildId=(document.getElementById('bl-guild-id')?.value||'').trim();
  const result=document.getElementById('bl-result');
  if(!userId||!guildId){toastErr('User ID and Guild ID required');return;}
  const r=await api.blacklistUser(userId,guildId).catch(e=>({error:e.message}));
  if(result){result.className=`cmd-result ${r?.success?'ok':'err'}`;result.textContent=r?.message||r?.error||'';result.classList.remove('hidden');}
  r?.success?toastOk(r.message||'Blacklisted'):toastErr(r?.error||'Failed');
}

async function unblacklistUser(){
  const userId=(document.getElementById('bl-user-id')?.value||'').trim();
  const guildId=(document.getElementById('bl-guild-id')?.value||'').trim();
  const result=document.getElementById('bl-result');
  if(!userId||!guildId){toastErr('User ID and Guild ID required');return;}
  const r=await api.unblacklistUser(userId,guildId).catch(e=>({error:e.message}));
  if(result){result.className=`cmd-result ${r?.success?'ok':'err'}`;result.textContent=r?.message||r?.error||'';result.classList.remove('hidden');}
  r?.success?toastOk(r.message||'Unblacklisted'):toastErr(r?.error||'Failed');
}

async function loadBlacklist(){
  const el=document.getElementById('blacklist-content');
  if(el)el.textContent='Loading...';
  const r=await api.getBlacklisted().catch(()=>null);
  if(!el)return;
  if(!r?.success||!r.data){el.textContent='Failed to load blacklist';return;}
  const guilds=Object.entries(r.data);
  if(!guilds.length){el.textContent='No blacklisted users.';return;}

  _blacklistData = guilds;
  _usersPage = 1;
  renderBlacklistPage();
}

function renderBlacklistPage(){
  const el=document.getElementById('blacklist-content');
  if(!el)return;
  const allEntries = _blacklistData.flatMap(([gid,users])=>users.map(u=>({gid,u})));
  const total = allEntries.length;
  const totalPages = Math.ceil(total/USERS_PER_PAGE)||1;
  const start = (_usersPage-1)*USERS_PER_PAGE;
  const slice = allEntries.slice(start, start+USERS_PER_PAGE);

  let html = slice.map(({gid,u})=>`
    <div class="bl-entry">
      <span class="bl-user mono">${u}</span>
      <span class="bl-guild-tag">Guild: ${gid.slice(-6)}</span>
    </div>`).join('');

  html += `<div class="bl-pagination">
    <button class="pg-btn sm" onclick="window._usersPage(${_usersPage-1})" ${_usersPage===1?'disabled':''}>‹</button>
    <span style="font-size:11px;color:var(--ts)">Page ${_usersPage}/${totalPages} · ${total} entries</span>
    <button class="pg-btn sm" onclick="window._usersPage(${_usersPage+1})" ${_usersPage>=totalPages?'disabled':''}>›</button>
  </div>`;
  el.innerHTML = html;
}

function usersPage(p){
  const allEntries = _blacklistData.flatMap(([gid,users])=>users.map(u=>({gid,u})));
  const totalPages = Math.ceil(allEntries.length/USERS_PER_PAGE)||1;
  if(p<1||p>totalPages)return;
  _usersPage=p;
  renderBlacklistPage();
}

// ── Auth ──────────────────────────────────────────────────────────────────────
async function checkSession(){
  const r=await api.authMe().catch(()=>null);
  const user = r?.user || r;
  if(!user?.email) return false;
  setText('sb-user-name', user.name || user.email.split('@')[0]);
  setText('sb-user-email', user.email);
  const av=document.getElementById('sb-avatar');
  if(av&&user.picture){av.src=user.picture;av.onerror=()=>{av.style.display='none';};}
  return true;
}

function handleOAuthCallback(){
  const params=new URLSearchParams(location.search);
  const token=params.get('token'),error=params.get('error');
  if(token){setToken(token);history.replaceState({},'',location.pathname);return true;}
  if(error){const el=document.getElementById('login-alert');if(el){el.textContent=decodeURIComponent(error);el.classList.remove('hidden');}history.replaceState({},'',location.pathname);}
  return false;
}

// ── Overview quick-buttons ────────────────────────────────────────────────────
window.CMD=window.CMD||{};
Object.assign(window.CMD,{
  saveState:   async()=>{const r=await api.saveState().catch(e=>({error:e.message}));r?.success?toastOk(r.message||'State saved'):toastErr(r?.error||'Failed');},
  toggleDebug: async()=>{const r=await api.toggleDebug().catch(e=>({error:e.message}));r?.success?toastOk(r.message||'Debug toggled'):toastErr(r?.error||'Failed');},
  restart:     async()=>{if(!confirm('Restart the bot process?'))return;const r=await api.restart().catch(e=>({error:e.message}));r?.success?toastWarn(r.message||'Restarting...'):toastErr(r?.error||'Failed');},
  switchApiKey:async()=>{const r=await api.switchApiKey().catch(e=>({error:e.message}));if(r?.success){toastOk(r.message||'Key rotated');if(r.stats)renderApiKeysPanel(r.stats);}else toastErr(r?.error||'Failed');},
});

function esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}

// ── Global refs ───────────────────────────────────────────────────────────────
window._navigate=navigate;
window._initiateLogin=()=>{window.location.href=`${BASE_URL}/auth/google`;};
window._logout=()=>{api.authLogout().catch(()=>{});clearToken();location.reload();};
window._toggleSidebar=()=>{const sb=document.getElementById('sidebar');const ov=document.getElementById('sb-overlay');if(!sb)return;const open=sb.classList.toggle('open');ov?.classList.toggle('hidden',!open);};
window._closeSidebar=()=>{document.getElementById('sidebar')?.classList.remove('open');document.getElementById('sb-overlay')?.classList.add('hidden');};
window._loadServers=loadServers;
window._filterServers=filterServers;
window._leaveServer=leaveServer;
window._resetServer=resetServer;
window._svPage=svPage;
window._refreshServer=refreshSingleServer;
window._sendAnnounce=sendAnnouncement;
window._toggleLockdown=toggleLockdown;
window._lookupUser=lookupUser;
window._viewUserSettings=viewUserSettings;
window._sendDm=sendDm;
window._blacklistUser=blacklistUser;
window._unblacklistUser=unblacklistUser;
window._loadBlacklist=loadBlacklist;
window._usersPage=usersPage;
window._setPresence=setPresence;
window._applyPreset=applyPreset;

// ── Page navigation ───────────────────────────────────────────────────────────
onNavigate(id=>{
  switch(id){
    case 'servers':       loadServers();       break;
    case 'commands':      renderCommands();    break;
    case 'announce':      initAnnounce();      break;
    case 'lockdown':      loadLockdownState(); break;
    case 'node-console':  initNodeTerminal();  break;
    case 'mongo-console': initMongoTerminal(); break;
    case 'users':         loadBlacklist();     break;
    case 'presence':      loadCurrentPresence();break;
  }
});

// ── Boot ──────────────────────────────────────────────────────────────────────
async function boot(){
  const hadToken=handleOAuthCallback();
  buildSidebarNav(document.getElementById('sb-nav'));
  buildBottomNav(document.getElementById('bnav-inner'));
  startClock();
  if(!hasToken()&&!hadToken){
    document.getElementById('login-page')?.classList.remove('hidden');
    document.getElementById('app')?.classList.add('hidden');
    return;
  }
  const valid=await checkSession();
  if(!valid){
    clearToken();
    document.getElementById('login-page')?.classList.remove('hidden');
    document.getElementById('app')?.classList.add('hidden');
    return;
  }
  document.getElementById('login-page')?.classList.add('hidden');
  document.getElementById('app')?.classList.remove('hidden');
  navigate('overview');
  startStatsStream();
  loadFullStats();
  loadLockdownState();
}

boot();
