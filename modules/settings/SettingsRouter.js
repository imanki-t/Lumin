/**
 * @fileoverview Settings interaction router — blacklist guard + dispatch to
 *               user/server handlers. All three entry-points (button, select,
 *               modal) live here so index.js has one clean import.
 * @module modules/settings/SettingsRouter
 */

import { EmbedBuilder, MessageFlags } from 'discord.js';
// BUG FIX: was a dynamic import inside every handler call — now static
import { initializeBlacklistForGuild } from '../utils.js';
import { state }                        from '../../managers/BotManager.js';
import { Logger }                       from '../../core/Logger.js';

import {
  showMainSettings,
  showUserSettings,
  showUserSettingsPage2,
  showUserSettingsPage3,
  clearUserMemory,
  downloadUserConversation,
  showUserPersonalityModal,
  removeUserPersonality,
  showUserEmbedColorModal
} from './UserSettingsHandler.js';

import {
  showServerSettings,
  showServerSettingsPage2,
  showServerSettingsPage3,
  showServerSettingsPage4,
  showServerSettingsPage5,
  showChannelManagementMenu,
  handleSetAllChannels,
  handleChannelManageSelect,
  toggleContinuousReplyChannel,
  clearServerMemory,
  downloadServerConversation,
  showServerPersonalityModal,
  removeServerPersonality,
  showServerEmbedColorModal,
  handleServerModelSelect,
  handleServerResponseFormat,
  handleServerActionButtons,
  handleServerContinuousReply,
  handleServerOverride,
  handleServerChatHistory
} from './ServerSettingsHandler.js';

import {
  handleUserModelSelect,
  handleUserResponseFormat,
  handleUserActionButtons,
  handleUserContinuousReply,
  handleUserPersonalityModal,
  handleServerPersonalityModal,
  handleUserEmbedColorModal,
  handleServerEmbedColorModal as handleServerEmbedColorModalSubmit,
  downloadMessage,
  handleDeleteMessageInteraction
} from './ActionHandlers.js';

const logger = Logger.get('SettingsRouter');

// ============================================================================
// BLACKLIST GUARD
// ============================================================================

/**
 * Returns true (and sends a blocked reply) if the user is blacklisted.
 * @param {import('discord.js').Interaction} interaction
 * @returns {Promise<boolean>}
 */
async function isBlacklisted(interaction) {
  const guildId = interaction.guild?.id;
  if (!guildId) return false;

  initializeBlacklistForGuild(guildId);

  if (state.blacklistedUsers[guildId]?.includes(interaction.user.id)) {
    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0xFF0000)
          .setTitle('🚫 Blacklisted')
          .setDescription('You are blacklisted and cannot use this interaction.')
      ],
      flags: MessageFlags.Ephemeral
    }).catch(() => {});
    return true;
  }
  return false;
}

// ============================================================================
// BUTTON ROUTER
// ============================================================================

/** Maps customId prefixes → handler functions for navigation buttons. */
const BUTTON_HANDLERS = {
  'user_settings_page3':      (i) => showUserSettingsPage3(i, true),
  'user_settings_page2':      (i) => showUserSettingsPage2(i, true),
  'user_settings_p1':         (i) => showUserSettings(i, true),
  'user_settings':            (i) => showUserSettings(i, true),
  'back_to_user_p2':          (i) => showUserSettingsPage2(i, true),
  'back_to_user':             (i) => showUserSettings(i, true),
  'server_settings_page5':    (i) => showServerSettingsPage5(i, true),
  'server_settings_page4':    (i) => showServerSettingsPage4(i, true),
  'server_settings_page3':    (i) => showServerSettingsPage3(i, true),
  'server_settings_page2':    (i) => showServerSettingsPage2(i, true),
  'server_settings_p1':       (i) => showServerSettings(i, true),
  'server_settings':          (i) => showServerSettings(i, true),
  'back_to_server_p4':        (i) => showServerSettingsPage4(i, true),
  'back_to_server_p3':        (i) => showServerSettingsPage3(i, true),
  'back_to_server_p2':        (i) => showServerSettingsPage2(i, true),
  'back_to_server':           (i) => showServerSettings(i, true),
  'back_to_main':             (i) => showMainSettings(i, true),
  'settings_btn':             (i) => showMainSettings(i, true),
  'clear_user_memory':        clearUserMemory,
  'download_user_conversation': downloadUserConversation,
  'clear_server_memory':      clearServerMemory,
  'download_server_conversation': downloadServerConversation,
  'user_custom_personality':  showUserPersonalityModal,
  'user_remove_personality':  removeUserPersonality,
  'server_custom_personality': showServerPersonalityModal,
  'server_remove_personality': removeServerPersonality,
  'user_embed_color':         showUserEmbedColorModal,
  'server_embed_color':       showServerEmbedColorModal,
  'toggle_continuous_reply':  toggleContinuousReplyChannel,
  'manage_allowed_channels':  (i) => showChannelManagementMenu(i, true),
  'set_all_channels':         (i) => handleSetAllChannels(i),
  'download_message':         downloadMessage
};

/**
 * Route a button interaction to the correct handler.
 * @param {import('discord.js').ButtonInteraction} interaction
 */
export async function handleButtonInteraction(interaction) {
  if (!interaction.isButton()) return;
  if (await isBlacklisted(interaction)) return;

  // delete_message has dynamic data after the prefix
  if (interaction.customId.startsWith('delete_message-')) {
    const data = interaction.customId.replace('delete_message-', '');
    return handleDeleteMessageInteraction(interaction, data);
  }

  for (const [prefix, handler] of Object.entries(BUTTON_HANDLERS)) {
    if (interaction.customId.startsWith(prefix)) {
      try {
        await handler(interaction);
      } catch (error) {
        logger.error(`Button handler error [${prefix}]`, error);
      }
      return;
    }
  }
}

// ============================================================================
// SELECT MENU ROUTER
// ============================================================================

/** Maps customId → handler for string/channel select menus. */
const SELECT_HANDLERS = {
  'user_model_select':     handleUserModelSelect,
  'server_model_select':   handleServerModelSelect,
  'user_response_format':  handleUserResponseFormat,
  'server_response_format': handleServerResponseFormat,
  'user_action_buttons':   handleUserActionButtons,
  'server_action_buttons': handleServerActionButtons,
  'user_continuous_reply': handleUserContinuousReply,
  'server_continuous_reply': handleServerContinuousReply,
  'server_override':       handleServerOverride,
  'server_chat_history':   handleServerChatHistory,
  'channel_manage_select': handleChannelManageSelect
};

/**
 * Route a select-menu interaction to the correct handler.
 * @param {import('discord.js').AnySelectMenuInteraction} interaction
 */
export async function handleSelectMenuInteraction(interaction) {
  if (!interaction.isStringSelectMenu() && !interaction.isChannelSelectMenu()) return;
  if (await isBlacklisted(interaction)) return;

  const handler = SELECT_HANDLERS[interaction.customId];
  if (!handler) return;

  try {
    await handler(interaction);
  } catch (error) {
    logger.error(`Select handler error [${interaction.customId}]`, error);
  }
}

// ============================================================================
// MODAL ROUTER
// ============================================================================

/** Maps customId → handler for modal submissions. */
const MODAL_HANDLERS = {
  'user_personality_modal':   handleUserPersonalityModal,
  'server_personality_modal': handleServerPersonalityModal,
  'user_embed_color_modal':   handleUserEmbedColorModal,
  'server_embed_color_modal': handleServerEmbedColorModalSubmit
};

/**
 * Route a modal submission to the correct handler.
 * @param {import('discord.js').ModalSubmitInteraction} interaction
 */
export async function handleModalSubmit(interaction) {
  if (!interaction.isModalSubmit()) return;

  const handler = MODAL_HANDLERS[interaction.customId];
  if (!handler) return;

  try {
    await handler(interaction);
  } catch (error) {
    logger.error(`Modal handler error [${interaction.customId}]`, error);
  }
}

// Re-export showMainSettings so index.js can call it directly for /settings command
export { showMainSettings };
