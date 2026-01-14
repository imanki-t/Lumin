/**
 * @fileoverview Settings Handler - Minimalistic Design
 * @version 4.0.0
 * 
 * Clean, minimal interface with symbol-based design
 * All configuration constants at the top for easy customization
 */

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

// ============================================================================
// CONFIGURATION CONSTANTS
// ============================================================================

/** Color scheme - Minimalistic grayscale palette */
const COLORS = Object.freeze({
  PRIMARY: 0x2B2D31,      // Dark gray (almost black)
  SECONDARY: 0x36393F,    // Medium gray
  SUCCESS: 0x3BA55D,      // Muted green
  WARNING: 0xFAA81A,      // Muted orange
  ERROR: 0xED4245,        // Muted red
  INFO: 0x5865F2,         // Muted blue
  NEUTRAL: 0x4E5058       // Neutral gray
});

/** Text labels and messages */
const LABELS = Object.freeze({
  // Main menu
  MAIN_TITLE: 'Settings',
  MAIN_DESC: 'Configure your bot preferences',
  
  // Page indicators
  PAGE_OF: 'Page',
  
  // Category names
  USER_SETTINGS: 'User Settings',
  SERVER_SETTINGS: 'Server Settings',
  
  // Section names
  CORE_PREFS: 'Core Preferences',
  BEHAVIOR: 'Behavior Settings',
  DATA_MGMT: 'Data Management',
  APPEARANCE: 'Appearance',
  CHANNELS: 'Channel Management',
  
  // Setting names
  AI_MODEL: 'Model',
  RESPONSE_FORMAT: 'Format',
  ACTION_BUTTONS: 'Buttons',
  CONTINUOUS_REPLY: 'Auto-Reply',
  CUSTOM_PERSONALITY: 'Personality',
  EMBED_COLOR: 'Color',
  OVERRIDE_SETTINGS: 'Override',
  SERVER_HISTORY: 'Server History',
  ALLOWED_CHANNELS: 'Channels',
  
  // Actions
  SAVE: 'Save',
  CANCEL: 'Cancel',
  CLEAR: 'Clear',
  DOWNLOAD: 'Download',
  REMOVE: 'Remove',
  BACK: 'Back',
  NEXT: 'Next',
  
  // Status
  ENABLED: 'Enabled',
  DISABLED: 'Disabled',
  ACTIVE: 'Active',
  INACTIVE: 'Inactive',
  VISIBLE: 'Visible',
  HIDDEN: 'Hidden'
});

/** Model configurations */
const MODELS = Object.freeze({
  FLASH: {
    id: 'gemini-2.5-flash',
    name: 'Flash 2.5',
    description: 'Fast and efficient'
  }
  // Add more models here as needed
});

/** Response format options */
const FORMATS = Object.freeze({
  NORMAL: {
    id: 'Normal',
    name: 'Plain Text',
    description: 'Standard text output'
  },
  EMBEDDED: {
    id: 'Embedded',
    name: 'Rich Embed',
    description: 'Formatted embed output'
  }
});

/** UI symbols (no emojis) */
const SYMBOLS = Object.freeze({
  // Navigation
  BACK: '‹',
  NEXT: '›',
  UP: '▴',
  DOWN: '▾',
  
  // Status
  ENABLED: '●',
  DISABLED: '○',
  ACTIVE: '▪',
  INACTIVE: '▫',
  
  // Actions
  EDIT: '✎',
  DELETE: '✕',
  DOWNLOAD: '⇩',
  CLEAR: '⌫',
  
  // Categories
  USER: '◆',
  SERVER: '◇',
  SETTINGS: '⚙',
  
  // Separators
  BULLET: '•',
  DASH: '─',
  PIPE: '│',
  
  // Indicators
  CURRENT: '▸',
  SELECT: '▹'
});

/** Session timeout (ms) */
const SESSION_TIMEOUT = 300000; // 5 minutes

/** Permission requirements */
const PERMISSIONS = Object.freeze({
  SERVER_SETTINGS: PermissionsBitField.Flags.ManageGuild
});

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Get effective color for embed
 */
function getEmbedColor(userId, guildId = null) {
  if (guildId && state.serverSettings[guildId]?.embedColor) {
    return state.serverSettings[guildId].embedColor;
  }
  if (state.userSettings[userId]?.embedColor) {
    return state.userSettings[userId].embedColor;
  }
  return COLORS.PRIMARY;
}

/**
 * Check if user has required permissions
 */
function hasPermission(interaction, permission) {
  if (!interaction.guild) return true;
  return interaction.member.permissions.has(permission);
}

/**
 * Send permission error
 */
async function sendPermissionError(interaction) {
  const embed = new EmbedBuilder()
    .setColor(COLORS.ERROR)
    .setTitle(`${SYMBOLS.DELETE} Permission Denied`)
    .setDescription('Manage Server permission required');
  
  return interaction.reply({
    embeds: [embed],
    flags: MessageFlags.Ephemeral
  });
}

/**
 * Auto-delete message after timeout
 */
async function scheduleMessageDeletion(interaction) {
  setTimeout(async () => {
    try {
      const reply = await interaction.fetchReply().catch(() => null);
      if (reply) {
        await interaction.deleteReply();
      }
    } catch (error) {
      if (error.code !== 10008) {
        console.error('Message deletion error:', error);
      }
    }
  }, SESSION_TIMEOUT);
}

/**
 * Create footer text
 */
function createFooter(page = null, total = null, extra = null) {
  const parts = [];
  
  if (page && total) {
    parts.push(`${LABELS.PAGE_OF} ${page}/${total}`);
  }
  
  if (extra) {
    parts.push(extra);
  }
  
  return parts.join(` ${SYMBOLS.BULLET} `);
}

// ============================================================================
// MAIN SETTINGS MENU
// ============================================================================

export async function showMainSettings(interaction, isUpdate = false) {
  try {
    const userId = interaction.user.id;
    const guildId = interaction.guild?.id;
    const embedColor = getEmbedColor(userId, guildId);
    const hasServerPerm = hasPermission(interaction, PERMISSIONS.SERVER_SETTINGS);
    
    const embed = new EmbedBuilder()
      .setColor(embedColor)
      .setTitle(`${SYMBOLS.SETTINGS} ${LABELS.MAIN_TITLE}`)
      .setDescription(LABELS.MAIN_DESC)
      .addFields(
        {
          name: `${SYMBOLS.USER} ${LABELS.USER_SETTINGS}`,
          value: `Personal configuration and preferences`,
          inline: false
        }
      )
      .setFooter({ text: 'Select a category below' })
      .setTimestamp();
    
    const userButton = new ButtonBuilder()
      .setCustomId('user_settings')
      .setLabel(LABELS.USER_SETTINGS)
      .setStyle(ButtonStyle.Secondary);
    
    const components = [new ActionRowBuilder().addComponents(userButton)];
    
    if (hasServerPerm && guildId) {
      embed.addFields({
        name: `${SYMBOLS.SERVER} ${LABELS.SERVER_SETTINGS}`,
        value: 'Server-wide configuration and overrides',
        inline: false
      });
      
      const serverButton = new ButtonBuilder()
        .setCustomId('server_settings')
        .setLabel(LABELS.SERVER_SETTINGS)
        .setStyle(ButtonStyle.Secondary);
      
      components[0].addComponents(serverButton);
    }
    
    const payload = {
      embeds: [embed],
      components,
      flags: MessageFlags.Ephemeral
    };
    
    if (isUpdate) {
      await interaction.update(payload);
    } else {
      await interaction.reply(payload);
    }
    
    scheduleMessageDeletion(interaction);
  } catch (error) {
    console.error('Main settings error:', error);
  }
}

// ============================================================================
// USER SETTINGS - PAGE 1: CORE
// ============================================================================

async function showUserSettings(interaction, isUpdate = false) {
  const userId = interaction.user.id;
  const userSettings = state.userSettings[userId] || {};
  const guildId = interaction.guild?.id;
  
  // Check for server override notification
  if (guildId && !isUpdate) {
    const serverSettings = state.serverSettings[guildId] || {};
    if (serverSettings.overrideUserSettings) {
      try {
        const embed = new EmbedBuilder()
          .setColor(COLORS.WARNING)
          .setTitle(`${SYMBOLS.ACTIVE} Server Override Active`)
          .setDescription(
            'Server settings override your personal preferences in this server.\n\n' +
            'Your settings will apply in DMs and other servers without override.'
          );
        await interaction.user.send({ embeds: [embed] });
      } catch (err) {
        console.error('Override notification failed:', err);
      }
    }
  }
  
  const selectedModel = userSettings.selectedModel || MODELS.FLASH.id;
  const responseFormat = userSettings.responseFormat || FORMATS.NORMAL.id;
  const showActionButtons = userSettings.showActionButtons === true;
  const embedColor = getEmbedColor(userId, guildId);
  
  // Model selector
  const modelSelect = new StringSelectMenuBuilder()
    .setCustomId('user_model_select')
    .setPlaceholder(`${SYMBOLS.SELECT} Select model`)
    .addOptions(
      new StringSelectMenuOptionBuilder()
        .setLabel(MODELS.FLASH.name)
        .setDescription(MODELS.FLASH.description)
        .setValue(MODELS.FLASH.id)
        .setDefault(selectedModel === MODELS.FLASH.id)
    );
  
  // Format selector
  const formatSelect = new StringSelectMenuBuilder()
    .setCustomId('user_response_format')
    .setPlaceholder(`${SYMBOLS.SELECT} Select format`)
    .addOptions(
      new StringSelectMenuOptionBuilder()
        .setLabel(FORMATS.NORMAL.name)
        .setDescription(FORMATS.NORMAL.description)
        .setValue(FORMATS.NORMAL.id)
        .setDefault(responseFormat === FORMATS.NORMAL.id),
      new StringSelectMenuOptionBuilder()
        .setLabel(FORMATS.EMBEDDED.name)
        .setDescription(FORMATS.EMBEDDED.description)
        .setValue(FORMATS.EMBEDDED.id)
        .setDefault(responseFormat === FORMATS.EMBEDDED.id)
    );
  
  // Action buttons toggle
  const buttonsSelect = new StringSelectMenuBuilder()
    .setCustomId('user_action_buttons')
    .setPlaceholder(`${SYMBOLS.SELECT} Toggle buttons`)
    .addOptions(
      new StringSelectMenuOptionBuilder()
        .setLabel(`${SYMBOLS.ENABLED} ${LABELS.VISIBLE}`)
        .setDescription('Show action buttons')
        .setValue('show')
        .setDefault(showActionButtons),
      new StringSelectMenuOptionBuilder()
        .setLabel(`${SYMBOLS.DISABLED} ${LABELS.HIDDEN}`)
        .setDescription('Hide action buttons')
        .setValue('hide')
        .setDefault(!showActionButtons)
    );
  
  // Navigation buttons
  const backButton = new ButtonBuilder()
    .setCustomId('back_to_main')
    .setLabel(LABELS.BACK)
    .setStyle(ButtonStyle.Secondary);
  
  const nextButton = new ButtonBuilder()
    .setCustomId('user_settings_page2')
    .setLabel(LABELS.NEXT)
    .setStyle(ButtonStyle.Primary);
  
  const embed = new EmbedBuilder()
    .setColor(embedColor)
    .setTitle(`${SYMBOLS.USER} ${LABELS.USER_SETTINGS}`)
    .setDescription(LABELS.CORE_PREFS)
    .addFields(
      {
        name: `${SYMBOLS.CURRENT} ${LABELS.AI_MODEL}`,
        value: `\`${selectedModel}\``,
        inline: true
      },
      {
        name: `${SYMBOLS.CURRENT} ${LABELS.RESPONSE_FORMAT}`,
        value: `\`${responseFormat}\``,
        inline: true
      },
      {
        name: `${SYMBOLS.CURRENT} ${LABELS.ACTION_BUTTONS}`,
        value: `\`${showActionButtons ? LABELS.VISIBLE : LABELS.HIDDEN}\``,
        inline: true
      }
    )
    .setFooter({ text: createFooter(1, 3, LABELS.CORE_PREFS) })
    .setTimestamp();
  
  const payload = {
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(modelSelect),
      new ActionRowBuilder().addComponents(formatSelect),
      new ActionRowBuilder().addComponents(buttonsSelect),
      new ActionRowBuilder().addComponents(backButton, nextButton)
    ],
    flags: MessageFlags.Ephemeral
  };
  
  if (isUpdate) {
    await interaction.update(payload);
  } else {
    await interaction.reply(payload);
  }
  
  scheduleMessageDeletion(interaction);
}

// ============================================================================
// USER SETTINGS - PAGE 2: BEHAVIOR
// ============================================================================

async function showUserSettingsPage2(interaction, isUpdate = false) {
  const userId = interaction.user.id;
  const userSettings = state.userSettings[userId] || {};
  const guildId = interaction.guild?.id;
  
  const continuousReply = userSettings.continuousReply ?? true;
  const hasPersonality = !!userSettings.customPersonality;
  const embedColor = getEmbedColor(userId, guildId);
  
  // Auto-reply toggle
  const replySelect = new StringSelectMenuBuilder()
    .setCustomId('user_continuous_reply')
    .setPlaceholder(`${SYMBOLS.SELECT} Auto-reply mode`)
    .addOptions(
      new StringSelectMenuOptionBuilder()
        .setLabel(`${SYMBOLS.ENABLED} ${LABELS.ENABLED}`)
        .setDescription('Reply without mentions')
        .setValue('enabled')
        .setDefault(continuousReply),
      new StringSelectMenuOptionBuilder()
        .setLabel(`${SYMBOLS.DISABLED} ${LABELS.DISABLED}`)
        .setDescription('Require mentions')
        .setValue('disabled')
        .setDefault(!continuousReply)
    );
  
  // Personality buttons
  const personalityButton = new ButtonBuilder()
    .setCustomId('user_custom_personality')
    .setLabel(hasPersonality ? `${SYMBOLS.EDIT} Edit` : `${SYMBOLS.EDIT} Add`)
    .setStyle(ButtonStyle.Secondary);
  
  const buttons = [personalityButton];
  
  if (hasPersonality) {
    const removeButton = new ButtonBuilder()
      .setCustomId('user_remove_personality')
      .setLabel(`${SYMBOLS.DELETE} ${LABELS.REMOVE}`)
      .setStyle(ButtonStyle.Danger);
    buttons.push(removeButton);
  }
  
  // Navigation
  const backButton = new ButtonBuilder()
    .setCustomId('user_settings_p1')
    .setLabel(LABELS.BACK)
    .setStyle(ButtonStyle.Secondary);
  
  const nextButton = new ButtonBuilder()
    .setCustomId('user_settings_page3')
    .setLabel(LABELS.NEXT)
    .setStyle(ButtonStyle.Primary);
  
  const embed = new EmbedBuilder()
    .setColor(embedColor)
    .setTitle(`${SYMBOLS.USER} ${LABELS.USER_SETTINGS}`)
    .setDescription(LABELS.BEHAVIOR)
    .addFields(
      {
        name: `${SYMBOLS.CURRENT} ${LABELS.CONTINUOUS_REPLY}`,
        value: `\`${continuousReply ? LABELS.ENABLED : LABELS.DISABLED}\``,
        inline: true
      },
      {
        name: `${SYMBOLS.CURRENT} ${LABELS.CUSTOM_PERSONALITY}`,
        value: `\`${hasPersonality ? LABELS.ACTIVE : LABELS.INACTIVE}\``,
        inline: true
      }
    )
    .setFooter({ text: createFooter(2, 3, LABELS.BEHAVIOR) })
    .setTimestamp();
  
  const payload = {
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(replySelect),
      new ActionRowBuilder().addComponents(...buttons),
      new ActionRowBuilder().addComponents(backButton, nextButton)
    ],
    flags: MessageFlags.Ephemeral
  };
  
  if (isUpdate) {
    await interaction.update(payload);
  } else {
    await interaction.reply(payload);
  }
  
  scheduleMessageDeletion(interaction);
}

// ============================================================================
// USER SETTINGS - PAGE 3: DATA & APPEARANCE
// ============================================================================

async function showUserSettingsPage3(interaction, isUpdate = false) {
  const userId = interaction.user.id;
  const userSettings = state.userSettings[userId] || {};
  const guildId = interaction.guild?.id;
  const embedColor = getEmbedColor(userId, guildId);
  
  // Data management buttons
  const clearButton = new ButtonBuilder()
    .setCustomId('clear_user_memory')
    .setLabel(`${SYMBOLS.CLEAR} ${LABELS.CLEAR}`)
    .setStyle(ButtonStyle.Danger);
  
  const downloadButton = new ButtonBuilder()
    .setCustomId('download_user_conversation')
    .setLabel(`${SYMBOLS.DOWNLOAD} ${LABELS.DOWNLOAD}`)
    .setStyle(ButtonStyle.Secondary);
  
  // Appearance button
  const colorButton = new ButtonBuilder()
    .setCustomId('user_embed_color')
    .setLabel(`${SYMBOLS.EDIT} ${LABELS.EMBED_COLOR}`)
    .setStyle(ButtonStyle.Secondary);
  
  // Navigation
  const backButton = new ButtonBuilder()
    .setCustomId('back_to_user_p2')
    .setLabel(LABELS.BACK)
    .setStyle(ButtonStyle.Secondary);
  
  const mainButton = new ButtonBuilder()
    .setCustomId('back_to_main')
    .setLabel('Main Menu')
    .setStyle(ButtonStyle.Primary);
  
  const embed = new EmbedBuilder()
    .setColor(embedColor)
    .setTitle(`${SYMBOLS.USER} ${LABELS.USER_SETTINGS}`)
    .setDescription(LABELS.DATA_MGMT)
    .addFields(
      {
        name: `${SYMBOLS.BULLET} Conversation Data`,
        value: 'Clear or download your conversation history',
        inline: false
      },
      {
        name: `${SYMBOLS.BULLET} ${LABELS.APPEARANCE}`,
        value: `Current color: \`${embedColor}\``,
        inline: false
      }
    )
    .setFooter({ text: createFooter(3, 3, LABELS.DATA_MGMT) })
    .setTimestamp();
  
  const payload = {
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(clearButton, downloadButton),
      new ActionRowBuilder().addComponents(colorButton),
      new ActionRowBuilder().addComponents(backButton, mainButton)
    ],
    flags: MessageFlags.Ephemeral
  };
  
  if (isUpdate) {
    await interaction.update(payload);
  } else {
    await interaction.reply(payload);
  }
  
  scheduleMessageDeletion(interaction);
}

// ============================================================================
// SERVER SETTINGS - PAGE 1: CORE
// ============================================================================

async function showServerSettings(interaction, isUpdate = false) {
  if (!hasPermission(interaction, PERMISSIONS.SERVER_SETTINGS)) {
    return sendPermissionError(interaction);
  }
  
  const userId = interaction.user.id;
  const guildId = interaction.guild.id;
  const serverSettings = state.serverSettings[guildId] || {};
  const embedColor = getEmbedColor(userId, guildId);
  
  const selectedModel = serverSettings.selectedModel || MODELS.FLASH.id;
  const responseFormat = serverSettings.responseFormat || FORMATS.NORMAL.id;
  const showActionButtons = serverSettings.showActionButtons === true;
  
  // Model selector
  const modelSelect = new StringSelectMenuBuilder()
    .setCustomId('server_model_select')
    .setPlaceholder(`${SYMBOLS.SELECT} Select model`)
    .addOptions(
      new StringSelectMenuOptionBuilder()
        .setLabel(MODELS.FLASH.name)
        .setDescription(MODELS.FLASH.description)
        .setValue(MODELS.FLASH.id)
        .setDefault(selectedModel === MODELS.FLASH.id)
    );
  
  // Format selector
  const formatSelect = new StringSelectMenuBuilder()
    .setCustomId('server_response_format')
    .setPlaceholder(`${SYMBOLS.SELECT} Select format`)
    .addOptions(
      new StringSelectMenuOptionBuilder()
        .setLabel(FORMATS.NORMAL.name)
        .setDescription(FORMATS.NORMAL.description)
        .setValue(FORMATS.NORMAL.id)
        .setDefault(responseFormat === FORMATS.NORMAL.id),
      new StringSelectMenuOptionBuilder()
        .setLabel(FORMATS.EMBEDDED.name)
        .setDescription(FORMATS.EMBEDDED.description)
        .setValue(FORMATS.EMBEDDED.id)
        .setDefault(responseFormat === FORMATS.EMBEDDED.id)
    );
  
  // Action buttons toggle
  const buttonsSelect = new StringSelectMenuBuilder()
    .setCustomId('server_action_buttons')
    .setPlaceholder(`${SYMBOLS.SELECT} Toggle buttons`)
    .addOptions(
      new StringSelectMenuOptionBuilder()
        .setLabel(`${SYMBOLS.ENABLED} ${LABELS.VISIBLE}`)
        .setDescription('Show action buttons')
        .setValue('show')
        .setDefault(showActionButtons),
      new StringSelectMenuOptionBuilder()
        .setLabel(`${SYMBOLS.DISABLED} ${LABELS.HIDDEN}`)
        .setDescription('Hide action buttons')
        .setValue('hide')
        .setDefault(!showActionButtons)
    );
  
  // Navigation
  const backButton = new ButtonBuilder()
    .setCustomId('back_to_main')
    .setLabel(LABELS.BACK)
    .setStyle(ButtonStyle.Secondary);
  
  const nextButton = new ButtonBuilder()
    .setCustomId('server_settings_page2')
    .setLabel(LABELS.NEXT)
    .setStyle(ButtonStyle.Primary);
  
  const embed = new EmbedBuilder()
    .setColor(embedColor)
    .setTitle(`${SYMBOLS.SERVER} ${LABELS.SERVER_SETTINGS}`)
    .setDescription(LABELS.CORE_PREFS)
    .addFields(
      {
        name: `${SYMBOLS.CURRENT} ${LABELS.AI_MODEL}`,
        value: `\`${selectedModel}\``,
        inline: true
      },
      {
        name: `${SYMBOLS.CURRENT} ${LABELS.RESPONSE_FORMAT}`,
        value: `\`${responseFormat}\``,
        inline: true
      },
      {
        name: `${SYMBOLS.CURRENT} ${LABELS.ACTION_BUTTONS}`,
        value: `\`${showActionButtons ? LABELS.VISIBLE : LABELS.HIDDEN}\``,
        inline: true
      }
    )
    .setFooter({ text: createFooter(1, 5, LABELS.CORE_PREFS) })
    .setTimestamp();
  
  const payload = {
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(modelSelect),
      new ActionRowBuilder().addComponents(formatSelect),
      new ActionRowBuilder().addComponents(buttonsSelect),
      new ActionRowBuilder().addComponents(backButton, nextButton)
    ],
    flags: MessageFlags.Ephemeral
  };
  
  if (isUpdate) {
    await interaction.update(payload);
  } else {
    await interaction.reply(payload);
  }
  
  scheduleMessageDeletion(interaction);
}

// ============================================================================
// SERVER SETTINGS - PAGE 2: BEHAVIOR
// ============================================================================

async function showServerSettingsPage2(interaction, isUpdate = false) {
  if (!hasPermission(interaction, PERMISSIONS.SERVER_SETTINGS)) {
    return sendPermissionError(interaction);
  }
  
  const userId = interaction.user.id;
  const guildId = interaction.guild.id;
  const serverSettings = state.serverSettings[guildId] || {};
  const embedColor = getEmbedColor(userId, guildId);
  
  const continuousReply = serverSettings.continuousReply ?? false;
  const overrideUser = serverSettings.overrideUserSettings ?? true;
  const serverHistory = serverSettings.serverChatHistory ?? false;
  
  // Auto-reply toggle
  const replySelect = new StringSelectMenuBuilder()
    .setCustomId('server_continuous_reply')
    .setPlaceholder(`${SYMBOLS.SELECT} Auto-reply mode`)
    .addOptions(
      new StringSelectMenuOptionBuilder()
        .setLabel(`${SYMBOLS.ENABLED} ${LABELS.ENABLED}`)
        .setDescription('Reply without mentions')
        .setValue('enabled')
        .setDefault(continuousReply),
      new StringSelectMenuOptionBuilder()
        .setLabel(`${SYMBOLS.DISABLED} ${LABELS.DISABLED}`)
        .setDescription('Require mentions')
        .setValue('disabled')
        .setDefault(!continuousReply)
    );
  
  // Override toggle
  const overrideSelect = new StringSelectMenuBuilder()
    .setCustomId('server_override')
    .setPlaceholder(`${SYMBOLS.SELECT} Override user settings`)
    .addOptions(
      new StringSelectMenuOptionBuilder()
        .setLabel(`${SYMBOLS.ENABLED} ${LABELS.ENABLED}`)
        .setDescription('Override user preferences')
        .setValue('enabled')
        .setDefault(overrideUser),
      new StringSelectMenuOptionBuilder()
        .setLabel(`${SYMBOLS.DISABLED} ${LABELS.DISABLED}`)
        .setDescription('Respect user preferences')
        .setValue('disabled')
        .setDefault(!overrideUser)
    );
  
  // History toggle
  const historySelect = new StringSelectMenuBuilder()
    .setCustomId('server_chat_history')
    .setPlaceholder(`${SYMBOLS.SELECT} Server history`)
    .addOptions(
      new StringSelectMenuOptionBuilder()
        .setLabel(`${SYMBOLS.ENABLED} ${LABELS.ENABLED}`)
        .setDescription('Use server-wide history')
        .setValue('enabled')
        .setDefault(serverHistory),
      new StringSelectMenuOptionBuilder()
        .setLabel(`${SYMBOLS.DISABLED} ${LABELS.DISABLED}`)
        .setDescription('Use per-user history')
        .setValue('disabled')
        .setDefault(!serverHistory)
    );
  
  // Navigation
  const backButton = new ButtonBuilder()
    .setCustomId('server_settings_p1')
    .setLabel(LABELS.BACK)
    .setStyle(ButtonStyle.Secondary);
  
  const nextButton = new ButtonBuilder()
    .setCustomId('server_settings_page3')
    .setLabel(LABELS.NEXT)
    .setStyle(ButtonStyle.Primary);
  
  const embed = new EmbedBuilder()
    .setColor(embedColor)
    .setTitle(`${SYMBOLS.SERVER} ${LABELS.SERVER_SETTINGS}`)
    .setDescription(LABELS.BEHAVIOR)
    .addFields(
      {
        name: `${SYMBOLS.CURRENT} ${LABELS.CONTINUOUS_REPLY}`,
        value: `\`${continuousReply ? LABELS.ENABLED : LABELS.DISABLED}\``,
        inline: true
      },
      {
        name: `${SYMBOLS.CURRENT} ${LABELS.OVERRIDE_SETTINGS}`,
        value: `\`${overrideUser ? LABELS.ENABLED : LABELS.DISABLED}\``,
        inline: true
      },
      {
        name: `${SYMBOLS.CURRENT} ${LABELS.SERVER_HISTORY}`,
        value: `\`${serverHistory ? LABELS.ENABLED : LABELS.DISABLED}\``,
        inline: true
      }
    )
    .setFooter({ text: createFooter(2, 5, LABELS.BEHAVIOR) })
    .setTimestamp();
  
  const payload = {
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(replySelect),
      new ActionRowBuilder().addComponents(overrideSelect),
      new ActionRowBuilder().addComponents(historySelect),
      new ActionRowBuilder().addComponents(backButton, nextButton)
    ],
    flags: MessageFlags.Ephemeral
  };
  
  if (isUpdate) {
    await interaction.update(payload);
  } else {
    await interaction.reply(payload);
  }
  
  scheduleMessageDeletion(interaction);
}

// ============================================================================
// SERVER SETTINGS - PAGE 3: PERSONALITY
// ============================================================================

async function showServerSettingsPage3(interaction, isUpdate = false) {
  if (!hasPermission(interaction, PERMISSIONS.SERVER_SETTINGS)) {
    return sendPermissionError(interaction);
  }
  
  const userId = interaction.user.id;
  const guildId = interaction.guild.id;
  const serverSettings = state.serverSettings[guildId] || {};
  const embedColor = getEmbedColor(userId, guildId);
  const hasPersonality = !!serverSettings.customPersonality;
  
  // Personality buttons
  const personalityButton = new ButtonBuilder()
    .setCustomId('server_custom_personality')
    .setLabel(hasPersonality ? `${SYMBOLS.EDIT} Edit` : `${SYMBOLS.EDIT} Add`)
    .setStyle(ButtonStyle.Secondary);
  
  const buttons = [personalityButton];
  
  if (hasPersonality) {
    const removeButton = new ButtonBuilder()
      .setCustomId('server_remove_personality')
      .setLabel(`${SYMBOLS.DELETE} ${LABELS.REMOVE}`)
      .setStyle(ButtonStyle.Danger);
    buttons.push(removeButton);
  }
  
  // Navigation
  const backButton = new ButtonBuilder()
    .setCustomId('back_to_server_p2')
    .setLabel(LABELS.BACK)
    .setStyle(ButtonStyle.Secondary);
  
  const nextButton = new ButtonBuilder()
    .setCustomId('server_settings_page4')
    .setLabel(LABELS.NEXT)
    .setStyle(ButtonStyle.Primary);
  
  const embed = new EmbedBuilder()
    .setColor(embedColor)
    .setTitle(`${SYMBOLS.SERVER} ${LABELS.SERVER_SETTINGS}`)
    .setDescription('Custom Personality')
    .addFields({
      name: `${SYMBOLS.CURRENT} ${LABELS.CUSTOM_PERSONALITY}`,
      value: `\`${hasPersonality ? LABELS.ACTIVE : LABELS.INACTIVE}\``,
      inline: false
    })
    .setFooter({ text: createFooter(3, 5, 'Personality') })
    .setTimestamp();
  
  const payload = {
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(...buttons),
      new ActionRowBuilder().addComponents(backButton, nextButton)
    ],
    flags: MessageFlags.Ephemeral
  };
  
  if (isUpdate) {
    await interaction.update(payload);
  } else {
    await interaction.reply(payload);
  }
  
  scheduleMessageDeletion(interaction);
}

// ============================================================================
// SERVER SETTINGS - PAGE 4: CHANNELS
// ============================================================================

async function showServerSettingsPage4(interaction, isUpdate = false) {
  if (!hasPermission(interaction, PERMISSIONS.SERVER_SETTINGS)) {
    return sendPermissionError(interaction);
  }
  
  const userId = interaction.user.id;
  const guildId = interaction.guild.id;
  const serverSettings = state.serverSettings[guildId] || {};
  const embedColor = getEmbedColor(userId, guildId);
  const allowedChannels = serverSettings.allowedChannels || [];
  
  // Channel management button
  const manageButton = new ButtonBuilder()
    .setCustomId('manage_allowed_channels')
    .setLabel(`${SYMBOLS.EDIT} Manage`)
    .setStyle(ButtonStyle.Secondary);
  
  const toggleButton = new ButtonBuilder()
    .setCustomId('toggle_continuous_reply')
    .setLabel('Toggle Current')
    .setStyle(ButtonStyle.Secondary);
  
  // Navigation
  const backButton = new ButtonBuilder()
    .setCustomId('back_to_server_p3')
    .setLabel(LABELS.BACK)
    .setStyle(ButtonStyle.Secondary);
  
  const nextButton = new ButtonBuilder()
    .setCustomId('server_settings_page5')
    .setLabel(LABELS.NEXT)
    .setStyle(ButtonStyle.Primary);
  
  const channelList = allowedChannels.length > 0
    ? allowedChannels.map(id => `<#${id}>`).join(', ')
    : 'All channels allowed';
  
  const embed = new EmbedBuilder()
    .setColor(embedColor)
    .setTitle(`${SYMBOLS.SERVER} ${LABELS.SERVER_SETTINGS}`)
    .setDescription(LABELS.CHANNELS)
    .addFields({
      name: `${SYMBOLS.CURRENT} ${LABELS.ALLOWED_CHANNELS}`,
      value: channelList,
      inline: false
    })
    .setFooter({ text: createFooter(4, 5, LABELS.CHANNELS) })
    .setTimestamp();
  
  const payload = {
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(manageButton, toggleButton),
      new ActionRowBuilder().addComponents(backButton, nextButton)
    ],
    flags: MessageFlags.Ephemeral
  };
  
  if (isUpdate) {
    await interaction.update(payload);
  } else {
    await interaction.reply(payload);
  }
  
  scheduleMessageDeletion(interaction);
}

// ============================================================================
// SERVER SETTINGS - PAGE 5: DATA & APPEARANCE
// ============================================================================

async function showServerSettingsPage5(interaction, isUpdate = false) {
  if (!hasPermission(interaction, PERMISSIONS.SERVER_SETTINGS)) {
    return sendPermissionError(interaction);
  }
  
  const userId = interaction.user.id;
  const guildId = interaction.guild.id;
  const embedColor = getEmbedColor(userId, guildId);
  
  // Data management buttons
  const clearButton = new ButtonBuilder()
    .setCustomId('clear_server_memory')
    .setLabel(`${SYMBOLS.CLEAR} ${LABELS.CLEAR}`)
    .setStyle(ButtonStyle.Danger);
  
  const downloadButton = new ButtonBuilder()
    .setCustomId('download_server_conversation')
    .setLabel(`${SYMBOLS.DOWNLOAD} ${LABELS.DOWNLOAD}`)
    .setStyle(ButtonStyle.Secondary);
  
  // Appearance button
  const colorButton = new ButtonBuilder()
    .setCustomId('server_embed_color')
    .setLabel(`${SYMBOLS.EDIT} ${LABELS.EMBED_COLOR}`)
    .setStyle(ButtonStyle.Secondary);
  
  // Navigation
  const backButton = new ButtonBuilder()
    .setCustomId('back_to_server_p4')
    .setLabel(LABELS.BACK)
    .setStyle(ButtonStyle.Secondary);
  
  const mainButton = new ButtonBuilder()
    .setCustomId('back_to_main')
    .setLabel('Main Menu')
    .setStyle(ButtonStyle.Primary);
  
  const embed = new EmbedBuilder()
    .setColor(embedColor)
    .setTitle(`${SYMBOLS.SERVER} ${LABELS.SERVER_SETTINGS}`)
    .setDescription(LABELS.DATA_MGMT)
    .addFields(
      {
        name: `${SYMBOLS.BULLET} Conversation Data`,
        value: 'Clear or download server conversation history',
        inline: false
      },
      {
        name: `${SYMBOLS.BULLET} ${LABELS.APPEARANCE}`,
        value: `Current color: \`${embedColor}\``,
        inline: false
      }
    )
    .setFooter({ text: createFooter(5, 5, LABELS.DATA_MGMT) })
    .setTimestamp();
  
  const payload = {
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(clearButton, downloadButton),
      new ActionRowBuilder().addComponents(colorButton),
      new ActionRowBuilder().addComponents(backButton, mainButton)
    ],
    flags: MessageFlags.Ephemeral
  };
  
  if (isUpdate) {
    await interaction.update(payload);
  } else {
    await interaction.reply(payload);
  }
  
  scheduleMessageDeletion(interaction);
}

// ============================================================================
// CHANNEL MANAGEMENT MENU
// ============================================================================

async function showChannelManagementMenu(interaction, isUpdate = false) {
  if (!hasPermission(interaction, PERMISSIONS.SERVER_SETTINGS)) {
    return sendPermissionError(interaction);
  }
  
  const userId = interaction.user.id;
  const guildId = interaction.guild.id;
  const serverSettings = state.serverSettings[guildId] || {};
  const embedColor = getEmbedColor(userId, guildId);
  const allowedChannels = serverSettings.allowedChannels || [];
  
  // Channel selector
  const channelSelect = new ChannelSelectMenuBuilder()
    .setCustomId('channel_manage_select')
    .setChannelTypes(ChannelType.GuildText)
    .setPlaceholder(`${SYMBOLS.SELECT} Select channels`)
    .setMinValues(0)
    .setMaxValues(25);
  
  if (allowedChannels.length > 0) {
    channelSelect.setDefaultChannels(allowedChannels);
  }
  
  // All channels button
  const allButton = new ButtonBuilder()
    .setCustomId('set_all_channels')
    .setLabel('Allow All')
    .setStyle(ButtonStyle.Secondary);
  
  // Back button
  const backButton = new ButtonBuilder()
    .setCustomId('back_to_server_p4')
    .setLabel(LABELS.BACK)
    .setStyle(ButtonStyle.Primary);
  
  const channelList = allowedChannels.length > 0
    ? allowedChannels.map(id => `<#${id}>`).join(', ')
    : 'All channels allowed';
  
  const embed = new EmbedBuilder()
    .setColor(embedColor)
    .setTitle(`${SYMBOLS.EDIT} ${LABELS.CHANNELS}`)
    .setDescription('Select channels where the bot can respond')
    .addFields({
      name: `${SYMBOLS.CURRENT} Active Channels`,
      value: channelList,
      inline: false
    })
    .setFooter({ text: 'Leave empty to allow all channels' })
    .setTimestamp();
  
  const payload = {
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(channelSelect),
      new ActionRowBuilder().addComponents(allButton, backButton)
    ],
    flags: MessageFlags.Ephemeral
  };
  
  if (isUpdate) {
    await interaction.update(payload);
  } else {
    await interaction.reply(payload);
  }
  
  scheduleMessageDeletion(interaction);
}

// ============================================================================
// MODAL HANDLERS
// ============================================================================

async function showUserPersonalityModal(interaction) {
  const userId = interaction.user.id;
  const existing = state.userSettings[userId]?.customPersonality || '';
  
  const input = new TextInputBuilder()
    .setCustomId('personality_input')
    .setLabel('Custom Personality')
    .setStyle(TextInputStyle.Paragraph)
    .setPlaceholder('Describe the bot personality...')
    .setRequired(true)
    .setMinLength(10)
    .setMaxLength(2000);
  
  if (existing) {
    input.setValue(existing);
  }
  
  const modal = new ModalBuilder()
    .setCustomId('user_personality_modal')
    .setTitle('User Personality')
    .addComponents(new ActionRowBuilder().addComponents(input));
  
  await interaction.showModal(modal);
}

async function showServerPersonalityModal(interaction) {
  if (!hasPermission(interaction, PERMISSIONS.SERVER_SETTINGS)) {
    return sendPermissionError(interaction);
  }
  
  const guildId = interaction.guild.id;
  const existing = state.serverSettings[guildId]?.customPersonality || '';
  
  const input = new TextInputBuilder()
    .setCustomId('personality_input')
    .setLabel('Server Personality')
    .setStyle(TextInputStyle.Paragraph)
    .setPlaceholder('Describe the bot personality...')
    .setRequired(true)
    .setMinLength(10)
    .setMaxLength(2000);
  
  if (existing) {
    input.setValue(existing);
  }
  
  const modal = new ModalBuilder()
    .setCustomId('server_personality_modal')
    .setTitle('Server Personality')
    .addComponents(new ActionRowBuilder().addComponents(input));
  
  await interaction.showModal(modal);
}

async function showUserEmbedColorModal(interaction) {
  const userId = interaction.user.id;
  const existing = state.userSettings[userId]?.embedColor || '';
  
  const input = new TextInputBuilder()
    .setCustomId('color_input')
    .setLabel('Hex Color Code')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('#2B2D31 or 2B2D31')
    .setRequired(true)
    .setMinLength(6)
    .setMaxLength(7);
  
  if (existing) {
    input.setValue(existing);
  }
  
  const modal = new ModalBuilder()
    .setCustomId('user_embed_color_modal')
    .setTitle('User Embed Color')
    .addComponents(new ActionRowBuilder().addComponents(input));
  
  await interaction.showModal(modal);
}

async function showServerEmbedColorModal(interaction) {
  if (!hasPermission(interaction, PERMISSIONS.SERVER_SETTINGS)) {
    return sendPermissionError(interaction);
  }
  
  const guildId = interaction.guild.id;
  const existing = state.serverSettings[guildId]?.embedColor || '';
  
  const input = new TextInputBuilder()
    .setCustomId('color_input')
    .setLabel('Hex Color Code')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('#2B2D31 or 2B2D31')
    .setRequired(true)
    .setMinLength(6)
    .setMaxLength(7);
  
  if (existing) {
    input.setValue(existing);
  }
  
  const modal = new ModalBuilder()
    .setCustomId('server_embed_color_modal')
    .setTitle('Server Embed Color')
    .addComponents(new ActionRowBuilder().addComponents(input));
  
  await interaction.showModal(modal);
}

// ============================================================================
// ACTION HANDLERS
// ============================================================================

async function removeUserPersonality(interaction) {
  const userId = interaction.user.id;
  
  if (state.userSettings[userId]) {
    state.userSettings[userId].customPersonality = null;
    await saveStateToFile();
  }
  
  const embed = new EmbedBuilder()
    .setColor(COLORS.SUCCESS)
    .setTitle(`${SYMBOLS.DELETE} Removed`)
    .setDescription('Custom personality removed');
  
  await interaction.reply({
    embeds: [embed],
    flags: MessageFlags.Ephemeral
  });
}

async function removeServerPersonality(interaction) {
  if (!hasPermission(interaction, PERMISSIONS.SERVER_SETTINGS)) {
    return sendPermissionError(interaction);
  }
  
  const guildId = interaction.guild.id;
  
  if (state.serverSettings[guildId]) {
    state.serverSettings[guildId].customPersonality = null;
    await saveStateToFile();
  }
  
  const embed = new EmbedBuilder()
    .setColor(COLORS.SUCCESS)
    .setTitle(`${SYMBOLS.DELETE} Removed`)
    .setDescription('Server personality removed');
  
  await interaction.reply({
    embeds: [embed],
    flags: MessageFlags.Ephemeral
  });
}

async function clearUserMemory(interaction) {
  const userId = interaction.user.id;
  
  await chatHistoryLock.runExclusive(async () => {
    if (state.chatHistories[userId]) {
      delete state.chatHistories[userId];
      await saveStateToFile();
    }
  });
  
  const embed = new EmbedBuilder()
    .setColor(COLORS.SUCCESS)
    .setTitle(`${SYMBOLS.CLEAR} Cleared`)
    .setDescription('Conversation history cleared');
  
  await interaction.reply({
    embeds: [embed],
    flags: MessageFlags.Ephemeral
  });
}

async function clearServerMemory(interaction) {
  if (!hasPermission(interaction, PERMISSIONS.SERVER_SETTINGS)) {
    return sendPermissionError(interaction);
  }
  
  const guildId = interaction.guild.id;
  
  await chatHistoryLock.runExclusive(async () => {
    if (state.chatHistories[guildId]) {
      delete state.chatHistories[guildId];
      await saveStateToFile();
    }
  });
  
  const embed = new EmbedBuilder()
    .setColor(COLORS.SUCCESS)
    .setTitle(`${SYMBOLS.CLEAR} Cleared`)
    .setDescription('Server history cleared');
  
  await interaction.reply({
    embeds: [embed],
    flags: MessageFlags.Ephemeral
  });
}

async function downloadUserConversation(interaction) {
  const userId = interaction.user.id;
  const history = getHistory(userId);
  
  if (!history || history.length === 0) {
    const embed = new EmbedBuilder()
      .setColor(COLORS.WARNING)
      .setTitle(`${SYMBOLS.DELETE} No Data`)
      .setDescription('No conversation history found');
    
    return interaction.reply({
      embeds: [embed],
      flags: MessageFlags.Ephemeral
    });
  }
  
  const formatted = JSON.stringify(history, null, 2);
  const filePath = path.join(TEMP_DIR, `user_history_${userId}.json`);
  
  await fs.writeFile(filePath, formatted, 'utf8');
  
  const attachment = new AttachmentBuilder(filePath, {
    name: 'conversation_history.json'
  });
  
  const embed = new EmbedBuilder()
    .setColor(COLORS.SUCCESS)
    .setTitle(`${SYMBOLS.DOWNLOAD} Downloaded`)
    .setDescription('Conversation history exported');
  
  await interaction.reply({
    embeds: [embed],
    files: [attachment],
    flags: MessageFlags.Ephemeral
  });
  
  await fs.unlink(filePath).catch(() => {});
}

async function downloadServerConversation(interaction) {
  if (!hasPermission(interaction, PERMISSIONS.SERVER_SETTINGS)) {
    return sendPermissionError(interaction);
  }
  
  const guildId = interaction.guild.id;
  const history = getHistory(guildId);
  
  if (!history || history.length === 0) {
    const embed = new EmbedBuilder()
      .setColor(COLORS.WARNING)
      .setTitle(`${SYMBOLS.DELETE} No Data`)
      .setDescription('No server history found');
    
    return interaction.reply({
      embeds: [embed],
      flags: MessageFlags.Ephemeral
    });
  }
  
  const formatted = JSON.stringify(history, null, 2);
  const filePath = path.join(TEMP_DIR, `server_history_${guildId}.json`);
  
  await fs.writeFile(filePath, formatted, 'utf8');
  
  const attachment = new AttachmentBuilder(filePath, {
    name: 'server_history.json'
  });
  
  const embed = new EmbedBuilder()
    .setColor(COLORS.SUCCESS)
    .setTitle(`${SYMBOLS.DOWNLOAD} Downloaded`)
    .setDescription('Server history exported');
  
  await interaction.reply({
    embeds: [embed],
    files: [attachment],
    flags: MessageFlags.Ephemeral
  });
  
  await fs.unlink(filePath).catch(() => {});
}

async function toggleContinuousReplyChannel(interaction) {
  if (!hasPermission(interaction, PERMISSIONS.SERVER_SETTINGS)) {
    return sendPermissionError(interaction);
  }
  
  const channelId = interaction.channelId;
  
  if (!state.continuousReplyChannels) {
    state.continuousReplyChannels = {};
  }
  
  const isEnabled = state.continuousReplyChannels[channelId];
  
  if (isEnabled) {
    delete state.continuousReplyChannels[channelId];
  } else {
    state.continuousReplyChannels[channelId] = true;
  }
  
  await saveStateToFile();
  
  const embed = new EmbedBuilder()
    .setColor(isEnabled ? COLORS.WARNING : COLORS.SUCCESS)
    .setTitle(`${isEnabled ? SYMBOLS.DISABLED : SYMBOLS.ENABLED} ${isEnabled ? LABELS.DISABLED : LABELS.ENABLED}`)
    .setDescription(`Auto-reply ${isEnabled ? 'disabled' : 'enabled'} in <#${channelId}>`);
  
  await interaction.reply({
    embeds: [embed],
    flags: MessageFlags.Ephemeral
  });
}

async function handleChannelManageSelect(interaction) {
  if (!hasPermission(interaction, PERMISSIONS.SERVER_SETTINGS)) {
    return sendPermissionError(interaction);
  }
  
  const guildId = interaction.guild.id;
  const selectedChannels = interaction.values;
  
  if (!state.serverSettings[guildId]) {
    state.serverSettings[guildId] = {};
  }
  
  state.serverSettings[guildId].allowedChannels = selectedChannels;
  await saveStateToFile();
  
  await showChannelManagementMenu(interaction, true);
}

async function handleSetAllChannels(interaction) {
  if (!hasPermission(interaction, PERMISSIONS.SERVER_SETTINGS)) {
    return sendPermissionError(interaction);
  }
  
  const guildId = interaction.guild.id;
  
  if (!state.serverSettings[guildId]) {
    state.serverSettings[guildId] = {};
  }
  
  state.serverSettings[guildId].allowedChannels = [];
  await saveStateToFile();
  
  await showChannelManagementMenu(interaction, true);
}

async function downloadMessage(interaction) {
  const message = interaction.message;
  let content = message.content;
  
  if (!content && message.embeds.length > 0) {
    content = message.embeds[0].description;
  }
  
  if (!content) {
    const embed = new EmbedBuilder()
      .setColor(COLORS.WARNING)
      .setTitle(`${SYMBOLS.DELETE} Empty`)
      .setDescription('Message has no content');
    
    return interaction.reply({
      embeds: [embed],
      flags: MessageFlags.Ephemeral
    });
  }
  
  const filePath = path.join(TEMP_DIR, `message_${interaction.id}.txt`);
  await fs.writeFile(filePath, content, 'utf8');
  
  const attachment = new AttachmentBuilder(filePath, {
    name: 'message.txt'
  });
  
  const embed = new EmbedBuilder()
    .setColor(COLORS.SUCCESS)
    .setTitle(`${SYMBOLS.DOWNLOAD} Saved`)
    .setDescription('Message content exported');
  
  try {
    await interaction.user.send({
      embeds: [embed],
      files: [attachment]
    });
    
    const confirmEmbed = new EmbedBuilder()
      .setColor(COLORS.INFO)
      .setTitle(`${SYMBOLS.ACTIVE} Sent`)
      .setDescription('Check your DMs');
    
    await interaction.reply({
      embeds: [confirmEmbed],
      flags: MessageFlags.Ephemeral
    });
  } catch (error) {
    await interaction.reply({
      embeds: [embed],
      files: [attachment],
      flags: MessageFlags.Ephemeral
    });
  }
  
  await fs.unlink(filePath).catch(() => {});
}

async function handleDeleteMessageInteraction(interaction, msgId) {
  const userId = interaction.user.id;
  const userHistory = state.chatHistories[userId];
  const channel = interaction.channel;
  const message = channel ? await channel.messages.fetch(msgId).catch(() => null) : null;
  
  if (userHistory && userHistory[msgId]) {
    delete userHistory[msgId];
    await interaction.message.delete().catch(() => {});
    if (message) {
      await message.delete().catch(() => {});
    }
  } else {
    try {
      const replyingTo = message?.reference
        ? (await message.channel.messages.fetch(message.reference.messageId)).author.id
        : null;
      
      if (userId === replyingTo) {
        await interaction.message.delete().catch(() => {});
        if (message) {
          await message.delete().catch(() => {});
        }
      } else {
        const embed = new EmbedBuilder()
          .setColor(COLORS.ERROR)
          .setTitle(`${SYMBOLS.DELETE} Not Authorized`)
          .setDescription('This action is not available to you');
        
        await interaction.reply({
          embeds: [embed],
          flags: MessageFlags.Ephemeral
        });
      }
    } catch (error) {
      console.error('Delete authorization check failed:', error);
    }
  }
}

// ============================================================================
// INTERACTION ROUTERS
// ============================================================================

export async function handleButtonInteraction(interaction) {
  if (!interaction.isButton()) return;
  
  const guildId = interaction.guild?.id;
  const userId = interaction.user.id;
  
  // Check blacklist
  if (guildId) {
    const { initializeBlacklistForGuild } = await import('./utils.js');
    initializeBlacklistForGuild(guildId);
    
    if (state.blacklistedUsers[guildId]?.includes(userId)) {
      const embed = new EmbedBuilder()
        .setColor(COLORS.ERROR)
        .setTitle(`${SYMBOLS.DELETE} Blacklisted`)
        .setDescription('You cannot use this interaction');
      
      return interaction.reply({
        embeds: [embed],
        flags: MessageFlags.Ephemeral
      });
    }
  }
  
  const handlers = {
    // User settings
    'user_settings': showUserSettings,
    'user_settings_p1': showUserSettings,
    'user_settings_page2': showUserSettingsPage2,
    'user_settings_page3': showUserSettingsPage3,
    'back_to_user': showUserSettings,
    'back_to_user_p2': showUserSettingsPage2,
    
    // Server settings
    'server_settings': showServerSettings,
    'server_settings_p1': showServerSettings,
    'server_settings_page2': showServerSettingsPage2,
    'server_settings_page3': showServerSettingsPage3,
    'server_settings_page4': showServerSettingsPage4,
    'server_settings_page5': showServerSettingsPage5,
    'back_to_server': showServerSettings,
    'back_to_server_p2': showServerSettingsPage2,
    'back_to_server_p3': showServerSettingsPage3,
    'back_to_server_p4': showServerSettingsPage4,
    
    // Navigation
    'back_to_main': showMainSettings,
    'settings_btn': showMainSettings,
    
    // Personality
    'user_custom_personality': showUserPersonalityModal,
    'user_remove_personality': removeUserPersonality,
    'server_custom_personality': showServerPersonalityModal,
    'server_remove_personality': removeServerPersonality,
    
    // Appearance
    'user_embed_color': showUserEmbedColorModal,
    'server_embed_color': showServerEmbedColorModal,
    
    // Data management
    'clear_user_memory': clearUserMemory,
    'clear_server_memory': clearServerMemory,
    'download_user_conversation': downloadUserConversation,
    'download_server_conversation': downloadServerConversation,
    
    // Channels
    'manage_allowed_channels': showChannelManagementMenu,
    'set_all_channels': handleSetAllChannels,
    'toggle_continuous_reply': toggleContinuousReplyChannel,
    
    // Message actions
    'download_message': downloadMessage
  };
  
  const updateable = [
    'user_settings', 'user_settings_p1', 'user_settings_page2', 'user_settings_page3',
    'server_settings', 'server_settings_p1', 'server_settings_page2',
    'server_settings_page3', 'server_settings_page4', 'server_settings_page5',
    'back_to_main', 'back_to_user', 'back_to_user_p2',
    'back_to_server', 'back_to_server_p2', 'back_to_server_p3', 'back_to_server_p4',
    'manage_allowed_channels', 'set_all_channels'
  ];
  
  for (const [key, handler] of Object.entries(handlers)) {
    if (interaction.customId.startsWith(key)) {
      await handler(interaction, updateable.includes(key));
      return;
    }
  }
  
  // Delete message handler
  if (interaction.customId.startsWith('delete_message-')) {
    const msgId = interaction.customId.replace('delete_message-', '');
    await handleDeleteMessageInteraction(interaction, msgId);
  }
}

export async function handleSelectMenuInteraction(interaction) {
  if (!interaction.isStringSelectMenu() && !interaction.isChannelSelectMenu()) return;
  
  const guildId = interaction.guild?.id;
  const userId = interaction.user.id;
  
  // Check blacklist
  if (guildId) {
    const { initializeBlacklistForGuild } = await import('./utils.js');
    initializeBlacklistForGuild(guildId);
    
    if (state.blacklistedUsers[guildId]?.includes(userId)) {
      const embed = new EmbedBuilder()
        .setColor(COLORS.ERROR)
        .setTitle(`${SYMBOLS.DELETE} Blacklisted`)
        .setDescription('You cannot use this interaction');
      
      return interaction.reply({
        embeds: [embed],
        flags: MessageFlags.Ephemeral
      });
    }
  }
  
  const handlers = {
    // User settings
    'user_model_select': async (interaction) => {
      const model = interaction.values[0];
      if (!state.userSettings[userId]) {
        state.userSettings[userId] = {};
      }
      state.userSettings[userId].selectedModel = model;
      await saveStateToFile();
      await showUserSettings(interaction, true);
    },
    
    'user_response_format': async (interaction) => {
      const format = interaction.values[0];
      if (!state.userSettings[userId]) {
        state.userSettings[userId] = {};
      }
      state.userSettings[userId].responseFormat = format;
      await saveStateToFile();
      await showUserSettings(interaction, true);
    },
    
    'user_action_buttons': async (interaction) => {
      const value = interaction.values[0];
      if (!state.userSettings[userId]) {
        state.userSettings[userId] = {};
      }
      state.userSettings[userId].showActionButtons = value === 'show';
      await saveStateToFile();
      await showUserSettings(interaction, true);
    },
    
    'user_continuous_reply': async (interaction) => {
      const value = interaction.values[0];
      if (!state.userSettings[userId]) {
        state.userSettings[userId] = {};
      }
      state.userSettings[userId].continuousReply = value === 'enabled';
      await saveStateToFile();
      await showUserSettingsPage2(interaction, true);
    },
    
    // Server settings
    'server_model_select': async (interaction) => {
      if (!hasPermission(interaction, PERMISSIONS.SERVER_SETTINGS)) {
        return sendPermissionError(interaction);
      }
      const model = interaction.values[0];
      if (!state.serverSettings[guildId]) {
        state.serverSettings[guildId] = {};
      }
      state.serverSettings[guildId].selectedModel = model;
      await saveStateToFile();
      await showServerSettings(interaction, true);
    },
    
    'server_response_format': async (interaction) => {
      if (!hasPermission(interaction, PERMISSIONS.SERVER_SETTINGS)) {
        return sendPermissionError(interaction);
      }
      const format = interaction.values[0];
      if (!state.serverSettings[guildId]) {
        state.serverSettings[guildId] = {};
      }
      state.serverSettings[guildId].responseFormat = format;
      await saveStateToFile();
      await showServerSettings(interaction, true);
    },
    
    'server_action_buttons': async (interaction) => {
      if (!hasPermission(interaction, PERMISSIONS.SERVER_SETTINGS)) {
        return sendPermissionError(interaction);
      }
      const value = interaction.values[0];
      if (!state.serverSettings[guildId]) {
        state.serverSettings[guildId] = {};
      }
      state.serverSettings[guildId].showActionButtons = value === 'show';
      await saveStateToFile();
      await showServerSettings(interaction, true);
    },
    
    'server_continuous_reply': async (interaction) => {
      if (!hasPermission(interaction, PERMISSIONS.SERVER_SETTINGS)) {
        return sendPermissionError(interaction);
      }
      const value = interaction.values[0];
      if (!state.serverSettings[guildId]) {
        state.serverSettings[guildId] = {};
      }
      state.serverSettings[guildId].continuousReply = value === 'enabled';
      await saveStateToFile();
      await showServerSettingsPage2(interaction, true);
    },
    
    'server_override': async (interaction) => {
      if (!hasPermission(interaction, PERMISSIONS.SERVER_SETTINGS)) {
        return sendPermissionError(interaction);
      }
      const value = interaction.values[0];
      if (!state.serverSettings[guildId]) {
        state.serverSettings[guildId] = {};
      }
      state.serverSettings[guildId].overrideUserSettings = value === 'enabled';
      await saveStateToFile();
      await showServerSettingsPage2(interaction, true);
    },
    
    'server_chat_history': async (interaction) => {
      if (!hasPermission(interaction, PERMISSIONS.SERVER_SETTINGS)) {
        return sendPermissionError(interaction);
      }
      const value = interaction.values[0];
      if (!state.serverSettings[guildId]) {
        state.serverSettings[guildId] = {};
      }
      state.serverSettings[guildId].serverChatHistory = value === 'enabled';
      await saveStateToFile();
      await showServerSettingsPage2(interaction, true);
    },
    
    'channel_manage_select': handleChannelManageSelect
  };
  
  const handler = handlers[interaction.customId];
  if (handler) {
    await handler(interaction);
  }
}

export async function handleModalSubmit(interaction) {
  const userId = interaction.user.id;
  const guildId = interaction.guild?.id;
  
  const handlers = {
    'user_personality_modal': async () => {
      const input = interaction.fields.getTextInputValue('personality_input');
      if (!state.userSettings[userId]) {
        state.userSettings[userId] = {};
      }
      state.userSettings[userId].customPersonality = input.trim();
      await saveStateToFile();
      
      const embed = new EmbedBuilder()
        .setColor(COLORS.SUCCESS)
        .setTitle(`${SYMBOLS.ACTIVE} Saved`)
        .setDescription('Custom personality updated');
      
      await interaction.reply({
        embeds: [embed],
        flags: MessageFlags.Ephemeral
      });
    },
    
    'server_personality_modal': async () => {
      if (!hasPermission(interaction, PERMISSIONS.SERVER_SETTINGS)) {
        return sendPermissionError(interaction);
      }
      
      const input = interaction.fields.getTextInputValue('personality_input');
      if (!state.serverSettings[guildId]) {
        state.serverSettings[guildId] = {};
      }
      state.serverSettings[guildId].customPersonality = input.trim();
      await saveStateToFile();
      
      const embed = new EmbedBuilder()
        .setColor(COLORS.SUCCESS)
        .setTitle(`${SYMBOLS.ACTIVE} Saved`)
        .setDescription('Server personality updated');
      
      await interaction.reply({
        embeds: [embed],
        flags: MessageFlags.Ephemeral
      });
    },
    
    'user_embed_color_modal': async () => {
      const input = interaction.fields.getTextInputValue('color_input').trim();
      const hexPattern = /^#?([0-9A-Fa-f]{6})$/;
      
      if (!hexPattern.test(input)) {
        const embed = new EmbedBuilder()
          .setColor(COLORS.ERROR)
          .setTitle(`${SYMBOLS.DELETE} Invalid`)
          .setDescription('Invalid hex color code');
        
        return interaction.reply({
          embeds: [embed],
          flags: MessageFlags.Ephemeral
        });
      }
      
      const hexColor = input.startsWith('#') ? input : `#${input}`;
      if (!state.userSettings[userId]) {
        state.userSettings[userId] = {};
      }
      state.userSettings[userId].embedColor = hexColor;
      await saveStateToFile();
      
      const embed = new EmbedBuilder()
        .setColor(hexColor)
        .setTitle(`${SYMBOLS.ACTIVE} Updated`)
        .setDescription(`Color set to \`${hexColor}\``);
      
      await interaction.reply({
        embeds: [embed],
        flags: MessageFlags.Ephemeral
      });
    },
    
    'server_embed_color_modal': async () => {
      if (!hasPermission(interaction, PERMISSIONS.SERVER_SETTINGS)) {
        return sendPermissionError(interaction);
      }
      
      const input = interaction.fields.getTextInputValue('color_input').trim();
      const hexPattern = /^#?([0-9A-Fa-f]{6})$/;
      
      if (!hexPattern.test(input)) {
        const embed = new EmbedBuilder()
          .setColor(COLORS.ERROR)
          .setTitle(`${SYMBOLS.DELETE} Invalid`)
          .setDescription('Invalid hex color code');
        
        return interaction.reply({
          embeds: [embed],
          flags: MessageFlags.Ephemeral
        });
      }
      
      const hexColor = input.startsWith('#') ? input : `#${input}`;
      if (!state.serverSettings[guildId]) {
        state.serverSettings[guildId] = {};
      }
      state.serverSettings[guildId].embedColor = hexColor;
      await saveStateToFile();
      
      const embed = new EmbedBuilder()
        .setColor(hexColor)
        .setTitle(`${SYMBOLS.ACTIVE} Updated`)
        .setDescription(`Server color set to \`${hexColor}\``);
      
      await interaction.reply({
        embeds: [embed],
        flags: MessageFlags.Ephemeral
      });
    }
  };
  
  const handler = handlers[interaction.customId];
  if (handler) {
    await handler();
  }
}

// ============================================================================
// EXPORTS
// ============================================================================
