/**
 * @fileoverview Shared Discord Utility Helpers
 * @module modules/shared/discordHelpers
 * @version 2.0.0
 *
 * Centralises all reusable Discord.js utility functions that were previously
 * duplicated across commands, settingsHandler, messageProcessor, and utils.
 *
 * Covers:
 *   - Permission checks (replaces 4+ duplicate sendPermError functions)
 *   - Safe interaction reply/edit helpers with deferred state awareness
 *   - Mention → display name replacement (replaces duplicate in utils.js)
 *   - Channel type guards
 *   - Safe message send helpers with fallback
 *
 * @requires discord.js
 * @requires core/AppError
 * @requires core/Logger
 * @requires modules/shared/embedBuilder
 */

import {
  ChannelType,
  PermissionsBitField,
  MessageFlags,
} from 'discord.js';

import { PermissionError }  from '../../core/AppError.js';
import { Logger }           from '../../core/Logger.js';
import { Embeds }           from './embedBuilder.js';
import {
  formatUser,
  formatChannel,
  formatRole,
  resolveAllMentions,
} from './mentionFormatter.js';

const log = Logger.get('DiscordHelpers');

// ============================================================================
// PERMISSION HELPERS
// ============================================================================

/**
 * Assert that the interaction member has Manage Guild permission.
 * Throws a PermissionError (non-retryable) if not.
 * The caller's outer error handler will send the embed automatically.
 *
 * @param {import('discord.js').Interaction} interaction
 * @throws {PermissionError}
 *
 * @example
 * assertManageGuild(interaction); // throws if no permission
 */
export function assertManageGuild(interaction) {
  if (!interaction.member?.permissions?.has(PermissionsBitField.Flags.ManageGuild)) {
    throw new PermissionError('Manage Server');
  }
}

/**
 * Assert that the interaction member has Manage Messages permission.
 *
 * @param {import('discord.js').Interaction} interaction
 * @throws {PermissionError}
 */
export function assertManageMessages(interaction) {
  if (!interaction.member?.permissions?.has(PermissionsBitField.Flags.ManageMessages)) {
    throw new PermissionError('Manage Messages');
  }
}

/**
 * Check (without throwing) whether a member has a permission.
 *
 * @param {import('discord.js').Interaction} interaction
 * @param {bigint} permFlag - PermissionsBitField flag
 * @returns {boolean}
 *
 * @example
 * if (!hasPermission(interaction, PermissionsBitField.Flags.ManageGuild)) {
 *   return interaction.reply({ embeds: [Embeds.permissionDenied()], flags: MessageFlags.Ephemeral });
 * }
 */
export function hasPermission(interaction, permFlag) {
  return Boolean(interaction.member?.permissions?.has(permFlag));
}

/**
 * Reply to an interaction with a permission denied embed and return.
 * Use when you want to reply inline instead of throwing.
 *
 * @param {import('discord.js').Interaction} interaction
 * @param {string} [permissionName='Manage Server']
 * @returns {Promise<void>}
 */
export async function replyPermissionDenied(interaction, permissionName = 'Manage Server') {
  await safeReply(interaction, {
    embeds:  [Embeds.permissionDenied(permissionName)],
    flags:   MessageFlags.Ephemeral,
  });
}

// ============================================================================
// SAFE INTERACTION REPLY / EDIT
// ============================================================================

/**
 * Safely reply to an interaction, accounting for deferred and already-replied state.
 * - Not deferred + not replied → reply()
 * - Deferred → editReply()
 * - Already replied → followUp()
 *
 * Swallows "Unknown Interaction" (10062) errors gracefully.
 *
 * @param {import('discord.js').Interaction} interaction
 * @param {import('discord.js').InteractionReplyOptions} payload
 * @returns {Promise<void>}
 *
 * @example
 * await safeReply(interaction, { embeds: [Embeds.success('Done!')] });
 */
export async function safeReply(interaction, payload) {
  try {
    if (interaction.deferred) {
      await interaction.editReply(payload);
    } else if (interaction.replied) {
      await interaction.followUp({ ...payload, flags: MessageFlags.Ephemeral });
    } else {
      await interaction.reply(payload);
    }
  } catch (error) {
    if (error.code !== 10062) { // 10062 = Unknown Interaction (expired)
      log.warn('safeReply failed', { code: error.code, message: error.message });
    }
  }
}

/**
 * Safely send an error embed to an interaction using safeReply.
 *
 * @param {import('discord.js').Interaction} interaction
 * @param {string} title
 * @param {string} description
 * @returns {Promise<void>}
 */
export async function replyError(interaction, title, description) {
  await safeReply(interaction, {
    embeds: [Embeds.error(title, description)],
    flags:  MessageFlags.Ephemeral,
  });
}

/**
 * Safely defer an interaction if it hasn't been deferred yet.
 * Prevents "Interaction has already been acknowledged" crashes.
 *
 * @param {import('discord.js').Interaction} interaction
 * @param {boolean} [ephemeral=false]
 * @returns {Promise<void>}
 */
export async function safeDeferReply(interaction, ephemeral = false) {
  if (interaction.deferred || interaction.replied) return;
  try {
    await interaction.deferReply({ flags: ephemeral ? MessageFlags.Ephemeral : undefined });
  } catch (error) {
    if (error.code !== 10062) {
      log.warn('safeDeferReply failed', { code: error.code });
    }
  }
}

// ============================================================================
// SAFE MESSAGE SEND
// ============================================================================

/**
 * Attempt to send a message to a channel, with optional fallback channel.
 * Catches missing permission errors and logs them instead of crashing.
 *
 * @param {import('discord.js').TextBasedChannel} channel  - Primary channel
 * @param {import('discord.js').MessageCreateOptions} payload
 * @param {import('discord.js').TextBasedChannel} [fallback] - Try this if primary fails
 * @returns {Promise<import('discord.js').Message|null>} Sent message or null
 *
 * @example
 * await safeSend(channel, { content: 'Hello!' });
 */
export async function safeSend(channel, payload, fallback) {
  try {
    return await channel.send(payload);
  } catch (error) {
    log.warn('safeSend failed on primary channel', {
      channelId: channel.id,
      code:      error.code,
    });

    if (fallback) {
      try {
        return await fallback.send(payload);
      } catch (fallbackError) {
        log.warn('safeSend failed on fallback channel', {
          channelId: fallback.id,
          code:      fallbackError.code,
        });
      }
    }

    return null;
  }
}

/**
 * Attempt to DM a user. Returns false if DMs are closed/disabled.
 *
 * @param {import('discord.js').User} user
 * @param {import('discord.js').MessageCreateOptions} payload
 * @returns {Promise<boolean>} True if DM was sent successfully
 *
 * @example
 * const sent = await safeDM(user, { embeds: [embed] });
 * if (!sent) await replyError(interaction, 'DM Failed', 'Please allow DMs.');
 */
export async function safeDM(user, payload) {
  try {
    await user.send(payload);
    return true;
  } catch (error) {
    log.debug('DM failed', { userId: user.id, code: error.code });
    return false;
  }
}

// ============================================================================
// CHANNEL TYPE GUARDS
// ============================================================================

/**
 * Returns true if the channel is a DM channel.
 *
 * @param {import('discord.js').Channel} channel
 * @returns {boolean}
 */
export function isDM(channel) {
  return channel?.type === ChannelType.DM;
}

/**
 * Returns true if the channel is a guild text channel.
 *
 * @param {import('discord.js').Channel} channel
 * @returns {boolean}
 */
export function isGuildText(channel) {
  return channel?.type === ChannelType.GuildText;
}

/**
 * Returns true if the channel is any type where the bot can send messages.
 *
 * @param {import('discord.js').Channel} channel
 * @returns {boolean}
 */
export function isSendable(channel) {
  return Boolean(channel && 'send' in channel);
}

// ============================================================================
// MENTION REPLACEMENT
// All formatting is delegated to the global mentionFormatter so the canonical
// display format (userId | @username | displayName | serverName, etc.) stays
// consistent across every part of the bot. These wrappers preserve the
// existing call-sites' signatures (guild-only / message-based) while routing
// through the single source of truth.
// ============================================================================

/**
 * Replace all user mentions (<@id>, <@!id>) in a string.
 * Uses the global canonical format: [userId | @username | displayName | serverName]
 *
 * @param {string}                          text
 * @param {import('discord.js').Guild|null} guild
 * @returns {Promise<string>}
 */
export async function replaceMentions(text, guild) {
  if (!text || !guild) return text ?? '';
  // Build a minimal message-like object so resolveAllMentions can access the guild
  return resolveAllMentions(text, { guild }, { appendReference: false });
}

/**
 * Replace all role mentions (<@&id>) with the canonical format: [roleId | @roleName]
 *
 * @param {string}                          text
 * @param {import('discord.js').Guild|null} guild
 * @returns {Promise<string>}
 */
export async function replaceRoleMentions(text, guild) {
  if (!text || !guild) return text ?? '';
  // Only role mentions present — resolveAllMentions handles them correctly
  return resolveAllMentions(text, { guild }, { appendReference: false });
}

/**
 * Replace all channel mentions (<#id>) with the canonical format: [channelId | #channelName]
 *
 * @param {string}                          text
 * @param {import('discord.js').Guild|null} guild
 * @returns {string | Promise<string>}
 */
export function replaceChannelMentions(text, guild) {
  if (!text || !guild) return text ?? '';
  // Delegate to resolveAllMentions (returns a Promise — callers should await)
  return resolveAllMentions(text, { guild }, { appendReference: false });
}

/**
 * Replace ALL mention types (users, roles, channels) in one pass.
 * Uses the global mentionFormatter as the single source of truth.
 *
 * For AI prompt contexts, use resolveAllMentions() from mentionFormatter directly
 * (with appendReference: true) so the model also gets the ping-format reference block.
 *
 * @param {string}                          text
 * @param {import('discord.js').Guild|null} guild
 * @returns {Promise<string>}
 *
 * @example
 * const clean = await replaceAllMentions(message.content, message.guild);
 */
export async function replaceAllMentions(text, guild) {
  if (!text) return '';
  return resolveAllMentions(text, { guild }, { appendReference: false });
}

// Re-export the primitive formatters so callers that only need the string
// format (no API fetch) can import them directly from discordHelpers.
export { formatUser, formatChannel, formatRole };

// ============================================================================
// MESSAGE CONTENT HELPERS
// ============================================================================

/**
 * Safely truncate a string for Discord embed fields/descriptions.
 *
 * @param {string} text
 * @param {number} [maxLength=4096] - Discord embed description limit
 * @param {string} [suffix='…']
 * @returns {string}
 */
export function truncate(text, maxLength = 4_096, suffix = '…') {
  if (!text || text.length <= maxLength) return text ?? '';
  return text.slice(0, maxLength - suffix.length) + suffix;
}

/**
 * Strip Discord markdown formatting characters from text.
 *
 * @param {string} text
 * @returns {string}
 *
 * @example
 * stripMarkdown('**bold** and _italic_') // → 'bold and italic'
 */
export function stripMarkdown(text) {
  if (!text) return '';
  return text
    .replace(/\*\*(.+?)\*\*/g, '$1')  // bold
    .replace(/\*(.+?)\*/g,     '$1')  // italic *
    .replace(/_(.+?)_/g,       '$1')  // italic _
    .replace(/~~(.+?)~~/g,     '$1')  // strikethrough
    .replace(/`{1,3}(.+?)`{1,3}/gs, '$1')  // inline + code block
    .replace(/^> /gm,          '')    // blockquotes
    .replace(/\|\|(.+?)\|\|/g, '$1') // spoilers
    .trim();
}
