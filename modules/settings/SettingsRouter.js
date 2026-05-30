/**
 * @fileoverview Settings interaction router — blacklist guard + dispatch.
 * Handles buttons, select menus, and modals for all settings pages.
 * @module modules/settings/SettingsRouter
 */

import { EmbedBuilder, MessageFlags } from 'discord.js';
import { initializeBlacklistForGuild } from '../../utils.js';
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
  showUserEmbedColorModal,
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
  handleServerResponseFormat,
  handleServerActionButtons,
  handleServerContinuousReply,
  handleServerOverride,
  handleServerChatHistory,
  handleServerModelSelect,
  handleToggleServerFormat,
  handleToggleServerButtons,
  handleToggleServerOverride,
  handleToggleServerContinuous,
  handleToggleServerHistory,
} from './ServerSettingsHandler.js';

import {
  // inline toggle handlers
  handleUserToggleFormat,
  handleUserToggleButtons,
  handleUserToggleContinuous,
  handleUserToggleCrossContext,
  // model selects
  handleUserModelSelect,
  // legacy select handlers
  handleUserResponseFormat,
  handleUserActionButtons,
  handleUserContinuousReply,
  handleUserCrossContext,
  // modals
  handleUserPersonalityModal,
  handleServerPersonalityModal,
  handleUserEmbedColorModal,
  handleServerEmbedColorModal as handleServerEmbedColorModalSubmit,
  // refresh handlers
  handleRefreshUserP1,
  handleRefreshUserP2,
  handleRefreshUserP3,
  handleRefreshServerP1,
  handleRefreshServerP2,
  handleRefreshServerP3,
  handleRefreshServerP4,
  handleRefreshServerP5,
  // message actions
  downloadMessage,
  handleDeleteMessageInteraction,
} from './ActionHandlers.js';

const logger = Logger.get('SettingsRouter');

// ============================================================================
// BLACKLIST GUARD
// ============================================================================

async function isBlacklisted(interaction) {
  const guildId = interaction.guild?.id;
  if (!guildId) return false;
  initializeBlacklistForGuild(guildId);
  if (state.blacklistedUsers[guildId]?.includes(interaction.user.id)) {
    await interaction.reply({
      embeds: [new EmbedBuilder()
        .setColor(0xFF0000)
        .setTitle('Blacklisted')
        .setDescription('You are blacklisted and cannot use this interaction.')
      ],
      flags: MessageFlags.Ephemeral,
    }).catch(() => {});
    return true;
  }
  return false;
}

// ============================================================================
// BUTTON ROUTER
// ============================================================================

/**
 * Maps exact customId (or prefix) → handler.
 * Prefix matching: checked with .startsWith() in order listed.
 */
const BUTTON_HANDLERS = {
  // ── User navigation ─────────────────────────────────────────────────────
  'user_settings_page3':        (i) => showUserSettingsPage3(i, true),
  'user_settings_page2':        (i) => showUserSettingsPage2(i, true),
  'user_settings_p1':           (i) => showUserSettings(i, true),
  'user_settings':              (i) => showUserSettings(i, true),
  'back_to_user_p2':            (i) => showUserSettingsPage2(i, true),
  'back_to_user':               (i) => showUserSettings(i, true),

  // ── User inline toggles ──────────────────────────────────────────────────
  'tog_uf':                     handleUserToggleFormat,
  'tog_ub':                     handleUserToggleButtons,
  'tog_ur':                     handleUserToggleContinuous,
  'tog_ux':                     handleUserToggleCrossContext,

  // ── User refresh buttons ─────────────────────────────────────────────────
  'user_p1_ref':                handleRefreshUserP1,
  'user_p2_ref':                handleRefreshUserP2,
  'user_p3_ref':                handleRefreshUserP3,

  // ── Server navigation ────────────────────────────────────────────────────
  'server_settings_page5':      (i) => showServerSettingsPage5(i, true),
  'server_settings_page4':      (i) => showServerSettingsPage4(i, true),
  'server_settings_page3':      (i) => showServerSettingsPage3(i, true),
  'server_settings_page2':      (i) => showServerSettingsPage2(i, true),
  'server_settings_p1':         (i) => showServerSettings(i, true),
  'server_settings':            (i) => showServerSettings(i, true),
  'back_to_server_p4':          (i) => showServerSettingsPage4(i, true),
  'back_to_server_p3':          (i) => showServerSettingsPage3(i, true),
  'back_to_server_p2':          (i) => showServerSettingsPage2(i, true),
  'back_to_server':             (i) => showServerSettings(i, true),

  // ── Server inline toggles ────────────────────────────────────────────────
  'tog_sf':                     handleToggleServerFormat,
  'tog_sb':                     handleToggleServerButtons,
  'tog_so':                     handleToggleServerOverride,
  'tog_sc':                     handleToggleServerContinuous,
  'tog_sh':                     handleToggleServerHistory,

  // ── Server refresh buttons ───────────────────────────────────────────────
  'srv_p1_ref':                 handleRefreshServerP1,
  'srv_p2_ref':                 handleRefreshServerP2,
  'srv_p3_ref':                 handleRefreshServerP3,
  'srv_p4_ref':                 handleRefreshServerP4,
  'srv_p5_ref':                 handleRefreshServerP5,

  // ── Shared navigation ────────────────────────────────────────────────────
  'back_to_main':               (i) => showMainSettings(i, true),
  'settings_btn':               (i) => showMainSettings(i, true),

  // ── User data actions ────────────────────────────────────────────────────
  'clear_user_memory':          clearUserMemory,
  'download_user_conversation': downloadUserConversation,
  'user_custom_personality':    showUserPersonalityModal,
  'user_remove_personality':    removeUserPersonality,
  'user_embed_color':           showUserEmbedColorModal,

  // ── Server data actions ──────────────────────────────────────────────────
  'clear_server_memory':        clearServerMemory,
  'download_server_conversation': downloadServerConversation,
  'server_custom_personality':  showServerPersonalityModal,
  'server_remove_personality':  removeServerPersonality,
  'server_embed_color':         showServerEmbedColorModal,

  // ── Channel management ───────────────────────────────────────────────────
  'toggle_continuous_reply':    toggleContinuousReplyChannel,
  'manage_allowed_channels':    (i) => showChannelManagementMenu(i, true),
  'set_all_channels':           handleSetAllChannels,

  // ── Message actions ──────────────────────────────────────────────────────
  'download_message':           downloadMessage,
};

export async function handleButtonInteraction(interaction) {
  if (!interaction.isButton()) return;
  if (await isBlacklisted(interaction)) return;

  // delete_message has dynamic payload after the prefix
  if (interaction.customId.startsWith('delete_message-')) {
    const data = interaction.customId.replace('delete_message-', '');
    return handleDeleteMessageInteraction(interaction, data);
  }

  for (const [prefix, handler] of Object.entries(BUTTON_HANDLERS)) {
    if (interaction.customId.startsWith(prefix)) {
      try { await handler(interaction); }
      catch (err) { logger.error(`Button handler error [${prefix}]`, err); }
      return;
    }
  }
}

// ============================================================================
// SELECT MENU ROUTER
// ============================================================================

const SELECT_HANDLERS = {
  // new dynamic model selects
  'user_model_select':     handleUserModelSelect,
  'server_model_select':   handleServerModelSelect,
  // legacy format/button selects (kept for in-flight interactions)
  'user_response_format':  handleUserResponseFormat,
  'server_response_format': handleServerResponseFormat,
  'user_action_buttons':   handleUserActionButtons,
  'server_action_buttons': handleServerActionButtons,
  'user_continuous_reply': handleUserContinuousReply,
  'user_cross_context':    handleUserCrossContext,
  'server_continuous_reply': handleServerContinuousReply,
  'server_override':       handleServerOverride,
  'server_chat_history':   handleServerChatHistory,
  'channel_manage_select': handleChannelManageSelect,
};

export async function handleSelectMenuInteraction(interaction) {
  if (!interaction.isStringSelectMenu() && !interaction.isChannelSelectMenu()) return;
  if (await isBlacklisted(interaction)) return;

  const handler = SELECT_HANDLERS[interaction.customId];
  if (!handler) return;

  try { await handler(interaction); }
  catch (err) { logger.error(`Select handler error [${interaction.customId}]`, err); }
}

// ============================================================================
// MODAL ROUTER
// ============================================================================

const MODAL_HANDLERS = {
  'user_personality_modal':   handleUserPersonalityModal,
  'server_personality_modal': handleServerPersonalityModal,
  'user_embed_color_modal':   handleUserEmbedColorModal,
  'server_embed_color_modal': handleServerEmbedColorModalSubmit,
};

export async function handleModalSubmit(interaction) {
  if (!interaction.isModalSubmit()) return;
  const handler = MODAL_HANDLERS[interaction.customId];
  if (!handler) return;
  try { await handler(interaction); }
  catch (err) { logger.error(`Modal handler error [${interaction.customId}]`, err); }
}

export { showMainSettings };
