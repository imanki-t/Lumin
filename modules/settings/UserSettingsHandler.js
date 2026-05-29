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

const logger = Logger.get('UserSettings');
const THEME_COLOR = '#09090B'; // Matte black brand fallback

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

    let embedColor = THEME_COLOR;
    if (guildId && state.serverSettings[guildId]?.embedColor) {
      embedColor = state.serverSettings[guildId].embedColor;
    } else if (state.userSettings[userId]?.embedColor) {
      embedColor = state.userSettings[userId].embedColor;
    }

    const userBtn = new ButtonBuilder()
      .setCustomId('user_settings')
      .setLabel('User Settings')
      .setStyle(ButtonStyle.Primary);

    const serverBtn = new ButtonBuilder()
      .setCustomId('server_settings')
      .setLabel('Server Settings')
      .setStyle(ButtonStyle.Success);

    const components = canManage
      ? [new ActionRowBuilder().addComponents(userBtn, serverBtn)]
      : [new ActionRowBuilder().addComponents(userBtn)];

    const embed = new EmbedBuilder()
      .setColor(embedColor)
      .setTitle('Settings Dashboard')
      .setDescription('Select a configuration tier below to customize preferences.')
      .addFields({ name: 'User Settings', value: 'Personal defaults, response formats, and privacy', inline: false })
      .setFooter({ text: 'Changes are automatically saved.' })
      .setTimestamp();

    if (canManage) {
      embed.addFields({ name: 'Server Settings', value: 'Server-wide logic, override rules, and channels', inline: false });
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
          .setColor('#09090B')
          .setTitle('Server Override Active')
          .setDescription(`The settings on ${interaction.guild.name} are locked by server administrators. Your personal settings will still apply in DMs or other guilds.`)
        ]
      }).catch(() => {});
    }
  }

  const selectedModel     = userSettings.selectedModel    || DEFAULT_USER_SETTINGS.selectedModel;
  const responseFormat    = userSettings.responseFormat   || DEFAULT_USER_SETTINGS.responseFormat;
  const showActionButtons = userSettings.showActionButtons ?? DEFAULT_USER_SETTINGS.showActionButtons;
  const embedColor        = userSettings.embedColor       || THEME_COLOR;

  const responseFormatSelect = new StringSelectMenuBuilder()
    .setCustomId('user_response_format')
    .setPlaceholder('Response Format')
    .addOptions(
      new StringSelectMenuOptionBuilder()
        .setLabel('Normal Format')
        .setDescription('Plain text responses')
        .setValue('Normal')
        .setDefault(responseFormat === 'Normal'),
      new StringSelectMenuOptionBuilder()
        .setLabel('Embedded Format')
        .setDescription('Rich embed responses')
        .setValue('Embedded')
        .setDefault(responseFormat === 'Embedded')
    );

  const actionButtonsSelect = new StringSelectMenuBuilder()
    .setCustomId('user_action_buttons')
    .setPlaceholder('Action Buttons')
    .addOptions(
      new StringSelectMenuOptionBuilder()
        .setLabel('Show Buttons')
        .setDescription('Enable standard message actions')
        .setValue('show')
        .setDefault(showActionButtons),
      new StringSelectMenuOptionBuilder()
        .setLabel('Hide Buttons')
        .setDescription('Disable standard message actions')
        .setValue('hide')
        .setDefault(!showActionButtons)
    );

  const backBtn = new ButtonBuilder()
    .setCustomId('back_to_main')
    .setLabel('← Menu')
    .setStyle(ButtonStyle.Secondary);

  const nextBtn = new ButtonBuilder()
    .setCustomId('user_settings_page2')
    .setLabel('Next Page →')
    .setStyle(ButtonStyle.Primary);

  const embed = new EmbedBuilder()
    .setColor(embedColor)
    .setTitle('User Settings')
    .setDescription('Configure your personal conversation preferences.')
    .addFields(
      { name: 'AI Model',        value: `\`${selectedModel}\``,                        inline: true },
      { name: 'Response Format', value: `\`${responseFormat}\``,                       inline: true },
      { name: 'Action Buttons',  value: `\`${showActionButtons ? 'Visible' : 'Hidden'}\``, inline: true }
    )
    .setFooter({ text: 'Page 1 of 3' })
    .setTimestamp();

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
  const embedColor            = userSettings.embedColor || THEME_COLOR;
  const hasPersonality        = !!userSettings.customPersonality;

  const continuousReplySelect = new StringSelectMenuBuilder()
    .setCustomId('user_continuous_reply')
    .setPlaceholder('Continuous Reply')
    .addOptions(
      new StringSelectMenuOptionBuilder()
        .setLabel('Enabled')
        .setDescription('Respond to consecutive messages without mentions')
        .setValue('enabled')
        .setDefault(continuousReply),
      new StringSelectMenuOptionBuilder()
        .setLabel('Disabled')
        .setDescription('Require mentions for every transaction')
        .setValue('disabled')
        .setDefault(!continuousReply)
    );

  const crossContextSelect = new StringSelectMenuBuilder()
    .setCustomId('user_cross_context')
    .setPlaceholder('Cross-Context Memory')
    .addOptions(
      new StringSelectMenuOptionBuilder()
        .setLabel('Disabled')
        .setDescription('Isolate conversation lookup to current context')
        .setValue('disabled')
        .setDefault(!crossContextEnabled),
      new StringSelectMenuOptionBuilder()
        .setLabel('Enabled')
        .setDescription('Utilize memory spanning across servers and DMs')
        .setValue('enabled')
        .setDefault(crossContextEnabled)
    );

  const colorBtn = new ButtonBuilder()
    .setCustomId('user_embed_color')
    .setLabel('Set Color')
    .setStyle(ButtonStyle.Secondary);

  const personalityBtn = new ButtonBuilder()
    .setCustomId('user_custom_personality')
    .setLabel('Set Personality')
    .setStyle(ButtonStyle.Primary);

  const removePersonalityBtn = new ButtonBuilder()
    .setCustomId('user_remove_personality')
    .setLabel('Reset')
    .setStyle(ButtonStyle.Danger)
    .setDisabled(!hasPersonality);

  const backBtn = new ButtonBuilder()
    .setCustomId('user_settings_p1')
    .setLabel('← Back')
    .setStyle(ButtonStyle.Secondary);

  const nextBtn = new ButtonBuilder()
    .setCustomId('user_settings_page3')
    .setLabel('Next Page →')
    .setStyle(ButtonStyle.Primary);

  const embed = new EmbedBuilder()
    .setColor(embedColor)
    .setTitle('User Settings')
    .setDescription('Personal behavior, aesthetic theme, and database rules.')
    .addFields(
      { name: 'Continuous Reply',   value: `\`${continuousReply ? 'Enabled' : 'Disabled'}\``,       inline: true },
      { name: 'Embed Color',        value: `\`${embedColor}\``,                                       inline: true },
      { name: 'Custom Personality', value: `\`${hasPersonality ? 'Active' : 'Default'}\``,            inline: true },
      { name: 'Cross-Context Memory', value: `\`${crossContextEnabled ? 'Enabled' : 'Disabled'}\`\nQuery personal memories globally across servers/DMs.`, inline: false }
    )
    .setFooter({ text: 'Page 2 of 3' })
    .setTimestamp();

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
  const embedColor   = userSettings.embedColor || THEME_COLOR;

  const clearMemBtn = new ButtonBuilder()
    .setCustomId('clear_user_memory')
    .setLabel('Clear Memory')
    .setStyle(ButtonStyle.Danger);

  const downloadBtn = new ButtonBuilder()
    .setCustomId('download_user_conversation')
    .setLabel('Export History')
    .setStyle(ButtonStyle.Success);

  const backBtn = new ButtonBuilder()
    .setCustomId('back_to_user_p2')
    .setLabel('← Back')
    .setStyle(ButtonStyle.Secondary);

  const mainBtn = new ButtonBuilder()
    .setCustomId('back_to_main')
    .setLabel('← Main Menu')
    .setStyle(ButtonStyle.Primary);

  const embed = new EmbedBuilder()
    .setColor(embedColor)
    .setTitle('User Settings')
    .setDescription('Clear or export personal conversation storage logs.')
    .addFields(
      { name: 'Clear Memory',      value: 'Erase all personal conversation storage.', inline: false },
      { name: 'Export History',  value: 'Download your personal chat log history as a text file.',             inline: false }
    )
    .setFooter({ text: 'Page 3 of 3' })
    .setTimestamp();

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
    embeds: [new EmbedBuilder()
      .setColor('#09090B')
      .setTitle('Memory Cleared')
      .setDescription('Your personal chat history has been cleared.')
    ],
    flags: MessageFlags.Ephemeral
  });
}

export async function downloadUserConversation(interaction) {
  const userId = interaction.user.id;
  const conversationHistory = getHistory(userId);

  if (!conversationHistory?.length) {
    return interaction.reply({
      embeds: [new EmbedBuilder()
        .setColor('#09090B')
        .setTitle('No History Found')
        .setDescription('There is no personal chat logs recorded under your profile.')
      ],
      flags: MessageFlags.Ephemeral
    });
  }

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
        embeds: [new EmbedBuilder()
          .setColor('#09090B')
          .setTitle('History Sent')
          .setDescription('Your complete conversation history has been sent to your DMs!')
        ],
        flags: MessageFlags.Ephemeral
      });
      fileSent = true;
    } catch (err) {
      logger.error('DM send failed for history download', err);
      fallback = new EmbedBuilder()
        .setColor('#09090B')
        .setTitle('DM Failed')
        .setDescription('Could not deliver history to DMs. Attempting direct upload.');
    }
  } else {
    fallback = new EmbedBuilder()
      .setColor('#09090B')
      .setTitle('History Too Large')
      .setDescription(`The personal chat history is too large (${sizeMB.toFixed(2)} MB). Transferring to a secure external link.`);
  }

  if (!fileSent) {
    const { uploadText } = await import('../../utils.js');
    const urlText = await uploadText(conversationText);
    const url     = urlText.match(/🔗 URL: (.+)/)?.[1] || 'URL generation failed.';
    const embed   = (fallback || new EmbedBuilder().setColor('#09090B').setTitle('History Exported'))
      .addFields({ name: 'Archive Link', value: `[View Saved Logs](${url})`, inline: false });
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
    .setLabel("Define the bot's user personality")
    .setStyle(TextInputStyle.Paragraph)
    .setPlaceholder('Enter your custom personality instructions...')
    .setMinLength(10).setMaxLength(4000);
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
    embeds: [new EmbedBuilder()
      .setColor('#09090B')
      .setTitle('Personality Removed')
      .setDescription('Your custom personality instructions have been reset to default.')
    ],
    flags: MessageFlags.Ephemeral
  });
}

export async function showUserEmbedColorModal(interaction) {
  const userId   = interaction.user.id;
  const existing = (state.userSettings[userId] || {}).embedColor || BOT_CONFIG.HEX_COLOUR;

  const input = new TextInputBuilder()
    .setCustomId('color_input')
    .setLabel('Hex Color Code')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('#FF5733 or FF5733')
    .setMinLength(6).setMaxLength(7);
  if (existing) input.setValue(existing);

  await interaction.showModal(
    new ModalBuilder()
      .setCustomId('user_embed_color_modal')
      .setTitle('Theme Color Customization')
      .addComponents(new ActionRowBuilder().addComponents(input))
  );
}

export { persistUser, persistInstructions };