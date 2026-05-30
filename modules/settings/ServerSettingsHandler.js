/**
 * @fileoverview Server settings pages (1–5), channel management, and data actions.
 * UI: Dank Memer-inspired — no emojis, toggle buttons, 5-button nav, dynamic model.
 * @module modules/settings/ServerSettingsHandler
 */

import {
  EmbedBuilder, MessageFlags, ButtonBuilder, ButtonStyle,
  ActionRowBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder,
  ChannelSelectMenuBuilder, ChannelType, AttachmentBuilder,
  ModalBuilder, TextInputBuilder, TextInputStyle, PermissionsBitField
} from 'discord.js';
import path from 'path';
import fs   from 'fs/promises';

import {
  state, TEMP_DIR, BOT_CONFIG, DEFAULT_SERVER_SETTINGS
} from '../../managers/BotManager.js';
import * as db    from '../../database.js';
import { Logger } from '../../core/Logger.js';
import { MODELS } from '../config.js';
import { formatModelName } from './UserSettingsHandler.js';

const logger = Logger.get('ServerSettings');
const MATTE  = 0x09090B;

// ============================================================================
// HELPERS
// ============================================================================

function requireManageGuild(interaction) {
  if (!interaction.member?.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
    interaction.reply({
      embeds: [new EmbedBuilder()
        .setColor(MATTE)
        .setTitle('Permission Denied')
        .setDescription('You need the "Manage Server" permission to access server settings.')
      ],
      flags: MessageFlags.Ephemeral,
    }).catch(() => {});
    return false;
  }
  return true;
}

function colorOf(guildId) {
  const raw = state.serverSettings[guildId]?.embedColor;
  if (!raw) return MATTE;
  const n = parseInt(raw.replace('#', ''), 16);
  return isNaN(n) ? MATTE : n;
}

async function persistServer(guildId) {
  try { await db.saveServerSettings(guildId, state.serverSettings[guildId]); }
  catch (err) { logger.error(`Persist server ${guildId}`, err); }
}

async function persistInstructions(id, val) {
  try { await db.saveCustomInstructions(id, val ?? null); }
  catch (err) { logger.error(`Persist instructions ${id}`, err); }
}

async function persistChannelSetting(channelId, type, value) {
  try { await db.saveChannelSetting(channelId, type, value); }
  catch (err) { logger.error(`Persist channel ${channelId}`, err); }
}

async function persistChatHistory(id) {
  try { await db.saveChatHistory(id, state.chatHistories[id] ?? {}); }
  catch (err) { logger.error(`Persist history ${id}`, err); }
}

/** Toggle button — green On / red Off. */
function toggle(customId, isOn) {
  return new ButtonBuilder()
    .setCustomId(customId)
    .setLabel(isOn ? 'On' : 'Off')
    .setStyle(isOn ? ButtonStyle.Success : ButtonStyle.Danger);
}

/** Per-model descriptions. */
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
 * 5-button nav row for server settings (5 pages).
 * « ‹ ↺ › »
 * Each button always has a unique customId — Discord rejects duplicate IDs even on disabled buttons.
 */
function navRow(page) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('server_settings_p1').setLabel('«').setStyle(ButtonStyle.Secondary).setDisabled(page === 1),
    new ButtonBuilder().setCustomId(`s_prev_${page}`).setLabel('‹').setStyle(ButtonStyle.Secondary).setDisabled(page === 1),
    new ButtonBuilder().setCustomId(`s_ref_${page}`).setLabel('↺').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`s_next_${page}`).setLabel('›').setStyle(ButtonStyle.Secondary).setDisabled(page === 5),
    new ButtonBuilder().setCustomId('server_settings_page5').setLabel('»').setStyle(ButtonStyle.Secondary).setDisabled(page === 5)
  );
}

// ============================================================================
// PAGE 1 — Core Preferences
// ============================================================================

export async function showServerSettings(interaction, isUpdate = false) {
  if (!requireManageGuild(interaction)) return;

  const guildId = interaction.guild.id;
  const ss      = state.serverSettings[guildId] || {};
  const model   = ss.selectedModel     || DEFAULT_SERVER_SETTINGS.selectedModel;
  const format  = ss.responseFormat    || DEFAULT_SERVER_SETTINGS.responseFormat;
  const btns    = ss.showActionButtons ?? DEFAULT_SERVER_SETTINGS.showActionButtons;
  const color   = colorOf(guildId);

  const formatBtn = new ButtonBuilder()
    .setCustomId('tog_sf')
    .setLabel(format)
    .setStyle(format === 'Embedded' ? ButtonStyle.Success : ButtonStyle.Danger);

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle('Server Settings')
    .setDescription([
      '**AI Model**',
      `The model used server-wide for generating responses. Currently \`${formatModelName(model)}\`.`,
      '',
      '**Response Format**',
      `Whether responses use plain text or rich embeds. Currently \`${format}\`.`,
      '',
      '**Action Buttons**',
      'Toggle Stop, Save, and Delete buttons appended to responses.',
    ].join('\n'))
    .setFooter({ text: 'Page 1 of 5 · Server Settings' });

  const payload = {
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(buildModelSelect('server_model_select', model)),
      new ActionRowBuilder().addComponents(formatBtn),
      new ActionRowBuilder().addComponents(toggle('tog_sb', btns)),
      navRow(1),
    ],
    flags: MessageFlags.Ephemeral,
  };

  if (isUpdate) await interaction.update(payload);
  else           await interaction.reply(payload);
}

// ============================================================================
// PAGE 2 — Logic & Overrides
// ============================================================================

export async function showServerSettingsPage2(interaction, isUpdate = false) {
  if (!requireManageGuild(interaction)) return;

  const guildId  = interaction.guild.id;
  const ss       = state.serverSettings[guildId] || {};
  const override = ss.overrideUserSettings ?? DEFAULT_SERVER_SETTINGS.overrideUserSettings;
  const contR    = ss.continuousReply      ?? DEFAULT_SERVER_SETTINGS.continuousReply;
  const srvHist  = ss.serverChatHistory    ?? DEFAULT_SERVER_SETTINGS.serverChatHistory;
  const color    = colorOf(guildId);

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle('Server Settings')
    .setDescription([
      '**Override User Settings**',
      'When enabled, server settings take precedence over individual user preferences.',
      '',
      '**Continuous Reply**',
      'When enabled, the bot responds to all messages in authorized channels without requiring a mention.',
      '',
      '**Server-Wide Chat History**',
      'When enabled, all members share a single conversation context rather than individual histories.',
    ].join('\n'))
    .setFooter({ text: 'Page 2 of 5 · Server Settings' });

  const payload = {
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(toggle('tog_so', override)),
      new ActionRowBuilder().addComponents(toggle('tog_sc', contR)),
      new ActionRowBuilder().addComponents(toggle('tog_sh', srvHist)),
      navRow(2),
    ],
    flags: MessageFlags.Ephemeral,
  };

  if (isUpdate) await interaction.update(payload);
  else           await interaction.reply(payload);
}

// ============================================================================
// PAGE 3 — Appearance & Personality
// ============================================================================

export async function showServerSettingsPage3(interaction, isUpdate = false) {
  if (!requireManageGuild(interaction)) return;

  const guildId  = interaction.guild.id;
  const ss       = state.serverSettings[guildId] || {};
  const hasPers  = !!ss.customPersonality;
  const rawColor = ss.embedColor || 'Default';
  const color    = colorOf(guildId);

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle('Server Settings')
    .setDescription([
      '**Embed Color**',
      `The accent color used in all bot embeds for this server. Currently \`${rawColor}\`.`,
      '',
      '**Custom Personality**',
      `Define how the bot communicates across the server. Status: \`${hasPers ? 'Active' : 'Default'}\`.`,
    ].join('\n'))
    .setFooter({ text: 'Page 3 of 5 · Server Settings' });

  const payload = {
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('server_embed_color').setLabel('Edit Color').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('server_custom_personality').setLabel('Set Personality').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('server_remove_personality').setLabel('Reset Personality').setStyle(ButtonStyle.Danger).setDisabled(!hasPers),
      ),
      navRow(3),
    ],
    flags: MessageFlags.Ephemeral,
  };

  if (isUpdate) await interaction.update(payload);
  else           await interaction.reply(payload);
}

// ============================================================================
// PAGE 4 — Channel Management
// ============================================================================

export async function showServerSettingsPage4(interaction, isUpdate = false) {
  if (!requireManageGuild(interaction)) return;

  const guildId       = interaction.guild.id;
  const ss            = state.serverSettings[guildId] || {};
  const allowed       = ss.allowedChannels || [];
  const color         = colorOf(guildId);

  const channelDisplay = allowed.length > 0
    ? allowed.slice(0, 5).map(id => `<#${id}>`).join(', ') +
      (allowed.length > 5 ? ` +${allowed.length - 5} more` : '')
    : 'All channels';

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle('Server Settings')
    .setDescription([
      '**Allowed Channels**',
      `The channels where the bot is permitted to respond. Currently: ${channelDisplay}`,
      '',
      '**Channel-Specific Continuous Mode**',
      'Enable or disable continuous reply in the current channel without changing the global setting.',
    ].join('\n'))
    .setFooter({ text: 'Page 4 of 5 · Server Settings' });

  const payload = {
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('manage_allowed_channels').setLabel('Manage Channels').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('toggle_continuous_reply').setLabel('Toggle Channel Mode').setStyle(ButtonStyle.Secondary),
      ),
      navRow(4),
    ],
    flags: MessageFlags.Ephemeral,
  };

  if (isUpdate) await interaction.update(payload);
  else           await interaction.reply(payload);
}

// ============================================================================
// PAGE 5 — Data Management
// ============================================================================

export async function showServerSettingsPage5(interaction, isUpdate = false) {
  if (!requireManageGuild(interaction)) return;

  const guildId = interaction.guild.id;
  const color   = colorOf(guildId);

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle('Server Settings')
    .setDescription([
      '**Clear Server Memory**',
      'Permanently erases all server-wide conversation history. This cannot be undone.',
      '',
      '**Export Server History**',
      'Downloads the complete server conversation archive as a text file sent to your DMs.',
    ].join('\n'))
    .setFooter({ text: 'Page 5 of 5 · Server Settings' });

  const payload = {
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('clear_server_memory').setLabel('Clear Memory').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('download_server_conversation').setLabel('Export History').setStyle(ButtonStyle.Secondary),
      ),
      navRow(5),
    ],
    flags: MessageFlags.Ephemeral,
  };

  if (isUpdate) await interaction.update(payload);
  else           await interaction.reply(payload);
}

// ============================================================================
// CHANNEL MANAGEMENT MENU
// ============================================================================

export async function showChannelManagementMenu(interaction, isUpdate = false) {
  if (!requireManageGuild(interaction)) return;

  const guildId = interaction.guild.id;
  const ss      = state.serverSettings[guildId] || {};
  const allowed = ss.allowedChannels || [];
  const color   = colorOf(guildId);

  const channelSelect = new ChannelSelectMenuBuilder()
    .setCustomId('channel_manage_select')
    .setPlaceholder('Select authorized channels')
    .setMinValues(0)
    .setMaxValues(25)
    .setChannelTypes([ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildForum]);

  if (allowed.length > 0) {
    const valid = allowed.filter(id => interaction.guild.channels.cache.has(id)).slice(0, 25);
    if (valid.length > 0) channelSelect.setDefaultChannels(valid);
  }

  const currentDisplay = allowed.length > 0
    ? allowed.map(id => `<#${id}>`).join(', ')
    : 'All channels';

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle('Channel Management')
    .setDescription([
      '**Authorized Channels**',
      `Select which channels the bot may respond in. Currently: ${currentDisplay}`,
      '',
      'Leave the selection empty to allow all channels.',
    ].join('\n'))
    .setFooter({ text: 'Page 4 of 5 · Server Settings' });

  const payload = {
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(channelSelect),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('back_to_server_p4').setLabel('‹ Back').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('set_all_channels').setLabel('Allow All Channels').setStyle(ButtonStyle.Success),
      ),
    ],
    flags: MessageFlags.Ephemeral,
  };

  if (isUpdate) await interaction.update(payload);
  else           await interaction.reply(payload);
}

// ============================================================================
// TOGGLE HANDLERS (called from SettingsRouter for new tog_ button IDs)
// ============================================================================

export async function handleToggleServerFormat(interaction) {
  if (!requireManageGuild(interaction)) return;
  const guildId = interaction.guild.id;
  if (!state.serverSettings[guildId]) state.serverSettings[guildId] = {};
  const current = state.serverSettings[guildId].responseFormat || DEFAULT_SERVER_SETTINGS.responseFormat;
  state.serverSettings[guildId].responseFormat = current === 'Normal' ? 'Embedded' : 'Normal';
  await persistServer(guildId);
  await showServerSettings(interaction, true);
}

export async function handleToggleServerButtons(interaction) {
  if (!requireManageGuild(interaction)) return;
  const guildId = interaction.guild.id;
  if (!state.serverSettings[guildId]) state.serverSettings[guildId] = {};
  state.serverSettings[guildId].showActionButtons = !(state.serverSettings[guildId].showActionButtons ?? DEFAULT_SERVER_SETTINGS.showActionButtons);
  await persistServer(guildId);
  await showServerSettings(interaction, true);
}

export async function handleToggleServerOverride(interaction) {
  if (!requireManageGuild(interaction)) return;
  const guildId = interaction.guild.id;
  if (!state.serverSettings[guildId]) state.serverSettings[guildId] = {};
  state.serverSettings[guildId].overrideUserSettings = !(state.serverSettings[guildId].overrideUserSettings ?? DEFAULT_SERVER_SETTINGS.overrideUserSettings);
  await persistServer(guildId);
  await showServerSettingsPage2(interaction, true);
}

export async function handleToggleServerContinuous(interaction) {
  if (!requireManageGuild(interaction)) return;
  const guildId = interaction.guild.id;
  if (!state.serverSettings[guildId]) state.serverSettings[guildId] = {};
  state.serverSettings[guildId].continuousReply = !(state.serverSettings[guildId].continuousReply ?? DEFAULT_SERVER_SETTINGS.continuousReply);
  await persistServer(guildId);
  await showServerSettingsPage2(interaction, true);
}

export async function handleToggleServerHistory(interaction) {
  if (!requireManageGuild(interaction)) return;
  const guildId = interaction.guild.id;
  if (!state.serverSettings[guildId]) state.serverSettings[guildId] = {};
  state.serverSettings[guildId].serverChatHistory = !(state.serverSettings[guildId].serverChatHistory ?? DEFAULT_SERVER_SETTINGS.serverChatHistory);
  await persistServer(guildId);
  await showServerSettingsPage2(interaction, true);
}

// ============================================================================
// SELECT MENU HANDLERS (model select)
// ============================================================================

export async function handleServerModelSelect(interaction) {
  if (!requireManageGuild(interaction)) return;
  const guildId = interaction.guild.id;
  if (!state.serverSettings[guildId]) state.serverSettings[guildId] = {};
  state.serverSettings[guildId].selectedModel = interaction.values[0];
  await persistServer(guildId);
  await showServerSettings(interaction, true);
}

// Legacy select handlers kept for backwards compat with old customIds
export async function handleServerResponseFormat(interaction) {
  if (!requireManageGuild(interaction)) return;
  const guildId = interaction.guild.id;
  if (!state.serverSettings[guildId]) state.serverSettings[guildId] = {};
  state.serverSettings[guildId].responseFormat = interaction.values[0];
  await persistServer(guildId);
  await showServerSettings(interaction, true);
}

export async function handleServerActionButtons(interaction) {
  if (!requireManageGuild(interaction)) return;
  const guildId = interaction.guild.id;
  if (!state.serverSettings[guildId]) state.serverSettings[guildId] = {};
  state.serverSettings[guildId].showActionButtons = interaction.values[0] === 'show';
  await persistServer(guildId);
  await showServerSettings(interaction, true);
}

export async function handleServerContinuousReply(interaction) {
  if (!requireManageGuild(interaction)) return;
  const guildId = interaction.guild.id;
  if (!state.serverSettings[guildId]) state.serverSettings[guildId] = {};
  state.serverSettings[guildId].continuousReply = interaction.values[0] === 'enabled';
  await persistServer(guildId);
  await showServerSettingsPage2(interaction, true);
}

export async function handleServerOverride(interaction) {
  if (!requireManageGuild(interaction)) return;
  const guildId = interaction.guild.id;
  if (!state.serverSettings[guildId]) state.serverSettings[guildId] = {};
  state.serverSettings[guildId].overrideUserSettings = interaction.values[0] === 'enabled';
  await persistServer(guildId);
  await showServerSettingsPage2(interaction, true);
}

export async function handleServerChatHistory(interaction) {
  if (!requireManageGuild(interaction)) return;
  const guildId = interaction.guild.id;
  if (!state.serverSettings[guildId]) state.serverSettings[guildId] = {};
  state.serverSettings[guildId].serverChatHistory = interaction.values[0] === 'enabled';
  await persistServer(guildId);
  await showServerSettingsPage2(interaction, true);
}

export async function handleChannelManageSelect(interaction) {
  if (!requireManageGuild(interaction)) return;
  const guildId = interaction.guild.id;
  if (!state.serverSettings[guildId]) state.serverSettings[guildId] = {};
  state.serverSettings[guildId].allowedChannels = interaction.values;
  await persistServer(guildId);
  await showChannelManagementMenu(interaction, true);
}

export async function handleSetAllChannels(interaction) {
  if (!requireManageGuild(interaction)) return;
  const guildId = interaction.guild.id;
  if (!state.serverSettings[guildId]) state.serverSettings[guildId] = {};
  state.serverSettings[guildId].allowedChannels = [];
  await persistServer(guildId);
  await showChannelManagementMenu(interaction, true);
}

export async function toggleContinuousReplyChannel(interaction) {
  if (!requireManageGuild(interaction)) return;
  const channelId = interaction.channelId;
  if (!state.continuousReplyChannels) state.continuousReplyChannels = {};
  const newValue = !state.continuousReplyChannels[channelId];
  if (newValue) state.continuousReplyChannels[channelId] = true;
  else          delete state.continuousReplyChannels[channelId];
  await persistChannelSetting(channelId, 'continuousReply', newValue || null);
  await interaction.reply({
    embeds: [new EmbedBuilder()
      .setColor(MATTE)
      .setTitle(newValue ? 'Continuous Reply Enabled' : 'Continuous Reply Disabled')
      .setDescription(
        newValue
          ? `Mentions are no longer required in <#${channelId}>.`
          : `Explicit mentions are now required in <#${channelId}>.`
      )
    ],
    flags: MessageFlags.Ephemeral,
  });
}

// ============================================================================
// DATA ACTIONS
// ============================================================================

export async function clearServerMemory(interaction) {
  if (!requireManageGuild(interaction)) return;
  const guildId = interaction.guild.id;
  state.chatHistories[guildId] = {};
  await persistChatHistory(guildId);
  await interaction.reply({
    embeds: [new EmbedBuilder().setColor(MATTE).setTitle('Memory Cleared').setDescription('Server-wide conversation history has been permanently erased.')],
    flags: MessageFlags.Ephemeral,
  });
}

export async function downloadServerConversation(interaction) {
  if (!requireManageGuild(interaction)) return;
  const guildId = interaction.guild.id;
  const ss      = state.serverSettings[guildId] || {};

  if (!ss.serverChatHistory) {
    return interaction.reply({
      embeds: [new EmbedBuilder().setColor(MATTE).setTitle('Feature Disabled').setDescription('Enable server-wide chat history on page 2 first.')],
      flags: MessageFlags.Ephemeral,
    });
  }

  const histObj = state.chatHistories[guildId];
  if (!histObj || !Object.keys(histObj).length) {
    return interaction.reply({
      embeds: [new EmbedBuilder().setColor(MATTE).setTitle('No History').setDescription('There is no conversation history recorded for this server.')],
      flags: MessageFlags.Ephemeral,
    });
  }

  let text = '', count = 0;
  for (const uid of Object.keys(histObj)) {
    for (const entry of histObj[uid]) {
      const role  = entry.role === 'user' ? '[User]' : '[Assistant]';
      const parts = (entry.content || entry.parts || [])
        .filter(p => p.text || p.fileUri || p.fileData)
        .map(p => p.text || '[Media Attached]');
      if (parts.length) { text += `${role}:\n${parts.join('\n')}\n\n`; count++; }
    }
  }

  if (!text || count === 0) {
    return interaction.reply({
      embeds: [new EmbedBuilder().setColor(MATTE).setTitle('Nothing to Export').setDescription('The conversation logs contain no exportable text.')],
      flags: MessageFlags.Ephemeral,
    });
  }

  const safe    = interaction.guild.name.replace(/[^a-z0-9]/gi, '_');
  const header  = `Server Conversation History\nServer: ${interaction.guild.name}\nMessages: ${count}\nExported: ${new Date().toLocaleString()}\n${'─'.repeat(50)}\n\n`;
  const tmpFile = path.join(TEMP_DIR, `srv_conv_${interaction.id}.txt`);
  await fs.writeFile(tmpFile, header + text, 'utf8');

  const { size } = await fs.stat(tmpFile);
  const sizeMB   = size / (1024 * 1024);
  let sent = false, fallback;

  if (sizeMB <= 9.5) {
    try {
      await interaction.user.send({
        content: `Server conversation history — ${interaction.guild.name} (${count} messages)`,
        files:   [new AttachmentBuilder(tmpFile, { name: `${safe}_history.txt` })],
      });
      await interaction.reply({
        embeds: [new EmbedBuilder().setColor(MATTE).setTitle('History Sent').setDescription(`${count} messages exported and sent to your DMs.`)],
        flags:  MessageFlags.Ephemeral,
      });
      sent = true;
    } catch {
      fallback = new EmbedBuilder().setColor(MATTE).setTitle('DM Failed').setDescription('Could not send to DMs. Uploading externally.');
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

export async function showServerPersonalityModal(interaction) {
  if (!requireManageGuild(interaction)) return;
  const existing = (state.serverSettings[interaction.guild.id] || {}).customPersonality || '';
  const input = new TextInputBuilder()
    .setCustomId('personality_input')
    .setLabel('Server personality instructions')
    .setStyle(TextInputStyle.Paragraph)
    .setPlaceholder('Describe how you want the bot to behave across this server...')
    .setMinLength(10)
    .setMaxLength(4000);
  if (existing) input.setValue(existing);
  await interaction.showModal(
    new ModalBuilder()
      .setCustomId('server_personality_modal')
      .setTitle('Server Custom Personality')
      .addComponents(new ActionRowBuilder().addComponents(input))
  );
}

export async function removeServerPersonality(interaction) {
  if (!requireManageGuild(interaction)) return;
  const guildId = interaction.guild.id;
  if (state.serverSettings[guildId]) delete state.serverSettings[guildId].customPersonality;
  if (state.customInstructions?.[guildId]) delete state.customInstructions[guildId];
  await Promise.all([persistServer(guildId), persistInstructions(guildId, null)]);
  await interaction.reply({
    embeds: [new EmbedBuilder().setColor(MATTE).setTitle('Personality Reset').setDescription('The server personality has been restored to default.')],
    flags: MessageFlags.Ephemeral,
  });
}

export async function showServerEmbedColorModal(interaction) {
  if (!requireManageGuild(interaction)) return;
  const existing = (state.serverSettings[interaction.guild.id] || {}).embedColor || '';
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
      .setCustomId('server_embed_color_modal')
      .setTitle('Server Embed Color')
      .addComponents(new ActionRowBuilder().addComponents(input))
  );
}

export { persistServer, persistInstructions };
