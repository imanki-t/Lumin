/**
 * @fileoverview Modal submissions, inline toggle handlers, model select handlers,
 *               download-message, and delete-message. All leaf handlers — no page renders.
 * @module modules/settings/ActionHandlers
 */

import {
  EmbedBuilder, MessageFlags, AttachmentBuilder, ChannelType
} from 'discord.js';
import path from 'path';
import fs   from 'fs/promises';

import { state, TEMP_DIR, BOT_CONFIG } from '../../managers/BotManager.js';
import * as db    from '../../database.js';
import { Logger } from '../../core/Logger.js';
import { DEFAULT_USER_SETTINGS } from '../../managers/BotManager.js';
import { MODELS } from '../config.js';

import {
  showUserSettings,
  showUserSettingsPage2,
  persistUser,
  persistInstructions,
  formatModelName,
} from './UserSettingsHandler.js';

import {
  showServerSettings,
  showServerSettingsPage2,
  persistServer,
} from './ServerSettingsHandler.js';

const logger    = Logger.get('ActionHandlers');
const MATTE     = 0x09090B;
const HEX_RE    = /^#?([0-9A-Fa-f]{6})$/;

function parseHex(raw) {
  const t = raw.trim();
  const m = t.match(HEX_RE);
  return m ? (t.startsWith('#') ? t : `#${t}`) : null;
}

// ============================================================================
// USER INLINE TOGGLES  (tog_ buttons on UserSettings pages)
// ============================================================================

/** Toggle response format Normal ↔ Embedded */
export async function handleUserToggleFormat(interaction) {
  const userId = interaction.user.id;
  if (!state.userSettings[userId]) state.userSettings[userId] = {};
  const current = state.userSettings[userId].responseFormat || DEFAULT_USER_SETTINGS.responseFormat;
  state.userSettings[userId].responseFormat = current === 'Normal' ? 'Embedded' : 'Normal';
  await persistUser(userId);
  await showUserSettings(interaction, true);
}

/** Toggle show action buttons */
export async function handleUserToggleButtons(interaction) {
  const userId = interaction.user.id;
  if (!state.userSettings[userId]) state.userSettings[userId] = {};
  state.userSettings[userId].showActionButtons = !(state.userSettings[userId].showActionButtons ?? DEFAULT_USER_SETTINGS.showActionButtons);
  await persistUser(userId);
  await showUserSettings(interaction, true);
}

/** Toggle continuous reply */
export async function handleUserToggleContinuous(interaction) {
  const userId = interaction.user.id;
  if (!state.userSettings[userId]) state.userSettings[userId] = {};
  state.userSettings[userId].continuousReply = !(state.userSettings[userId].continuousReply ?? DEFAULT_USER_SETTINGS.continuousReply);
  await persistUser(userId);
  await showUserSettingsPage2(interaction, true);
}

/** Toggle cross-context memory */
export async function handleUserToggleCrossContext(interaction) {
  const userId = interaction.user.id;
  if (!state.userSettings[userId]) state.userSettings[userId] = {};
  state.userSettings[userId].crossContextEnabled = !(state.userSettings[userId].crossContextEnabled ?? DEFAULT_USER_SETTINGS.crossContextEnabled);
  await persistUser(userId);
  await showUserSettingsPage2(interaction, true);
}

// ============================================================================
// USER MODEL SELECT
// ============================================================================

export async function handleUserModelSelect(interaction) {
  const userId = interaction.user.id;
  const chosen = interaction.values[0];
  if (!MODELS[chosen]) {
    return interaction.reply({
      embeds: [new EmbedBuilder().setColor(MATTE).setTitle('Invalid Model').setDescription(`\`${chosen}\` is not a recognised model.`)],
      flags: MessageFlags.Ephemeral,
    });
  }
  if (!state.userSettings[userId]) state.userSettings[userId] = {};
  state.userSettings[userId].selectedModel = chosen;
  await persistUser(userId);
  await showUserSettings(interaction, true);
}

// ============================================================================
// LEGACY SELECT HANDLERS (old customIds — kept for any in-flight interactions)
// ============================================================================

export async function handleUserResponseFormat(interaction) {
  const userId = interaction.user.id;
  if (!state.userSettings[userId]) state.userSettings[userId] = {};
  state.userSettings[userId].responseFormat = interaction.values[0];
  await persistUser(userId);
  await showUserSettings(interaction, true);
}

export async function handleUserActionButtons(interaction) {
  const userId = interaction.user.id;
  if (!state.userSettings[userId]) state.userSettings[userId] = {};
  state.userSettings[userId].showActionButtons = interaction.values[0] === 'show';
  await persistUser(userId);
  await showUserSettings(interaction, true);
}

export async function handleUserContinuousReply(interaction) {
  const userId = interaction.user.id;
  if (!state.userSettings[userId]) state.userSettings[userId] = {};
  state.userSettings[userId].continuousReply = interaction.values[0] === 'enabled';
  await persistUser(userId);
  await showUserSettingsPage2(interaction, true);
}

export async function handleUserCrossContext(interaction) {
  const userId = interaction.user.id;
  if (!state.userSettings[userId]) state.userSettings[userId] = {};
  state.userSettings[userId].crossContextEnabled = interaction.values[0] === 'enabled';
  await persistUser(userId);
  await showUserSettingsPage2(interaction, true);
}

// ============================================================================
// MODAL SUBMIT HANDLERS
// ============================================================================

export async function handleUserPersonalityModal(interaction) {
  const userId = interaction.user.id;
  try {
    const input = interaction.fields.getTextInputValue('personality_input');
    if (!state.userSettings[userId]) state.userSettings[userId] = {};
    state.userSettings[userId].customPersonality = input.trim();
    await persistUser(userId);
    await interaction.reply({
      embeds: [new EmbedBuilder().setColor(MATTE).setTitle('Personality Saved').setDescription('Your custom personality instructions have been saved.')],
      flags: MessageFlags.Ephemeral,
    });
  } catch (err) { logger.error('handleUserPersonalityModal', err); }
}

export async function handleServerPersonalityModal(interaction) {
  if (!interaction.member.permissions.has(0x20n)) {
    return interaction.reply({
      embeds: [new EmbedBuilder().setColor(MATTE).setTitle('Permission Denied').setDescription('You need "Manage Server" to change the server personality.')],
      flags: MessageFlags.Ephemeral,
    });
  }
  const guildId = interaction.guild?.id;
  try {
    const input = interaction.fields.getTextInputValue('personality_input');
    if (!state.serverSettings[guildId]) state.serverSettings[guildId] = {};
    state.serverSettings[guildId].customPersonality = input.trim();
    await persistServer(guildId);
    await interaction.reply({
      embeds: [new EmbedBuilder().setColor(MATTE).setTitle('Personality Saved').setDescription('Server custom personality instructions have been saved.')],
      flags: MessageFlags.Ephemeral,
    });
  } catch (err) { logger.error('handleServerPersonalityModal', err); }
}

export async function handleUserEmbedColorModal(interaction) {
  const userId = interaction.user.id;
  try {
    const raw = interaction.fields.getTextInputValue('color_input');
    const hex = parseHex(raw);
    if (!hex) {
      return interaction.reply({
        embeds: [new EmbedBuilder().setColor(MATTE).setTitle('Invalid Color').setDescription('Please provide a valid hex code, e.g. `#FF5733`.')],
        flags: MessageFlags.Ephemeral,
      });
    }
    if (!state.userSettings[userId]) state.userSettings[userId] = {};
    state.userSettings[userId].embedColor = hex;
    await persistUser(userId);
    await interaction.reply({
      embeds: [new EmbedBuilder().setColor(parseInt(hex.replace('#',''), 16)).setTitle('Color Updated').setDescription(`Embed color set to \`${hex}\`.`)],
      flags: MessageFlags.Ephemeral,
    });
  } catch (err) { logger.error('handleUserEmbedColorModal', err); }
}

export async function handleServerEmbedColorModal(interaction) {
  if (!interaction.member.permissions.has(0x20n)) {
    return interaction.reply({
      embeds: [new EmbedBuilder().setColor(MATTE).setTitle('Permission Denied').setDescription('You need "Manage Server" to change the embed color.')],
      flags: MessageFlags.Ephemeral,
    });
  }
  const guildId = interaction.guild?.id;
  try {
    const raw = interaction.fields.getTextInputValue('color_input');
    const hex = parseHex(raw);
    if (!hex) {
      return interaction.reply({
        embeds: [new EmbedBuilder().setColor(MATTE).setTitle('Invalid Color').setDescription('Please provide a valid hex code, e.g. `#FF5733`.')],
        flags: MessageFlags.Ephemeral,
      });
    }
    if (!state.serverSettings[guildId]) state.serverSettings[guildId] = {};
    state.serverSettings[guildId].embedColor = hex;
    await persistServer(guildId);
    await interaction.reply({
      embeds: [new EmbedBuilder().setColor(parseInt(hex.replace('#',''), 16)).setTitle('Color Updated').setDescription(`Server embed color set to \`${hex}\`.`)],
      flags: MessageFlags.Ephemeral,
    });
  } catch (err) { logger.error('handleServerEmbedColorModal', err); }
}

// ============================================================================
// REFRESH (↺) HANDLERS — just re-render current page
// ============================================================================

export async function handleRefreshUserP1(interaction) { await showUserSettings(interaction, true); }
export async function handleRefreshUserP2(interaction) {
  const { showUserSettingsPage2 } = await import('./UserSettingsHandler.js');
  await showUserSettingsPage2(interaction, true);
}
export async function handleRefreshUserP3(interaction) {
  const { showUserSettingsPage3 } = await import('./UserSettingsHandler.js');
  await showUserSettingsPage3(interaction, true);
}
export async function handleRefreshServerP1(interaction) { await showServerSettings(interaction, true); }
export async function handleRefreshServerP2(interaction) { await showServerSettingsPage2(interaction, true); }
export async function handleRefreshServerP3(interaction) {
  const { showServerSettingsPage3 } = await import('./ServerSettingsHandler.js');
  await showServerSettingsPage3(interaction, true);
}
export async function handleRefreshServerP4(interaction) {
  const { showServerSettingsPage4 } = await import('./ServerSettingsHandler.js');
  await showServerSettingsPage4(interaction, true);
}
export async function handleRefreshServerP5(interaction) {
  const { showServerSettingsPage5 } = await import('./ServerSettingsHandler.js');
  await showServerSettingsPage5(interaction, true);
}

// ============================================================================
// DOWNLOAD MESSAGE
// ============================================================================

export async function downloadMessage(interaction) {
  const message   = interaction.message;
  const textContent = message.content || message.embeds?.[0]?.description;

  if (!textContent) {
    return interaction.reply({
      embeds: [new EmbedBuilder().setColor(MATTE).setTitle('Empty Message').setDescription('There is no content to download.')],
      flags: MessageFlags.Ephemeral,
    });
  }

  const filePath   = path.join(TEMP_DIR, `msg_${interaction.id}.txt`);
  await fs.writeFile(filePath, textContent, 'utf8');
  const attachment = new AttachmentBuilder(filePath, { name: 'message_content.txt' });
  const baseEmbed  = new EmbedBuilder().setColor(MATTE).setTitle('Message Saved').setDescription('Content prepared for download.');

  let response;
  if (interaction.channel.type === ChannelType.DM) {
    await interaction.reply({ embeds: [baseEmbed], files: [attachment] });
    response = await interaction.fetchReply();
  } else {
    try {
      await interaction.user.send({ embeds: [baseEmbed], files: [attachment] });
      await interaction.reply({
        embeds: [new EmbedBuilder().setColor(MATTE).setTitle('Sent to DMs').setDescription('Message content has been sent to your DMs.')],
        flags: MessageFlags.Ephemeral,
      });
      response = await interaction.fetchReply();
    } catch {
      await interaction.reply({
        embeds: [new EmbedBuilder().setColor(MATTE).setTitle('DM Failed').setDescription('Could not send to DMs. File attached below.')],
        files: [attachment],
        flags: MessageFlags.Ephemeral,
      });
      response = await interaction.fetchReply();
    }
  }

  await fs.unlink(filePath).catch(() => {});

  try {
    const { uploadText } = await import('../../utils.js');
    const msgUrl = await uploadText(textContent);
    const updated = EmbedBuilder.from(response.embeds[0])
      .setDescription(`Content saved.\n${msgUrl}`);
    if (interaction.channel.type === ChannelType.DM) {
      await interaction.editReply({ embeds: [updated] });
    } else {
      await response.edit({ embeds: [updated] }).catch(() => {});
    }
  } catch (err) { logger.error('downloadMessage upload', err); }
}

// ============================================================================
// DELETE MESSAGE
// ============================================================================

export async function handleDeleteMessageInteraction(interaction, customIdData) {
  const lastDash = customIdData.lastIndexOf('-');
  if (lastDash === -1) {
    return interaction.reply({
      embeds: [new EmbedBuilder().setColor(MATTE).setTitle('Authorization Error').setDescription('Unable to verify ownership of this message.')],
      flags: MessageFlags.Ephemeral,
    });
  }
  const ownerId   = customIdData.substring(lastDash + 1);
  const clickerId = interaction.user.id;
  if (clickerId !== ownerId) {
    return interaction.reply({
      embeds: [new EmbedBuilder().setColor(MATTE).setTitle('Not Authorized').setDescription('Only the user who triggered this response can delete it.')],
      flags: MessageFlags.Ephemeral,
    });
  }
  await interaction.message.delete().catch(() => {});
}
