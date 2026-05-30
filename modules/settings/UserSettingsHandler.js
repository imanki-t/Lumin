/**
 * @fileoverview User settings pages (1–3) + data actions.
 * UI: Dank Memer-inspired — no emojis, toggle buttons, 5-button nav, dynamic model.
 * @module modules/settings/UserSettingsHandler
 */

import {
  EmbedBuilder, MessageFlags, ButtonBuilder, ButtonStyle,
  ActionRowBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder,
  AttachmentBuilder, ModalBuilder, TextInputBuilder, TextInputStyle
} from 'discord.js';
import path from 'path';
import fs   from 'fs/promises';

import {
  state, getHistory, TEMP_DIR, BOT_CONFIG, DEFAULT_USER_SETTINGS
} from '../../managers/BotManager.js';
import * as db    from '../../database.js';
import { Logger } from '../../core/Logger.js';
import { MODELS } from '../config.js';

const logger     = Logger.get('UserSettings');
const MATTE      = 0x09090B;   // near-black — invisible left stripe in Discord dark mode

// ============================================================================
// SHARED UTILITIES
// ============================================================================

/** Near-black embed color; user's custom color overrides if set. */
function colorOf(userId) {
  const raw = state.userSettings[userId]?.embedColor;
  if (!raw) return MATTE;
  const n = parseInt(raw.replace('#', ''), 16);
  return isNaN(n) ? MATTE : n;
}

/**
 * Format a model key into a readable display name.
 * 'gemini-3.1-flash-lite' → 'Gemini 3.1 Flash Lite'
 * 'gemma-4-26b'           → 'Gemma 4 26B'
 */
export function formatModelName(id) {
  if (!id) return 'None';
  const prefix   = id.startsWith('gemini-') ? 'Gemini'
                 : id.startsWith('gemma-')  ? 'Gemma' : null;
  const stripped = id.replace(/^gemini-/, '').replace(/^gemma-/, '').replace(/-preview$/, '');
  const parts    = stripped
    .split('-')
    .map(p => /^\d/.test(p) ? p.toUpperCase() : p.charAt(0).toUpperCase() + p.slice(1));
  return prefix ? `${prefix} ${parts.join(' ')}` : parts.join(' ');
}

/** Per-model descriptions for the select menu. */
const MODEL_DESC = {
  'gemini-3.1-pro':        'Most capable — agentic tasks',
  'gemini-3.1-flash-lite': 'Fastest and most efficient',
  'gemini-3-flash':        'Frontier-class, lower cost',
  'gemini-3.5-flash':      'Speed and quality balance',
  'gemini-2.5-pro':        'Best reasoning and coding',
  'gemma-4-26b':           'Gemma 4 — 26B active params (MoE)',
  'gemma-4-31b':           'Gemma 4 — 31B dense model',
  'gemma-3-27b':           'Gemma 3 — 27B',
  'gemma-3-12b':           'Gemma 3 — 12B',
  'gemma-3-4b':            'Gemma 3 — 4B',
  'gemma-3-2b':            'Gemma 3 — 2B',
  'gemma-3-1b':            'Gemma 3 — 1B',
};

/** Build the AI model select menu populated dynamically from MODELS. */
function buildModelSelect(customId, currentModel) {
  return new StringSelectMenuBuilder()
    .setCustomId(customId)
    .setPlaceholder('Select AI model')
    .addOptions(
      Object.keys(MODELS).map(key =>
        new StringSelectMenuOptionBuilder()
          .setLabel(formatModelName(key))
          .setDescription(MODEL_DESC[key] ?? key)
          .setValue(key)
          .setDefault(currentModel === key)
      )
    );
}

/**
 * Toggle button: green "On" when active, red "Off" when inactive.
 * Clicking it flips the value via the corresponding button handler.
 */
function toggle(customId, isOn) {
  return new ButtonBuilder()
    .setCustomId(customId)
    .setLabel(isOn ? 'On' : 'Off')
    .setStyle(isOn ? ButtonStyle.Success : ButtonStyle.Danger);
}

/**
 * 5-button navigation row for user settings (3 pages).
 * « ‹ ↺ › »  — first/prev/refresh/next/last
 */
function navRow(page) {
  const first  = page === 1;
  const last   = page === 3;
  const PREV   = { 1: 'user_settings_p1', 2: 'user_settings_p1', 3: 'user_settings_page2' };
  const NEXT   = { 1: 'user_settings_page2', 2: 'user_settings_page3', 3: 'user_settings_page3' };
  const REFR   = { 1: 'user_p1_ref', 2: 'user_p2_ref', 3: 'user_p3_ref' };

  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('user_settings_p1').setLabel('«').setStyle(ButtonStyle.Secondary).setDisabled(first),
    new ButtonBuilder().setCustomId(PREV[page]).setLabel('‹').setStyle(ButtonStyle.Secondary).setDisabled(first),
    new ButtonBuilder().setCustomId(REFR[page]).setLabel('↺').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(NEXT[page]).setLabel('›').setStyle(ButtonStyle.Secondary).setDisabled(last),
    new ButtonBuilder().setCustomId('user_settings_page3').setLabel('»').setStyle(ButtonStyle.Secondary).setDisabled(last)
  );
}

// ============================================================================
// PERSIST HELPERS
// ============================================================================

async function persistUser(userId) {
  try { await db.saveUserSettings(userId, state.userSettings[userId]); }
  catch (err) { logger.error(`Persist user ${userId}`, err); }
}

async function persistInstructions(id, val) {
  try { await db.saveCustomInstructions(id, val ?? null); }
  catch (err) { logger.error(`Persist instructions ${id}`, err); }
}

async function persistChatHistory(id) {
  try { await db.saveChatHistory(id, state.chatHistories[id] ?? {}); }
  catch (err) { logger.error(`Persist history ${id}`, err); }
}

/** Schedule the ephemeral to auto-delete after 5 minutes (only on initial reply). */
function scheduleAutoDelete(interaction, isUpdate) {
  if (isUpdate) return;
  setTimeout(async () => {
    const reply = await interaction.fetchReply().catch(() => null);
    if (reply) await interaction.deleteReply().catch(() => {});
  }, 300_000);
}

// ============================================================================
// MAIN SETTINGS DASHBOARD  (/settings initial reply)
// ============================================================================

export async function showMainSettings(interaction, isUpdate = false) {
  try {
    const userId    = interaction.user.id;
    const guildId   = interaction.guild?.id;
    const canManage = guildId ? interaction.member.permissions.has(0x20n) : false;
    const color     = colorOf(userId);

    const lines = [
      'Adjust your personal preferences below. Server admins can also configure server-wide settings.',
      '',
      '**User Settings**',
      'Response model, format, memory, appearance, and data management.',
    ];
    if (canManage) {
      lines.push('', '**Server Settings**', 'Server-wide behavior, channel controls, and overrides.');
    }

    const embed = new EmbedBuilder()
      .setColor(color)
      .setTitle('Settings')
      .setDescription(lines.join('\n'))
      .setFooter({ text: 'Changes save automatically' });

    const btns = [
      new ButtonBuilder().setCustomId('user_settings').setLabel('User Settings').setStyle(ButtonStyle.Primary),
    ];
    if (canManage) {
      btns.push(new ButtonBuilder().setCustomId('server_settings').setLabel('Server Settings').setStyle(ButtonStyle.Secondary));
    }

    const payload = {
      embeds:     [embed],
      components: [new ActionRowBuilder().addComponents(...btns)],
      flags:      MessageFlags.Ephemeral,
    };

    if (isUpdate) await interaction.update(payload);
    else           await interaction.reply(payload);

    scheduleAutoDelete(interaction, isUpdate);
  } catch (err) {
    logger.error('showMainSettings', err);
  }
}

// ============================================================================
// PAGE 1 — Core Preferences
// ============================================================================

export async function showUserSettings(interaction, isUpdate = false) {
  const userId  = interaction.user.id;
  const us      = state.userSettings[userId] || {};
  const model   = us.selectedModel     || DEFAULT_USER_SETTINGS.selectedModel;
  const format  = us.responseFormat    || DEFAULT_USER_SETTINGS.responseFormat;
  const btns    = us.showActionButtons ?? DEFAULT_USER_SETTINGS.showActionButtons;
  const color   = colorOf(userId);

  // DM user if server override is active (first open only)
  if (interaction.guild?.id && !isUpdate) {
    const ss = state.serverSettings[interaction.guild.id] || {};
    if (ss.overrideUserSettings) {
      interaction.user.send({
        embeds: [new EmbedBuilder()
          .setColor(MATTE)
          .setTitle('Server Override Active')
          .setDescription(
            `Server admins on **${interaction.guild.name}** have locked settings server-wide.\n` +
            'Your personal preferences still apply in DMs and other servers.'
          )
        ],
      }).catch(() => {});
    }
  }

  // Format toggle: label shows current value; clicking flips it
  const formatBtn = new ButtonBuilder()
    .setCustomId('tog_uf')
    .setLabel(format)
    .setStyle(format === 'Embedded' ? ButtonStyle.Success : ButtonStyle.Danger);

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle('User Settings')
    .setDescription([
      '**AI Model**',
      `The model used to generate your responses. Currently set to \`${formatModelName(model)}\`.`,
      '',
      '**Response Format**',
      `Controls whether responses use plain text or rich embeds. Currently \`${format}\`.`,
      '',
      '**Action Buttons**',
      'Toggle Stop, Save, and Delete buttons appended to responses.',
    ].join('\n'))
    .setFooter({ text: 'Page 1 of 3 · User Settings' });

  const payload = {
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(buildModelSelect('user_model_select', model)),
      new ActionRowBuilder().addComponents(formatBtn),
      new ActionRowBuilder().addComponents(toggle('tog_ub', btns)),
      navRow(1),
    ],
    flags: MessageFlags.Ephemeral,
  };

  if (isUpdate) await interaction.update(payload);
  else           await interaction.reply(payload);

  scheduleAutoDelete(interaction, isUpdate);
}

// ============================================================================
// PAGE 2 — Behavior & Appearance
// ============================================================================

export async function showUserSettingsPage2(interaction, isUpdate = false) {
  const userId  = interaction.user.id;
  const us      = state.userSettings[userId] || {};
  const contR   = us.continuousReply     ?? DEFAULT_USER_SETTINGS.continuousReply;
  const crossC  = us.crossContextEnabled ?? DEFAULT_USER_SETTINGS.crossContextEnabled;
  const hasPers = !!us.customPersonality;
  const color   = colorOf(userId);
  const rawColor = us.embedColor || 'Default';

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle('User Settings')
    .setDescription([
      '**Continuous Reply**',
      'When enabled, the bot responds to all your messages without requiring a mention.',
      '',
      '**Cross-Context Memory**',
      'When enabled, the bot searches your conversation history across all servers and DMs.',
      '',
      '**Embed Color**',
      `Set a custom accent color for bot responses. Currently \`${rawColor}\`.`,
      '',
      '**Custom Personality**',
      `Define custom instructions for how the bot communicates with you. Status: \`${hasPers ? 'Active' : 'Default'}\`.`,
    ].join('\n'))
    .setFooter({ text: 'Page 2 of 3 · User Settings' });

  const payload = {
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(toggle('tog_ur', contR)),
      new ActionRowBuilder().addComponents(toggle('tog_ux', crossC)),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('user_embed_color').setLabel('Edit Color').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('user_custom_personality').setLabel('Set Personality').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('user_remove_personality').setLabel('Reset Personality').setStyle(ButtonStyle.Danger).setDisabled(!hasPers),
      ),
      navRow(2),
    ],
    flags: MessageFlags.Ephemeral,
  };

  if (isUpdate) await interaction.update(payload);
  else           await interaction.reply(payload);
}

// ============================================================================
// PAGE 3 — Data Management
// ============================================================================

export async function showUserSettingsPage3(interaction, isUpdate = false) {
  const userId = interaction.user.id;
  const color  = colorOf(userId);

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle('User Settings')
    .setDescription([
      '**Clear Memory**',
      'Permanently erases all conversation history for your account. This cannot be undone.',
      '',
      '**Download History**',
      'Exports your full conversation log as a text file, sent to your DMs.',
    ].join('\n'))
    .setFooter({ text: 'Page 3 of 3 · User Settings' });

  const payload = {
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('clear_user_memory').setLabel('Clear Memory').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('download_user_conversation').setLabel('Download History').setStyle(ButtonStyle.Secondary),
      ),
      navRow(3),
    ],
    flags: MessageFlags.Ephemeral,
  };

  if (isUpdate) await interaction.update(payload);
  else           await interaction.reply(payload);
}

// ============================================================================
// DATA ACTIONS
// ============================================================================

export async function clearUserMemory(interaction) {
  const userId = interaction.user.id;
  state.chatHistories[userId] = {};
  await persistChatHistory(userId);
  await interaction.reply({
    embeds: [new EmbedBuilder().setColor(MATTE).setTitle('Memory Cleared').setDescription('Your conversation history has been permanently erased.')],
    flags: MessageFlags.Ephemeral,
  });
}

export async function downloadUserConversation(interaction) {
  const userId  = interaction.user.id;
  const history = getHistory(userId);

  if (!history?.length) {
    return interaction.reply({
      embeds: [new EmbedBuilder().setColor(MATTE).setTitle('No History').setDescription('You have no conversation history to export.')],
      flags: MessageFlags.Ephemeral,
    });
  }

  const text = history.map(e => {
    const role    = e.role === 'user' ? '[User]' : '[Model]';
    const content = (e.content || e.parts || []).map(c => c.text || '').filter(Boolean).join('\n');
    return `${role}:\n${content}\n\n`;
  }).join('');

  const tmpFile = path.join(TEMP_DIR, `conv_${interaction.id}.txt`);
  await fs.writeFile(tmpFile, text, 'utf8');

  const { size } = await fs.stat(tmpFile);
  const sizeMB   = size / (1024 * 1024);
  let sent = false, fallback;

  if (sizeMB <= 9.5) {
    try {
      await interaction.user.send({
        content: 'Your conversation history:',
        files:   [new AttachmentBuilder(tmpFile, { name: 'conversation_history.txt' })],
      });
      await interaction.reply({
        embeds: [new EmbedBuilder().setColor(MATTE).setTitle('History Sent').setDescription('Your conversation history has been sent to your DMs.')],
        flags:  MessageFlags.Ephemeral,
      });
      sent = true;
    } catch {
      fallback = new EmbedBuilder().setColor(MATTE).setTitle('DM Failed').setDescription('Could not send to your DMs. Uploading externally.');
    }
  } else {
    fallback = new EmbedBuilder().setColor(MATTE).setTitle('File Too Large').setDescription(`History is ${sizeMB.toFixed(2)} MB — uploading externally.`);
  }

  if (!sent) {
    const { uploadText } = await import('../../utils.js');
    const urlText = await uploadText(text);
    const url     = urlText.match(/URL: (.+)/)?.[1] || 'Generation failed.';
    await interaction.reply({
      embeds: [(fallback || new EmbedBuilder().setColor(MATTE).setTitle('History Exported'))
        .addFields({ name: 'Link', value: `[View History](${url})` })],
      flags: MessageFlags.Ephemeral,
    });
  }

  await fs.unlink(tmpFile).catch(() => {});
}

// ============================================================================
// PERSONALITY / COLOR MODALS
// ============================================================================

export async function showUserPersonalityModal(interaction) {
  const existing = (state.userSettings[interaction.user.id] || {}).customPersonality || '';
  const input = new TextInputBuilder()
    .setCustomId('personality_input')
    .setLabel('Custom personality instructions')
    .setStyle(TextInputStyle.Paragraph)
    .setPlaceholder('Describe how you want the bot to behave and communicate...')
    .setMinLength(10)
    .setMaxLength(4000);
  if (existing) input.setValue(existing);
  await interaction.showModal(
    new ModalBuilder()
      .setCustomId('user_personality_modal')
      .setTitle('Custom Personality')
      .addComponents(new ActionRowBuilder().addComponents(input))
  );
}

export async function removeUserPersonality(interaction) {
  const userId = interaction.user.id;
  if (state.userSettings[userId]) delete state.userSettings[userId].customPersonality;
  if (state.customInstructions?.[userId]) delete state.customInstructions[userId];
  await Promise.all([persistUser(userId), persistInstructions(userId, null)]);
  await interaction.reply({
    embeds: [new EmbedBuilder().setColor(MATTE).setTitle('Personality Reset').setDescription('Your custom personality has been removed.')],
    flags: MessageFlags.Ephemeral,
  });
}

export async function showUserEmbedColorModal(interaction) {
  const existing = (state.userSettings[interaction.user.id] || {}).embedColor || '';
  const input = new TextInputBuilder()
    .setCustomId('color_input')
    .setLabel('Hex color code')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('#FF5733')
    .setMinLength(6)
    .setMaxLength(7);
  if (existing) input.setValue(existing);
  await interaction.showModal(
    new ModalBuilder()
      .setCustomId('user_embed_color_modal')
      .setTitle('Embed Color')
      .addComponents(new ActionRowBuilder().addComponents(input))
  );
}

export { persistUser, persistInstructions };
