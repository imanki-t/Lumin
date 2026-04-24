/**
 * @fileoverview User settings pages (1–3) and data actions (clear/download memory).
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
  state, getHistory, TEMP_DIR, BOT_CONFIG,
  DEFAULT_USER_SETTINGS
} from '../../managers/BotManager.js';
import * as db     from '../../database.js';
import { Logger }  from '../../core/Logger.js';
import { Embeds }  from '../shared/embedBuilder.js';

const logger = Logger.get('UserSettings');
// Embed color fallback uses BOT_CONFIG.HEX_COLOUR ('#5B7C99') for brand consistency.

// ============================================================================
// PERSIST HELPERS
// ============================================================================

async function persistUser(userId) {
  try {
    await db.saveUserSettings(userId, state.userSettings[userId]);
  } catch (err) {
    logger.error(`Failed to persist user settings for ${userId}`, err);
  }
}

async function persistInstructions(id, instructions) {
  try {
    await db.saveCustomInstructions(id, instructions ?? null);
  } catch (err) {
    logger.error(`Failed to persist custom instructions for ${id}`, err);
  }
}

async function persistChatHistory(id) {
  try {
    await db.saveChatHistory(id, state.chatHistories[id] ?? {});
  } catch (err) {
    logger.error(`Failed to persist chat history for ${id}`, err);
  }
}

// ============================================================================
// AUTO-DELETE HELPER
// Timer registered only on first reply (isUpdate === false) to avoid multiple
// overlapping timers on the same interaction.
// ============================================================================

function scheduleAutoDelete(interaction, isUpdate) {
  if (isUpdate) return; // only schedule once, on first reply
  setTimeout(async () => {
    try {
      const reply = await interaction.fetchReply().catch(() => null);
      if (reply) await interaction.deleteReply();
    } catch (err) {
      if (err.code !== 10008) logger.error('Error auto-deleting settings message', err);
    }
  }, 300_000);
}

// ============================================================================
// MAIN SETTINGS DASHBOARD
// ============================================================================

/**
 * Show (or update) the top-level settings dashboard.
 * @param {import('discord.js').Interaction} interaction
 * @param {boolean} [isUpdate]
 */
export async function showMainSettings(interaction, isUpdate = false) {
  try {
    const userId    = interaction.user.id;
    const guildId   = interaction.guild?.id;
    const canManage = guildId
      ? interaction.member.permissions.has(0x20n) // ManageGuild
      : false;

    const defaultColor = parseInt(BOT_CONFIG.HEX_COLOUR.replace('#', ''), 16);
    let embedColor = defaultColor;
    if (guildId && state.serverSettings[guildId]?.embedColor) {
      embedColor = state.serverSettings[guildId].embedColor;
    } else if (state.userSettings[userId]?.embedColor) {
      embedColor = state.userSettings[userId].embedColor;
    }

    const userBtn = new ButtonBuilder()
      .setCustomId('user_settings').setLabel('User Settings')
      .setEmoji('👤').setStyle(ButtonStyle.Primary);

    const serverBtn = new ButtonBuilder()
      .setCustomId('server_settings').setLabel('Server Settings')
      .setEmoji('🏰').setStyle(ButtonStyle.Success);

    const components = canManage
      ? [new ActionRowBuilder().addComponents(userBtn, serverBtn)]
      : [new ActionRowBuilder().addComponents(userBtn)];

    const embed = new EmbedBuilder()
      .setColor(embedColor)
      .setTitle('⚙️ Settings Dashboard')
      .setDescription('**Configure your bot experience**\n\nSelect a category below to customize your preferences.')
      .addFields({ name: '👤 User Settings', value: '> Personal preferences, models, appearance, and data management', inline: false })
      .setFooter({ text: 'Settings Menu • Changes save automatically' })
      .setTimestamp();

    if (canManage) {
      embed.addFields({ name: '🏰 Server Settings', value: '> Server-wide configuration, channels, overrides, and moderation', inline: false });
    }

    const payload = { embeds: [embed], components, flags: MessageFlags.Ephemeral };

    if (isUpdate) await interaction.update(payload);
    else           await interaction.reply(payload);

    scheduleAutoDelete(interaction, isUpdate);
  } catch (error) {
    logger.error('Error showing main settings', error);
  }
}

// ============================================================================
// PAGE 1 — Core Preferences
// ============================================================================

export async function showUserSettings(interaction, isUpdate = false) {
  const userId      = interaction.user.id;
  const userSettings = state.userSettings[userId] || {};
  const guildId     = interaction.guild?.id;

  // Notify user if server override is active (only on first open, not updates)
  if (guildId && !isUpdate) {
    const ss = state.serverSettings[guildId] || {};
    if (ss.overrideUserSettings) {
      interaction.user.send({
        embeds: [new EmbedBuilder()
          .setColor(0xFFAA00)
          .setTitle('🔒 Server Override Active')
          .setDescription(
            `The settings on **${interaction.guild.name}** are overridden by server admins.\n\n` +
            'Your personal settings still apply in DMs and other servers.'
          )
        ]
      }).catch(() => {});
    }
  }

  const selectedModel     = userSettings.selectedModel    || DEFAULT_USER_SETTINGS.selectedModel;
  const responseFormat    = userSettings.responseFormat   || DEFAULT_USER_SETTINGS.responseFormat;
  const showActionButtons = userSettings.showActionButtons ?? DEFAULT_USER_SETTINGS.showActionButtons;
  const embedColor        = userSettings.embedColor       || BOT_CONFIG.HEX_COLOUR;

  const responseFormatSelect = new StringSelectMenuBuilder()
    .setCustomId('user_response_format').setPlaceholder('Response Format')
    .addOptions(
      new StringSelectMenuOptionBuilder()
        .setLabel('Normal').setDescription('Plain text responses')
        .setValue('Normal').setEmoji('📝').setDefault(responseFormat === 'Normal'),
      new StringSelectMenuOptionBuilder()
        .setLabel('Embedded').setDescription('Rich embed responses')
        .setValue('Embedded').setEmoji('📊').setDefault(responseFormat === 'Embedded')
    );

  const actionButtonsSelect = new StringSelectMenuBuilder()
    .setCustomId('user_action_buttons').setPlaceholder('Action Buttons')
    .addOptions(
      new StringSelectMenuOptionBuilder()
        .setLabel('Show Buttons').setDescription('Display Stop/Save/Delete buttons')
        .setValue('show').setEmoji('✅').setDefault(showActionButtons),
      new StringSelectMenuOptionBuilder()
        .setLabel('Hide Buttons').setDescription('Hide action buttons')
        .setValue('hide').setEmoji('❌').setDefault(!showActionButtons)
    );

  const backBtn = new ButtonBuilder()
    .setCustomId('back_to_main').setLabel('Back to Menu').setEmoji('◀️').setStyle(ButtonStyle.Secondary);
  const nextBtn = new ButtonBuilder()
    .setCustomId('user_settings_page2').setLabel('Next Page').setEmoji('▶️').setStyle(ButtonStyle.Primary);

  const embed = new EmbedBuilder()
    .setColor(embedColor)
    .setTitle('👤 User Settings')
    .setDescription('**Page 1 of 3** • Core Preferences\n\nConfigure your personal AI response settings.')
    .addFields(
      { name: '🤖 AI Model',        value: `\`${selectedModel}\``,                        inline: true },
      { name: '📋 Response Format', value: `\`${responseFormat}\``,                       inline: true },
      { name: '🔘 Action Buttons',  value: `\`${showActionButtons ? 'Visible' : 'Hidden'}\``, inline: true }
    )
    .setFooter({ text: 'Page 1 of 3 • Core Preferences' }).setTimestamp();

  const payload = {
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(responseFormatSelect),
      new ActionRowBuilder().addComponents(actionButtonsSelect),
      new ActionRowBuilder().addComponents(backBtn, nextBtn)
    ],
    flags: MessageFlags.Ephemeral
  };

  if (isUpdate) await interaction.update(payload);
  else           await interaction.reply(payload);

  scheduleAutoDelete(interaction, isUpdate);
}

// ============================================================================
// PAGE 2 — Behavior & Appearance
// ============================================================================

export async function showUserSettingsPage2(interaction, isUpdate = false) {
  const userId      = interaction.user.id;
  const userSettings = state.userSettings[userId] || {};
  const continuousReply       = userSettings.continuousReply       ?? true;
  const crossContextEnabled   = userSettings.crossContextEnabled   ?? false;
  const embedColor            = userSettings.embedColor || BOT_CONFIG.HEX_COLOUR;
  const hasPersonality        = !!userSettings.customPersonality;

  const continuousReplySelect = new StringSelectMenuBuilder()
    .setCustomId('user_continuous_reply').setPlaceholder('Continuous Reply')
    .addOptions(
      new StringSelectMenuOptionBuilder()
        .setLabel('Enabled').setDescription('Bot replies without mentions')
        .setValue('enabled').setEmoji('🔄').setDefault(continuousReply),
      new StringSelectMenuOptionBuilder()
        .setLabel('Disabled').setDescription('Bot requires mentions')
        .setValue('disabled').setEmoji('⏸️').setDefault(!continuousReply)
    );

  const crossContextSelect = new StringSelectMenuBuilder()
    .setCustomId('user_cross_context').setPlaceholder('Cross-Context Memory')
    .addOptions(
      new StringSelectMenuOptionBuilder()
        .setLabel('Disabled').setDescription('Only search current conversation memory (default)')
        .setValue('disabled').setEmoji('🔒').setDefault(!crossContextEnabled),
      new StringSelectMenuOptionBuilder()
        .setLabel('Enabled').setDescription('Search your memory across all servers and DMs')
        .setValue('enabled').setEmoji('🌐').setDefault(crossContextEnabled)
    );

  const colorBtn = new ButtonBuilder()
    .setCustomId('user_embed_color').setLabel('Embed Color').setEmoji('🎨').setStyle(ButtonStyle.Secondary);
  const personalityBtn = new ButtonBuilder()
    .setCustomId('user_custom_personality').setLabel('Set Personality').setEmoji('🎭').setStyle(ButtonStyle.Primary);
  const removePersonalityBtn = new ButtonBuilder()
    .setCustomId('user_remove_personality').setLabel('Reset').setEmoji('🗑️')
    .setStyle(ButtonStyle.Danger).setDisabled(!hasPersonality);
  const backBtn = new ButtonBuilder()
    .setCustomId('user_settings_p1').setLabel('Previous').setEmoji('◀️').setStyle(ButtonStyle.Secondary);
  const nextBtn = new ButtonBuilder()
    .setCustomId('user_settings_page3').setLabel('Next Page').setEmoji('▶️').setStyle(ButtonStyle.Primary);

  const embed = new EmbedBuilder()
    .setColor(embedColor)
    .setTitle('👤 User Settings')
    .setDescription('**Page 2 of 3** • Behavior & Appearance\n\nCustomize how the bot responds and looks.')
    .addFields(
      { name: '🔄 Continuous Reply',   value: `\`${continuousReply ? 'Enabled' : 'Disabled'}\``,       inline: true },
      { name: '🎨 Embed Color',        value: `\`${embedColor}\``,                                       inline: true },
      { name: '🎭 Custom Personality', value: `\`${hasPersonality ? 'Active' : 'Default'}\``,            inline: true },
      { name: '🌐 Cross-Context Memory', value: `\`${crossContextEnabled ? 'Enabled' : 'Disabled'}\`\n> When enabled, the bot searches your memory across all servers and DMs`, inline: false }
    )
    .setFooter({ text: 'Page 2 of 3 • Behavior & Appearance' }).setTimestamp();

  const payload = {
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(continuousReplySelect),
      new ActionRowBuilder().addComponents(crossContextSelect),
      new ActionRowBuilder().addComponents(colorBtn, personalityBtn, removePersonalityBtn),
      new ActionRowBuilder().addComponents(backBtn, nextBtn)
    ],
    flags: MessageFlags.Ephemeral
  };

  if (isUpdate) await interaction.update(payload);
  else           await interaction.reply(payload);
}

// ============================================================================
// PAGE 3 — Data Management
// ============================================================================

export async function showUserSettingsPage3(interaction, isUpdate = false) {
  const userId      = interaction.user.id;
  const userSettings = state.userSettings[userId] || {};
  const embedColor   = userSettings.embedColor || BOT_CONFIG.HEX_COLOUR;

  const clearMemBtn = new ButtonBuilder()
    .setCustomId('clear_user_memory').setLabel('Clear Memory').setEmoji('🧹').setStyle(ButtonStyle.Danger);
  const downloadBtn = new ButtonBuilder()
    .setCustomId('download_user_conversation').setLabel('Download History').setEmoji('💾').setStyle(ButtonStyle.Success);
  const backBtn = new ButtonBuilder()
    .setCustomId('back_to_user_p2').setLabel('Previous').setEmoji('◀️').setStyle(ButtonStyle.Secondary);
  const mainBtn = new ButtonBuilder()
    .setCustomId('back_to_main').setLabel('Main Menu').setEmoji('🏠').setStyle(ButtonStyle.Primary);

  const embed = new EmbedBuilder()
    .setColor(embedColor)
    .setTitle('👤 User Settings')
    .setDescription('**Page 3 of 3** • Data Management\n\nManage your conversation data and history.')
    .addFields(
      { name: '🧹 Clear Memory',      value: 'Delete all conversation history and start fresh', inline: false },
      { name: '💾 Download History',  value: 'Export your chat log as a text file',             inline: false }
    )
    .setFooter({ text: 'Page 3 of 3 • Data Management' }).setTimestamp();

  const payload = {
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(clearMemBtn, downloadBtn),
      new ActionRowBuilder().addComponents(backBtn, mainBtn)
    ],
    flags: MessageFlags.Ephemeral
  };

  if (isUpdate) await interaction.update(payload);
  else           await interaction.reply(payload);
}

// ============================================================================
// ACTIONS
// ============================================================================

export async function clearUserMemory(interaction) {
  const userId = interaction.user.id;
  state.chatHistories[userId] = {};
  await persistChatHistory(userId);
  await interaction.reply({
    embeds: [Embeds.success('✅ Memory Cleared', 'Your chat history has been cleared successfully!')],
    flags: MessageFlags.Ephemeral
  });
}

export async function downloadUserConversation(interaction) {
  const userId = interaction.user.id;
  const conversationHistory = getHistory(userId);

  if (!conversationHistory?.length) {
    return interaction.reply({
      embeds: [Embeds.error('❌ No History Found', "You don't have any conversation history to download.")],
      flags: MessageFlags.Ephemeral
    });
  }

  // entry.content is the canonical field; entry.parts is the legacy shape — handle both.
  const conversationText = conversationHistory.map(entry => {
    const role    = entry.role === 'user' ? '[User]' : '[Model]';
    const content = (entry.content || entry.parts || [])
      .map(c => c.text || '').filter(Boolean).join('\n');
    return `${role}:\n${content}\n\n`;
  }).join('');

  const tempFile = path.join(TEMP_DIR, `conversation_${interaction.id}.txt`);
  await fs.writeFile(tempFile, conversationText, 'utf8');

  const { size } = await fs.stat(tempFile);
  const sizeMB   = size / (1024 * 1024);
  let fileSent   = false;
  let fallback;

  if (sizeMB <= 9.5) {
    try {
      await interaction.user.send({
        content: `📥 **Your Conversation History**`,
        files:   [new AttachmentBuilder(tempFile, { name: 'conversation_history.txt' })]
      });
      await interaction.reply({
        embeds: [Embeds.success('✅ History Sent', 'Your conversation history has been sent to your DMs!')],
        flags: MessageFlags.Ephemeral
      });
      fileSent = true;
    } catch (err) {
      logger.error('DM send failed for history download', err);
      fallback = new EmbedBuilder()
        .setColor(0xFFAA00).setTitle('❌ DM Failed')
        .setDescription('Could not send via DM. Attempting external upload.');
    }
  } else {
    fallback = new EmbedBuilder()
      .setColor(0xFFAA00).setTitle('🔗 History Too Large')
      .setDescription(`History is ${sizeMB.toFixed(2)} MB — uploading to external site.`);
  }

  if (!fileSent) {
    const { uploadText } = await import('../../utils.js');
    const urlText = await uploadText(conversationText);
    const url     = urlText.match(/🔗 URL: (.+)/)?.[1] || 'URL generation failed.';
    const embed   = (fallback || new EmbedBuilder().setColor(0xFFAA00).setTitle('🔗 History Upload'))
      .addFields({ name: 'External Link', value: `[View History Content](${url})`, inline: false });
    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  }

  await fs.unlink(tempFile).catch(() => {});
}

// ============================================================================
// PERSONALITY / COLOR MODALS
// ============================================================================

export async function showUserPersonalityModal(interaction) {
  const userId     = interaction.user.id;
  const existing   = (state.userSettings[userId] || {}).customPersonality || '';

  const input = new TextInputBuilder()
    .setCustomId('personality_input')
    .setLabel("What should the bot's personality be like?")
    .setStyle(TextInputStyle.Paragraph)
    .setPlaceholder('Enter your custom personality instructions…')
    .setMinLength(10).setMaxLength(4000);
  if (existing) input.setValue(existing);

  await interaction.showModal(
    new ModalBuilder()
      .setCustomId('user_personality_modal').setTitle('Custom Personality')
      .addComponents(new ActionRowBuilder().addComponents(input))
  );
}

export async function removeUserPersonality(interaction) {
  const userId = interaction.user.id;
  if (state.userSettings[userId]) delete state.userSettings[userId].customPersonality;
  if (state.customInstructions?.[userId]) delete state.customInstructions[userId];
  await Promise.all([persistUser(userId), persistInstructions(userId, null)]);
  await interaction.reply({
    embeds: [Embeds.success('✅ Personality Removed', 'Your custom personality has been removed!')],
    flags: MessageFlags.Ephemeral
  });
}

export async function showUserEmbedColorModal(interaction) {
  const userId   = interaction.user.id;
  const existing = (state.userSettings[userId] || {}).embedColor || BOT_CONFIG.HEX_COLOUR;

  const input = new TextInputBuilder()
    .setCustomId('color_input').setLabel('Enter Hex Color Code')
    .setStyle(TextInputStyle.Short).setPlaceholder('#FF5733 or FF5733')
    .setMinLength(6).setMaxLength(7);
  if (existing) input.setValue(existing);

  await interaction.showModal(
    new ModalBuilder()
      .setCustomId('user_embed_color_modal').setTitle('Embed Color Customization')
      .addComponents(new ActionRowBuilder().addComponents(input))
  );
}

// Export persist helpers for ActionHandlers
export { persistUser, persistInstructions };
