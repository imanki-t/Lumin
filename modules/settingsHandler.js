import { 
  EmbedBuilder, 
  MessageFlags, 
  ButtonBuilder, 
  ButtonStyle, 
  ActionRowBuilder, 
  PermissionsBitField, 
  StringSelectMenuBuilder, 
  StringSelectMenuOptionBuilder, 
  ChannelSelectMenuBuilder, 
  ChannelType, 
  ModalBuilder, 
  TextInputBuilder, 
  TextInputStyle, 
  AttachmentBuilder 
} from 'discord.js';
import path from 'path';
import fs from 'fs/promises';
import { state, saveStateToFile, chatHistoryLock, getHistory, TEMP_DIR } from '../botManager.js';
import config from '../config.js';

// ═══════════════════════════════════════════════════════════════════════════════
// CONFIGURATION & CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════════

// Color Constants
const COLORS = Object.freeze({
  PRIMARY: 0x2B2D31,      // Dark slate
  SUCCESS: 0x43B581,      // Green
  WARNING: 0xFAA61A,      // Orange
  ERROR: 0xF04747,        // Red
  INFO: 0x5865F2,         // Blurple
  DEFAULT: 0x000000,      // Black
  ACCENT: 0x7289DA        // Light blurple
});

// Model Configuration
const MODELS = Object.freeze({
  GEMINI_FLASH: {
    value: 'gemini-2.5-flash',
    label: 'Gemini 3.0 Flash',
    description: 'Latest model - Pro-level intelligence at Flash speed',
    icon: '⚡'
  },
  // Add more models here as needed
});

// Default model
const DEFAULT_MODEL = MODELS.GEMINI_FLASH.value;

// Response Format Options
const RESPONSE_FORMATS = Object.freeze({
  NORMAL: { value: 'Normal', label: 'Normal', description: 'Plain text responses', icon: '▪' },
  EMBEDDED: { value: 'Embedded', label: 'Embedded', description: 'Rich embed responses', icon: '▫' }
});

// UI Symbols (minimalistic, no emoji)
const SYMBOLS = Object.freeze({
  // Navigation
  BACK: '◀',
  FORWARD: '▶',
  HOME: '⌂',
  SETTINGS: '⚙',
  
  // Actions
  SAVE: '↓',
  DELETE: '×',
  CLEAR: '⌫',
  DOWNLOAD: '↓',
  UPLOAD: '↑',
  TOGGLE: '⇄',
  
  // Status
  ENABLED: '●',
  DISABLED: '○',
  SUCCESS: '✓',
  ERROR: '✗',
  WARNING: '⚠',
  INFO: 'ⓘ',
  LOCKED: '⚿',
  UNLOCKED: '⚿',
  
  // Categories
  USER: '◉',
  SERVER: '◈',
  CHANNEL: '▣',
  MODEL: '◆',
  FORMAT: '◇',
  COLOR: '◐',
  PERSONALITY: '◎',
  MEMORY: '◔',
  HISTORY: '◑',
  
  // Misc
  BULLET: '•',
  ARROW: '→',
  DOT: '·'
});

// Button Custom IDs
const BUTTON_IDS = Object.freeze({
  // Main Menu
  SETTINGS_MAIN: 'settings_main',
  
  // User Settings
  USER_SETTINGS: 'user_settings',
  USER_SETTINGS_P2: 'user_settings_page2',
  USER_SETTINGS_P3: 'user_settings_page3',
  USER_COLOR: 'user_embed_color',
  USER_PERSONALITY: 'user_custom_personality',
  USER_PERSONALITY_REMOVE: 'user_remove_personality',
  USER_MEMORY_CLEAR: 'clear_user_memory',
  USER_DOWNLOAD: 'download_user_conversation',
  
  // Server Settings
  SERVER_SETTINGS: 'server_settings',
  SERVER_SETTINGS_P2: 'server_settings_page2',
  SERVER_SETTINGS_P3: 'server_settings_page3',
  SERVER_SETTINGS_P4: 'server_settings_page4',
  SERVER_SETTINGS_P5: 'server_settings_page5',
  SERVER_COLOR: 'server_embed_color',
  SERVER_PERSONALITY: 'server_custom_personality',
  SERVER_PERSONALITY_REMOVE: 'server_remove_personality',
  SERVER_MEMORY_CLEAR: 'clear_server_memory',
  SERVER_DOWNLOAD: 'download_server_conversation',
  SERVER_CHANNELS: 'manage_allowed_channels',
  SERVER_TOGGLE_CHANNEL: 'toggle_continuous_reply',
  SERVER_ALL_CHANNELS: 'set_all_channels',
  
  // Navigation
  BACK_TO_MAIN: 'back_to_main',
  BACK_TO_USER: 'back_to_user',
  BACK_TO_USER_P2: 'back_to_user_p2',
  BACK_TO_SERVER: 'back_to_server',
  BACK_TO_SERVER_P2: 'back_to_server_p2',
  BACK_TO_SERVER_P3: 'back_to_server_p3',
  BACK_TO_SERVER_P4: 'back_to_server_p4',
  
  // Message Actions
  DOWNLOAD_MESSAGE: 'download_message',
  DELETE_MESSAGE_PREFIX: 'delete_message-'
});

// Select Menu Custom IDs
const SELECT_IDS = Object.freeze({
  USER_MODEL: 'user_model_select',
  USER_FORMAT: 'user_response_format',
  USER_BUTTONS: 'user_action_buttons',
  USER_CONTINUOUS: 'user_continuous_reply',
  
  SERVER_MODEL: 'server_model_select',
  SERVER_FORMAT: 'server_response_format',
  SERVER_BUTTONS: 'server_action_buttons',
  SERVER_CONTINUOUS: 'server_continuous_reply',
  SERVER_OVERRIDE: 'server_override',
  SERVER_HISTORY: 'server_chat_history',
  
  CHANNEL_MANAGE: 'channel_manage_select'
});

// Modal Custom IDs
const MODAL_IDS = Object.freeze({
  USER_PERSONALITY: 'user_personality_modal',
  USER_COLOR: 'user_embed_color_modal',
  SERVER_PERSONALITY: 'server_personality_modal',
  SERVER_COLOR: 'server_embed_color_modal'
});

// Timeout for settings messages (5 minutes)
const SETTINGS_TIMEOUT = 300000;

// Maximum message length for downloads
const MAX_DOWNLOAD_LENGTH = 500000;

// ═══════════════════════════════════════════════════════════════════════════════
// INTERACTION HANDLERS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Main button interaction handler
 */
export async function handleButtonInteraction(interaction) {
  if (!interaction.isButton()) return;

  const guildId = interaction.guild?.id;
  const userId = interaction.user.id;

  // Blacklist check
  if (guildId) {
    const { initializeBlacklistForGuild } = await import('./utils.js');
    initializeBlacklistForGuild(guildId);
    if (state.blacklistedUsers[guildId]?.includes(userId)) {
      return sendErrorEmbed(interaction, 'Access Denied', 'You are blacklisted from using this bot.');
    }
  }

  // Button handler mapping
  const handlers = {
    [BUTTON_IDS.SETTINGS_MAIN]: () => showMainSettings(interaction, true),
    [BUTTON_IDS.USER_SETTINGS]: () => showUserSettings(interaction, true),
    [BUTTON_IDS.USER_SETTINGS_P2]: () => showUserSettingsPage2(interaction, true),
    [BUTTON_IDS.USER_SETTINGS_P3]: () => showUserSettingsPage3(interaction, true),
    [BUTTON_IDS.USER_COLOR]: () => showUserColorModal(interaction),
    [BUTTON_IDS.USER_PERSONALITY]: () => showUserPersonalityModal(interaction),
    [BUTTON_IDS.USER_PERSONALITY_REMOVE]: () => removeUserPersonality(interaction),
    [BUTTON_IDS.USER_MEMORY_CLEAR]: () => clearUserMemory(interaction),
    [BUTTON_IDS.USER_DOWNLOAD]: () => downloadUserConversation(interaction),
    
    [BUTTON_IDS.SERVER_SETTINGS]: () => showServerSettings(interaction, true),
    [BUTTON_IDS.SERVER_SETTINGS_P2]: () => showServerSettingsPage2(interaction, true),
    [BUTTON_IDS.SERVER_SETTINGS_P3]: () => showServerSettingsPage3(interaction, true),
    [BUTTON_IDS.SERVER_SETTINGS_P4]: () => showServerSettingsPage4(interaction, true),
    [BUTTON_IDS.SERVER_SETTINGS_P5]: () => showServerSettingsPage5(interaction, true),
    [BUTTON_IDS.SERVER_COLOR]: () => showServerColorModal(interaction),
    [BUTTON_IDS.SERVER_PERSONALITY]: () => showServerPersonalityModal(interaction),
    [BUTTON_IDS.SERVER_PERSONALITY_REMOVE]: () => removeServerPersonality(interaction),
    [BUTTON_IDS.SERVER_MEMORY_CLEAR]: () => clearServerMemory(interaction),
    [BUTTON_IDS.SERVER_DOWNLOAD]: () => downloadServerConversation(interaction),
    [BUTTON_IDS.SERVER_CHANNELS]: () => showChannelManagementMenu(interaction, true),
    [BUTTON_IDS.SERVER_TOGGLE_CHANNEL]: () => toggleContinuousReplyChannel(interaction),
    [BUTTON_IDS.SERVER_ALL_CHANNELS]: () => handleSetAllChannels(interaction, true),
    
    [BUTTON_IDS.BACK_TO_MAIN]: () => showMainSettings(interaction, true),
    [BUTTON_IDS.BACK_TO_USER]: () => showUserSettings(interaction, true),
    [BUTTON_IDS.BACK_TO_USER_P2]: () => showUserSettingsPage2(interaction, true),
    [BUTTON_IDS.BACK_TO_SERVER]: () => showServerSettings(interaction, true),
    [BUTTON_IDS.BACK_TO_SERVER_P2]: () => showServerSettingsPage2(interaction, true),
    [BUTTON_IDS.BACK_TO_SERVER_P3]: () => showServerSettingsPage3(interaction, true),
    [BUTTON_IDS.BACK_TO_SERVER_P4]: () => showServerSettingsPage4(interaction, true),
    
    [BUTTON_IDS.DOWNLOAD_MESSAGE]: () => downloadMessage(interaction)
  };

  // Find and execute handler
  for (const [id, handler] of Object.entries(handlers)) {
    if (interaction.customId === id || interaction.customId.startsWith(id)) {
      try {
        await handler();
        return;
      } catch (error) {
        console.error(`Error in button handler ${id}:`, error);
        if (!interaction.replied && !interaction.deferred) {
          await sendErrorEmbed(interaction, 'Error', 'An error occurred processing your request.');
        }
        return;
      }
    }
  }

  // Handle delete message button
  if (interaction.customId.startsWith(BUTTON_IDS.DELETE_MESSAGE_PREFIX)) {
    const msgId = interaction.customId.replace(BUTTON_IDS.DELETE_MESSAGE_PREFIX, '');
    await handleDeleteMessageInteraction(interaction, msgId);
  }
}

/**
 * Main select menu interaction handler
 */
export async function handleSelectMenuInteraction(interaction) {
  if (!interaction.isStringSelectMenu() && !interaction.isChannelSelectMenu()) return;

  const guildId = interaction.guild?.id;
  const userId = interaction.user.id;

  // Blacklist check
  if (guildId) {
    const { initializeBlacklistForGuild } = await import('./utils.js');
    initializeBlacklistForGuild(guildId);
    if (state.blacklistedUsers[guildId]?.includes(userId)) {
      return sendErrorEmbed(interaction, 'Access Denied', 'You are blacklisted from using this bot.');
    }
  }

  const handlers = {
    [SELECT_IDS.USER_MODEL]: handleUserModelSelect,
    [SELECT_IDS.USER_FORMAT]: handleUserFormatSelect,
    [SELECT_IDS.USER_BUTTONS]: handleUserButtonsSelect,
    [SELECT_IDS.USER_CONTINUOUS]: handleUserContinuousSelect,
    
    [SELECT_IDS.SERVER_MODEL]: handleServerModelSelect,
    [SELECT_IDS.SERVER_FORMAT]: handleServerFormatSelect,
    [SELECT_IDS.SERVER_BUTTONS]: handleServerButtonsSelect,
    [SELECT_IDS.SERVER_CONTINUOUS]: handleServerContinuousSelect,
    [SELECT_IDS.SERVER_OVERRIDE]: handleServerOverrideSelect,
    [SELECT_IDS.SERVER_HISTORY]: handleServerHistorySelect,
    
    [SELECT_IDS.CHANNEL_MANAGE]: handleChannelManageSelect
  };

  const handler = handlers[interaction.customId];
  if (handler) {
    try {
      await handler(interaction);
    } catch (error) {
      console.error(`Error in select menu handler ${interaction.customId}:`, error);
      if (!interaction.replied && !interaction.deferred) {
        await sendErrorEmbed(interaction, 'Error', 'An error occurred processing your selection.');
      }
    }
  }
}

/**
 * Main modal submit handler
 */
export async function handleModalSubmit(interaction) {
  const userId = interaction.user.id;
  const guildId = interaction.guild?.id;

  const handlers = {
    [MODAL_IDS.USER_PERSONALITY]: handleUserPersonalitySubmit,
    [MODAL_IDS.USER_COLOR]: handleUserColorSubmit,
    [MODAL_IDS.SERVER_PERSONALITY]: handleServerPersonalitySubmit,
    [MODAL_IDS.SERVER_COLOR]: handleServerColorSubmit
  };

  const handler = handlers[interaction.customId];
  if (handler) {
    try {
      await handler(interaction);
    } catch (error) {
      console.error(`Error in modal handler ${interaction.customId}:`, error);
      if (!interaction.replied && !interaction.deferred) {
        await sendErrorEmbed(interaction, 'Error', 'An error occurred processing your submission.');
      }
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN SETTINGS MENU
// ═══════════════════════════════════════════════════════════════════════════════

async function showMainSettings(interaction, isUpdate = false) {
  try {
    const userId = interaction.user.id;
    const guildId = interaction.guild?.id;
    const hasManageServer = guildId ? 
      interaction.member.permissions.has(PermissionsBitField.Flags.ManageGuild) : false;

    const embedColor = getEmbedColor(userId, guildId);

    const embed = new EmbedBuilder()
      .setColor(embedColor)
      .setTitle(`${SYMBOLS.SETTINGS} Settings Panel`)
      .setDescription(
        '**Configure Bot Preferences**\n\n' +
        `${SYMBOLS.USER} **User Settings** ${SYMBOLS.ARROW} Personal configuration\n` +
        (hasManageServer ? `${SYMBOLS.SERVER} **Server Settings** ${SYMBOLS.ARROW} Server-wide configuration\n\n` : '\n') +
        'Select a category to begin.'
      )
      .setFooter({ text: 'Settings auto-save • Session expires in 5 minutes' })
      .setTimestamp();

    const userButton = new ButtonBuilder()
      .setCustomId(BUTTON_IDS.USER_SETTINGS)
      .setLabel('User Settings')
      .setStyle(ButtonStyle.Primary);

    const components = [new ActionRowBuilder().addComponents(userButton)];

    if (hasManageServer) {
      const serverButton = new ButtonBuilder()
        .setCustomId(BUTTON_IDS.SERVER_SETTINGS)
        .setLabel('Server Settings')
        .setStyle(ButtonStyle.Success);
      components[0].addComponents(serverButton);
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

    // Auto-delete after timeout
    scheduleMessageDeletion(interaction);
  } catch (error) {
    console.error('Error showing main settings:', error);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// USER SETTINGS - PAGE 1: CORE
// ═══════════════════════════════════════════════════════════════════════════════

async function showUserSettings(interaction, isUpdate = false) {
  const userId = interaction.user.id;
  const guildId = interaction.guild?.id;
  const userSettings = state.userSettings[userId] || {};

  // Check for server override
  if (guildId) {
    const serverSettings = state.serverSettings[guildId] || {};
    if (serverSettings.overrideUserSettings && !isUpdate) {
      try {
        const warningEmbed = new EmbedBuilder()
          .setColor(COLORS.WARNING)
          .setTitle(`${SYMBOLS.WARNING} Server Override Active`)
          .setDescription(
            `Server administrators have enabled settings override on **${interaction.guild.name}**.\n\n` +
            'Your personal settings will not apply here, but they will work in DMs and other servers.'
          );
        await interaction.user.send({ embeds: [warningEmbed] }).catch(() => {});
      } catch (error) {
        // DM failed, ignore
      }
    }
  }

  const selectedModel = userSettings.selectedModel || DEFAULT_MODEL;
  const responseFormat = userSettings.responseFormat || RESPONSE_FORMATS.NORMAL.value;
  const showActionButtons = userSettings.showActionButtons === true;
  const embedColor = userSettings.embedColor || COLORS.DEFAULT;

  // Model Select
  const modelSelect = new StringSelectMenuBuilder()
    .setCustomId(SELECT_IDS.USER_MODEL)
    .setPlaceholder('Select AI Model')
    .addOptions(
      new StringSelectMenuOptionBuilder()
        .setLabel(MODELS.GEMINI_FLASH.label)
        .setDescription(MODELS.GEMINI_FLASH.description)
        .setValue(MODELS.GEMINI_FLASH.value)
        .setDefault(selectedModel === MODELS.GEMINI_FLASH.value)
    );

  // Response Format Select
  const formatSelect = new StringSelectMenuBuilder()
    .setCustomId(SELECT_IDS.USER_FORMAT)
    .setPlaceholder('Response Format')
    .addOptions(
      new StringSelectMenuOptionBuilder()
        .setLabel(RESPONSE_FORMATS.NORMAL.label)
        .setDescription(RESPONSE_FORMATS.NORMAL.description)
        .setValue(RESPONSE_FORMATS.NORMAL.value)
        .setDefault(responseFormat === RESPONSE_FORMATS.NORMAL.value),
      new StringSelectMenuOptionBuilder()
        .setLabel(RESPONSE_FORMATS.EMBEDDED.label)
        .setDescription(RESPONSE_FORMATS.EMBEDDED.description)
        .setValue(RESPONSE_FORMATS.EMBEDDED.value)
        .setDefault(responseFormat === RESPONSE_FORMATS.EMBEDDED.value)
    );

  // Action Buttons Select
  const buttonsSelect = new StringSelectMenuBuilder()
    .setCustomId(SELECT_IDS.USER_BUTTONS)
    .setPlaceholder('Action Buttons')
    .addOptions(
      new StringSelectMenuOptionBuilder()
        .setLabel('Show Buttons')
        .setDescription('Display action buttons on messages')
        .setValue('show')
        .setDefault(showActionButtons),
      new StringSelectMenuOptionBuilder()
        .setLabel('Hide Buttons')
        .setDescription('Hide action buttons')
        .setValue('hide')
        .setDefault(!showActionButtons)
    );

  // Navigation Buttons
  const backButton = new ButtonBuilder()
    .setCustomId(BUTTON_IDS.BACK_TO_MAIN)
    .setLabel('Back')
    .setStyle(ButtonStyle.Secondary);

  const nextButton = new ButtonBuilder()
    .setCustomId(BUTTON_IDS.USER_SETTINGS_P2)
    .setLabel('Next')
    .setStyle(ButtonStyle.Primary);

  const components = [
    new ActionRowBuilder().addComponents(modelSelect),
    new ActionRowBuilder().addComponents(formatSelect),
    new ActionRowBuilder().addComponents(buttonsSelect),
    new ActionRowBuilder().addComponents(backButton, nextButton)
  ];

  const embed = new EmbedBuilder()
    .setColor(embedColor)
    .setTitle(`${SYMBOLS.USER} User Settings`)
    .setDescription('**Page 1 of 3** — Core Configuration\n\nSelect your preferred AI model and response style.')
    .addFields(
      {
        name: `${SYMBOLS.MODEL} Current Model`,
        value: `\`${selectedModel}\``,
        inline: true
      },
      {
        name: `${SYMBOLS.FORMAT} Response Format`,
        value: `\`${responseFormat}\``,
        inline: true
      },
      {
        name: `${SYMBOLS.BULLET} Action Buttons`,
        value: `\`${showActionButtons ? 'Visible' : 'Hidden'}\``,
        inline: true
      }
    )
    .setFooter({ text: 'Page 1/3 — Core Configuration' })
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
}

// ═══════════════════════════════════════════════════════════════════════════════
// USER SETTINGS - PAGE 2: BEHAVIOR & APPEARANCE
// ═══════════════════════════════════════════════════════════════════════════════

async function showUserSettingsPage2(interaction, isUpdate = false) {
  const userId = interaction.user.id;
  const userSettings = state.userSettings[userId] || {};
  const continuousReply = userSettings.continuousReply ?? true;
  const embedColor = userSettings.embedColor || COLORS.DEFAULT;
  const hasPersonality = !!userSettings.customPersonality;

  // Continuous Reply Select
  const continuousSelect = new StringSelectMenuBuilder()
    .setCustomId(SELECT_IDS.USER_CONTINUOUS)
    .setPlaceholder('Continuous Reply Mode')
    .addOptions(
      new StringSelectMenuOptionBuilder()
        .setLabel('Enabled')
        .setDescription('Bot responds without requiring mentions')
        .setValue('enabled')
        .setDefault(continuousReply),
      new StringSelectMenuOptionBuilder()
        .setLabel('Disabled')
        .setDescription('Bot only responds when mentioned')
        .setValue('disabled')
        .setDefault(!continuousReply)
    );

  // Action Buttons
  const colorButton = new ButtonBuilder()
    .setCustomId(BUTTON_IDS.USER_COLOR)
    .setLabel('Set Color')
    .setStyle(ButtonStyle.Secondary);

  const personalityButton = new ButtonBuilder()
    .setCustomId(BUTTON_IDS.USER_PERSONALITY)
    .setLabel('Personality')
    .setStyle(ButtonStyle.Primary);

  const removePersonalityButton = new ButtonBuilder()
    .setCustomId(BUTTON_IDS.USER_PERSONALITY_REMOVE)
    .setLabel('Reset')
    .setStyle(ButtonStyle.Danger)
    .setDisabled(!hasPersonality);

  // Navigation
  const backButton = new ButtonBuilder()
    .setCustomId(BUTTON_IDS.BACK_TO_USER)
    .setLabel('Back')
    .setStyle(ButtonStyle.Secondary);

  const nextButton = new ButtonBuilder()
    .setCustomId(BUTTON_IDS.USER_SETTINGS_P3)
    .setLabel('Next')
    .setStyle(ButtonStyle.Primary);

  const components = [
    new ActionRowBuilder().addComponents(continuousSelect),
    new ActionRowBuilder().addComponents(colorButton, personalityButton, removePersonalityButton),
    new ActionRowBuilder().addComponents(backButton, nextButton)
  ];

  const embed = new EmbedBuilder()
    .setColor(embedColor)
    .setTitle(`${SYMBOLS.USER} User Settings`)
    .setDescription('**Page 2 of 3** — Behavior & Appearance\n\nCustomize bot behavior and visual preferences.')
    .addFields(
      {
        name: `${SYMBOLS.TOGGLE} Continuous Reply`,
        value: `\`${continuousReply ? SYMBOLS.ENABLED : SYMBOLS.DISABLED} ${continuousReply ? 'Enabled' : 'Disabled'}\``,
        inline: true
      },
      {
        name: `${SYMBOLS.COLOR} Embed Color`,
        value: `\`${embedColor}\``,
        inline: true
      },
      {
        name: `${SYMBOLS.PERSONALITY} Custom Personality`,
        value: `\`${hasPersonality ? SYMBOLS.ENABLED + ' Active' : SYMBOLS.DISABLED + ' Default'}\``,
        inline: true
      }
    )
    .setFooter({ text: 'Page 2/3 — Behavior & Appearance' })
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
}

// ═══════════════════════════════════════════════════════════════════════════════
// USER SETTINGS - PAGE 3: DATA MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════════

async function showUserSettingsPage3(interaction, isUpdate = false) {
  const userId = interaction.user.id;
  const userSettings = state.userSettings[userId] || {};
  const embedColor = userSettings.embedColor || COLORS.DEFAULT;

  // Action Buttons
  const clearButton = new ButtonBuilder()
    .setCustomId(BUTTON_IDS.USER_MEMORY_CLEAR)
    .setLabel('Clear Memory')
    .setStyle(ButtonStyle.Danger);

  const downloadButton = new ButtonBuilder()
    .setCustomId(BUTTON_IDS.USER_DOWNLOAD)
    .setLabel('Download')
    .setStyle(ButtonStyle.Success);

  // Navigation
  const backButton = new ButtonBuilder()
    .setCustomId(BUTTON_IDS.BACK_TO_USER_P2)
    .setLabel('Back')
    .setStyle(ButtonStyle.Secondary);

  const mainButton = new ButtonBuilder()
    .setCustomId(BUTTON_IDS.BACK_TO_MAIN)
    .setLabel('Main Menu')
    .setStyle(ButtonStyle.Primary);

  const components = [
    new ActionRowBuilder().addComponents(clearButton, downloadButton),
    new ActionRowBuilder().addComponents(backButton, mainButton)
  ];

  const embed = new EmbedBuilder()
    .setColor(embedColor)
    .setTitle(`${SYMBOLS.USER} User Settings`)
    .setDescription('**Page 3 of 3** — Data Management\n\nManage your conversation history and data.')
    .addFields(
      {
        name: `${SYMBOLS.CLEAR} Clear Memory`,
        value: 'Delete all conversation history permanently',
        inline: false
      },
      {
        name: `${SYMBOLS.DOWNLOAD} Download History`,
        value: 'Export conversation history as a text file',
        inline: false
      }
    )
    .setFooter({ text: 'Page 3/3 — Data Management' })
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
}

// ═══════════════════════════════════════════════════════════════════════════════
// SERVER SETTINGS - PAGE 1: CORE
// ═══════════════════════════════════════════════════════════════════════════════

async function showServerSettings(interaction, isUpdate = false) {
  if (!checkServerPermission(interaction)) return;

  const guildId = interaction.guild.id;
  const serverSettings = state.serverSettings[guildId] || {};
  const selectedModel = serverSettings.selectedModel || DEFAULT_MODEL;
  const responseFormat = serverSettings.responseFormat || RESPONSE_FORMATS.NORMAL.value;
  const showActionButtons = serverSettings.showActionButtons === true;
  const embedColor = serverSettings.embedColor || COLORS.DEFAULT;

  // Model Select
  const modelSelect = new StringSelectMenuBuilder()
    .setCustomId(SELECT_IDS.SERVER_MODEL)
    .setPlaceholder('Select AI Model')
    .addOptions(
      new StringSelectMenuOptionBuilder()
        .setLabel(MODELS.GEMINI_FLASH.label)
        .setDescription(MODELS.GEMINI_FLASH.description)
        .setValue(MODELS.GEMINI_FLASH.value)
        .setDefault(selectedModel === MODELS.GEMINI_FLASH.value)
    );

  // Response Format Select
  const formatSelect = new StringSelectMenuBuilder()
    .setCustomId(SELECT_IDS.SERVER_FORMAT)
    .setPlaceholder('Response Format')
    .addOptions(
      new StringSelectMenuOptionBuilder()
        .setLabel(RESPONSE_FORMATS.NORMAL.label)
        .setDescription(RESPONSE_FORMATS.NORMAL.description)
        .setValue(RESPONSE_FORMATS.NORMAL.value)
        .setDefault(responseFormat === RESPONSE_FORMATS.NORMAL.value),
      new StringSelectMenuOptionBuilder()
        .setLabel(RESPONSE_FORMATS.EMBEDDED.label)
        .setDescription(RESPONSE_FORMATS.EMBEDDED.description)
        .setValue(RESPONSE_FORMATS.EMBEDDED.value)
        .setDefault(responseFormat === RESPONSE_FORMATS.EMBEDDED.value)
    );

  // Action Buttons Select
  const buttonsSelect = new StringSelectMenuBuilder()
    .setCustomId(SELECT_IDS.SERVER_BUTTONS)
    .setPlaceholder('Action Buttons')
    .addOptions(
      new StringSelectMenuOptionBuilder()
        .setLabel('Show Buttons')
        .setDescription('Display action buttons on messages')
        .setValue('show')
        .setDefault(showActionButtons),
      new StringSelectMenuOptionBuilder()
        .setLabel('Hide Buttons')
        .setDescription('Hide action buttons')
        .setValue('hide')
        .setDefault(!showActionButtons)
    );

  // Navigation
  const backButton = new ButtonBuilder()
    .setCustomId(BUTTON_IDS.BACK_TO_MAIN)
    .setLabel('Back')
    .setStyle(ButtonStyle.Secondary);

  const nextButton = new ButtonBuilder()
    .setCustomId(BUTTON_IDS.SERVER_SETTINGS_P2)
    .setLabel('Next')
    .setStyle(ButtonStyle.Primary);

  const components = [
    new ActionRowBuilder().addComponents(modelSelect),
    new ActionRowBuilder().addComponents(formatSelect),
    new ActionRowBuilder().addComponents(buttonsSelect),
    new ActionRowBuilder().addComponents(backButton, nextButton)
  ];

  const embed = new EmbedBuilder()
    .setColor(embedColor)
    .setTitle(`${SYMBOLS.SERVER} Server Settings`)
    .setDescription('**Page 1 of 5** — Core Configuration\n\nConfigure server-wide AI settings.')
    .addFields(
      {
        name: `${SYMBOLS.MODEL} Current Model`,
        value: `\`${selectedModel}\``,
        inline: true
      },
      {
        name: `${SYMBOLS.FORMAT} Response Format`,
        value: `\`${responseFormat}\``,
        inline: true
      },
      {
        name: `${SYMBOLS.BULLET} Action Buttons`,
        value: `\`${showActionButtons ? 'Visible' : 'Hidden'}\``,
        inline: true
      }
    )
    .setFooter({ text: 'Page 1/5 — Core Configuration' })
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
}

// ═══════════════════════════════════════════════════════════════════════════════
// SERVER SETTINGS - PAGE 2: BEHAVIOR
// ═══════════════════════════════════════════════════════════════════════════════

async function showServerSettingsPage2(interaction, isUpdate = false) {
  if (!checkServerPermission(interaction)) return;

  const guildId = interaction.guild.id;
  const serverSettings = state.serverSettings[guildId] || {};
  const embedColor = serverSettings.embedColor || COLORS.DEFAULT;
  const overrideUserSettings = serverSettings.overrideUserSettings || false;
  const continuousReply = serverSettings.continuousReply || false;
  const serverChatHistory = serverSettings.serverChatHistory || false;

  // Override Select
  const overrideSelect = new StringSelectMenuBuilder()
    .setCustomId(SELECT_IDS.SERVER_OVERRIDE)
    .setPlaceholder('Override User Settings')
    .addOptions(
      new StringSelectMenuOptionBuilder()
        .setLabel('Enabled')
        .setDescription('Force server settings for all users')
        .setValue('enabled')
        .setDefault(overrideUserSettings),
      new StringSelectMenuOptionBuilder()
        .setLabel('Disabled')
        .setDescription('Allow users to use their own settings')
        .setValue('disabled')
        .setDefault(!overrideUserSettings)
    );

  // Continuous Reply Select
  const continuousSelect = new StringSelectMenuBuilder()
    .setCustomId(SELECT_IDS.SERVER_CONTINUOUS)
    .setPlaceholder('Continuous Reply Mode')
    .addOptions(
      new StringSelectMenuOptionBuilder()
        .setLabel('Enabled')
        .setDescription('Bot responds without mentions server-wide')
        .setValue('enabled')
        .setDefault(continuousReply),
      new StringSelectMenuOptionBuilder()
        .setLabel('Disabled')
        .setDescription('Bot requires mentions (default)')
        .setValue('disabled')
        .setDefault(!continuousReply)
    );

  // Chat History Select
  const historySelect = new StringSelectMenuBuilder()
    .setCustomId(SELECT_IDS.SERVER_HISTORY)
    .setPlaceholder('Chat History Mode')
    .addOptions(
      new StringSelectMenuOptionBuilder()
        .setLabel('Server-Wide')
        .setDescription('Share chat history across all users')
        .setValue('enabled')
        .setDefault(serverChatHistory),
      new StringSelectMenuOptionBuilder()
        .setLabel('Individual')
        .setDescription('Separate history per user')
        .setValue('disabled')
        .setDefault(!serverChatHistory)
    );

  // Navigation
  const backButton = new ButtonBuilder()
    .setCustomId(BUTTON_IDS.BACK_TO_SERVER)
    .setLabel('Back')
    .setStyle(ButtonStyle.Secondary);

  const nextButton = new ButtonBuilder()
    .setCustomId(BUTTON_IDS.SERVER_SETTINGS_P3)
    .setLabel('Next')
    .setStyle(ButtonStyle.Primary);

  const components = [
    new ActionRowBuilder().addComponents(overrideSelect),
    new ActionRowBuilder().addComponents(continuousSelect),
    new ActionRowBuilder().addComponents(historySelect),
    new ActionRowBuilder().addComponents(backButton, nextButton)
  ];

  const embed = new EmbedBuilder()
    .setColor(embedColor)
    .setTitle(`${SYMBOLS.SERVER} Server Settings`)
    .setDescription('**Page 2 of 5** — Behavior Configuration\n\nControl server behavior and user overrides.')
    .addFields(
      {
        name: `${SYMBOLS.LOCKED} Override Settings`,
        value: `\`${overrideUserSettings ? SYMBOLS.ENABLED + ' Enabled' : SYMBOLS.DISABLED + ' Disabled'}\``,
        inline: true
      },
      {
        name: `${SYMBOLS.TOGGLE} Continuous Reply`,
        value: `\`${continuousReply ? SYMBOLS.ENABLED + ' Enabled' : SYMBOLS.DISABLED + ' Disabled'}\``,
        inline: true
      },
      {
        name: `${SYMBOLS.HISTORY} Chat History`,
        value: `\`${serverChatHistory ? SYMBOLS.ENABLED + ' Server-Wide' : SYMBOLS.DISABLED + ' Individual'}\``,
        inline: true
      }
    )
    .setFooter({ text: 'Page 2/5 — Behavior Configuration' })
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
}

// ═══════════════════════════════════════════════════════════════════════════════
// SERVER SETTINGS - PAGE 3: APPEARANCE
// ═══════════════════════════════════════════════════════════════════════════════

async function showServerSettingsPage3(interaction, isUpdate = false) {
  if (!checkServerPermission(interaction)) return;

  const guildId = interaction.guild.id;
  const serverSettings = state.serverSettings[guildId] || {};
  const embedColor = serverSettings.embedColor || COLORS.DEFAULT;
  const hasPersonality = !!serverSettings.customPersonality;

  // Action Buttons
  const colorButton = new ButtonBuilder()
    .setCustomId(BUTTON_IDS.SERVER_COLOR)
    .setLabel('Set Color')
    .setStyle(ButtonStyle.Secondary);

  const personalityButton = new ButtonBuilder()
    .setCustomId(BUTTON_IDS.SERVER_PERSONALITY)
    .setLabel('Personality')
    .setStyle(ButtonStyle.Primary);

  const removePersonalityButton = new ButtonBuilder()
    .setCustomId(BUTTON_IDS.SERVER_PERSONALITY_REMOVE)
    .setLabel('Reset')
    .setStyle(ButtonStyle.Danger)
    .setDisabled(!hasPersonality);

  // Navigation
  const backButton = new ButtonBuilder()
    .setCustomId(BUTTON_IDS.BACK_TO_SERVER_P2)
    .setLabel('Back')
    .setStyle(ButtonStyle.Secondary);

  const nextButton = new ButtonBuilder()
    .setCustomId(BUTTON_IDS.SERVER_SETTINGS_P4)
    .setLabel('Next')
    .setStyle(ButtonStyle.Primary);

  const components = [
    new ActionRowBuilder().addComponents(colorButton, personalityButton, removePersonalityButton),
    new ActionRowBuilder().addComponents(backButton, nextButton)
  ];

  const embed = new EmbedBuilder()
    .setColor(embedColor)
    .setTitle(`${SYMBOLS.SERVER} Server Settings`)
    .setDescription('**Page 3 of 5** — Appearance & Personality\n\nCustomize visual theme and bot personality.')
    .addFields(
      {
        name: `${SYMBOLS.COLOR} Embed Color`,
        value: `\`${embedColor}\``,
        inline: true
      },
      {
        name: `${SYMBOLS.PERSONALITY} Custom Personality`,
        value: `\`${hasPersonality ? SYMBOLS.ENABLED + ' Active' : SYMBOLS.DISABLED + ' Default'}\``,
        inline: true
      }
    )
    .setFooter({ text: 'Page 3/5 — Appearance & Personality' })
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
}

// ═══════════════════════════════════════════════════════════════════════════════
// SERVER SETTINGS - PAGE 4: CHANNELS
// ═══════════════════════════════════════════════════════════════════════════════

async function showServerSettingsPage4(interaction, isUpdate = false) {
  if (!checkServerPermission(interaction)) return;

  const guildId = interaction.guild.id;
  const serverSettings = state.serverSettings[guildId] || {};
  const embedColor = serverSettings.embedColor || COLORS.DEFAULT;
  const allowedChannels = serverSettings.allowedChannels || [];

  // Action Buttons
  const manageButton = new ButtonBuilder()
    .setCustomId(BUTTON_IDS.SERVER_CHANNELS)
    .setLabel('Manage Channels')
    .setStyle(ButtonStyle.Primary);

  const toggleButton = new ButtonBuilder()
    .setCustomId(BUTTON_IDS.SERVER_TOGGLE_CHANNEL)
    .setLabel('Toggle Current')
    .setStyle(ButtonStyle.Secondary);

  // Navigation
  const backButton = new ButtonBuilder()
    .setCustomId(BUTTON_IDS.BACK_TO_SERVER_P3)
    .setLabel('Back')
    .setStyle(ButtonStyle.Secondary);

  const nextButton = new ButtonBuilder()
    .setCustomId(BUTTON_IDS.SERVER_SETTINGS_P5)
    .setLabel('Next')
    .setStyle(ButtonStyle.Primary);

  const components = [
    new ActionRowBuilder().addComponents(manageButton, toggleButton),
    new ActionRowBuilder().addComponents(backButton, nextButton)
  ];

  const channelList = allowedChannels.length > 0
    ? allowedChannels.slice(0, 5).map(id => `<#${id}>`).join(', ') +
      (allowedChannels.length > 5 ? ` and ${allowedChannels.length - 5} more` : '')
    : 'All channels enabled';

  const embed = new EmbedBuilder()
    .setColor(embedColor)
    .setTitle(`${SYMBOLS.SERVER} Server Settings`)
    .setDescription('**Page 4 of 5** — Channel Management\n\nControl bot access and behavior per channel.')
    .addFields(
      {
        name: `${SYMBOLS.CHANNEL} Allowed Channels`,
        value: channelList,
        inline: false
      },
      {
        name: `${SYMBOLS.INFO} Channel Mode`,
        value: 'Toggle continuous reply for the current channel',
        inline: false
      }
    )
    .setFooter({ text: 'Page 4/5 — Channel Management' })
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
}

// ═══════════════════════════════════════════════════════════════════════════════
// SERVER SETTINGS - PAGE 5: DATA
// ═══════════════════════════════════════════════════════════════════════════════

async function showServerSettingsPage5(interaction, isUpdate = false) {
  if (!checkServerPermission(interaction)) return;

  const guildId = interaction.guild.id;
  const serverSettings = state.serverSettings[guildId] || {};
  const embedColor = serverSettings.embedColor || COLORS.DEFAULT;

  // Action Buttons
  const clearButton = new ButtonBuilder()
    .setCustomId(BUTTON_IDS.SERVER_MEMORY_CLEAR)
    .setLabel('Clear Memory')
    .setStyle(ButtonStyle.Danger);

  const downloadButton = new ButtonBuilder()
    .setCustomId(BUTTON_IDS.SERVER_DOWNLOAD)
    .setLabel('Download')
    .setStyle(ButtonStyle.Success);

  // Navigation
  const backButton = new ButtonBuilder()
    .setCustomId(BUTTON_IDS.BACK_TO_SERVER_P4)
    .setLabel('Back')
    .setStyle(ButtonStyle.Secondary);

  const mainButton = new ButtonBuilder()
    .setCustomId(BUTTON_IDS.BACK_TO_MAIN)
    .setLabel('Main Menu')
    .setStyle(ButtonStyle.Primary);

  const components = [
    new ActionRowBuilder().addComponents(clearButton, downloadButton),
    new ActionRowBuilder().addComponents(backButton, mainButton)
  ];

  const embed = new EmbedBuilder()
    .setColor(embedColor)
    .setTitle(`${SYMBOLS.SERVER} Server Settings`)
    .setDescription('**Page 5 of 5** — Data Management\n\nManage server conversation history and data.')
    .addFields(
      {
        name: `${SYMBOLS.CLEAR} Clear Server Memory`,
        value: 'Delete all server conversation history permanently',
        inline: false
      },
      {
        name: `${SYMBOLS.DOWNLOAD} Download History`,
        value: 'Export server conversation history as text',
        inline: false
      }
    )
    .setFooter({ text: 'Page 5/5 — Data Management' })
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
}

// ═══════════════════════════════════════════════════════════════════════════════
// CHANNEL MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════════

async function showChannelManagementMenu(interaction, isUpdate = false) {
  if (!checkServerPermission(interaction)) return;

  const guildId = interaction.guild.id;
  const serverSettings = state.serverSettings[guildId] || {};
  const embedColor = serverSettings.embedColor || COLORS.DEFAULT;
  const allowedChannels = serverSettings.allowedChannels || [];

  // Channel Select Menu
  const channelSelect = new ChannelSelectMenuBuilder()
    .setCustomId(SELECT_IDS.CHANNEL_MANAGE)
    .setPlaceholder('Select allowed channels')
    .setChannelTypes([ChannelType.GuildText])
    .setMinValues(0)
    .setMaxValues(25);

  if (allowedChannels.length > 0) {
    channelSelect.setDefaultChannels(allowedChannels);
  }

  // Action Buttons
  const allChannelsButton = new ButtonBuilder()
    .setCustomId(BUTTON_IDS.SERVER_ALL_CHANNELS)
    .setLabel('Allow All')
    .setStyle(ButtonStyle.Success);

  const backButton = new ButtonBuilder()
    .setCustomId(BUTTON_IDS.BACK_TO_SERVER_P4)
    .setLabel('Back')
    .setStyle(ButtonStyle.Secondary);

  const components = [
    new ActionRowBuilder().addComponents(channelSelect),
    new ActionRowBuilder().addComponents(allChannelsButton, backButton)
  ];

  const channelList = allowedChannels.length > 0
    ? allowedChannels.slice(0, 10).map(id => `<#${id}>`).join(', ') +
      (allowedChannels.length > 10 ? `\n...and ${allowedChannels.length - 10} more` : '')
    : 'No restrictions — all channels allowed';

  const embed = new EmbedBuilder()
    .setColor(embedColor)
    .setTitle(`${SYMBOLS.CHANNEL} Channel Management`)
    .setDescription(
      'Configure which channels the bot can respond in.\n\n' +
      `${SYMBOLS.INFO} Leave empty to allow all channels.\n` +
      `${SYMBOLS.INFO} Select specific channels to restrict access.`
    )
    .addFields({
      name: `${SYMBOLS.BULLET} Currently Allowed`,
      value: channelList,
      inline: false
    })
    .setFooter({ text: 'Channel Management' })
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
}

// ═══════════════════════════════════════════════════════════════════════════════
// SELECT MENU HANDLERS
// ═══════════════════════════════════════════════════════════════════════════════

async function handleUserModelSelect(interaction) {
  const userId = interaction.user.id;
  const selectedModel = interaction.values[0];
  
  if (!state.userSettings[userId]) {
    state.userSettings[userId] = {};
  }
  state.userSettings[userId].selectedModel = selectedModel;
  await saveStateToFile();
  await showUserSettings(interaction, true);
}

async function handleUserFormatSelect(interaction) {
  const userId = interaction.user.id;
  const selectedFormat = interaction.values[0];
  
  if (!state.userSettings[userId]) {
    state.userSettings[userId] = {};
  }
  state.userSettings[userId].responseFormat = selectedFormat;
  await saveStateToFile();
  await showUserSettings(interaction, true);
}

async function handleUserButtonsSelect(interaction) {
  const userId = interaction.user.id;
  const selectedValue = interaction.values[0];
  
  if (!state.userSettings[userId]) {
    state.userSettings[userId] = {};
  }
  state.userSettings[userId].showActionButtons = selectedValue === 'show';
  await saveStateToFile();
  await showUserSettings(interaction, true);
}

async function handleUserContinuousSelect(interaction) {
  const userId = interaction.user.id;
  const selectedValue = interaction.values[0];
  
  if (!state.userSettings[userId]) {
    state.userSettings[userId] = {};
  }
  state.userSettings[userId].continuousReply = selectedValue === 'enabled';
  await saveStateToFile();
  await showUserSettingsPage2(interaction, true);
}

async function handleServerModelSelect(interaction) {
  if (!checkServerPermission(interaction)) return;
  
  const guildId = interaction.guild.id;
  const selectedModel = interaction.values[0];
  
  if (!state.serverSettings[guildId]) {
    state.serverSettings[guildId] = {};
  }
  state.serverSettings[guildId].selectedModel = selectedModel;
  await saveStateToFile();
  await showServerSettings(interaction, true);
}

async function handleServerFormatSelect(interaction) {
  if (!checkServerPermission(interaction)) return;
  
  const guildId = interaction.guild.id;
  const selectedFormat = interaction.values[0];
  
  if (!state.serverSettings[guildId]) {
    state.serverSettings[guildId] = {};
  }
  state.serverSettings[guildId].responseFormat = selectedFormat;
  await saveStateToFile();
  await showServerSettings(interaction, true);
}

async function handleServerButtonsSelect(interaction) {
  if (!checkServerPermission(interaction)) return;
  
  const guildId = interaction.guild.id;
  const selectedValue = interaction.values[0];
  
  if (!state.serverSettings[guildId]) {
    state.serverSettings[guildId] = {};
  }
  state.serverSettings[guildId].showActionButtons = selectedValue === 'show';
  await saveStateToFile();
  await showServerSettings(interaction, true);
}

async function handleServerContinuousSelect(interaction) {
  if (!checkServerPermission(interaction)) return;
  
  const guildId = interaction.guild.id;
  const selectedValue = interaction.values[0];
  
  if (!state.serverSettings[guildId]) {
    state.serverSettings[guildId] = {};
  }
  state.serverSettings[guildId].continuousReply = selectedValue === 'enabled';
  await saveStateToFile();
  await showServerSettingsPage2(interaction, true);
}

async function handleServerOverrideSelect(interaction) {
  if (!checkServerPermission(interaction)) return;
  
  const guildId = interaction.guild.id;
  const selectedValue = interaction.values[0];
  
  if (!state.serverSettings[guildId]) {
    state.serverSettings[guildId] = {};
  }
  state.serverSettings[guildId].overrideUserSettings = selectedValue === 'enabled';
  await saveStateToFile();
  await showServerSettingsPage2(interaction, true);
}

async function handleServerHistorySelect(interaction) {
  if (!checkServerPermission(interaction)) return;
  
  const guildId = interaction.guild.id;
  const selectedValue = interaction.values[0];
  
  if (!state.serverSettings[guildId]) {
    state.serverSettings[guildId] = {};
  }
  state.serverSettings[guildId].serverChatHistory = selectedValue === 'enabled';
  await saveStateToFile();
  await showServerSettingsPage2(interaction, true);
}

async function handleChannelManageSelect(interaction) {
  if (!checkServerPermission(interaction)) return;
  
  const guildId = interaction.guild.id;
  const selectedChannels = interaction.values;
  
  if (!state.serverSettings[guildId]) {
    state.serverSettings[guildId] = {};
  }
  state.serverSettings[guildId].allowedChannels = selectedChannels;
  await saveStateToFile();
  await showChannelManagementMenu(interaction, true);
}

// ═══════════════════════════════════════════════════════════════════════════════
// MODAL HANDLERS
// ═══════════════════════════════════════════════════════════════════════════════

async function showUserPersonalityModal(interaction) {
  const userId = interaction.user.id;
  const userSettings = state.userSettings[userId] || {};
  const existing = userSettings.customPersonality || '';

  const input = new TextInputBuilder()
    .setCustomId('personality_input')
    .setLabel('Custom Personality')
    .setStyle(TextInputStyle.Paragraph)
    .setPlaceholder('Describe how the bot should respond...')
    .setRequired(true)
    .setMinLength(10)
    .setMaxLength(1000);

  if (existing) {
    input.setValue(existing);
  }

  const modal = new ModalBuilder()
    .setCustomId(MODAL_IDS.USER_PERSONALITY)
    .setTitle('Set Custom Personality')
    .addComponents(new ActionRowBuilder().addComponents(input));

  await interaction.showModal(modal);
}

async function showUserColorModal(interaction) {
  const userId = interaction.user.id;
  const userSettings = state.userSettings[userId] || {};
  const existing = userSettings.embedColor || '';

  const input = new TextInputBuilder()
    .setCustomId('color_input')
    .setLabel('Hex Color Code')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('#1a1a1a or 1a1a1a')
    .setRequired(true)
    .setMinLength(6)
    .setMaxLength(7);

  if (existing) {
    input.setValue(existing);
  }

  const modal = new ModalBuilder()
    .setCustomId(MODAL_IDS.USER_COLOR)
    .setTitle('Set Embed Color')
    .addComponents(new ActionRowBuilder().addComponents(input));

  await interaction.showModal(modal);
}

async function showServerPersonalityModal(interaction) {
  if (!checkServerPermission(interaction)) return;
  
  const guildId = interaction.guild.id;
  const serverSettings = state.serverSettings[guildId] || {};
  const existing = serverSettings.customPersonality || '';

  const input = new TextInputBuilder()
    .setCustomId('personality_input')
    .setLabel('Server Personality')
    .setStyle(TextInputStyle.Paragraph)
    .setPlaceholder('Describe how the bot should respond in this server...')
    .setRequired(true)
    .setMinLength(10)
    .setMaxLength(1000);

  if (existing) {
    input.setValue(existing);
  }

  const modal = new ModalBuilder()
    .setCustomId(MODAL_IDS.SERVER_PERSONALITY)
    .setTitle('Set Server Personality')
    .addComponents(new ActionRowBuilder().addComponents(input));

  await interaction.showModal(modal);
}

async function showServerColorModal(interaction) {
  if (!checkServerPermission(interaction)) return;
  
  const guildId = interaction.guild.id;
  const serverSettings = state.serverSettings[guildId] || {};
  const existing = serverSettings.embedColor || '';

  const input = new TextInputBuilder()
    .setCustomId('color_input')
    .setLabel('Hex Color Code')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('#1a1a1a or 1a1a1a')
    .setRequired(true)
    .setMinLength(6)
    .setMaxLength(7);

  if (existing) {
    input.setValue(existing);
  }

  const modal = new ModalBuilder()
    .setCustomId(MODAL_IDS.SERVER_COLOR)
    .setTitle('Set Server Embed Color')
    .addComponents(new ActionRowBuilder().addComponents(input));

  await interaction.showModal(modal);
}

async function handleUserPersonalitySubmit(interaction) {
  try {
    const userId = interaction.user.id;
    const personality = interaction.fields.getTextInputValue('personality_input').trim();
    
    if (!state.userSettings[userId]) {
      state.userSettings[userId] = {};
    }
    state.userSettings[userId].customPersonality = personality;
    await saveStateToFile();

    await sendSuccessEmbed(
      interaction,
      'Personality Updated',
      'Your custom personality has been saved successfully.'
    );
  } catch (error) {
    console.error('Error saving user personality:', error);
    await sendErrorEmbed(interaction, 'Error', 'Failed to save personality.');
  }
}

async function handleUserColorSubmit(interaction) {
  try {
    const userId = interaction.user.id;
    const colorInput = interaction.fields.getTextInputValue('color_input').trim();
    
    const hexPattern = /^#?([0-9A-Fa-f]{6})$/;
    if (!hexPattern.test(colorInput)) {
      return sendErrorEmbed(
        interaction,
        'Invalid Color',
        'Please provide a valid hex color code (e.g., #1a1a1a or 1a1a1a).'
      );
    }

    const hexColor = colorInput.startsWith('#') ? colorInput : `#${colorInput}`;
    
    if (!state.userSettings[userId]) {
      state.userSettings[userId] = {};
    }
    state.userSettings[userId].embedColor = hexColor;
    await saveStateToFile();

    const embed = new EmbedBuilder()
      .setColor(hexColor)
      .setTitle(`${SYMBOLS.SUCCESS} Color Updated`)
      .setDescription(`Your embed color has been set to \`${hexColor}\`.`);
    
    await interaction.reply({
      embeds: [embed],
      flags: MessageFlags.Ephemeral
    });
  } catch (error) {
    console.error('Error saving user color:', error);
    await sendErrorEmbed(interaction, 'Error', 'Failed to save color.');
  }
}

async function handleServerPersonalitySubmit(interaction) {
  if (!checkServerPermission(interaction)) return;
  
  try {
    const guildId = interaction.guild.id;
    const personality = interaction.fields.getTextInputValue('personality_input').trim();
    
    if (!state.serverSettings[guildId]) {
      state.serverSettings[guildId] = {};
    }
    state.serverSettings[guildId].customPersonality = personality;
    await saveStateToFile();

    await sendSuccessEmbed(
      interaction,
      'Server Personality Updated',
      'The server personality has been saved successfully.'
    );
  } catch (error) {
    console.error('Error saving server personality:', error);
    await sendErrorEmbed(interaction, 'Error', 'Failed to save personality.');
  }
}

async function handleServerColorSubmit(interaction) {
  if (!checkServerPermission(interaction)) return;
  
  try {
    const guildId = interaction.guild.id;
    const colorInput = interaction.fields.getTextInputValue('color_input').trim();
    
    const hexPattern = /^#?([0-9A-Fa-f]{6})$/;
    if (!hexPattern.test(colorInput)) {
      return sendErrorEmbed(
        interaction,
        'Invalid Color',
        'Please provide a valid hex color code (e.g., #1a1a1a or 1a1a1a).'
      );
    }

    const hexColor = colorInput.startsWith('#') ? colorInput : `#${colorInput}`;
    
    if (!state.serverSettings[guildId]) {
      state.serverSettings[guildId] = {};
    }
    state.serverSettings[guildId].embedColor = hexColor;
    await saveStateToFile();

    const embed = new EmbedBuilder()
      .setColor(hexColor)
      .setTitle(`${SYMBOLS.SUCCESS} Server Color Updated`)
      .setDescription(`Server embed color has been set to \`${hexColor}\`.`);
    
    await interaction.reply({
      embeds: [embed],
      flags: MessageFlags.Ephemeral
    });
  } catch (error) {
    console.error('Error saving server color:', error);
    await sendErrorEmbed(interaction, 'Error', 'Failed to save color.');
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// ACTION HANDLERS
// ═══════════════════════════════════════════════════════════════════════════════

async function removeUserPersonality(interaction) {
  const userId = interaction.user.id;
  
  if (state.userSettings[userId]?.customPersonality) {
    delete state.userSettings[userId].customPersonality;
    await saveStateToFile();
    await sendSuccessEmbed(interaction, 'Personality Reset', 'Your custom personality has been removed.');
  } else {
    await sendInfoEmbed(interaction, 'No Personality Set', 'You don\'t have a custom personality configured.');
  }
}

async function removeServerPersonality(interaction) {
  if (!checkServerPermission(interaction)) return;
  
  const guildId = interaction.guild.id;
  
  if (state.serverSettings[guildId]?.customPersonality) {
    delete state.serverSettings[guildId].customPersonality;
    await saveStateToFile();
    await sendSuccessEmbed(interaction, 'Personality Reset', 'Server personality has been removed.');
  } else {
    await sendInfoEmbed(interaction, 'No Personality Set', 'No custom server personality is configured.');
  }
}

async function clearUserMemory(interaction) {
  const userId = interaction.user.id;
  
  try {
    await chatHistoryLock.runExclusive(async () => {
      if (state.chatHistories[userId]) {
        delete state.chatHistories[userId];
      }
    });
    await saveStateToFile();
    await sendSuccessEmbed(
      interaction,
      'Memory Cleared',
      'Your conversation history has been deleted successfully.'
    );
  } catch (error) {
    console.error('Error clearing user memory:', error);
    await sendErrorEmbed(interaction, 'Error', 'Failed to clear memory.');
  }
}

async function clearServerMemory(interaction) {
  if (!checkServerPermission(interaction)) return;
  
  const guildId = interaction.guild.id;
  
  try {
    await chatHistoryLock.runExclusive(async () => {
      if (state.chatHistories[guildId]) {
        delete state.chatHistories[guildId];
      }
    });
    await saveStateToFile();
    await sendSuccessEmbed(
      interaction,
      'Server Memory Cleared',
      'Server conversation history has been deleted successfully.'
    );
  } catch (error) {
    console.error('Error clearing server memory:', error);
    await sendErrorEmbed(interaction, 'Error', 'Failed to clear memory.');
  }
}

async function downloadUserConversation(interaction) {
  const userId = interaction.user.id;
  
  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    
    const history = await getHistory(userId);
    
    if (!history || history.length === 0) {
      return sendInfoEmbed(interaction, 'No History', 'You don\'t have any conversation history yet.');
    }

    const conversationText = formatConversationHistory(history);
    const filePath = path.join(TEMP_DIR, `user_conversation_${userId}_${Date.now()}.txt`);
    await fs.writeFile(filePath, conversationText, 'utf8');

    const attachment = new AttachmentBuilder(filePath, {
      name: 'conversation_history.txt'
    });

    await interaction.editReply({
      embeds: [createSuccessEmbed('Download Complete', 'Your conversation history has been exported.')],
      files: [attachment]
    });

    await fs.unlink(filePath).catch(() => {});

    // Upload to pastebin alternative
    const { uploadText } = await import('./utils.js');
    const url = await uploadText(conversationText);
    
    if (url) {
      await interaction.followUp({
        embeds: [createInfoEmbed('Online Backup', `View online: ${url}`)],
        flags: MessageFlags.Ephemeral
      });
    }
  } catch (error) {
    console.error('Error downloading user conversation:', error);
    await sendErrorEmbed(interaction, 'Error', 'Failed to download conversation history.');
  }
}

async function downloadServerConversation(interaction) {
  if (!checkServerPermission(interaction)) return;
  
  const guildId = interaction.guild.id;
  
  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    
    const history = await getHistory(guildId);
    
    if (!history || history.length === 0) {
      return sendInfoEmbed(interaction, 'No History', 'This server doesn\'t have any conversation history yet.');
    }

    const conversationText = formatConversationHistory(history);
    const filePath = path.join(TEMP_DIR, `server_conversation_${guildId}_${Date.now()}.txt`);
    await fs.writeFile(filePath, conversationText, 'utf8');

    const attachment = new AttachmentBuilder(filePath, {
      name: 'server_conversation_history.txt'
    });

    await interaction.editReply({
      embeds: [createSuccessEmbed('Download Complete', 'Server conversation history has been exported.')],
      files: [attachment]
    });

    await fs.unlink(filePath).catch(() => {});

    // Upload to pastebin alternative
    const { uploadText } = await import('./utils.js');
    const url = await uploadText(conversationText);
    
    if (url) {
      await interaction.followUp({
        embeds: [createInfoEmbed('Online Backup', `View online: ${url}`)],
        flags: MessageFlags.Ephemeral
      });
    }
  } catch (error) {
    console.error('Error downloading server conversation:', error);
    await sendErrorEmbed(interaction, 'Error', 'Failed to download conversation history.');
  }
}

async function handleSetAllChannels(interaction, isUpdate = false) {
  if (!checkServerPermission(interaction)) return;
  
  const guildId = interaction.guild.id;
  
  if (!state.serverSettings[guildId]) {
    state.serverSettings[guildId] = {};
  }
  state.serverSettings[guildId].allowedChannels = [];
  await saveStateToFile();
  
  await showChannelManagementMenu(interaction, isUpdate);
}

async function toggleContinuousReplyChannel(interaction) {
  if (!checkServerPermission(interaction)) return;
  
  const channelId = interaction.channelId;
  
  if (!state.continuousReplyChannels) {
    state.continuousReplyChannels = {};
  }

  if (state.continuousReplyChannels[channelId]) {
    delete state.continuousReplyChannels[channelId];
    await saveStateToFile();
    await sendInfoEmbed(
      interaction,
      'Mode Disabled',
      `Continuous reply disabled in <#${channelId}>.`
    );
  } else {
    state.continuousReplyChannels[channelId] = true;
    await saveStateToFile();
    await sendSuccessEmbed(
      interaction,
      'Mode Enabled',
      `Continuous reply enabled in <#${channelId}>.`
    );
  }
}

async function handleDeleteMessageInteraction(interaction, msgId) {
  const userId = interaction.user.id;
  const userChatHistory = state.chatHistories[userId];
  const channel = interaction.channel;
  
  let message = null;
  try {
    message = await channel.messages.fetch(msgId).catch(() => null);
  } catch (error) {
    // Message not found
  }

  if (userChatHistory?.[msgId]) {
    delete userChatHistory[msgId];
    await deleteMessages(interaction, message, channel);
  } else if (message?.reference) {
    try {
      const replyingTo = await message.channel.messages.fetch(message.reference.messageId);
      if (userId === replyingTo.author.id) {
        await deleteMessages(interaction, message, channel);
      } else {
        return sendErrorEmbed(interaction, 'Unauthorized', 'You cannot delete this message.');
      }
    } catch (error) {
      return sendErrorEmbed(interaction, 'Error', 'Failed to verify message ownership.');
    }
  } else {
    return sendErrorEmbed(interaction, 'Unauthorized', 'You cannot delete this message.');
  }
}

async function deleteMessages(interaction, message, channel) {
  try {
    await interaction.message.delete().catch(() => {});
    if (message) {
      await message.delete().catch(() => {});
    }
  } catch (error) {
    console.error('Error deleting messages:', error);
  }
}

async function downloadMessage(interaction) {
  const message = interaction.message;
  let textContent = message.content;
  
  if (!textContent && message.embeds.length > 0) {
    textContent = message.embeds[0].description || message.embeds[0].title || '';
  }

  if (!textContent || textContent.length === 0) {
    return sendErrorEmbed(interaction, 'Empty Message', 'This message appears to be empty.');
  }

  try {
    const filePath = path.join(TEMP_DIR, `message_${interaction.id}.txt`);
    await fs.writeFile(filePath, textContent, 'utf8');

    const attachment = new AttachmentBuilder(filePath, {
      name: 'message_content.txt'
    });

    const embed = createSuccessEmbed('Message Saved', 'The message content has been exported.');

    if (interaction.channel.type === ChannelType.DM) {
      await interaction.reply({
        embeds: [embed],
        files: [attachment]
      });
    } else {
      try {
        await interaction.user.send({
          embeds: [embed],
          files: [attachment]
        });
        await interaction.reply({
          embeds: [createSuccessEmbed('Sent to DMs', 'Message content sent to your DMs.')],
          flags: MessageFlags.Ephemeral
        });
      } catch (error) {
        await interaction.reply({
          embeds: [embed],
          files: [attachment],
          flags: MessageFlags.Ephemeral
        });
      }
    }

    await fs.unlink(filePath).catch(() => {});

    // Upload to pastebin
    const { uploadText } = await import('./utils.js');
    const url = await uploadText(textContent);
    
    if (url) {
      const urlEmbed = createInfoEmbed('Online Backup', `View online: ${url}`);
      if (interaction.channel.type === ChannelType.DM) {
        await interaction.followUp({ embeds: [urlEmbed] });
      } else {
        await interaction.user.send({ embeds: [urlEmbed] }).catch(() => {});
      }
    }
  } catch (error) {
    console.error('Error downloading message:', error);
    await sendErrorEmbed(interaction, 'Error', 'Failed to download message.');
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// UTILITY FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════════

function getEmbedColor(userId, guildId) {
  if (guildId && state.serverSettings[guildId]?.embedColor) {
    return state.serverSettings[guildId].embedColor;
  }
  if (state.userSettings[userId]?.embedColor) {
    return state.userSettings[userId].embedColor;
  }
  return COLORS.DEFAULT;
}

function checkServerPermission(interaction) {
  if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
    sendErrorEmbed(interaction, 'Permission Denied', 'You need "Manage Server" permission to access this.');
    return false;
  }
  return true;
}

function createSuccessEmbed(title, description) {
  return new EmbedBuilder()
    .setColor(COLORS.SUCCESS)
    .setTitle(`${SYMBOLS.SUCCESS} ${title}`)
    .setDescription(description);
}

function createErrorEmbed(title, description) {
  return new EmbedBuilder()
    .setColor(COLORS.ERROR)
    .setTitle(`${SYMBOLS.ERROR} ${title}`)
    .setDescription(description);
}

function createInfoEmbed(title, description) {
  return new EmbedBuilder()
    .setColor(COLORS.INFO)
    .setTitle(`${SYMBOLS.INFO} ${title}`)
    .setDescription(description);
}

function createWarningEmbed(title, description) {
  return new EmbedBuilder()
    .setColor(COLORS.WARNING)
    .setTitle(`${SYMBOLS.WARNING} ${title}`)
    .setDescription(description);
}

async function sendSuccessEmbed(interaction, title, description) {
  const embed = createSuccessEmbed(title, description);
  if (interaction.deferred) {
    await interaction.editReply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  } else {
    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  }
}

async function sendErrorEmbed(interaction, title, description) {
  const embed = createErrorEmbed(title, description);
  if (interaction.deferred) {
    await interaction.editReply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  } else {
    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  }
}

async function sendInfoEmbed(interaction, title, description) {
  const embed = createInfoEmbed(title, description);
  if (interaction.deferred) {
    await interaction.editReply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  } else {
    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  }
}

function formatConversationHistory(history) {
  let formatted = 'CONVERSATION HISTORY\n';
  formatted += '='.repeat(60) + '\n\n';
  
  for (const entry of history) {
    formatted += `[${entry.role.toUpperCase()}]\n`;
    formatted += `${entry.content}\n\n`;
    formatted += '-'.repeat(60) + '\n\n';
  }
  
  return formatted;
}

function scheduleMessageDeletion(interaction) {
  setTimeout(async () => {
    try {
      const reply = await interaction.fetchReply().catch(() => null);
      if (reply) {
        await interaction.deleteReply().catch(() => {});
      }
    } catch (error) {
      // Ignore deletion errors
    }
  }, SETTINGS_TIMEOUT);
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════════

export { showMainSettings };
