import { api } from './api.js';
import { toastOk, toastErr, toastConfirm } from './toast.js';

// ── Result renderer ───────────────────────────────────────────────────────────
function setResult(el, data, isErr = false) {
  if (!el) return;
  el.className = `result-box ${isErr ? 'err' : 'ok'}`;
  el.classList.remove('hidden');
  el.textContent = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
}

function clearResult(el) {
  if (!el) return;
  el.className = 'result-box hidden';
  el.textContent = '';
}

// ── Input helpers ─────────────────────────────────────────────────────────────
const val   = id => document.getElementById(id)?.value?.trim() ?? '';
const tag   = (cls, txt) => `<span class="tag ${cls}">${txt}</span>`;
const mono  = txt => `<span style="font-family:var(--fm);font-size:11px;">${txt}</span>`;

// ── Command definitions ───────────────────────────────────────────────────────
// Each entry: { name, desc, fields[], dangerLabel? }
// fields: { id, label, placeholder, type='text' }
const COMMANDS = [
  // ── Presence ────────────────────────────────────────────────────────────────
  {
    name: '/set-presence',
    desc: 'Instantly change the bot\'s Discord status and activity text.',
    fields: [
      { id: 'cmd-pres-status',   label: 'Status',        type: 'select',
        opts: ['online','idle','dnd','invisible'] },
      { id: 'cmd-pres-activity', label: 'Activity Text', placeholder: 'e.g. with 1000 servers' },
      { id: 'cmd-pres-type',     label: 'Activity Type', type: 'select',
        opts: ['0:Playing','1:Streaming','2:Listening to','3:Watching','5:Competing in'] },
    ],
    action: async res => {
      const status   = val('cmd-pres-status');
      const activity = val('cmd-pres-activity');
      const type     = Number(val('cmd-pres-type') || 0);
      const r = await api.setPresence({ status, activity, type }).catch(e => ({ error: e.message }));
      if (r?.success) {
        toastOk('Presence updated');
        setResult(res, r.message || 'Done');
      } else {
        toastErr(r?.error || 'Failed');
        setResult(res, r?.error || 'Failed', true);
      }
    },
  },

  // ── Model ────────────────────────────────────────────────────────────────────
  {
    name: '/set-model',
    desc: 'Switch the active AI model for all new conversations.',
    fields: [
      { id: 'cmd-model', label: 'Model ID', placeholder: 'e.g. gemini-2.5-flash-preview-04-17' },
    ],
    action: async res => {
      const model = val('cmd-model');
      if (!model) { toastErr('Enter a model ID'); return; }
      const r = await api.setModel(model).catch(e => ({ error: e.message }));
      if (r?.success) { toastOk('Model updated'); setResult(res, r.message || model); }
      else { toastErr(r?.error || 'Failed'); setResult(res, r?.error, true); }
    },
  },

  // ── Embed colour ─────────────────────────────────────────────────────────────
  {
    name: '/set-embed-color',
    desc: 'Change the global or per-guild embed accent colour.',
    fields: [
      { id: 'cmd-color',    label: 'Hex Color',       placeholder: '#8b5cf6' },
      { id: 'cmd-color-gid',label: 'Guild ID (opt.)', placeholder: 'Leave blank for global' },
    ],
    action: async res => {
      const color   = val('cmd-color');
      const guildId = val('cmd-color-gid') || null;
      if (!color) { toastErr('Enter a colour'); return; }
      const r = await api.setEmbedColor(color, guildId).catch(e => ({ error: e.message }));
      if (r?.success) { toastOk('Colour set'); setResult(res, r.message || 'Done'); }
      else { toastErr(r?.error || 'Failed'); setResult(res, r?.error, true); }
    },
  },

  // ── Send DM ───────────────────────────────────────────────────────────────────
  {
    name: '/send-dm',
    desc: 'DM a user directly from the bot.',
    fields: [
      { id: 'cmd-dm-uid', label: 'User ID or Username', placeholder: '123456789' },
      { id: 'cmd-dm-msg', label: 'Message',             placeholder: 'Your message…', type: 'textarea' },
    ],
    action: async res => {
      const userId  = val('cmd-dm-uid');
      const message = val('cmd-dm-msg');
      if (!userId || !message) { toastErr('Fill in both fields'); return; }
      const r = await api.sendDm(userId, message).catch(e => ({ error: e.message }));
      if (r?.success) { toastOk('DM sent'); setResult(res, r.message || 'Sent'); }
      else { toastErr(r?.error || 'Failed'); setResult(res, r?.error, true); }
    },
  },

  // ── Send to channel ───────────────────────────────────────────────────────────
  {
    name: '/send-channel',
    desc: 'Send a message to any channel the bot has access to.',
    fields: [
      { id: 'cmd-chan-id',  label: 'Channel ID', placeholder: '123456789' },
      { id: 'cmd-chan-msg', label: 'Message',    placeholder: 'Your message…', type: 'textarea' },
    ],
    action: async res => {
      const channelId = val('cmd-chan-id');
      const msg       = val('cmd-chan-msg');
      if (!channelId || !msg) { toastErr('Fill in both fields'); return; }
      const r = await api.sendChannel(channelId, msg).catch(e => ({ error: e.message }));
      if (r?.success) { toastOk('Message sent'); setResult(res, r.message || 'Sent'); }
      else { toastErr(r?.error || 'Failed'); setResult(res, r?.error, true); }
    },
  },

  // ── User profile ──────────────────────────────────────────────────────────────
  {
    name: '/user-profile',
    desc: 'Fetch full profile, settings, and stats for any user.',
    fields: [
      { id: 'cmd-prof-uid', label: 'User ID or Username', placeholder: '123456789' },
    ],
    action: async res => {
      const userId = val('cmd-prof-uid');
      if (!userId) { toastErr('Enter a user ID'); return; }
      const r = await api.fetchUserProfile(userId).catch(e => ({ error: e.message }));
      if (r?.user || r?.settings) {
        const u = r.user || {};
        const s = r.settings || {};
        setResult(res, `User: ${u.username || '—'} (${u.id || userId})\n` +
          `Language: ${s.language || '—'}  ·  Timezone: ${s.timezone || '—'}\n` +
          `Model Override: ${s.model || 'none'}\n\n` +
          JSON.stringify({ user: u, settings: s }, null, 2));
      } else {
        toastErr(r?.error || 'Not found'); setResult(res, r?.error || 'Not found', true);
      }
    },
  },

  // ── Reset user settings ───────────────────────────────────────────────────────
  {
    name: '/reset-user-settings',
    desc: 'Reset all per-user settings to server defaults.',
    dangerLabel: 'Reset Settings',
    fields: [
      { id: 'cmd-rst-uid', label: 'User ID or Username', placeholder: '123456789' },
    ],
    action: async res => {
      const userId = val('cmd-rst-uid');
      if (!userId) { toastErr('Enter a user ID'); return; }
      const ok = await toastConfirm(`Reset all settings for user ${userId}?`);
      if (!ok) return;
      const r = await api.resetUserSettings(userId).catch(e => ({ error: e.message }));
      if (r?.success) { toastOk('Settings reset'); setResult(res, r.message || 'Done'); }
      else { toastErr(r?.error || 'Failed'); setResult(res, r?.error, true); }
    },
  },

  // ── Clear chat history ────────────────────────────────────────────────────────
  {
    name: '/clear-history',
    desc: 'Wipe the message history for a user/channel, or all histories at once.',
    dangerLabel: 'Clear History',
    fields: [
      { id: 'cmd-ch-id', label: 'User or Channel ID (blank = all)', placeholder: 'Leave blank to clear all' },
    ],
    action: async res => {
      const id = val('cmd-ch-id') || null;
      const label = id ? `history for ${id}` : 'ALL chat histories';
      const ok = await toastConfirm(`Clear ${label}? This cannot be undone.`);
      if (!ok) return;
      const r = await api.clearHistory(id).catch(e => ({ error: e.message }));
      if (r?.success) { toastOk(`Cleared ${label}`); setResult(res, r.message || 'Done'); }
      else { toastErr(r?.error || 'Failed'); setResult(res, r?.error, true); }
    },
  },

  // ── Delete user memory ────────────────────────────────────────────────────────
  {
    name: '/delete-memory',
    desc: 'Permanently delete all stored facts for a user.',
    dangerLabel: 'Delete Memory',
    fields: [
      { id: 'cmd-mem-uid', label: 'User ID', placeholder: '123456789' },
    ],
    action: async res => {
      const userId = val('cmd-mem-uid');
      if (!userId) { toastErr('Enter a user ID'); return; }
      const ok = await toastConfirm(`Delete all memory for user ${userId}?`);
      if (!ok) return;
      const r = await api.deleteMemory(userId).catch(e => ({ error: e.message }));
      if (r?.success) { toastOk('Memory deleted'); setResult(res, r.message || 'Done'); }
      else { toastErr(r?.error || 'Failed'); setResult(res, r?.error, true); }
    },
  },

  // ── DM all owners ────────────────────────────────────────────────────────────
  {
    name: '/dm-all-owners',
    desc: 'Send a direct message to every server owner.',
    dangerLabel: 'Send to All Owners',
    fields: [
      { id: 'cmd-owners-msg', label: 'Message', placeholder: 'Message to send…', type: 'textarea' },
    ],
    action: async res => {
      const message = val('cmd-owners-msg');
      if (!message) { toastErr('Enter a message'); return; }
      const ok = await toastConfirm(`Send to ALL server owners? This cannot be undone.`);
      if (!ok) return;
      const r = await api.dmAllOwners(message).catch(e => ({ error: e.message }));
      if (r?.success) { toastOk(`Sent to ${r.count ?? '?'} owners`); setResult(res, r.message || 'Done'); }
      else { toastErr(r?.error || 'Failed'); setResult(res, r?.error, true); }
    },
  },

  // ── Guild info ────────────────────────────────────────────────────────────────
  {
    name: '/guild-info',
    desc: 'Fetch detailed information about a specific guild.',
    fields: [
      { id: 'cmd-gi-id', label: 'Guild ID', placeholder: '123456789' },
    ],
    action: async res => {
      const guildId = val('cmd-gi-id');
      if (!guildId) { toastErr('Enter a guild ID'); return; }
      const r = await api.getGuildInfo(guildId).catch(e => ({ error: e.message }));
      if (r?.guild || r?.id) {
        setResult(res, JSON.stringify(r, null, 2));
      } else {
        toastErr(r?.error || 'Not found'); setResult(res, r?.error || 'Not found', true);
      }
    },
  },

  // ── Kick member ──────────────────────────────────────────────────────────────
  {
    name: '/kick-member',
    desc: 'Kick a user from a guild.',
    dangerLabel: 'Kick',
    fields: [
      { id: 'cmd-kick-gid', label: 'Guild ID', placeholder: '123456789' },
      { id: 'cmd-kick-uid', label: 'User ID',  placeholder: '123456789' },
      { id: 'cmd-kick-rsn', label: 'Reason',   placeholder: 'Optional reason' },
    ],
    action: async res => {
      const guildId = val('cmd-kick-gid');
      const userId  = val('cmd-kick-uid');
      const reason  = val('cmd-kick-rsn') || 'No reason provided';
      if (!guildId || !userId) { toastErr('Guild ID and User ID are required'); return; }
      const ok = await toastConfirm(`Kick user ${userId} from guild ${guildId}?`);
      if (!ok) return;
      const r = await api.kickMember(guildId, userId, reason).catch(e => ({ error: e.message }));
      if (r?.success) { toastOk('Member kicked'); setResult(res, r.message || 'Done'); }
      else { toastErr(r?.error || 'Failed'); setResult(res, r?.error, true); }
    },
  },

  // ── Ban member ───────────────────────────────────────────────────────────────
  {
    name: '/ban-member',
    desc: 'Permanently ban a user from a guild.',
    dangerLabel: 'Ban',
    fields: [
      { id: 'cmd-ban-gid', label: 'Guild ID', placeholder: '123456789' },
      { id: 'cmd-ban-uid', label: 'User ID',  placeholder: '123456789' },
      { id: 'cmd-ban-rsn', label: 'Reason',   placeholder: 'Optional reason' },
    ],
    action: async res => {
      const guildId = val('cmd-ban-gid');
      const userId  = val('cmd-ban-uid');
      const reason  = val('cmd-ban-rsn') || 'No reason provided';
      if (!guildId || !userId) { toastErr('Guild ID and User ID are required'); return; }
      const ok = await toastConfirm(`Ban user ${userId} from guild ${guildId}? This cannot be undone.`);
      if (!ok) return;
      const r = await api.banMember(guildId, userId, reason).catch(e => ({ error: e.message }));
      if (r?.success) { toastOk('Member banned'); setResult(res, r.message || 'Done'); }
      else { toastErr(r?.error || 'Failed'); setResult(res, r?.error, true); }
    },
  },

  // ── Save state ───────────────────────────────────────────────────────────────
  {
    name: '/save-state',
    desc: 'Flush all in-memory state to MongoDB immediately.',
    fields: [],
    action: async res => {
      const r = await api.saveState().catch(e => ({ error: e.message }));
      if (r?.success) { toastOk('State saved'); setResult(res, r.message || 'Done'); }
      else { toastErr(r?.error || 'Failed'); setResult(res, r?.error, true); }
    },
  },

  // ── Toggle debug ─────────────────────────────────────────────────────────────
  {
    name: '/toggle-debug',
    desc: 'Toggle verbose debug logging in the bot process.',
    fields: [],
    action: async res => {
      const r = await api.toggleDebug().catch(e => ({ error: e.message }));
      if (r?.success) { toastOk(r.message || 'Debug toggled'); setResult(res, r.message || 'Done'); }
      else { toastErr(r?.error || 'Failed'); setResult(res, r?.error, true); }
    },
  },

  // ── Reload commands ───────────────────────────────────────────────────────────
  {
    name: '/reload-commands',
    desc: 'Re-register all slash commands with Discord without restarting.',
    fields: [],
    action: async res => {
      const r = await api.reloadCommands().catch(e => ({ error: e.message }));
      if (r?.success) { toastOk('Commands reloaded'); setResult(res, r.message || 'Done'); }
      else { toastErr(r?.error || 'Failed'); setResult(res, r?.error, true); }
    },
  },

  // ── Restart ───────────────────────────────────────────────────────────────────
  {
    name: '/restart',
    desc: 'Gracefully restart the bot process. You will be disconnected briefly.',
    dangerLabel: 'Restart Bot',
    fields: [],
    action: async res => {
      const ok = await toastConfirm('Restart the bot? All terminals will disconnect.');
      if (!ok) return;
      const r = await api.restart().catch(e => ({ error: e.message }));
      if (r?.success) { toastOk('Restarting…'); setResult(res, r.message || 'Restarting…'); }
      else { toastErr(r?.error || 'Failed'); setResult(res, r?.error, true); }
    },
  },

  // ── Switch API key ────────────────────────────────────────────────────────────
  {
    name: '/switch-api-key',
    desc: 'Rotate to the next available Gemini API key in the rotation pool.',
    fields: [],
    action: async res => {
      const r = await api.switchApiKey().catch(e => ({ error: e.message }));
      if (r?.success) { toastOk('Key rotated'); setResult(res, r.message || 'Done'); }
      else { toastErr(r?.error || 'Failed'); setResult(res, r?.error, true); }
    },
  },

  // ── Clear all usage ────────────────────────────────────────────────────────────
  {
    name: '/clear-all-usage',
    desc: 'Reset all per-command usage counters (image, summary, quote, etc.).',
    dangerLabel: 'Clear All Usage',
    fields: [],
    action: async res => {
      const ok = await toastConfirm('Reset ALL usage counters?');
      if (!ok) return;
      const r = await api.clearAllUsage().catch(e => ({ error: e.message }));
      if (r?.success) { toastOk('Usage cleared'); setResult(res, r.message || 'Done'); }
      else { toastErr(r?.error || 'Failed'); setResult(res, r?.error, true); }
    },
  },
];

// ── Build command cards ───────────────────────────────────────────────────────
export function initCommands() {
  const grid = document.getElementById('cmd-grid');
  if (!grid || grid.dataset.built) return;
  grid.dataset.built = '1';

  const cards = COMMANDS.map((cmd, i) => {
    const resultId = `cmd-res-${i}`;
    const isDanger = !!cmd.dangerLabel;

    const fieldsHtml = cmd.fields.map(f => {
      if (f.type === 'select') {
        const opts = (f.opts || []).map(o => {
          const [v, l] = o.includes(':') ? o.split(':') : [o, o];
          return `<option value="${v}">${l}</option>`;
        }).join('');
        return `<div class="form-g" style="margin-bottom:7px">
          <label class="form-l" for="${f.id}">${f.label}</label>
          <select class="form-sel" id="${f.id}">${opts}</select>
        </div>`;
      }
      if (f.type === 'textarea') {
        return `<div class="form-g" style="margin-bottom:7px">
          <label class="form-l" for="${f.id}">${f.label}</label>
          <textarea class="form-ta" id="${f.id}" rows="3"
            placeholder="${f.placeholder || ''}" style="font-size:12px;"></textarea>
        </div>`;
      }
      return `<div class="form-g" style="margin-bottom:7px">
        <label class="form-l" for="${f.id}">${f.label}</label>
        <input class="form-i" id="${f.id}" placeholder="${f.placeholder || ''}">
      </div>`;
    }).join('');

    return `
      <div class="cmd-card">
        <div class="cmd-name">${cmd.name}</div>
        <div class="cmd-desc">${cmd.desc}</div>
        ${fieldsHtml}
        <button class="cmd-btn${isDanger ? ' d' : ''}"
                data-cmd="${i}"
                onclick="window._runCmd(${i}, '${resultId}')">
          ${cmd.dangerLabel || 'Run'}
        </button>
        <div id="${resultId}" class="result-box hidden" style="margin-top:8px;font-size:11px;"></div>
      </div>`;
  });

  grid.innerHTML = cards.join('');
}

// ── Runner ────────────────────────────────────────────────────────────────────
window._runCmd = async (idx, resultId) => {
  const cmd = COMMANDS[idx];
  if (!cmd) return;
  const resEl = document.getElementById(resultId);
  clearResult(resEl);
  await cmd.action(resEl);
};
