/**
 * app.js — Lumin Dashboard entry point
 *
 * Boot sequence:
 *   1. Verify session (GET /dashboard/auth/me)
 *   2. If not authed → show login page, fire reCAPTCHA flow
 *   3. If authed     → show app shell, build nav, connect WebSocket, init overview
 *
 * All window._xxx globals used by HTML onclick handlers are assigned here or
 * in the relevant module files.
 */

import { api }                              from './api.js';
import { PAGES }                            from './config.js';
import { navigate, onNavigate,
         buildSidebarNav, buildBottomNav,
         setLockdownIndicator,
         currentPage }                      from './router.js';
import { toastOk, toastErr,
         toastInfo, toastConfirm }          from './toast.js';
import { initOverview, refreshStats }       from './overview.js';
import { initCommands }                     from './commands.js';
import { loadServers, filterServers }       from './servers.js';
import { initAnnounce,
         setAnnTarget, updatePreview,
         sendAnnouncement, dmAllOwners }    from './announce.js';
import { toggleLockdown, loadLockdownState } from './lockdown.js';
import { initNodeTerminal,
         initMongoTerminal,
         initShellTerminal }               from './terminals.js';

// ── Section init registry ─────────────────────────────────────────────────────
// Maps page IDs to lazy init functions.  Each runs once on first visit.
const sectionInited = {};
const SECTION_INIT = {
  'overview':       initOverview,
  'commands':       initCommands,
  'servers':        loadServers,
  'announce':       initAnnounce,
  'lockdown':       loadLockdownState,
  'node-console':   initNodeTerminal,
  'mongo-console':  initMongoTerminal,
  'shell-console':  initShellTerminal,
  'models':         initModels,
  'users':          initUsers,
  'config':         initConfig,
  'database':       initDatabase,
  'files':          initFileBrowser,
  'presence':       initPresence,
};

onNavigate(id => {
  if (sectionInited[id]) return;
  sectionInited[id] = true;
  SECTION_INIT[id]?.();
});

// ═══════════════════════════════════════════════════════════════════════════════
// BOOT
// ═══════════════════════════════════════════════════════════════════════════════
(async function boot() {
  const r = await api.authMe().catch(() => null);

  if (!r || r._authError || !r.user) {
    showLogin(r?.error);
    return;
  }

  showApp(r.user);
})();

// ── Show login ────────────────────────────────────────────────────────────────
async function showLogin(errorMsg) {
  document.getElementById('app')?.classList.add('hidden');
  const lp = document.getElementById('login-page');
  if (lp) lp.style.display = 'flex';

  if (errorMsg) showLoginAlert(errorMsg);

  // Load reCAPTCHA site key from server
  const cfg = await api.authConfig().catch(() => null);
  const siteKey = cfg?.recaptchaSiteKey;

  if (siteKey && window.grecaptcha) {
    window.grecaptcha.ready(() => {
      window._initiateLogin = async () => {
        const btn = document.getElementById('google-btn');
        if (btn) { btn.disabled = true; btn.textContent = 'Verifying…'; }
        try {
          const token = await window.grecaptcha.execute(siteKey, { action: 'login' });
          const rv = await api.verifyRecaptcha(token).catch(e => ({ error: e.message }));
          if (rv?.success) {
            window.location.href = `${window.location.origin}/dashboard/auth/google`;
          } else {
            showLoginAlert(rv?.error || 'reCAPTCHA failed');
            if (btn) { btn.disabled = false; btn.textContent = 'Continue with Google'; }
          }
        } catch (e) {
          showLoginAlert('reCAPTCHA error. Please try again.');
          if (btn) { btn.disabled = false; btn.textContent = 'Continue with Google'; }
        }
      };
    });
  } else {
    // Fallback: direct OAuth redirect
    window._initiateLogin = () => {
      window.location.href = `${window.location.origin}/dashboard/auth/google`;
    };
  }
}

function showLoginAlert(msg) {
  const el = document.getElementById('login-alert');
  if (!el) return;
  el.textContent = msg || 'Authentication failed';
  el.classList.remove('hidden');
}

// ── Show app ──────────────────────────────────────────────────────────────────
function showApp(user) {
  document.getElementById('login-page')?.remove();
  const app = document.getElementById('app');
  if (app) app.classList.remove('hidden');

  // Populate user info in sidebar footer
  const av = document.getElementById('sb-av');
  const un = document.getElementById('sb-un');
  const ue = document.getElementById('sb-ue');

  if (user.avatar && av) av.src = user.avatar;
  if (un) un.textContent = user.name    || user.email?.split('@')[0] || '—';
  if (ue) ue.textContent = user.email   || '—';

  // Build navigation
  buildSidebarNav(document.getElementById('sb-nav'));
  buildBottomNav(document.getElementById('bnav-i'));

  // Wire window globals used by HTML onclick attributes
  wireGlobals();

  // Start WebSocket heartbeat / stats polling
  startPoller();

  // Start clock
  startClock();

  // Navigate to overview (triggers initOverview via onNavigate)
  navigate('overview');
}

// ── Polling ───────────────────────────────────────────────────────────────────
// Lightweight stat refresh every 20 s.  Only runs when overview is active.
function startPoller() {
  setInterval(async () => {
    if (currentPage() !== 'overview') return;
    await refreshStats().catch(() => null);
  }, 20_000);
}

// ── Clock ─────────────────────────────────────────────────────────────────────
function startClock() {
  const tick = () => {
    const clk = document.getElementById('tb-clk');
    if (clk) clk.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };
  tick();
  setInterval(tick, 1000);
}

// ══════════════════════════════════════════════════════════════════════════════
// MODELS & FLAGS
// ══════════════════════════════════════════════════════════════════════════════
async function initModels() {
  await Promise.all([loadModels(), loadFeatureFlags(), loadApiKeyDetails(),
                     loadMigrationConfig(), loadBotConfig(), loadRateLimits(),
                     loadMigrateFields()]);
}

async function loadModels() {
  const grid   = document.getElementById('mdl-grid');
  const active = document.getElementById('mdl-active-info');
  if (!grid) return;
  grid.innerHTML = '<div class="loading">Loading…</div>';

  const r = await api.getModels().catch(() => null);
  if (!r?.models?.length) { grid.innerHTML = '<div class="empty">No models available</div>'; return; }

  grid.innerHTML = r.models.map(m => {
    const isActive = m.id === r.active || m.active;
    const tags = [
      m.gemma   ? '<span class="bot-badge bot-badge-app" style="font-size:9px;">Gemma</span>' : '',
      m.preview ? '<span class="bot-badge bot-badge-slash" style="font-size:9px;">Preview</span>' : '',
    ].filter(Boolean).join('');

    return `
      <div class="mdl-card${isActive ? ' active' : ''}"
           onclick="window._setModel('${m.id}')">
        <div class="mdl-name">${m.id}</div>
        ${m.displayName ? `<div class="mdl-id">${m.displayName}</div>` : ''}
        <div style="display:flex;gap:4px;margin-top:5px;flex-wrap:wrap;">${tags}</div>
      </div>`;
  }).join('');

  if (active && r.active) active.textContent = `Active: ${r.active}`;
}

async function loadFeatureFlags() {
  const r = await api.getFeatureFlags().catch(() => null);
  if (!r) return;
  const flags = r.flags ?? r;
  for (const [key, val] of Object.entries(flags)) {
    const map = {
      ENABLE_GEMMA:              'ff-gemma',
      ENABLE_RAG:                'ff-rag',
      CACHE_ENABLED:             'ff-cache',
      CYCLE_GEMMA_WITH_GEMINI:   'ff-cycle',
      WEEKLY_SUMMARY_ENABLED:    'ff-weekly',
      ENABLE_WEB_SEARCH:         'ff-websearch',
      ENABLE_FUNCTION_CALLING:   'ff-funcall',
      CROSS_CONTEXT_ENABLED:     'ff-cross',
      ENABLE_IMAGE_PROCESSING:   'ff-image',
      ENABLE_VIDEO_PROCESSING:   'ff-video',
      ENABLE_AUDIO_PROCESSING:   'ff-audio',
      ENABLE_FILE_PROCESSING:    'ff-file',
      PDF_ENABLED_FOR_GEMINI:    'ff-pdf',
    };
    const sel = document.getElementById(map[key]);
    if (sel) sel.value = String(val);
  }
}

async function loadApiKeyDetails() {
  const con = document.getElementById('keys-detail');
  if (!con) return;
  con.innerHTML = '<div class="loading">Loading…</div>';
  const r = await api.getApiKeyStats().catch(() => null);
  const keys = Array.isArray(r) ? r : r?.keys ?? [];
  if (!keys.length) { con.innerHTML = '<div class="empty">No keys configured</div>'; return; }

  con.innerHTML = keys.map((k, i) => {
    const masked  = k.key ? `${k.key.slice(0,8)}…${k.key.slice(-4)}` : `Key #${i+1}`;
    const model   = k.model || k.currentModel || '—';
    const calls   = k.callsToday != null ? k.callsToday.toLocaleString() : '—';
    const errors  = k.errors     != null ? k.errors.toLocaleString()     : '—';
    const status  = k.current || k.active
      ? '<span class="tag tag-ok">Active</span>'
      : `<button class="btn btn-ghost btn-sm" onclick="window._switchToKey(${i})">Use</button>`;

    return `
      <div class="key-detail${k.current || k.active ? ' active' : ''}">
        <div class="kd-top">
          <span class="kd-n mono">${masked}</span>
          ${status}
        </div>
        <div class="kd-stats">
          <div class="kd-st"><div class="kd-sl">Model</div><div class="kd-sv">${model}</div></div>
          <div class="kd-st"><div class="kd-sl">Today</div><div class="kd-sv mono">${calls}</div></div>
          <div class="kd-st"><div class="kd-sl">Errors</div><div class="kd-sv mono" style="color:var(--er)">${errors}</div></div>
        </div>
      </div>`;
  }).join('');
}

async function loadMigrationConfig() {
  const r = await api.getMigrationConfig().catch(() => null);
  if (!r) return;
  const c = r.config ?? r;
  const s = id => document.getElementById(id);
  if (s('mc-enable'))     s('mc-enable').value     = String(c.enabled ?? false);
  if (s('mc-batch-size')) s('mc-batch-size').value  = c.batchSize  ?? 50;
  if (s('mc-batch-delay'))s('mc-batch-delay').value = c.batchDelay ?? 100;
}

async function loadBotConfig() {
  const r = await api.getBotConfig().catch(() => null);
  if (!r) return;
  const c = r.config ?? r;
  const s = id => document.getElementById(id);
  if (s('bc-resp-format'))   s('bc-resp-format').value    = c.responseFormat   ?? 'Normal';
  if (s('bc-dms'))           s('bc-dms').value            = String(c.workInDMs ?? true);
  if (s('bc-queue'))         s('bc-queue').value          = c.maxQueuePerUser  ?? 5;
  if (s('bc-key-hold'))      s('bc-key-hold').value       = c.keySwitchHold    ?? 1500;
  if (s('bc-ram'))           s('bc-ram').value            = c.ramSuspend       ?? 380;
  if (s('bc-max-msg'))       s('bc-max-msg').value        = c.maxHistoryMsgs   ?? 50;
  if (s('bc-ctx-break'))     s('bc-ctx-break').value      = c.contextBreakMin  ?? 30;
  if (s('bc-gemma-limit'))   s('bc-gemma-limit').value    = c.gemmaDailyLimit  ?? 1500;
  if (s('bc-gemma-default')) s('bc-gemma-default').value  = c.gemmaDefault     ?? '';
  if (s('bc-gemma-fallback'))s('bc-gemma-fallback').value = c.gemmaFallback    ?? '';
}

async function loadRateLimits() {
  const r = await api.getRateLimits().catch(() => null);
  if (!r) return;
  const c = r.config ?? r;
  const s = id => document.getElementById(id);
  if (s('rl-rpm'))            s('rl-rpm').value    = c.defaultRpm      ?? 15;
  if (s('rl-window'))         s('rl-window').value = c.windowMs        ?? 60000;
  if (s('rl-cool'))           s('rl-cool').value   = c.cooldownMs      ?? 60000;
  if (s('rl-fd'))             s('rl-fd').value     = c.retryForbidden  ?? 3000;
  if (s('rl-rl'))             s('rl-rl').value     = c.retryRateLimit  ?? 2500;
  if (s('rl-se'))             s('rl-se').value     = c.retryServerError ?? 1000;
  const overrides = s('rl-model-overrides');
  if (overrides) overrides.value = JSON.stringify(c.modelOverrides ?? {}, null, 2);
}

async function loadMigrateFields() {
  const r = await api.getMigrateFields().catch(() => null);
  if (!r) return;

  ['server', 'user'].forEach(scope => {
    const con = document.getElementById(`mig-${scope}-fields`);
    if (!con) return;
    const fields = r[`${scope}Fields`] ?? r[scope] ?? [];
    con.innerHTML = fields.map(f => `
      <label class="cb-row">
        <input type="checkbox" name="mig-${scope}" value="${f}">
        <span>${f}</span>
      </label>`).join('') || '<div class="empty">No fields</div>';
  });
}

// ── Model actions ─────────────────────────────────────────────────────────────
window._setModel = async model => {
  const r = await api.setModel(model).catch(e => ({ error: e.message }));
  if (r?.success) { toastOk(`Model set to ${model}`); loadModels(); }
  else toastErr(r?.error || 'Failed');
};

window._loadModels = loadModels;

window._toggleFlag = async (flag, enabled) => {
  const r = await api.toggleFeature(flag, enabled).catch(e => ({ error: e.message }));
  r?.success ? toastOk(`${flag} ${enabled ? 'enabled' : 'disabled'}`) : toastErr(r?.error || 'Failed');
};

window._saveMigrationConfig = async () => {
  const s  = id => document.getElementById(id)?.value;
  const r  = await api.setMigrationConfig({
    enabled:    s('mc-enable') === 'true',
    batchSize:  Number(s('mc-batch-size')  || 50),
    batchDelay: Number(s('mc-batch-delay') || 100),
  }).catch(e => ({ error: e.message }));
  const res = document.getElementById('mc-result');
  if (res) {
    res.classList.remove('hidden');
    res.className = `result-box ${r?.success ? 'ok' : 'err'}`;
    res.textContent = r?.message || r?.error || (r?.success ? 'Saved' : 'Failed');
  }
  r?.success ? toastOk('Migration config saved') : toastErr(r?.error || 'Failed');
};

window._saveBotConfig = async () => {
  const s  = id => document.getElementById(id)?.value;
  const r  = await api.setBotConfig({
    responseFormat:  s('bc-resp-format'),
    workInDMs:       s('bc-dms') === 'true',
    maxQueuePerUser: Number(s('bc-queue')        || 5),
    keySwitchHold:   Number(s('bc-key-hold')     || 1500),
    ramSuspend:      Number(s('bc-ram')          || 380),
    maxHistoryMsgs:  Number(s('bc-max-msg')      || 50),
    contextBreakMin: Number(s('bc-ctx-break')    || 30),
    gemmaDailyLimit: Number(s('bc-gemma-limit')  || 1500),
    gemmaDefault:    s('bc-gemma-default'),
    gemmaFallback:   s('bc-gemma-fallback'),
  }).catch(e => ({ error: e.message }));
  const res = document.getElementById('bc-result');
  if (res) {
    res.classList.remove('hidden');
    res.className = `result-box ${r?.success ? 'ok' : 'err'}`;
    res.textContent = r?.message || r?.error || (r?.success ? 'Saved' : 'Failed');
  }
  r?.success ? toastOk('Bot config saved') : toastErr(r?.error || 'Failed');
};

window._saveRateLimits = async () => {
  const s = id => document.getElementById(id)?.value;
  let modelOverrides = {};
  try { modelOverrides = JSON.parse(s('rl-model-overrides') || '{}'); } catch { toastErr('Invalid JSON in model overrides'); return; }

  const r = await api.setRateLimits({
    defaultRpm:       Number(s('rl-rpm')    || 15),
    windowMs:         Number(s('rl-window') || 60000),
    cooldownMs:       Number(s('rl-cool')   || 60000),
    retryForbidden:   Number(s('rl-fd')     || 3000),
    retryRateLimit:   Number(s('rl-rl')     || 2500),
    retryServerError: Number(s('rl-se')     || 1000),
    modelOverrides,
  }).catch(e => ({ error: e.message }));
  const res = document.getElementById('rl-result');
  if (res) {
    res.classList.remove('hidden');
    res.className = `result-box ${r?.success ? 'ok' : 'err'}`;
    res.textContent = r?.message || r?.error || (r?.success ? 'Saved' : 'Failed');
  }
  r?.success ? toastOk('Rate limits saved') : toastErr(r?.error || 'Failed');
};

window._selectAllMigFields = (containerId, checked) => {
  document.querySelectorAll(`#${containerId} input[type=checkbox]`).forEach(cb => { cb.checked = checked; });
};

window._runMigration = async scope => {
  const getChecked = s => [...document.querySelectorAll(`#mig-${s}-fields input:checked`)].map(c => c.value);
  const force      = document.getElementById('mig-force')?.checked ?? false;

  const serverFields = scope !== 'users' ? getChecked('server') : [];
  const userFields   = scope !== 'servers' ? getChecked('user') : [];

  const ok = await toastConfirm(`Run migration for ${scope}? This modifies the database.`);
  if (!ok) return;

  const r = await api.runMigration({ scope, serverFields, userFields, force }).catch(e => ({ error: e.message }));
  const res = document.getElementById('mig-result');
  if (res) {
    res.classList.remove('hidden');
    res.className = `result-box ${r?.success ? 'ok' : 'err'}`;
    res.textContent = r?.message || r?.error || JSON.stringify(r, null, 2);
  }
  r?.success ? toastOk('Migration complete') : toastErr(r?.error || 'Migration failed');
};

// ══════════════════════════════════════════════════════════════════════════════
// USERS
// ══════════════════════════════════════════════════════════════════════════════
async function initUsers() {
  loadBlacklist();
}

window._lookupUser = async () => {
  const id  = document.getElementById('user-lookup-id')?.value?.trim();
  const res = document.getElementById('user-lookup-result');
  if (!id || !res) return;

  res.className = 'result-box info';
  res.classList.remove('hidden');
  res.textContent = 'Looking up…';

  const r = await api.fetchUserProfile(id).catch(e => ({ error: e.message }));
  if (r?.error) {
    res.className = 'result-box err'; res.textContent = r.error; return;
  }
  const u = r.user ?? r;
  const s = r.settings ?? {};
  res.className  = 'result-box ok';
  res.textContent = [
    `Username   : ${u.username || '—'}`,
    `Global Name: ${u.globalName || '—'}`,
    `ID         : ${u.id || id}`,
    `Language   : ${s.language || '—'}`,
    `Timezone   : ${s.timezone || '—'}`,
    `Model      : ${s.model || 'default'}`,
    `\n--- Raw ---\n${JSON.stringify(r, null, 2)}`,
  ].join('\n');
};

window._sendDm = async () => {
  const userId  = document.getElementById('dm-user-id')?.value?.trim();
  const message = document.getElementById('dm-message')?.value?.trim();
  const res     = document.getElementById('dm-result');
  if (!userId || !message) { toastErr('Fill in both fields'); return; }

  if (res) { res.className = 'result-box info'; res.classList.remove('hidden'); res.textContent = 'Sending…'; }
  const r = await api.sendDm(userId, message).catch(e => ({ error: e.message }));
  if (res) {
    res.className  = `result-box ${r?.success ? 'ok' : 'err'}`;
    res.textContent = r?.message || r?.error || (r?.success ? 'Sent' : 'Failed');
  }
  r?.success ? toastOk('DM sent') : toastErr(r?.error || 'Failed');
};

window._blacklistUser = async () => {
  const userId  = document.getElementById('bl-user-id')?.value?.trim();
  const guildId = document.getElementById('bl-guild-id')?.value?.trim() || null;
  const res     = document.getElementById('bl-result');
  if (!userId) { toastErr('Enter a user ID'); return; }

  const r = await api.blacklistUser(userId, guildId).catch(e => ({ error: e.message }));
  if (res) {
    res.className  = `result-box ${r?.success ? 'ok' : 'err'}`;
    res.classList.remove('hidden');
    res.textContent = r?.message || r?.error || (r?.success ? 'Blacklisted' : 'Failed');
  }
  r?.success ? toastOk('User blacklisted') : toastErr(r?.error || 'Failed');
};

window._unblacklistUser = async () => {
  const userId  = document.getElementById('bl-user-id')?.value?.trim();
  const guildId = document.getElementById('bl-guild-id')?.value?.trim() || null;
  const res     = document.getElementById('bl-result');
  if (!userId) { toastErr('Enter a user ID'); return; }

  const r = await api.unblacklistUser(userId, guildId).catch(e => ({ error: e.message }));
  if (res) {
    res.className  = `result-box ${r?.success ? 'ok' : 'err'}`;
    res.classList.remove('hidden');
    res.textContent = r?.message || r?.error || (r?.success ? 'Removed from blacklist' : 'Failed');
  }
  r?.success ? toastOk('User unblacklisted') : toastErr(r?.error || 'Failed');
};

window._viewHistory = async () => {
  const id  = document.getElementById('hist-user-id')?.value?.trim();
  const res = document.getElementById('hist-result');
  if (!id || !res) return;

  res.className = 'result-box info'; res.classList.remove('hidden'); res.textContent = 'Loading…';
  const r = await api.getChatHistory(id).catch(e => ({ error: e.message }));
  if (r?.error) { res.className = 'result-box err'; res.textContent = r.error; return; }
  const msgs = Array.isArray(r) ? r : r?.messages ?? [];
  res.className  = 'result-box ok';
  res.textContent = msgs.length
    ? msgs.map(m => `[${m.role || '?'}]: ${(m.content || '').slice(0, 200)}`).join('\n')
    : 'No history';
};

window._clearHistory = async () => {
  const id = document.getElementById('hist-user-id')?.value?.trim() || null;
  const ok = await toastConfirm(id ? `Clear history for ${id}?` : 'Clear ALL histories?');
  if (!ok) return;
  const r = await api.clearHistory(id).catch(e => ({ error: e.message }));
  r?.success ? toastOk('History cleared') : toastErr(r?.error || 'Failed');
};

window._loadHistories = async () => {
  const con = document.getElementById('hist-all');
  if (!con) return;
  con.classList.remove('hidden');
  con.className = 'result-box info'; con.textContent = 'Loading…';
  const r = await api.allHistories().catch(e => ({ error: e.message }));
  if (r?.error) { con.className = 'result-box err'; con.textContent = r.error; return; }
  const list = Array.isArray(r) ? r : r?.histories ?? [];
  con.className  = 'result-box ok';
  con.textContent = list.length
    ? list.map(h => `${h.id} — ${h.messageCount ?? '?'} messages`).join('\n')
    : 'No histories';
};

async function loadBlacklist() {
  const con = document.getElementById('blacklist-content');
  if (!con) return;
  con.innerHTML = '<div class="loading">Loading…</div>';
  const r = await api.getBlacklisted().catch(() => null);
  const users = Array.isArray(r) ? r : r?.users ?? [];
  if (!users.length) { con.innerHTML = '<div class="empty">No blacklisted users</div>'; return; }
  con.innerHTML = users.map(u => `
    <div class="bl-e">
      <div>
        <div class="bl-u mono">${u.userId || u.id}</div>
        <div style="font-size:9px;color:var(--t4);">${u.guildId ? `Guild: ${u.guildId}` : 'Global'}</div>
      </div>
      <div style="display:flex;align-items:center;gap:6px;">
        ${u.reason ? `<span class="bl-g">${u.reason.slice(0,40)}</span>` : ''}
        <button class="btn btn-ghost btn-sm"
                onclick="window._quickUnblacklist('${u.userId||u.id}','${u.guildId||''}')">Remove</button>
      </div>
    </div>`).join('');
}

window._loadBlacklist      = loadBlacklist;
window._purgeBlacklist     = async () => {
  const ok = await toastConfirm('Purge the entire blacklist?');
  if (!ok) return;
  const r = await api.purgeBlacklist().catch(e => ({ error: e.message }));
  r?.success ? (toastOk('Blacklist purged'), loadBlacklist()) : toastErr(r?.error || 'Failed');
};
window._quickUnblacklist = async (uid, gid) => {
  const r = await api.unblacklistUser(uid, gid || null).catch(e => ({ error: e.message }));
  r?.success ? (toastOk('Removed'), loadBlacklist()) : toastErr(r?.error || 'Failed');
};

// ══════════════════════════════════════════════════════════════════════════════
// PRESENCE
// ══════════════════════════════════════════════════════════════════════════════
async function initPresence() {
  const r = await api.getPresence().catch(() => null);
  const p = r?.presence ?? r;
  if (!p) return;

  const s = id => document.getElementById(id);
  if (p.status   && s('pres-status'))   s('pres-status').value   = p.status;
  if (p.activity && s('pres-activity')) s('pres-activity').value = p.activity;
  if (p.type != null && s('pres-type')) s('pres-type').value     = String(p.type);
  updatePresenceDisplay(p);
}

function updatePresenceDisplay(p) {
  const ids = ['presence-cur', 'presence-cur-2'];
  const colors = { online: 'var(--ok)', idle: 'var(--wa)', dnd: 'var(--er)', invisible: 'var(--t4)' };
  const typeLabels = ['Playing','Streaming','Listening to','Watching','','Competing in'];

  ids.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    if (!p || !p.status) { el.innerHTML = '<span style="color:var(--t4);font-size:12px;">No active presence</span>'; return; }
    const color   = colors[p.status]      || 'var(--t4)';
    const actType = typeLabels[p.type ?? 0] || '';
    const actText = p.activity || '';
    el.innerHTML = `
      <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${color};flex-shrink:0;"></span>
      <span style="font-size:12px;color:var(--t2);">${p.status}</span>
      ${actText ? `<span style="font-size:11px;color:var(--t3);">·</span>
                   <span style="font-size:12px;">${actType} ${actText}</span>` : ''}`;
  });
}

window._setPresence = async () => {
  const s      = id => document.getElementById(id)?.value?.trim();
  const status   = s('pres-status')   || 'online';
  const activity = s('pres-activity') || '';
  const type     = Number(s('pres-type') || 0);
  const res      = document.getElementById('pres-result');

  if (res) { res.className = 'result-box info'; res.classList.remove('hidden'); res.textContent = 'Updating…'; }

  const r = await api.setPresence({ status, activity, type }).catch(e => ({ error: e.message }));
  if (res) {
    res.className  = `result-box ${r?.success ? 'ok' : 'err'}`;
    res.textContent = r?.message || r?.error || (r?.success ? 'Updated' : 'Failed');
  }
  if (r?.success) { toastOk('Presence updated'); updatePresenceDisplay({ status, activity, type }); }
  else toastErr(r?.error || 'Failed');
};

window._preset = (status, activity, type) => {
  const s = id => document.getElementById(id);
  if (s('pres-status'))   s('pres-status').value   = status;
  if (s('pres-activity')) s('pres-activity').value = activity;
  if (s('pres-type'))     s('pres-type').value     = type;
  window._setPresence?.();
};

// ══════════════════════════════════════════════════════════════════════════════
// CONFIG EDITOR
// ══════════════════════════════════════════════════════════════════════════════
async function initConfig() {
  await loadRuntimeConfig();
}

async function loadRuntimeConfig() {
  const r = await api.getRuntimeConfig().catch(() => null);
  const c = r?.config ?? r ?? {};
  const s = id => document.getElementById(id);
  if (s('rt-model')) s('rt-model').value = c.modelOverride  || '';
  if (s('rt-color')) s('rt-color').value = c.embedColor     || '';
  const rawEl = s('rt-raw');
  if (rawEl) rawEl.value = JSON.stringify(c, null, 2);
}

window._loadRuntimeConfig = loadRuntimeConfig;

window._saveRuntimeConfig = async () => {
  const model = document.getElementById('rt-model')?.value?.trim() || null;
  const color = document.getElementById('rt-color')?.value?.trim() || null;
  const r = await api.setRuntimeConfig({ modelOverride: model, embedColor: color }).catch(e => ({ error: e.message }));
  const res = document.getElementById('rt-result');
  if (res) { res.classList.remove('hidden'); res.className = `result-box ${r?.success ? 'ok' : 'err'}`; res.textContent = r?.message || r?.error || (r?.success ? 'Saved' : 'Failed'); }
  r?.success ? toastOk('Runtime config saved') : toastErr(r?.error || 'Failed');
};

window._clearRuntimeConfig = async () => {
  const ok = await toastConfirm('Reset runtime config to defaults?');
  if (!ok) return;
  const r = await api.clearRuntimeConfig().catch(e => ({ error: e.message }));
  r?.success ? (toastOk('Config reset'), loadRuntimeConfig()) : toastErr(r?.error || 'Failed');
};

window._saveRuntimeRaw = async () => {
  const raw = document.getElementById('rt-raw')?.value;
  let parsed;
  try { parsed = JSON.parse(raw); } catch { toastErr('Invalid JSON'); return; }
  const r = await api.setRuntimeConfig(parsed).catch(e => ({ error: e.message }));
  r?.success ? toastOk('Saved') : toastErr(r?.error || 'Failed');
};

window._cfgTab = btn => {
  const tab = btn.dataset.tab;
  document.querySelectorAll('.cfg-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  ['runtime','modules','base'].forEach(t => {
    const pane = document.getElementById(`cfg-${t}-pane`);
    if (pane) pane.classList.toggle('hidden', t !== tab);
  });
  if (tab === 'modules' && !document.getElementById('cfg-modules-ta')?.value) window._loadCfg?.('modules');
  if (tab === 'base'    && !document.getElementById('cfg-base-ta')?.value)    window._loadCfg?.('base');
};

window._loadCfg = async type => {
  const fetcher = { modules: api.getModulesConfig, base: api.getBaseConfig }[type];
  if (!fetcher) return;
  const r = await fetcher().catch(() => null);
  const ta   = document.getElementById(`cfg-${type}-ta`);
  const info = document.getElementById(`cfg-${type}-info`);
  if (ta)   ta.value = r?.content || '';
  if (info && r?.lastModified) info.textContent = `Last modified: ${new Date(r.lastModified).toLocaleString()}`;
};

window._saveCfg = async type => {
  const ta  = document.getElementById(`cfg-${type}-ta`);
  const res = document.getElementById(`cfg-${type}-result`);
  if (!ta) return;
  const setter = { modules: api.setModulesConfig, base: api.setBaseConfig }[type];
  if (!setter) return;
  const r = await setter(ta.value).catch(e => ({ error: e.message }));
  if (res) { res.classList.remove('hidden'); res.className = `result-box ${r?.success ? 'ok' : 'err'}`; res.textContent = r?.message || r?.error || (r?.success ? 'Saved' : 'Failed'); }
  r?.success ? toastOk('File saved') : toastErr(r?.error || 'Failed');
};

window._resetCfg = async type => {
  const ok = await toastConfirm(`Restore ${type} config from backup?`);
  if (!ok) return;
  const resetter = { modules: api.resetModulesConfig, base: api.resetBaseConfig }[type];
  if (!resetter) return;
  const r = await resetter().catch(e => ({ error: e.message }));
  r?.success ? (toastOk('Restored from backup'), window._loadCfg?.(type)) : toastErr(r?.error || 'Failed');
};

// ══════════════════════════════════════════════════════════════════════════════
// DATABASE BROWSER
// ══════════════════════════════════════════════════════════════════════════════
let dbCurrentCollection = null;
let dbPage = 1;

async function initDatabase() {
  loadCollections();
}

async function loadCollections() {
  const con = document.getElementById('db-coll-list');
  if (!con) return;
  con.innerHTML = '<div class="loading">Loading…</div>';
  const r = await api.dbCollections().catch(() => null);
  const cols = Array.isArray(r) ? r : r?.collections ?? [];
  if (!cols.length) { con.innerHTML = '<div class="empty">No collections</div>'; return; }

  con.innerHTML = cols.map(c => `
    <div class="db-coll${c.name === dbCurrentCollection ? ' active' : ''}"
         onclick="window._dbSelectCollection('${c.name}')">
      <span class="db-cn">${c.name}</span>
      <span class="db-cc">${c.count != null ? c.count.toLocaleString() : '?'}</span>
    </div>`).join('');
}

window._loadCollections = loadCollections;

window._dbSelectCollection = async name => {
  dbCurrentCollection = name;
  dbPage = 1;
  document.querySelectorAll('.db-coll').forEach(el =>
    el.classList.toggle('active', el.textContent.trim().startsWith(name)),
  );
  const hdr = document.getElementById('db-docs-h');
  if (hdr) hdr.textContent = name;
  document.getElementById('db-docs-search')?.classList.remove('hidden');
  await loadDbDocs();
};

async function loadDbDocs() {
  const con = document.getElementById('db-doc-list');
  const pg  = document.getElementById('db-pg');
  if (!con || !dbCurrentCollection) return;
  con.innerHTML = '<div class="loading">Loading…</div>';

  const r = await api.dbCollection(dbCurrentCollection, dbPage).catch(() => null);
  const docs  = Array.isArray(r) ? r : r?.docs ?? [];
  const total = r?.total ?? docs.length;
  const pages = Math.ceil(total / 50);

  if (!docs.length) { con.innerHTML = '<div class="empty">No documents</div>'; if(pg) pg.innerHTML=''; return; }

  con.innerHTML = docs.map(doc => {
    const id  = doc._id?.toString() || 'unknown';
    const preview = JSON.stringify(doc, null, 2);
    return `
      <div class="db-doc" id="doc-${id}">
        <div class="db-doc-h" onclick="window._dbToggleDoc('${id}')">
          <span class="db-doc-id mono">${id}</span>
          <div class="db-doc-acts">
            <button class="btn btn-ghost btn-sm" onclick="event.stopPropagation();window._dbEditDoc('${id}')">Edit</button>
            <button class="btn btn-danger btn-sm" onclick="event.stopPropagation();window._dbDeleteDoc('${id}')">Delete</button>
          </div>
        </div>
        <div class="db-doc-body hidden" id="doc-body-${id}"><pre>${preview}</pre></div>
      </div>`;
  }).join('');

  if (pg && pages > 1) {
    pg.innerHTML = `
      <button class="btn btn-ghost btn-sm" ${dbPage <= 1 ? 'disabled' : ''} onclick="window._dbPage(${dbPage-1})">‹</button>
      <span style="font-size:11px;color:var(--t3);">${dbPage} / ${pages}</span>
      <button class="btn btn-ghost btn-sm" ${dbPage >= pages ? 'disabled' : ''} onclick="window._dbPage(${dbPage+1})">›</button>`;
  } else if (pg) pg.innerHTML = '';
}

window._dbPage = async n => { dbPage = n; await loadDbDocs(); };

window._dbToggleDoc = id => {
  document.getElementById(`doc-body-${id}`)?.classList.toggle('hidden');
};

window._dbEditDoc = id => {
  const bodyEl = document.getElementById(`doc-body-${id}`);
  if (!bodyEl) return;
  bodyEl.classList.remove('hidden');
  const current = bodyEl.querySelector('pre')?.textContent || '{}';
  bodyEl.innerHTML = `
    <textarea class="db-doc-edit" id="doc-edit-${id}">${current}</textarea>
    <div style="display:flex;gap:5px;padding:6px 10px;background:var(--bg-3);">
      <button class="btn btn-accent btn-sm" onclick="window._dbSaveDoc('${id}')">Save</button>
      <button class="btn btn-ghost btn-sm" onclick="window._dbCancelEdit('${id}')">Cancel</button>
    </div>`;
};

window._dbSaveDoc = async id => {
  const ta = document.getElementById(`doc-edit-${id}`);
  let data;
  try { data = JSON.parse(ta.value); } catch { toastErr('Invalid JSON'); return; }
  const r = await api.dbUpdateDoc(dbCurrentCollection, id, data).catch(e => ({ error: e.message }));
  r?.success ? (toastOk('Document updated'), loadDbDocs()) : toastErr(r?.error || 'Failed');
};

window._dbCancelEdit = id => { loadDbDocs(); };

window._dbDeleteDoc = async id => {
  const ok = await toastConfirm(`Delete document ${id}?`);
  if (!ok) return;
  const r = await api.dbDeleteDoc(dbCurrentCollection, id).catch(e => ({ error: e.message }));
  r?.success ? (toastOk('Deleted'), loadDbDocs()) : toastErr(r?.error || 'Failed');
};

window._dbSearch = query => {
  const q = (query || '').toLowerCase();
  document.querySelectorAll('.db-doc').forEach(el => {
    const id = el.dataset.id || el.id.replace('doc-','');
    el.style.display = !q || id.toLowerCase().includes(q) ? '' : 'none';
  });
};

// ══════════════════════════════════════════════════════════════════════════════
// FILE BROWSER
// ══════════════════════════════════════════════════════════════════════════════
let fbCurrentPath = '';
let fbCurrentFile = null;

async function initFileBrowser() {
  fbNav('');
}

async function fbNav(path) {
  fbCurrentPath = path || '';
  const list = document.getElementById('fb-list');
  if (list) list.innerHTML = '<div class="loading">Loading…</div>';

  renderFbPath(fbCurrentPath);

  const r = await api.files(fbCurrentPath).catch(() => null);
  const entries = Array.isArray(r) ? r : r?.entries ?? [];

  if (!list) return;
  if (!entries.length) { list.innerHTML = '<div class="empty">Empty directory</div>'; return; }

  const sorted = [...entries].sort((a, b) => {
    if (a.type === 'dir' && b.type !== 'dir') return -1;
    if (b.type === 'dir' && a.type !== 'dir') return 1;
    return (a.name || '').localeCompare(b.name || '');
  });

  list.innerHTML = sorted.map(e => {
    const isDir = e.type === 'dir';
    const icon  = isDir
      ? `<svg class="fb-ei" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>`
      : `<svg class="fb-ei" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`;
    const fullPath = fbCurrentPath ? `${fbCurrentPath}/${e.name}` : e.name;
    const onclick  = isDir
      ? `window._fbNav('${fullPath}')`
      : `window._fbOpen('${fullPath}', '${e.name}')`;
    const size = !isDir && e.size != null
      ? `<span class="fb-es">${fmtBytes(e.size)}</span>` : '';

    return `
      <div class="fb-e" onclick="${onclick}">
        ${icon}
        <span class="fb-en">${e.name}</span>
        ${size}
      </div>`;
  }).join('');
}

function renderFbPath(path) {
  const el = document.getElementById('fb-path');
  if (!el) return;
  const parts = path ? path.split('/').filter(Boolean) : [];
  const segs = [
    `<span class="fb-path-seg" onclick="window._fbNav('')" tabindex="0" role="button">root</span>`,
    ...parts.map((p, i) => {
      const partial = parts.slice(0, i + 1).join('/');
      return `<span class="fb-path-sep">/</span>
              <span class="fb-path-seg" onclick="window._fbNav('${partial}')" tabindex="0" role="button">${p}</span>`;
    }),
  ];
  el.innerHTML = segs.join('');
}

async function fbOpen(path, name) {
  fbCurrentFile = path;
  const editor = document.getElementById('fb-editor');
  const noFile = document.getElementById('fb-no-file');
  const ta     = document.getElementById('fb-ta');
  const fn     = document.getElementById('fb-fn');
  if (editor) editor.style.display = 'flex';
  if (noFile) noFile.style.display = 'none';
  if (fn)     fn.textContent = name || path;
  if (ta)     ta.value = 'Loading…';

  const r = await api.files(path).catch(() => null);
  if (ta) ta.value = r?.content ?? r ?? '';
}

window._fbNav    = path => fbNav(path);
window._fbOpen   = (path, name) => fbOpen(path, name);

window._fbSave   = async () => {
  const ta = document.getElementById('fb-ta');
  if (!fbCurrentFile || !ta) return;
  const r = await api.saveFile(fbCurrentFile, ta.value).catch(e => ({ error: e.message }));
  r?.success ? toastOk('File saved') : toastErr(r?.error || 'Failed to save');
};

window._fbDelete = async () => {
  if (!fbCurrentFile) return;
  const ok = await toastConfirm(`Delete ${fbCurrentFile}?`);
  if (!ok) return;
  const r = await api.deleteFile(fbCurrentFile).catch(e => ({ error: e.message }));
  if (r?.success) {
    toastOk('File deleted');
    fbCurrentFile = null;
    const editor = document.getElementById('fb-editor');
    const noFile = document.getElementById('fb-no-file');
    if (editor) editor.style.display = 'none';
    if (noFile) noFile.style.display = 'block';
    fbNav(fbCurrentPath);
  } else {
    toastErr(r?.error || 'Failed to delete');
  }
};

// ══════════════════════════════════════════════════════════════════════════════
// SIDEBAR / TOPBAR GLOBALS
// ══════════════════════════════════════════════════════════════════════════════
window._navigate = id => navigate(id);

window._toggleSidebar = () => {
  const sb = document.getElementById('sidebar');
  const ov = document.getElementById('sb-ov');
  const isOpen = sb?.classList.contains('open');
  sb?.classList.toggle('open', !isOpen);
  ov?.classList.toggle('hidden', isOpen);
};

window._closeSidebar = () => {
  document.getElementById('sidebar')?.classList.remove('open');
  document.getElementById('sb-ov')?.classList.add('hidden');
};

window._logout = async () => {
  await api.authLogout().catch(() => null);
  window.location.reload();
};

// ── Bot quick actions (also used from overview page) ─────────────────────────
window.CMD = {
  restart:       () => window._runCmd ? undefined : api.restart().then(r => r?.success ? toastOk('Restarting…') : toastErr(r?.error)),
  saveState:     () => api.saveState().then(r => r?.success ? toastOk('State saved') : toastErr(r?.error || 'Failed')).catch(e => toastErr(e.message)),
  toggleDebug:   () => api.toggleDebug().then(r => r?.success ? toastOk(r.message || 'Debug toggled') : toastErr(r?.error || 'Failed')).catch(e => toastErr(e.message)),
  reloadCommands:() => api.reloadCommands().then(r => r?.success ? toastOk('Commands reloaded') : toastErr(r?.error || 'Failed')).catch(e => toastErr(e.message)),
  switchApiKey:  () => api.switchApiKey().then(r => r?.success ? (toastOk('Key rotated'), window._switchToKey?.(0)) : toastErr(r?.error || 'Failed')).catch(e => toastErr(e.message)),
};
