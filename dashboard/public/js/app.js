import { getToken, setToken, clearToken, hasToken, BASE_URL } from './config.js';
import { buildSidebarNav, buildBottomNav, navigate, onNavigate, setLockdownIndicator } from './router.js';
import { loadServers, filterServers, leaveServer, resetServer } from './servers.js';
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
  const heapPct=d.ram?.heapTotal?Math.round((d.ram.heapUsed/d.ram.heapTotal)*100):0;
  const ramPct=d.ram?.sysTotal?Math.round(((d.ram.sysTotal-d.ram.sysFree)/d.ram.sysTotal)*100):0;
  const stats=[
    {label:'Heap Used',value:fmtBytes(d.ram?.heapUsed),sub:`${heapPct}% of ${fmtBytes(d.ram?.heapTotal)}`},
    {label:'RSS Memory',value:fmtBytes(d.ram?.rss),sub:'Resident set size'},
    {label:'System RAM',value:fmtBytes(d.ram?.sysTotal-d.ram?.sysFree),sub:`${ramPct}% used`},
    {label:'Disk Used',value:d.disk?.used||'—',sub:`${d.disk?.percent||''} · ${d.disk?.available||'—'} free`},
    {label:'Node.js',value:d.nodeVersion||'—',sub:d.platform||'—'},
    {label:'CPU Cores',value:String(d.cpuCores||'—'),sub:'Available cores'},
    {label:'WS Status',value:d.wsStatus||'—',sub:'Discord socket',badge:d.wsStatus==='OPEN'?'ok':d.wsStatus==='CONNECTING'?'warn':'err',badgeLbl:d.wsStatus||'—'},
    {label:'Lockdown',value:d.globalLockdown?'ACTIVE':'Off',sub:'Global state',badge:d.globalLockdown?'err':null,badgeLbl:'LOCKDOWN'},
    {label:'Debug Mode',value:d.debugMode?'ON':'Off',sub:'Verbose logging'},
    {label:'Histories',value:fmtNum(d.historyCount),sub:'Active sessions'},
    {label:'Blacklisted',value:fmtNum(d.blacklistCount),sub:'Users blocked'},
    {label:'Uptime',value:fmtUptime(d.uptime),sub:'Since last restart'},
  ];
  grid.innerHTML=stats.map(s=>`
    <div class="stat-card">
      <div class="stat-label">${s.label}</div>
      <div class="stat-value">${s.value}</div>
      <div class="stat-sub">${s.sub}</div>
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
  const dbOk=r.dbStatus==='connected'||r.dbStatus==='ok';
  if(dbDot)dbDot.className=`status-dot ${dbOk?'ok':'err'}`;
  if(dbText)dbText.textContent=dbOk?'Connected':(r.dbStatus||'Unknown');
  const keyRes=await api.getApiKeyStats().catch(()=>null);
  if(keyRes?.success)renderApiKeysPanel(keyRes.data);
}

// Users
async function lookupUser(){
  const id=(document.getElementById('user-lookup-id')?.value||'').trim();
  if(!id){toastErr('Enter a User ID');return;}
  const r=await api.getUserSettings(id).catch(e=>({error:e.message}));
  const el=document.getElementById('user-lookup-result');
  if(!el)return;
  el.classList.remove('hidden');
  el.textContent=r?.success?(r.found?JSON.stringify(r.data,null,2):`No settings for user ${id}`):(r?.error||'Error');
}
async function sendDm(){
  const userId=(document.getElementById('dm-user-id')?.value||'').trim();
  const message=(document.getElementById('dm-message')?.value||'').trim();
  const result=document.getElementById('dm-result');
  if(!userId||!message){toastErr('User ID and message required');return;}
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
  el.innerHTML=guilds.map(([gid,users])=>`<div class="bl-guild">Guild: ${gid}</div>${users.map(u=>`<div class="bl-entry">${u}</div>`).join('')}`).join('')+`<div style="margin-top:8px;font-size:11px;color:var(--tm)">Total: ${r.total||0}</div>`;
}

// Presence
function applyPreset(status,activity,type){
  const s=document.getElementById('presence-status');const a=document.getElementById('presence-activity');const t=document.getElementById('presence-type');
  if(s)s.value=status;if(a)a.value=activity;if(t)t.value=type;
}
async function setPresence(){
  const status=document.getElementById('presence-status')?.value||'online';
  const activity=(document.getElementById('presence-activity')?.value||'').trim();
  const type=parseInt(document.getElementById('presence-type')?.value||'0');
  const result=document.getElementById('presence-result');
  const r=await api.setPresence({status,activity,activityType:type}).catch(e=>({error:e.message}));
  if(result){result.className=`cmd-result ${r?.success?'ok':'err'}`;result.textContent=r?.message||r?.error||'';result.classList.remove('hidden');}
  r?.success?toastOk(r.message||'Presence updated'):toastErr(r?.error||'Failed');
}

// Auth
async function checkSession(){
  const r=await api.authMe().catch(()=>null);
  if(r?._authError||!r?.email)return false;
  setText('sb-user-name',r.name||r.email.split('@')[0]);
  setText('sb-user-email',r.email);
  const av=document.getElementById('sb-avatar');
  if(av&&r.picture){av.src=r.picture;av.onerror=()=>{av.style.display='none';};}
  return true;
}
function handleOAuthCallback(){
  const params=new URLSearchParams(location.search);
  const token=params.get('token'),error=params.get('error');
  if(token){setToken(token);history.replaceState({},'',location.pathname);return true;}
  if(error){const el=document.getElementById('login-alert');if(el){el.textContent=decodeURIComponent(error);el.classList.remove('hidden');}history.replaceState({},'',location.pathname);}
  return false;
}

// Overview quick-buttons
window.CMD=window.CMD||{};
Object.assign(window.CMD,{
  saveState:   async()=>{const r=await api.saveState().catch(e=>({error:e.message}));r?.success?toastOk(r.message||'State saved'):toastErr(r?.error||'Failed');},
  toggleDebug: async()=>{const r=await api.toggleDebug().catch(e=>({error:e.message}));r?.success?toastOk(r.message||'Debug toggled'):toastErr(r?.error||'Failed');},
  restart:     async()=>{if(!confirm('Restart the bot process?'))return;const r=await api.restart().catch(e=>({error:e.message}));r?.success?toastWarn(r.message||'Restarting...'):toastErr(r?.error||'Failed');},
  switchApiKey:async()=>{const r=await api.switchApiKey().catch(e=>({error:e.message}));if(r?.success){toastOk(r.message||'Key rotated');if(r.stats)renderApiKeysPanel(r.stats);}else toastErr(r?.error||'Failed');},
});

// Global refs
window._navigate=navigate;
window._initiateLogin=()=>{window.location.href=`${BASE_URL}/auth/google`;};
window._logout=()=>{api.authLogout().catch(()=>{});clearToken();location.reload();};
window._toggleSidebar=()=>{const sb=document.getElementById('sidebar');const ov=document.getElementById('sb-overlay');if(!sb)return;const open=sb.classList.toggle('open');ov?.classList.toggle('hidden',!open);};
window._closeSidebar=()=>{document.getElementById('sidebar')?.classList.remove('open');document.getElementById('sb-overlay')?.classList.add('hidden');};
window._loadServers=loadServers;
window._filterServers=filterServers;
window._leaveServer=leaveServer;
window._resetServer=resetServer;
window._sendAnnounce=sendAnnouncement;
window._toggleLockdown=toggleLockdown;
window._lookupUser=lookupUser;
window._sendDm=sendDm;
window._blacklistUser=blacklistUser;
window._unblacklistUser=unblacklistUser;
window._loadBlacklist=loadBlacklist;
window._setPresence=setPresence;
window._applyPreset=applyPreset;

// Page navigation
onNavigate(id=>{
  switch(id){
    case 'servers':       loadServers();      break;
    case 'commands':      renderCommands();   break;
    case 'announce':      initAnnounce();     break;
    case 'lockdown':      loadLockdownState();break;
    case 'node-console':  initNodeTerminal(); break;
    case 'mongo-console': initMongoTerminal();break;
    case 'users':         loadBlacklist();    break;
  }
});

// Boot
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
