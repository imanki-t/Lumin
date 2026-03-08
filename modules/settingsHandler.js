import { EmbedBuilder, MessageFlags, ButtonBuilder, ButtonStyle, ActionRowBuilder, PermissionsBitField, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, ChannelSelectMenuBuilder, ChannelType, ModalBuilder, TextInputBuilder, TextInputStyle, AttachmentBuilder } from 'discord.js';
import path from 'path';
import fs from 'fs/promises';
import { state, saveStateToFile, chatHistoryLock, getHistory, TEMP_DIR, BOT_CONFIG, DEFAULT_USER_SETTINGS, DEFAULT_SERVER_SETTINGS } from '../botManager.js';
import * as db from '../database.js';
import config from '../config.js';
import { DEFAULT_MODEL } from './config.js';

const hexColour = BOT_CONFIG.HEX_COLOUR;
const DEFAULT_BLACK = 0x000000;

// ============================================================================
// TARGETED SAVE HELPERS
// These write ONLY what changed directly to MongoDB, bypassing the slow
// saveStateToFile() full-state dump. This fixes two bugs:
// 1. Speed: no longer re-saving every user/history/setting on each interaction.
// 2. Reliability: changes are persisted immediately — not lost if the bot is
//    force-killed before a pending batch save fires.
// saveStateToFile() (5-min periodic in botManager) still runs as a full backup.
// ============================================================================

async function persistUser(userId) {
  try {
    await db.saveUserSettings(userId, state.userSettings[userId]);
  } catch (err) {
    console.error(`❌ Failed to persist user settings for ${userId}:`, err.message);
  }
}

async function persistServer(guildId) {
  try {
    await db.saveServerSettings(guildId, state.serverSettings[guildId]);
  } catch (err) {
    console.error(`❌ Failed to persist server settings for ${guildId}:`, err.message);
  }
}

async function persistInstructions(id, instructions) {
  try {
    // null/undefined/empty means the instructions were deleted — persist that too
    await db.saveCustomInstructions(id, instructions ?? null);
  } catch (err) {
    console.error(`❌ Failed to persist custom instructions for ${id}:`, err.message);
  }
}

async function persistChannelSetting(channelId, type, value) {
  try {
    await db.saveChannelSetting(channelId, type, value);
  } catch (err) {
    console.error(`❌ Failed to persist channel setting for ${channelId}:`, err.message);
  }
}

async function persistChatHistory(id) {
  try {
    await db.saveChatHistory(id, state.chatHistories[id] ?? {});
  } catch (err) {
    console.error(`❌ Failed to persist chat history for ${id}:`, err.message);
  }
}

export async function handleButtonInteraction(interaction) {
  if (!interaction.isButton()) return;

  const guildId = interaction.guild?.id;
  const userId = interaction.user.id;

  if (guildId) {
    const { initializeBlacklistForGuild } = await import('./utils.js');
    initializeBlacklistForGuild(guildId);
    if (state.blacklistedUsers[guildId]?.includes(userId)) {
      const embed = new EmbedBuilder()
        .setColor(0xFF0000)
        .setTitle('🚫 Blacklisted')
        .setDescription('You are blacklisted and cannot use this interaction.');
      return interaction.reply({
        embeds: [embed],
        flags: MessageFlags.Ephemeral
      });
    }
  }

  const buttonHandlers = {
    'user_settings_page3': showUserSettingsPage3,
    'user_settings_page2': showUserSettingsPage2,
    'user_settings_p1': showUserSettings,
    'user_settings': showUserSettings,
    'back_to_user_p2': showUserSettingsPage2,
    'back_to_user': showUserSettings,
    'server_settings_page5': showServerSettingsPage5,
    'server_settings_page4': showServerSettingsPage4,
    'server_settings_page3': showServerSettingsPage3,
    'server_settings_page2': showServerSettingsPage2,
    'server_settings_p1': showServerSettings,
    'server_settings': showServerSettings,
    'back_to_server_p4': showServerSettingsPage4,
    'back_to_server_p3': showServerSettingsPage3,
    'back_to_server_p2': showServerSettingsPage2,
    'back_to_server': showServerSettings,
    'back_to_main': showMainSettings,
    'clear_user_memory': clearUserMemory,
    'download_user_conversation': downloadUserConversation,
    'clear_server_memory': clearServerMemory,
    'download_server_conversation': downloadServerConversation,
    'user_custom_personality': showUserPersonalityModal,
    'user_remove_personality': removeUserPersonality,
    'server_custom_personality': showServerPersonalityModal,
    'server_remove_personality': removeServerPersonality,
    'user_embed_color': showUserEmbedColorModal,
    'server_embed_color': showServerEmbedColorModal,
    'toggle_continuous_reply': toggleContinuousReplyChannel,
    'manage_allowed_channels': showChannelManagementMenu,
    'set_all_channels': handleSetAllChannels,
    'download_message': downloadMessage,
    'settings_btn': showMainSettings,
  };

  const updateableMenus = [
    'user_settings', 'user_settings_page2', 'user_settings_page3', 'user_settings_p1',
    'server_settings', 'server_settings_p1', 'server_settings_page2', 
    'server_settings_page3', 'server_settings_page4', 'server_settings_page5',
    'back_to_main', 'back_to_user', 'back_to_user_p2',
    'back_to_server', 'back_to_server_p2', 'back_to_server_p3', 'back_to_server_p4',
    'manage_allowed_channels', 'set_all_channels'
  ];

  for (const [key, handler] of Object.entries(buttonHandlers)) {
    if (interaction.customId.startsWith(key)) {
      if (updateableMenus.includes(key)) {
        await handler(interaction, true);
      } else {
        await handler(interaction);
      }
      return;
    }
  }

  if (interaction.customId.startsWith('delete_message-')) {
  const customIdData = interaction.customId.replace('delete_message-', '');
  await handleDeleteMessageInteraction(interaction, customIdData);
  }
}

export async function handleSelectMenuInteraction(interaction) {
  if (!interaction.isStringSelectMenu() && !interaction.isChannelSelectMenu()) return;

  const guildId = interaction.guild?.id;
  const userId = interaction.user.id;

  if (guildId) {
    const { initializeBlacklistForGuild } = await import('./utils.js');
    initializeBlacklistForGuild(guildId);
    if (state.blacklistedUsers[guildId]?.includes(userId)) {
      const embed = new EmbedBuilder()
        .setColor(0xFF0000)
        .setTitle('🚫 Blacklisted')
        .setDescription('You are blacklisted and cannot use this interaction.');
      return interaction.reply({
        embeds: [embed],
        flags: MessageFlags.Ephemeral
      });
    }
  }

  if (interaction.customId === 'user_model_select') {
    const selectedModel = interaction.values[0];
    if (!state.userSettings[userId]) {
      state.userSettings[userId] = {};
    }
    state.userSettings[userId].selectedModel = selectedModel;
    await persistUser(userId);
    if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
      return sendPermError(interaction);
    }
    const selectedModel = interaction.values[0];
    if (!state.serverSettings[guildId]) {
      state.serverSettings[guildId] = {};
    }
    state.serverSettings[guildId].selectedModel = selectedModel;
    await persistServer(guildId);
    await showServerSettings(interaction, true);
  } else if (interaction.customId === 'user_response_format') {
    const selectedFormat = interaction.values[0];
    if (!state.userSettings[userId]) {
      state.userSettings[userId] = {};
    }
    state.userSettings[userId].responseFormat = selectedFormat;
    await persistUser(userId);
    await showUserSettings(interaction, true);
  } else if (interaction.customId === 'server_response_format') {
    if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
      return sendPermError(interaction);
    }
    const selectedFormat = interaction.values[0];
    if (!state.serverSettings[guildId]) {
      state.serverSettings[guildId] = {};
    }
    state.serverSettings[guildId].responseFormat = selectedFormat;
    await persistServer(guildId);
    await showServerSettings(interaction, true);
  } else if (interaction.customId === 'user_action_buttons') {
    const selectedValue = interaction.values[0];
    if (!state.userSettings[userId]) {
      state.userSettings[userId] = {};
    }
    state.userSettings[userId].showActionButtons = selectedValue === 'show';
    await persistUser(userId);
    await showUserSettings(interaction, true);
  } else if (interaction.customId === 'server_action_buttons') {
    if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
      return sendPermError(interaction);
    }
    const selectedValue = interaction.values[0];
    if (!state.serverSettings[guildId]) {
      state.serverSettings[guildId] = {};
    }
    state.serverSettings[guildId].showActionButtons = selectedValue === 'show';
    await persistServer(guildId);
    await showServerSettings(interaction, true);
  } else if (interaction.customId === 'user_continuous_reply') {
    const selectedValue = interaction.values[0];
    if (!state.userSettings[userId]) {
      state.userSettings[userId] = {};
    }
    state.userSettings[userId].continuousReply = selectedValue === 'enabled';
    await persistUser(userId);
    await showUserSettingsPage2(interaction, true);
  } else if (interaction.customId === 'server_continuous_reply') {
    if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
      return sendPermError(interaction);
    }
    const selectedValue = interaction.values[0];
    if (!state.serverSettings[guildId]) {
      state.serverSettings[guildId] = {};
    }
    state.serverSettings[guildId].continuousReply = selectedValue === 'enabled';
    await persistServer(guildId);
    await showServerSettingsPage2(interaction, true);
  } else if (interaction.customId === 'server_override') {
    if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
      return sendPermError(interaction);
    }
    const selectedValue = interaction.values[0];
    if (!state.serverSettings[guildId]) {
      state.serverSettings[guildId] = {};
    }
    state.serverSettings[guildId].overrideUserSettings = selectedValue === 'enabled';
    await persistServer(guildId);
    await showServerSettingsPage2(interaction, true);
  } else if (interaction.customId === 'server_chat_history') {
    if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
      return sendPermError(interaction);
    }
    const selectedValue = interaction.values[0];
    if (!state.serverSettings[guildId]) {
      state.serverSettings[guildId] = {};
    }
    state.serverSettings[guildId].serverChatHistory = selectedValue === 'enabled';
    await persistServer(guildId);
    await showServerSettingsPage2(interaction, true);
  } else if (interaction.customId === 'channel_manage_select') {
    await handleChannelManageSelect(interaction);
  }
}

export async function handleModalSubmit(interaction) {
  const userId = interaction.user.id;
  const guildId = interaction.guild?.id;

  if (interaction.customId === 'user_personality_modal') {
    try {
      const personalityInput = interaction.fields.getTextInputValue('personality_input');
      if (!state.userSettings[userId]) {
        state.userSettings[userId] = {};
      }
      state.userSettings[userId].customPersonality = personalityInput.trim();
      // Write directly to DB — this is the setting most likely to revert on redeploy
      await persistUser(userId);

      const embed = new EmbedBuilder()
        .setColor(0x00FF00)
        .setTitle('✅ Success')
        .setDescription('Your custom personality has been saved!');
      await interaction.reply({
        embeds: [embed],
        flags: MessageFlags.Ephemeral
      });
    } catch (error) {
      console.error('Error saving user personality:', error);
    }
  } else if (interaction.customId === 'server_personality_modal') {
    if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
      return sendPermError(interaction);
    }
    try {
      const personalityInput = interaction.fields.getTextInputValue('personality_input');
      if (!state.serverSettings[guildId]) {
        state.serverSettings[guildId] = {};
      }
      state.serverSettings[guildId].customPersonality = personalityInput.trim();
      await persistServer(guildId);

      const embed = new EmbedBuilder()
        .setColor(0x00FF00)
        .setTitle('✅ Success')
        .setDescription('Server custom personality has been saved!');
      await interaction.reply({
        embeds: [embed],
        flags: MessageFlags.Ephemeral
      });
    } catch (error) {
      console.error('Error saving server personality:', error);
    }
  } else if (interaction.customId === 'user_embed_color_modal') {
    try {
      const colorInput = interaction.fields.getTextInputValue('color_input').trim();
      const hexPattern = /^#?([0-9A-Fa-f]{6})$/;
      if (!hexPattern.test(colorInput)) {
        const embed = new EmbedBuilder()
          .setColor(0xFF0000)
          .setTitle('❌ Invalid Color')
          .setDescription('Please provide a valid hex color code (e.g., #FF5733 or FF5733).');
        return interaction.reply({
          embeds: [embed],
          flags: MessageFlags.Ephemeral
        });
      }
      const hexColor = colorInput.startsWith('#') ? colorInput : `#${colorInput}`;
      if (!state.userSettings[userId]) {
        state.userSettings[userId] = {};
      }
      state.userSettings[userId].embedColor = hexColor;
      await persistUser(userId);

      const embed = new EmbedBuilder()
        .setColor(hexColor)
        .setTitle('✅ Color Updated')
        .setDescription(`Your embed color has been set to \`${hexColor}\``);
      await interaction.reply({
        embeds: [embed],
        flags: MessageFlags.Ephemeral
      });
    } catch (error) {
      console.error('Error saving user embed color:', error);
    }
  } else if (interaction.customId === 'server_embed_color_modal') {
    if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
      return sendPermError(interaction);
    }
    try {
      const colorInput = interaction.fields.getTextInputValue('color_input').trim();
      const hexPattern = /^#?([0-9A-Fa-f]{6})$/;
      if (!hexPattern.test(colorInput)) {
        const embed = new EmbedBuilder()
          .setColor(0xFF0000)
          .setTitle('❌ Invalid Color')
          .setDescription('Please provide a valid hex color code (e.g., #FF5733 or FF5733).');
        return interaction.reply({
          embeds: [embed],
          flags: MessageFlags.Ephemeral
        });
      }
      const hexColor = colorInput.startsWith('#') ? colorInput : `#${colorInput}`;
      if (!state.serverSettings[guildId]) {
        state.serverSettings[guildId] = {};
      }
      state.serverSettings[guildId].embedColor = hexColor;
      await persistServer(guildId);

      const embed = new EmbedBuilder()
        .setColor(hexColor)
        .setTitle('✅ Color Updated')
        .setDescription(`Server embed color has been set to \`${hexColor}\``);
      await interaction.reply({
        embeds: [embed],
        flags: MessageFlags.Ephemeral
      });
    } catch (error) {
      console.error('Error saving server embed color:', error);
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN SETTINGS - Modern Black Theme
// ═══════════════════════════════════════════════════════════════════════════════

async function showMainSettings(interaction, isUpdate = false) {
  try {
    const userId = interaction.user.id;
    const guildId = interaction.guild?.id;
    const hasManageServer = guildId ? interaction.member.permissions.has(PermissionsBitField.Flags.ManageGuild) : false;

    // Get embed color from user or server settings, default to black
    const defaultColor = parseInt(BOT_CONFIG.HEX_COLOUR.replace('#', ''), 16);
    let embedColor = defaultColor;
    if (guildId && state.serverSettings[guildId]?.embedColor) {
      embedColor = state.serverSettings[guildId].embedColor;
    } else if (state.userSettings[userId]?.embedColor) {
      embedColor = state.userSettings[userId].embedColor;
    }

    const userButton = new ButtonBuilder()
      .setCustomId('user_settings')
      .setLabel('User Settings')
      .setEmoji('👤')
      .setStyle(ButtonStyle.Primary);

    const serverButton = new ButtonBuilder()
      .setCustomId('server_settings')
      .setLabel('Server Settings')
      .setEmoji('🏰')
      .setStyle(ButtonStyle.Success);

    const components = hasManageServer 
      ? [new ActionRowBuilder().addComponents(userButton, serverButton)]
      : [new ActionRowBuilder().addComponents(userButton)];

    const embed = new EmbedBuilder()
      .setColor(embedColor)
      .setTitle('⚙️ Settings Dashboard')
      .setDescription('**Configure your bot experience**\n\nSelect a category below to customize your preferences.')
      .addFields(
        {
          name: '👤 User Settings',
          value: '> Personal preferences, models, appearance, and data management',
          inline: false
        }
      )
      .setFooter({ text: 'Settings Menu • Changes save automatically' })
      .setTimestamp();

    if (hasManageServer) {
      embed.addFields({
        name: '🏰 Server Settings',
        value: '> Server-wide configuration, channels, overrides, and moderation',
        inline: false
      });
    }

    const payload = {
      embeds: [embed],
      components: components,
      flags: MessageFlags.Ephemeral
    };

    if (isUpdate) {
      await interaction.update(payload);
    } else {
      await interaction.reply(payload);
    }

    setTimeout(async () => {
      try {
        const currentReply = await interaction.fetchReply().catch(() => null);
        if (currentReply) {
          await interaction.deleteReply();
        }
      } catch (error) {
        if (error.code !== 10008) {
          console.error('Error deleting expired settings message:', error);
        }
      }
    }, 300000);
  } catch (error) {
    console.error('Error showing main settings:', error);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// USER SETTINGS - Page 1: Core Preferences
// ═══════════════════════════════════════════════════════════════════════════════

async function showUserSettings(interaction, isUpdate = false) {
  const userId = interaction.user.id;
  const userSettings = state.userSettings[userId] || {};
  const guildId = interaction.guild?.id;

  if (guildId) {
    const serverSettings = state.serverSettings[guildId] || {};
    if (serverSettings.overrideUserSettings && !isUpdate) {
      try {
        const embed = new EmbedBuilder()
          .setColor(0xFFAA00)
          .setTitle('🔒 Server Override Active')
          .setDescription(`The settings on this server, **${interaction.guild.name}**, are being overridden by server administrators.\n\n` +
            'Your personal user settings will not apply here. However, you can still edit them, and they will apply in your DMs and other servers that do not have override enabled.');
        await interaction.user.send({
          embeds: [embed]
        });
      } catch (dmError) {
        console.error("Failed to send override DM:", dmError);
      }
    }
  }

  const selectedModel = userSettings.selectedModel || DEFAULT_USER_SETTINGS.selectedModel;
  const responseFormat = userSettings.responseFormat || DEFAULT_USER_SETTINGS.responseFormat;
  const showActionButtons = userSettings.showActionButtons ?? DEFAULT_USER_SETTINGS.showActionButtons;
  const embedColor = userSettings.embedColor || BOT_CONFIG.HEX_COLOUR;
  

  const modelSelect = new StringSelectMenuBuilder()
    .setCustomId('user_model_select')
    .setPlaceholder('Select AI Model')
    .addOptions(
      new StringSelectMenuOptionBuilder()
        .setLabel('Gemini 3.0 Flash')
        .setDescription('Latest AI model - Pro-level intelligence at Flash speed')
        .setValue('gemini-2.5-flash')
        .setEmoji('⚡')
        .setDefault(true)
    );

  const responseFormatSelect = new StringSelectMenuBuilder()
    .setCustomId('user_response_format')
    .setPlaceholder('Response Format')
    .addOptions(
      new StringSelectMenuOptionBuilder()
        .setLabel('Normal')
        .setDescription('Plain text responses')
        .setValue('Normal')
        .setEmoji('📝')
        .setDefault(responseFormat === 'Normal'),
      new StringSelectMenuOptionBuilder()
        .setLabel('Embedded')
        .setDescription('Rich embed responses')
        .setValue('Embedded')
        .setEmoji('📊')
        .setDefault(responseFormat === 'Embedded')
    );

  const actionButtonsSelect = new StringSelectMenuBuilder()
    .setCustomId('user_action_buttons')
    .setPlaceholder('Action Buttons')
    .addOptions(
      new StringSelectMenuOptionBuilder()
        .setLabel('Show Buttons')
        .setDescription('Display Stop/Save/Delete buttons')
        .setValue('show')
        .setEmoji('✅')
        .setDefault(showActionButtons),
      new StringSelectMenuOptionBuilder()
        .setLabel('Hide Buttons')
        .setDescription('Hide action buttons')
        .setValue('hide')
        .setEmoji('❌')
        .setDefault(!showActionButtons)
    );

  const nextButton = new ButtonBuilder()
    .setCustomId('user_settings_page2')
    .setLabel('Next Page')
    .setEmoji('▶️')
    .setStyle(ButtonStyle.Primary);

  const backButton = new ButtonBuilder()
    .setCustomId('back_to_main')
    .setLabel('Back to Menu')
    .setEmoji('◀️')
    .setStyle(ButtonStyle.Secondary);

  const components = [
    new ActionRowBuilder().addComponents(modelSelect),
    new ActionRowBuilder().addComponents(responseFormatSelect),
    new ActionRowBuilder().addComponents(actionButtonsSelect),
    new ActionRowBuilder().addComponents(backButton, nextButton)
  ];

  const embed = new EmbedBuilder()
    .setColor(embedColor)
    .setTitle('👤 User Settings')
    .setDescription('**Page 1 of 3** • Core Preferences\n\nConfigure your personal AI model and response settings.')
    .addFields(
      {
        name: '🤖 AI Model',
        value: `\`${selectedModel}\``,
        inline: true
      },
      {
        name: '📋 Response Format',
        value: `\`${responseFormat}\``,
        inline: true
      },
      {
        name: '🔘 Action Buttons',
        value: `\`${showActionButtons ? 'Visible' : 'Hidden'}\``,
        inline: true
      }
    )
    .setFooter({ text: 'Page 1 of 3 • Core Preferences' })
    .setTimestamp();

  const payload = {
    embeds: [embed],
    components: components,
    flags: MessageFlags.Ephemeral
  };

  if (isUpdate) {
    await interaction.update(payload);
  } else {
    await interaction.reply(payload);
  }

  setTimeout(async () => {
    try {
      const currentReply = await interaction.fetchReply().catch(() => null);
      if (currentReply) {
        await interaction.deleteReply();
      }
    } catch (error) {
      if (error.code !== 10008) console.error('Error deleting expired settings message:', error);
    }
  }, 300000);
}

// ═══════════════════════════════════════════════════════════════════════════════
// USER SETTINGS - Page 2: Behavior & Appearance
// ═══════════════════════════════════════════════════════════════════════════════

async function showUserSettingsPage2(interaction, isUpdate = false) {
  const userId = interaction.user.id;
  const userSettings = state.userSettings[userId] || {};
  const continuousReply = userSettings.continuousReply ?? true;
  const embedColor = userSettings.embedColor || DEFAULT_BLACK;
  const hasPersonality = !!userSettings.customPersonality;

  const continuousReplySelect = new StringSelectMenuBuilder()
    .setCustomId('user_continuous_reply')
    .setPlaceholder('Continuous Reply')
    .addOptions(
      new StringSelectMenuOptionBuilder()
        .setLabel('Enabled')
        .setDescription('Bot replies without mentions')
        .setValue('enabled')
        .setEmoji('🔄')
        .setDefault(continuousReply),
      new StringSelectMenuOptionBuilder()
        .setLabel('Disabled')
        .setDescription('Bot requires mentions')
        .setValue('disabled')
        .setEmoji('⏸️')
        .setDefault(!continuousReply)
    );

  const colorButton = new ButtonBuilder()
    .setCustomId('user_embed_color')
    .setLabel('Embed Color')
    .setEmoji('🎨')
    .setStyle(ButtonStyle.Secondary);

  const personalityBtn = new ButtonBuilder()
    .setCustomId('user_custom_personality')
    .setLabel('Set Personality')
    .setEmoji('🎭')
    .setStyle(ButtonStyle.Primary);

  const removePersonalityBtn = new ButtonBuilder()
    .setCustomId('user_remove_personality')
    .setLabel('Reset')
    .setEmoji('🗑️')
    .setStyle(ButtonStyle.Danger)
    .setDisabled(!hasPersonality);

  const backButton = new ButtonBuilder()
    .setCustomId('user_settings_p1')
    .setLabel('Previous')
    .setEmoji('◀️')
    .setStyle(ButtonStyle.Secondary);

  const nextButton = new ButtonBuilder()
    .setCustomId('user_settings_page3')
    .setLabel('Next Page')
    .setEmoji('▶️')
    .setStyle(ButtonStyle.Primary);

  const components = [
    new ActionRowBuilder().addComponents(continuousReplySelect),
    new ActionRowBuilder().addComponents(colorButton, personalityBtn, removePersonalityBtn),
    new ActionRowBuilder().addComponents(backButton, nextButton)
  ];

  const embed = new EmbedBuilder()
    .setColor(embedColor)
    .setTitle('👤 User Settings')
    .setDescription('**Page 2 of 3** • Behavior & Appearance\n\nCustomize how the bot responds and looks.')
    .addFields(
      {
        name: '🔄 Continuous Reply',
        value: `\`${continuousReply ? 'Enabled' : 'Disabled'}\``,
        inline: true
      },
      {
        name: '🎨 Embed Color',
        value: `\`${embedColor}\``,
        inline: true
      },
      {
        name: '🎭 Custom Personality',
        value: `\`${hasPersonality ? 'Active' : 'Default'}\``,
        inline: true
      }
    )
    .setFooter({ text: 'Page 2 of 3 • Behavior & Appearance' })
    .setTimestamp();

  const payload = {
    embeds: [embed],
    components: components,
    flags: MessageFlags.Ephemeral
  };

  if (isUpdate) await interaction.update(payload);
  else await interaction.reply(payload);
}

// ═══════════════════════════════════════════════════════════════════════════════
// USER SETTINGS - Page 3: Data Management
// ═══════════════════════════════════════════════════════════════════════════════

async function showUserSettingsPage3(interaction, isUpdate = false) {
  const userId = interaction.user.id;
  const userSettings = state.userSettings[userId] || {};
  const embedColor = userSettings.embedColor || DEFAULT_BLACK;

  const clearMemBtn = new ButtonBuilder()
    .setCustomId('clear_user_memory')
    .setLabel('Clear Memory')
    .setEmoji('🧹')
    .setStyle(ButtonStyle.Danger);

  const downloadBtn = new ButtonBuilder()
    .setCustomId('download_user_conversation')
    .setLabel('Download History')
    .setEmoji('💾')
    .setStyle(ButtonStyle.Success);

  const backButton = new ButtonBuilder()
    .setCustomId('back_to_user_p2')
    .setLabel('Previous')
    .setEmoji('◀️')
    .setStyle(ButtonStyle.Secondary);

  const mainMenuButton = new ButtonBuilder()
    .setCustomId('back_to_main')
    .setLabel('Main Menu')
    .setEmoji('🏠')
    .setStyle(ButtonStyle.Primary);

  const components = [
    new ActionRowBuilder().addComponents(clearMemBtn, downloadBtn),
    new ActionRowBuilder().addComponents(backButton, mainMenuButton)
  ];

  const embed = new EmbedBuilder()
    .setColor(embedColor)
    .setTitle('👤 User Settings')
    .setDescription('**Page 3 of 3** • Data Management\n\nManage your conversation data and history.')
    .addFields(
      {
        name: '🧹 Clear Memory',
        value: 'Delete all conversation history and start fresh',
        inline: false
      },
      {
        name: '💾 Download History',
        value: 'Export your chat log as a text file',
        inline: false
      }
    )
    .setFooter({ text: 'Page 3 of 3 • Data Management' })
    .setTimestamp();

  const payload = {
    embeds: [embed],
    components: components,
    flags: MessageFlags.Ephemeral
  };

  if (isUpdate) await interaction.update(payload);
  else await interaction.reply(payload);
}

// ═══════════════════════════════════════════════════════════════════════════════
// SERVER SETTINGS - Page 1: Core Preferences
// ═══════════════════════════════════════════════════════════════════════════════

async function showServerSettings(interaction, isUpdate = false) {
  if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageGuild)) return sendPermError(interaction);

  const guildId = interaction.guild.id;
  const serverSettings = state.serverSettings[guildId] || {};
  const selectedModel = serverSettings.selectedModel || DEFAULT_SERVER_SETTINGS.selectedModel;
  const responseFormat = serverSettings.responseFormat || DEFAULT_SERVER_SETTINGS.responseFormat;
  const showActionButtons = serverSettings.showActionButtons ?? DEFAULT_SERVER_SETTINGS.showActionButtons;
  const embedColor = serverSettings.embedColor || BOT_CONFIG.HEX_COLOUR;
  

  const modelSelect = new StringSelectMenuBuilder()
    .setCustomId('server_model_select')
    .setPlaceholder('Select AI Model')
    .addOptions(
      new StringSelectMenuOptionBuilder()
        .setLabel('Gemini 3.0 Flash')
        .setDescription('Latest AI model - Pro-level intelligence at Flash speed')
        .setValue('gemini-2.5-flash')
        .setEmoji('⚡')
        .setDefault(true)
    );

  const responseFormatSelect = new StringSelectMenuBuilder()
    .setCustomId('server_response_format')
    .setPlaceholder('Response Format')
    .addOptions(
      new StringSelectMenuOptionBuilder()
        .setLabel('Normal')
        .setDescription('Plain text responses')
        .setValue('Normal')
        .setEmoji('📝')
        .setDefault(responseFormat === 'Normal'),
      new StringSelectMenuOptionBuilder()
        .setLabel('Embedded')
        .setDescription('Rich embed responses')
        .setValue('Embedded')
        .setEmoji('📊')
        .setDefault(responseFormat === 'Embedded')
    );

  const actionButtonsSelect = new StringSelectMenuBuilder()
    .setCustomId('server_action_buttons')
    .setPlaceholder('Action Buttons')
    .addOptions(
      new StringSelectMenuOptionBuilder()
        .setLabel('Show Buttons')
        .setDescription('Display Stop/Save/Delete buttons')
        .setValue('show')
        .setEmoji('✅')
        .setDefault(showActionButtons),
      new StringSelectMenuOptionBuilder()
        .setLabel('Hide Buttons')
        .setDescription('Hide action buttons')
        .setValue('hide')
        .setEmoji('❌')
        .setDefault(!showActionButtons)
    );

  const backButton = new ButtonBuilder()
    .setCustomId('back_to_main')
    .setLabel('Back to Menu')
    .setEmoji('◀️')
    .setStyle(ButtonStyle.Secondary);

  const nextButton = new ButtonBuilder()
    .setCustomId('server_settings_page2')
    .setLabel('Next Page')
    .setEmoji('▶️')
    .setStyle(ButtonStyle.Primary);

  const components = [
    new ActionRowBuilder().addComponents(modelSelect),
    new ActionRowBuilder().addComponents(responseFormatSelect),
    new ActionRowBuilder().addComponents(actionButtonsSelect),
    new ActionRowBuilder().addComponents(backButton, nextButton)
  ];

  const embed = new EmbedBuilder()
    .setColor(embedColor)
    .setTitle('🏰 Server Settings')
    .setDescription('**Page 1 of 5** • Core Preferences\n\nConfigure server-wide AI model and response settings.')
    .addFields(
      {
        name: '🤖 AI Model',
        value: `\`${selectedModel}\``,
        inline: true
      },
      {
        name: '📋 Response Format',
        value: `\`${responseFormat}\``,
        inline: true
      },
      {
        name: '🔘 Action Buttons',
        value: `\`${showActionButtons ? 'Visible' : 'Hidden'}\``,
        inline: true
      }
    )
    .setFooter({ text: 'Page 1 of 5 • Core Preferences' })
    .setTimestamp();

  const payload = {
    embeds: [embed],
    components: components,
    flags: MessageFlags.Ephemeral
  };

  if (isUpdate) await interaction.update(payload);
  else await interaction.reply(payload);
}

// ═══════════════════════════════════════════════════════════════════════════════
// SERVER SETTINGS - Page 2: Logic & Overrides
// ═══════════════════════════════════════════════════════════════════════════════

async function showServerSettingsPage2(interaction, isUpdate = false) {
  if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageGuild)) return sendPermError(interaction);
  
  const guildId = interaction.guild.id;
  const serverSettings = state.serverSettings[guildId] || {};
  const embedColor = serverSettings.embedColor || DEFAULT_BLACK;
  const overrideUserSettings = serverSettings.overrideUserSettings || false;
  const continuousReply = serverSettings.continuousReply || false;
  const serverChatHistory = serverSettings.serverChatHistory || false;

  const overrideSelect = new StringSelectMenuBuilder()
    .setCustomId('server_override')
    .setPlaceholder('Override User Settings')
    .addOptions(
      new StringSelectMenuOptionBuilder()
        .setLabel('Enabled')
        .setDescription('Server settings override user settings')
        .setValue('enabled')
        .setEmoji('🔒')
        .setDefault(overrideUserSettings),
      new StringSelectMenuOptionBuilder()
        .setLabel('Disabled')
        .setDescription('Users can use their own settings')
        .setValue('disabled')
        .setEmoji('🔓')
        .setDefault(!overrideUserSettings)
    );

  const continuousReplySelect = new StringSelectMenuBuilder()
    .setCustomId('server_continuous_reply')
    .setPlaceholder('Continuous Reply (Server-Wide)')
    .addOptions(
      new StringSelectMenuOptionBuilder()
        .setLabel('Enabled')
        .setDescription('Bot replies without mentions in all channels')
        .setValue('enabled')
        .setEmoji('🔄')
        .setDefault(continuousReply),
      new StringSelectMenuOptionBuilder()
        .setLabel('Disabled')
        .setDescription('Bot requires mentions (default)')
        .setValue('disabled')
        .setEmoji('⏸️')
        .setDefault(!continuousReply)
    );

  const chatHistorySelect = new StringSelectMenuBuilder()
    .setCustomId('server_chat_history')
    .setPlaceholder('Server-Wide Chat History')
    .addOptions(
      new StringSelectMenuOptionBuilder()
        .setLabel('Enabled')
        .setDescription('Share chat history across server')
        .setValue('enabled')
        .setEmoji('📚')
        .setDefault(serverChatHistory),
      new StringSelectMenuOptionBuilder()
        .setLabel('Disabled')
        .setDescription('Individual user histories')
        .setValue('disabled')
        .setEmoji('📖')
        .setDefault(!serverChatHistory)
    );

  const backButton = new ButtonBuilder()
    .setCustomId('back_to_server')
    .setLabel('Previous')
    .setEmoji('◀️')
    .setStyle(ButtonStyle.Secondary);

  const nextButton = new ButtonBuilder()
    .setCustomId('server_settings_page3')
    .setLabel('Next Page')
    .setEmoji('▶️')
    .setStyle(ButtonStyle.Primary);

  const components = [
    new ActionRowBuilder().addComponents(overrideSelect),
    new ActionRowBuilder().addComponents(continuousReplySelect),
    new ActionRowBuilder().addComponents(chatHistorySelect),
    new ActionRowBuilder().addComponents(backButton, nextButton)
  ];

  const embed = new EmbedBuilder()
    .setColor(embedColor)
    .setTitle('🏰 Server Settings')
    .setDescription('**Page 2 of 5** • Logic & Overrides\n\nConfigure server behavior and override settings.')
    .addFields(
      {
        name: '🔒 Override User Settings',
        value: `\`${overrideUserSettings ? 'Enabled' : 'Disabled'}\``,
        inline: true
      },
      {
        name: '🔄 Continuous Reply',
        value: `\`${continuousReply ? 'Enabled' : 'Disabled'}\``,
        inline: true
      },
      {
        name: '📚 Server-Wide History',
        value: `\`${serverChatHistory ? 'Enabled' : 'Disabled'}\``,
        inline: true
      }
    )
    .setFooter({ text: 'Page 2 of 5 • Logic & Overrides' })
    .setTimestamp();

  const payload = {
    embeds: [embed],
    components: components,
    flags: MessageFlags.Ephemeral
  };

  if (isUpdate) await interaction.update(payload);
  else await interaction.reply(payload);
}

// ═══════════════════════════════════════════════════════════════════════════════
// SERVER SETTINGS - Page 3: Appearance & Personality
// ═══════════════════════════════════════════════════════════════════════════════

async function showServerSettingsPage3(interaction, isUpdate = false) {
  if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageGuild)) return sendPermError(interaction);
  
  const guildId = interaction.guild.id;
  const serverSettings = state.serverSettings[guildId] || {};
  const embedColor = serverSettings.embedColor || DEFAULT_BLACK;
  const hasPersonality = !!serverSettings.customPersonality;

  const colorBtn = new ButtonBuilder()
    .setCustomId('server_embed_color')
    .setLabel('Embed Color')
    .setEmoji('🎨')
    .setStyle(ButtonStyle.Secondary);

  const personalityBtn = new ButtonBuilder()
    .setCustomId('server_custom_personality')
    .setLabel('Set Personality')
    .setEmoji('🎭')
    .setStyle(ButtonStyle.Primary);

  const removePersonalityBtn = new ButtonBuilder()
    .setCustomId('server_remove_personality')
    .setLabel('Reset')
    .setEmoji('🗑️')
    .setStyle(ButtonStyle.Danger)
    .setDisabled(!hasPersonality);

  const backButton = new ButtonBuilder()
    .setCustomId('back_to_server_p2')
    .setLabel('Previous')
    .setEmoji('◀️')
    .setStyle(ButtonStyle.Secondary);

  const nextButton = new ButtonBuilder()
    .setCustomId('server_settings_page4')
    .setLabel('Next Page')
    .setEmoji('▶️')
    .setStyle(ButtonStyle.Primary);

  const components = [
    new ActionRowBuilder().addComponents(colorBtn, personalityBtn, removePersonalityBtn),
    new ActionRowBuilder().addComponents(backButton, nextButton)
  ];

  const embed = new EmbedBuilder()
    .setColor(embedColor)
    .setTitle('🏰 Server Settings')
    .setDescription('**Page 3 of 5** • Appearance & Personality\n\nCustomize the server\'s visual theme and bot personality.')
    .addFields(
      {
        name: '🎨 Embed Color',
        value: `\`${embedColor}\``,
        inline: true
      },
      {
        name: '🎭 Custom Personality',
        value: `\`${hasPersonality ? 'Active' : 'Default'}\``,
        inline: true
      }
    )
    .setFooter({ text: 'Page 3 of 5 • Appearance & Personality' })
    .setTimestamp();

  const payload = {
    embeds: [embed],
    components: components,
    flags: MessageFlags.Ephemeral
  };

  if (isUpdate) await interaction.update(payload);
  else await interaction.reply(payload);
}

// ═══════════════════════════════════════════════════════════════════════════════
// SERVER SETTINGS - Page 4: Channel Management
// ═══════════════════════════════════════════════════════════════════════════════

async function showServerSettingsPage4(interaction, isUpdate = false) {
  if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
    return sendPermError(interaction);
  }

  const guildId = interaction.guild.id;
  const serverSettings = state.serverSettings[guildId] || {};
  const embedColor = serverSettings.embedColor || DEFAULT_BLACK;
  const allowedChannels = serverSettings.allowedChannels || [];

  const manageChannelsBtn = new ButtonBuilder()
    .setCustomId('manage_allowed_channels')
    .setLabel('Manage Channels')
    .setEmoji('📢')
    .setStyle(ButtonStyle.Primary);

  const toggleContinuousBtn = new ButtonBuilder()
    .setCustomId('toggle_continuous_reply')
    .setLabel('Toggle Channel Mode')
    .setEmoji('🔄')
    .setStyle(ButtonStyle.Secondary);

  const backButton = new ButtonBuilder()
    .setCustomId('back_to_server_p3')
    .setLabel('Previous')
    .setEmoji('◀️')
    .setStyle(ButtonStyle.Secondary);

  const nextButton = new ButtonBuilder()
    .setCustomId('server_settings_page5')
    .setLabel('Next Page')
    .setEmoji('▶️')
    .setStyle(ButtonStyle.Primary);

  const components = [
    new ActionRowBuilder().addComponents(manageChannelsBtn, toggleContinuousBtn),
    new ActionRowBuilder().addComponents(backButton, nextButton)
  ];

  const channelList = allowedChannels.length > 0 ?
    allowedChannels.map(id => `<#${id}>`).slice(0, 5).join(', ') + (allowedChannels.length > 5 ? ` +${allowedChannels.length - 5} more` : '') :
    'All channels allowed';

  const embed = new EmbedBuilder()
    .setColor(embedColor)
    .setTitle('🏰 Server Settings')
    .setDescription('**Page 4 of 5** • Channel Management\n\nControl which channels the bot can respond in.')
    .addFields(
      {
        name: '📢 Allowed Channels',
        value: channelList,
        inline: false
      },
      {
        name: '🔄 Channel-Specific Mode',
        value: 'Enable or disable continuous mode for the current channel',
        inline: false
      }
    )
    .setFooter({ text: 'Page 4 of 5 • Channel Management' })
    .setTimestamp();

  const payload = {
    embeds: [embed],
    components: components,
    flags: MessageFlags.Ephemeral
  };

  if (isUpdate) await interaction.update(payload);
  else await interaction.reply(payload);
}

// ═══════════════════════════════════════════════════════════════════════════════
// SERVER SETTINGS - Page 5: Data Management
// ═══════════════════════════════════════════════════════════════════════════════

async function showServerSettingsPage5(interaction, isUpdate = false) {
  if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
    return sendPermError(interaction);
  }

  const guildId = interaction.guild.id;
  const serverSettings = state.serverSettings[guildId] || {};
  const embedColor = serverSettings.embedColor || DEFAULT_BLACK;

  const clearMemBtn = new ButtonBuilder()
    .setCustomId('clear_server_memory')
    .setLabel('Clear Memory')
    .setEmoji('🧹')
    .setStyle(ButtonStyle.Danger);

  const downloadBtn = new ButtonBuilder()
    .setCustomId('download_server_conversation')
    .setLabel('Download History')
    .setEmoji('💾')
    .setStyle(ButtonStyle.Success);

  const backButton = new ButtonBuilder()
    .setCustomId('back_to_server_p4')
    .setLabel('Previous')
    .setEmoji('◀️')
    .setStyle(ButtonStyle.Secondary);

  const mainMenuButton = new ButtonBuilder()
    .setCustomId('back_to_main')
    .setLabel('Main Menu')
    .setEmoji('🏠')
    .setStyle(ButtonStyle.Primary);

  const components = [
    new ActionRowBuilder().addComponents(clearMemBtn, downloadBtn),
    new ActionRowBuilder().addComponents(backButton, mainMenuButton)
  ];

  const embed = new EmbedBuilder()
    .setColor(embedColor)
    .setTitle('🏰 Server Settings')
    .setDescription('**Page 5 of 5** • Data Management\n\nManage server-wide conversation data and history.')
    .addFields(
      {
        name: '🧹 Clear Server Memory',
        value: 'Delete all server conversation history and start fresh',
        inline: false
      },
      {
        name: '💾 Download Server History',
        value: 'Export the complete server chat log as a text file',
        inline: false
      }
    )
    .setFooter({ text: 'Page 5 of 5 • Data Management' })
    .setTimestamp();

  const payload = {
    embeds: [embed],
    components: components,
    flags: MessageFlags.Ephemeral
  };

  if (isUpdate) await interaction.update(payload);
  else await interaction.reply(payload);
}

// ═══════════════════════════════════════════════════════════════════════════════
// CHANNEL MANAGEMENT MENU
// ═══════════════════════════════════════════════════════════════════════════════

async function showChannelManagementMenu(interaction, isUpdate = false) {
  if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
    return sendPermError(interaction);
  }

  const guildId = interaction.guild.id;
  const serverSettings = state.serverSettings[guildId] || {};
  const allowedChannels = serverSettings.allowedChannels || [];
  const embedColor = serverSettings.embedColor || DEFAULT_BLACK;

  const channelSelect = new ChannelSelectMenuBuilder()
    .setCustomId('channel_manage_select')
    .setPlaceholder('Select channels the bot can be used in')
    .setMinValues(0)
    .setMaxValues(25)
    .setChannelTypes([ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildForum]);

  if (allowedChannels.length > 0) {
    const validDefaultChannels = [];
    for (const channelId of allowedChannels) {
      if (interaction.guild.channels.cache.has(channelId)) {
        validDefaultChannels.push(channelId);
      }
    }
    if (validDefaultChannels.length > 0) {
      channelSelect.setDefaultChannels(validDefaultChannels.slice(0, 25));
    }
  }

  const row = new ActionRowBuilder().addComponents(channelSelect);

  const setAllBtn = new ButtonBuilder()
    .setCustomId('set_all_channels')
    .setLabel('Allow All Channels')
    .setEmoji('🌍')
    .setStyle(ButtonStyle.Success);

  const backBtn = new ButtonBuilder()
    .setCustomId('back_to_server_p4')
    .setLabel('Back to Settings')
    .setEmoji('◀️')
    .setStyle(ButtonStyle.Secondary);

  const buttons = new ActionRowBuilder().addComponents(backBtn, setAllBtn);

  const embed = new EmbedBuilder()
    .setColor(embedColor)
    .setTitle('📢 Channel Management')
    .setDescription('**Configure allowed channels**\n\n' +
      '• Select specific channels where the bot can respond\n' +
      '• Leave empty to allow all channels\n' +
      '• Changes save automatically')
    .setFooter({ text: 'Channel Management • Select channels from the menu below' });

  if (allowedChannels.length > 0) {
    embed.addFields({
      name: '✅ Currently Allowed',
      value: allowedChannels.map(id => `<#${id}>`).join(', ') || 'None'
    });
  } else {
    embed.addFields({
      name: '✅ Currently Allowed',
      value: '**All Channels**'
    });
  }

  const payload = {
    embeds: [embed],
    components: [row, buttons],
    flags: MessageFlags.Ephemeral
  };

  if (isUpdate) {
    await interaction.update(payload);
  } else {
    await interaction.reply(payload);
  }

  setTimeout(async () => {
    try {
      const currentReply = await interaction.fetchReply().catch(() => null);
      if (currentReply) {
        await interaction.deleteReply();
      }
    } catch (error) {
      if (error.code !== 10008) {
        console.error('Error deleting expired settings message:', error);
      }
    }
  }, 300000);
}

// ═══════════════════════════════════════════════════════════════════════════════
// ACTION HANDLERS
// ═══════════════════════════════════════════════════════════════════════════════

async function clearUserMemory(interaction) {
  const userId = interaction.user.id;
  state.chatHistories[userId] = {};
  await persistChatHistory(userId);

  const embed = new EmbedBuilder()
    .setColor(0x00FF00)
    .setTitle('✅ Memory Cleared')
    .setDescription('Your chat history has been cleared successfully!');
  await interaction.reply({
    embeds: [embed],
    flags: MessageFlags.Ephemeral
  });
}

async function clearServerMemory(interaction) {
  if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
    return sendPermError(interaction);
  }

  const guildId = interaction.guild.id;
  state.chatHistories[guildId] = {};
  await persistChatHistory(guildId);

  const embed = new EmbedBuilder()
    .setColor(0x00FF00)
    .setTitle('✅ Server Memory Cleared')
    .setDescription('Server-wide chat history has been cleared successfully!');
  await interaction.reply({
    embeds: [embed],
    flags: MessageFlags.Ephemeral
  });
}

async function downloadUserConversation(interaction) {
  const userId = interaction.user.id;
  const conversationHistory = getHistory(userId);

  if (!conversationHistory || conversationHistory.length === 0) {
    const embed = new EmbedBuilder()
      .setColor(0xFF5555)
      .setTitle('❌ No History Found')
      .setDescription('You don\'t have any conversation history to download.');
    return interaction.reply({
      embeds: [embed],
      flags: MessageFlags.Ephemeral
    });
  }

  let conversationText = conversationHistory.map(entry => {
    const role = entry.role === 'user' ? '[User]' : '[Model]';
    const content = entry.parts.map(c => c.text).join('\n');
    return `${role}:\n${content}\n\n`;
  }).join('');

  const tempFileName = path.join(TEMP_DIR, `conversation_${interaction.id}.txt`);
  await fs.writeFile(tempFileName, conversationText, 'utf8');

  const stats = await fs.stat(tempFileName);
  const fileSizeMB = stats.size / (1024 * 1024);
  const MAX_DISCORD_MB = 9.5;

  const isDM = interaction.channel.type === ChannelType.DM;
  const historyType = isDM ? 'DM History' : 'Personal History';
  
  let fileSent = false;
  let fallbackEmbed;

  if (fileSizeMB <= MAX_DISCORD_MB) {
    const file = new AttachmentBuilder(tempFileName, {
      name: 'conversation_history.txt'
    });

    try {
      await interaction.user.send({
        content: `📥 **Your Conversation History**\n\`${historyType}\``,
        files: [file]
      });
      
      await interaction.reply({
        embeds: [new EmbedBuilder().setColor(0x00FF00).setTitle('✅ History Sent').setDescription('Your conversation history has been sent to your DMs!')],
        flags: MessageFlags.Ephemeral
      });
      fileSent = true;
    } catch (error) {
      console.error(`Discord Send Error for ${tempFileName}:`, error);
      fallbackEmbed = new EmbedBuilder()
        .setColor(0xFFAA00)
        .setTitle('❌ DM Failed / Upload Error')
        .setDescription('Could not send the history file via DM. Attempting external upload fallback.');
    }
  } else {
    fallbackEmbed = new EmbedBuilder()
      .setColor(0xFFAA00)
      .setTitle('🔗 History Too Large')
      .setDescription(`The conversation history is too large (${fileSizeMB.toFixed(2)} MB) to send directly via Discord. It will be uploaded to an external site.`);
  }

  if (!fileSent) {
    const { uploadText } = await import('./utils.js');
    const msgUrlText = await uploadText(conversationText);
    const msgUrl = msgUrlText.match(/🔗 URL: (.+)/)?.[1] || 'URL generation failed.';

    const finalEmbed = fallbackEmbed || new EmbedBuilder()
      .setColor(0xFFAA00)
      .setTitle('🔗 History Upload Fallback');
      
    finalEmbed.addFields({
      name: 'External Link',
      value: `[View History Content](${msgUrl})`,
      inline: false
    });

    await interaction.reply({
      embeds: [finalEmbed],
      flags: MessageFlags.Ephemeral
    });
  }

  await fs.unlink(tempFileName).catch(() => {});
}

async function downloadServerConversation(interaction) {
  if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
    return sendPermError(interaction);
  }

  const guildId = interaction.guild.id;
  const serverSettings = state.serverSettings[guildId] || {};
  
  if (!serverSettings.serverChatHistory) {
    const embed = new EmbedBuilder()
      .setColor(0xFF5555)
      .setTitle('❌ Server Chat History Disabled')
      .setDescription('Server-wide chat history is not enabled. Enable it in server settings to use this feature.');
    return interaction.reply({
      embeds: [embed],
      flags: MessageFlags.Ephemeral
    });
  }

  const historyObject = state.chatHistories[guildId];
  
  if (!historyObject || Object.keys(historyObject).length === 0) {
    const embed = new EmbedBuilder()
      .setColor(0xFF5555)
      .setTitle('❌ No History Found')
      .setDescription('No server-wide conversation history found. Start chatting with the bot to build history!');
    return interaction.reply({
      embeds: [embed],
      flags: MessageFlags.Ephemeral
    });
  }

  let conversationText = '';
  let messageCount = 0;
  
  for (const messagesId in historyObject) {
    if (historyObject.hasOwnProperty(messagesId)) {
      const messages = historyObject[messagesId];
      
      for (const entry of messages) {
        const role = entry.role === 'user' ? '[User]' : '[Assistant]';
        const contentParts = [];
        
        for (const part of entry.content) {
          if (part.text !== undefined && part.text !== '') {
            contentParts.push(part.text);
          } else if (part.fileUri || part.fileData) {
            contentParts.push('[Media File Attached]');
          }
        }
        
        if (contentParts.length > 0) {
          const content = contentParts.join('\n');
          conversationText += `${role}:\n${content}\n\n`;
          messageCount++;
        }
      }
    }
  }

  if (conversationText === '' || messageCount === 0) {
    const embed = new EmbedBuilder()
      .setColor(0xFF5555)
      .setTitle('❌ No Readable History')
      .setDescription('History exists but contains no readable content (possibly only media without text).');
    return interaction.reply({
      embeds: [embed],
      flags: MessageFlags.Ephemeral
    });
  }

  const tempFileName = path.join(TEMP_DIR, `server_conversation_${interaction.id}.txt`);
  const header = `Server Conversation History\nServer: ${interaction.guild.name}\nMessages: ${messageCount}\nExported: ${new Date().toLocaleString()}\n${'='.repeat(50)}\n\n`;
  await fs.writeFile(tempFileName, header + conversationText, 'utf8');

  const stats = await fs.stat(tempFileName);
  const fileSizeMB = stats.size / (1024 * 1024);
  const MAX_DISCORD_MB = 9.5;
  const serverName = interaction.guild.name;
  
  let fileSent = false;
  let fallbackEmbed;

  if (fileSizeMB <= MAX_DISCORD_MB) {
    const file = new AttachmentBuilder(tempFileName, {
      name: `${serverName.replace(/[^a-z0-9]/gi, '_')}_history.txt`
    });

    try {
      await interaction.user.send({
        content: `📥 **Server Conversation History**\n\`Server: ${serverName}\`\n\`Messages: ${messageCount}\``,
        files: [file]
      });
      
      await interaction.reply({
        embeds: [new EmbedBuilder().setColor(0x00FF00).setTitle('✅ History Sent').setDescription(`Server conversation history (${messageCount} messages) has been sent to your DMs!`)],
        flags: MessageFlags.Ephemeral
      });
      fileSent = true;
    } catch (error) {
      console.error(`Discord Send Error for ${tempFileName}:`, error);
      fallbackEmbed = new EmbedBuilder()
        .setColor(0xFFAA00)
        .setTitle('❌ DM Failed / Upload Error')
        .setDescription('Could not send the history file via DM. Attempting external upload fallback.');
    }
  } else {
    fallbackEmbed = new EmbedBuilder()
      .setColor(0xFFAA00)
      .setTitle('🔗 History Too Large')
      .setDescription(`The server history is too large (${fileSizeMB.toFixed(2)} MB) to send directly via Discord. It will be uploaded to an external site.`);
  }

  if (!fileSent) {
    const { uploadText } = await import('./utils.js');
    const msgUrlText = await uploadText(conversationText);
    const msgUrl = msgUrlText.match(/🔗 URL: (.+)/)?.[1] || 'URL generation failed.';

    const finalEmbed = fallbackEmbed || new EmbedBuilder()
      .setColor(0xFFAA00)
      .setTitle('🔗 History Upload Fallback');
      
    finalEmbed.addFields({
      name: 'External Link',
      value: `[View History Content](${msgUrl})`,
      inline: false
    });
    
    await interaction.reply({
      embeds: [finalEmbed],
      flags: MessageFlags.Ephemeral
    });
  }

  await fs.unlink(tempFileName).catch(() => {});
}

async function showUserPersonalityModal(interaction) {
  const userId = interaction.user.id;
  const userSettings = state.userSettings[userId] || {};
  const existingPersonality = userSettings.customPersonality || '';

  const input = new TextInputBuilder()
    .setCustomId('personality_input')
    .setLabel("What should the bot's personality be like?")
    .setStyle(TextInputStyle.Paragraph)
    .setPlaceholder("Enter your custom personality instructions...")
    .setMinLength(10)
    .setMaxLength(4000);

  if (existingPersonality) {
    input.setValue(existingPersonality);
  }

  const modal = new ModalBuilder()
    .setCustomId('user_personality_modal')
    .setTitle('Custom Personality')
    .addComponents(new ActionRowBuilder().addComponents(input));

  await interaction.showModal(modal);
}

async function showServerPersonalityModal(interaction) {
  if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
    return sendPermError(interaction);
  }

  const guildId = interaction.guild.id;
  const serverSettings = state.serverSettings[guildId] || {};
  const existingPersonality = serverSettings.customPersonality || '';

  const input = new TextInputBuilder()
    .setCustomId('personality_input')
    .setLabel("What should the bot's personality be like?")
    .setStyle(TextInputStyle.Paragraph)
    .setPlaceholder("Enter server custom personality instructions...")
    .setMinLength(10)
    .setMaxLength(4000);

  if (existingPersonality) {
    input.setValue(existingPersonality);
  }

  const modal = new ModalBuilder()
    .setCustomId('server_personality_modal')
    .setTitle('Server Custom Personality')
    .addComponents(new ActionRowBuilder().addComponents(input));

  await interaction.showModal(modal);
}

async function removeUserPersonality(interaction) {
  const userId = interaction.user.id;
  if (state.userSettings[userId]) {
    delete state.userSettings[userId].customPersonality;
  }
  if (state.customInstructions && state.customInstructions[userId]) {
    delete state.customInstructions[userId]; 
  }
  // Write both affected records directly to DB so they survive a force-kill
  await Promise.all([
    persistUser(userId),
    persistInstructions(userId, null)
  ]);

  const embed = new EmbedBuilder()
    .setColor(0x00FF00)
    .setTitle('✅ Personality Removed')
    .setDescription('Your custom personality has been removed!');
  await interaction.reply({
    embeds: [embed],
    flags: MessageFlags.Ephemeral
  });
}

async function removeServerPersonality(interaction) {
  if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
    return sendPermError(interaction);
  }

  const guildId = interaction.guild.id;
  if (state.serverSettings[guildId]) {
    delete state.serverSettings[guildId].customPersonality;
  }
  if (state.customInstructions && state.customInstructions[guildId]) {
    delete state.customInstructions[guildId];
  }
  await Promise.all([
    persistServer(guildId),
    persistInstructions(guildId, null)
  ]);

  const embed = new EmbedBuilder()
    .setColor(0x00FF00)
    .setTitle('✅ Server Personality Removed')
    .setDescription('Server custom personality has been removed!');
  await interaction.reply({
    embeds: [embed],
    flags: MessageFlags.Ephemeral
  });
}

async function showUserEmbedColorModal(interaction) {
  const userId = interaction.user.id;
  const userSettings = state.userSettings[userId] || {};
  const existingColor = userSettings.embedColor || hexColour;

  const input = new TextInputBuilder()
    .setCustomId('color_input')
    .setLabel('Enter Hex Color Code')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('#FF5733 or FF5733')
    .setMinLength(6)
    .setMaxLength(7);

  if (existingColor) {
    input.setValue(existingColor);
  }

  const modal = new ModalBuilder()
    .setCustomId('user_embed_color_modal')
    .setTitle('Embed Color Customization')
    .addComponents(new ActionRowBuilder().addComponents(input));

  await interaction.showModal(modal);
}

async function showServerEmbedColorModal(interaction) {
  if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
    return sendPermError(interaction);
  }

  const guildId = interaction.guild.id;
  const serverSettings = state.serverSettings[guildId] || {};
  const existingColor = serverSettings.embedColor || hexColour;

  const input = new TextInputBuilder()
    .setCustomId('color_input')
    .setLabel('Enter Hex Color Code')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('#FF5733 or FF5733')
    .setMinLength(6)
    .setMaxLength(7);

  if (existingColor) {
    input.setValue(existingColor);
  }

  const modal = new ModalBuilder()
    .setCustomId('server_embed_color_modal')
    .setTitle('Server Embed Color')
    .addComponents(new ActionRowBuilder().addComponents(input));

  await interaction.showModal(modal);
}

async function handleChannelManageSelect(interaction) {
  if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
    return sendPermError(interaction);
  }

  const guildId = interaction.guild.id;
  const selectedChannelIds = interaction.values;

  if (!state.serverSettings[guildId]) {
    state.serverSettings[guildId] = {};
  }

  state.serverSettings[guildId].allowedChannels = selectedChannelIds;
  await persistServer(guildId);

  await showChannelManagementMenu(interaction, true);
}

async function handleSetAllChannels(interaction) {
  if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
    return sendPermError(interaction);
  }

  const guildId = interaction.guild.id;
  if (!state.serverSettings[guildId]) {
    state.serverSettings[guildId] = {};
  }

  state.serverSettings[guildId].allowedChannels = [];
  await persistServer(guildId);

  await showChannelManagementMenu(interaction, true);
}

async function toggleContinuousReplyChannel(interaction) {
  if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
    return sendPermError(interaction);
  }

  const channelId = interaction.channelId;
  if (!state.continuousReplyChannels) {
    state.continuousReplyChannels = {};
  }

  const newValue = !state.continuousReplyChannels[channelId];
  if (newValue) {
    state.continuousReplyChannels[channelId] = true;
  } else {
    delete state.continuousReplyChannels[channelId];
  }
  await persistChannelSetting(channelId, 'continuousReply', newValue || null);

  const embed = newValue
    ? new EmbedBuilder()
        .setColor(0x00FF00)
        .setTitle('📢 Continuous Reply Enabled')
        .setDescription(`The bot will now reply to all messages in <#${channelId}> without requiring mentions.`)
    : new EmbedBuilder()
        .setColor(0xFFAA00)
        .setTitle('📢 Continuous Reply Disabled')
        .setDescription(`The bot will no longer reply to all messages in <#${channelId}>.`);

  await interaction.reply({
    embeds: [embed],
    flags: MessageFlags.Ephemeral
  });
}

async function handleDeleteMessageInteraction(interaction, customIdData) {
  // Parse the custom ID: delete_message-{msgId}-{userId}
  // customIdData will be: "{msgId}-{userId}"
  const lastDashIndex = customIdData.lastIndexOf('-');
  
  if (lastDashIndex === -1) {
    // Fallback for old format without userId
    const embed = new EmbedBuilder()
      .setColor(0xFF0000)
      .setTitle('🚫 Authorization Error')
      .setDescription('Unable to verify authorization for this message.');
      
    return interaction.reply({
      embeds: [embed],
      flags: MessageFlags.Ephemeral
    });
  }
  
  const userId = customIdData.substring(lastDashIndex + 1);
  const clickerId = interaction.user.id;

  // Verify authorization
  if (clickerId === userId) {
    await interaction.message.delete().catch(() => {});
  } else {
    const embed = new EmbedBuilder()
      .setColor(0xFF0000)
      .setTitle('🚫 Not Authorized')
      .setDescription('Only the user who triggered this response can delete it.');
      
    return interaction.reply({
      embeds: [embed],
      flags: MessageFlags.Ephemeral
    });
  }
}

  async function deleteMsg() {
    await interaction.message.delete()
      .catch(err => console.error('Error deleting interaction message:', err));

    if (channel && message) {
      message.delete().catch(() => {});
    }
  }

async function downloadMessage(interaction) {
  const message = interaction.message;
  let textContent = message.content;
  if (!textContent && message.embeds.length > 0) {
    textContent = message.embeds[0].description;
  }

  if (!textContent) {
    const embed = new EmbedBuilder()
      .setColor(0xFF5555)
      .setTitle('❌ Empty Message')
      .setDescription('The message appears to be empty.');
    await interaction.reply({
      embeds: [embed],
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const filePath = path.join(TEMP_DIR, `message_content_${interaction.id}.txt`);
  await fs.writeFile(filePath, textContent, 'utf8');

  const attachment = new AttachmentBuilder(filePath, {
    name: 'message_content.txt'
  });

  const initialEmbed = new EmbedBuilder()
    .setColor(0x00FF00)
    .setTitle('💾 Message Saved')
    .setDescription('The message content has been prepared for download.');

  let response;
  if (interaction.channel.type === ChannelType.DM) {
    response = await interaction.reply({
      embeds: [initialEmbed],
      files: [attachment]
    });
    response = await interaction.fetchReply();
  } else {
    try {
      response = await interaction.user.send({
        embeds: [initialEmbed],
        files: [attachment]
      });
      const dmSentEmbed = new EmbedBuilder()
        .setColor(0x00FF00)
        .setTitle('✅ Sent to DMs')
        .setDescription('The message content has been sent to your DMs!');
      await interaction.reply({
        embeds: [dmSentEmbed],
        flags: MessageFlags.Ephemeral
      });
    } catch (error) {
      console.error(`Failed to send DM: ${error}`);
      const failDMEmbed = new EmbedBuilder()
        .setColor(0xFF5555)
        .setTitle('❌ DM Failed')
        .setDescription('Could not send to DMs. Here is the file:');
      response = await interaction.reply({
        embeds: [failDMEmbed],
        files: [attachment],
        flags: MessageFlags.Ephemeral
      });
      response = await interaction.fetchReply();
    }
  }

  await fs.unlink(filePath).catch(() => {});

  const { uploadText } = await import('./utils.js');
  const msgUrl = await uploadText(textContent);
  const updatedEmbed = EmbedBuilder.from(response.embeds[0])
    .setDescription(`The message content has been saved.\n${msgUrl}`);

  if (interaction.channel.type === ChannelType.DM) {
    await interaction.editReply({
      embeds: [updatedEmbed]
    });
  } else {
    await response.edit({
      embeds: [updatedEmbed]
    });
  }
}

function sendPermError(interaction) {
  const embed = new EmbedBuilder()
    .setColor(0xFF0000)
    .setTitle('🚫 Permission Denied')
    .setDescription('You need "Manage Server" permission to access server settings.');
  return interaction.reply({
    embeds: [embed],
    flags: MessageFlags.Ephemeral
  });
}

export { showMainSettings };
