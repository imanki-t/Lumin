/**
 * @fileoverview Global Mention Formatter — single source of truth for how Discord
 *               user, channel, and role mentions are resolved and formatted.
 * @module modules/shared/mentionFormatter
 * @version 1.0.0
 *
 * This module is the ONLY place that defines the canonical display format for
 * Discord entity mentions. Every other module (PromptBuilder, discordHelpers,
 * ResponseHandler, etc.) must import from here so the format stays consistent
 * everywhere a message is processed.
 *
 * Formats:
 *   User    → [userId | @username | Display Name | Server Name]
 *   Channel → [channelId | #channel-name]
 *   Role    → [roleId | @role-name]
 *
 * @requires discord.js
 * @requires managers/BotManager
 * @requires core/Logger
 */

import { client } from '../../managers/BotManager.js';
import { Logger }  from '../../core/Logger.js';

const log = Logger.get('MentionFormatter');

// ============================================================================
// PRIMITIVE FORMAT FUNCTIONS
// These are pure functions — no Discord API calls, no side-effects.
// Import these anywhere you have the raw data and just need the display string.
// ============================================================================

/**
 * Format a resolved user into the canonical display string.
 *
 * @param {string}      userId
 * @param {string}      username      - Discord account username (e.g. "alice")
 * @param {string}      displayName   - Server nickname or global display name
 * @param {string|null} serverName    - Guild name; null/undefined for DMs
 * @returns {string}  e.g. "[123456789 | @alice | Alice ✨ | My Cool Server]"
 *
 * @example
 * formatUser('123', 'alice', 'Alice ✨', 'My Server')
 * // → "[123 | @alice | Alice ✨ | My Server]"
 *
 * formatUser('123', 'alice', 'Alice', null)
 * // → "[123 | @alice | Alice | DM]"
 */
export function formatUser(userId, username, displayName, serverName) {
  const server = serverName ?? 'DM';
  return `[${userId} | @${username} | ${displayName} | ${server}]`;
}

/**
 * Format a resolved channel into the canonical display string.
 *
 * @param {string} channelId
 * @param {string} channelName
 * @returns {string}  e.g. "[987654321 | #general]"
 *
 * @example
 * formatChannel('987', 'general')
 * // → "[987 | #general]"
 */
export function formatChannel(channelId, channelName) {
  return `[${channelId} | #${channelName}]`;
}

/**
 * Format a resolved role into the canonical display string.
 *
 * @param {string} roleId
 * @param {string} roleName
 * @returns {string}  e.g. "[111222333 | @Moderator]"
 *
 * @example
 * formatRole('111', 'Moderator')
 * // → "[111 | @Moderator]"
 */
export function formatRole(roleId, roleName) {
  return `[${roleId} | @${roleName}]`;
}

// ============================================================================
// INTERNAL RESOLUTION HELPERS
// Each helper resolves one mention type, returns { text, mentions[] }.
// ============================================================================

/**
 * Resolve all <@uid> / <@!uid> mentions in content.
 *
 * @param {string}                          content
 * @param {import('discord.js').Message}    message
 * @returns {Promise<{ text: string, mentions: object[] }>}
 */
async function resolveUserMentions(content, message) {
  const matches = [...content.matchAll(/<@!?(\d+)>/g)];
  if (matches.length === 0) return { text: content, mentions: [] };

  const uniqueIds = [...new Set(matches.map(m => m[1]))];
  const guildName = message.guild?.name ?? null;

  // Prefer GuildMember (has server nickname) over bare User
  const fetched = await Promise.allSettled(
    uniqueIds.map(id => {
      if (message.guild) {
        return message.guild.members.fetch(id)
          .catch(() => client.users.fetch(id).catch(() => null));
      }
      return client.users.fetch(id).catch(() => null);
    })
  );

  const replacements = new Map();
  const mentions     = [];

  uniqueIds.forEach((uid, i) => {
    const entity = fetched[i].status === 'fulfilled' ? fetched[i].value : null;
    if (!entity) {
      replacements.set(uid, `<@${uid}>`);
      return;
    }

    const isGuildMember = !!entity.user;
    const user          = isGuildMember ? entity.user : entity;
    const displayName   = isGuildMember
      ? entity.displayName
      : (user.globalName ?? user.username);
    const username = user.username;

    replacements.set(uid, formatUser(uid, username, displayName, guildName));
    mentions.push({ type: 'user', id: uid, displayName, username, serverName: guildName });
  });

  let text = content;
  for (const [uid, label] of replacements) {
    text = text.replace(new RegExp(`<@!?${uid}>`, 'g'), label);
  }

  return { text, mentions };
}

/**
 * Resolve all <#cid> mentions in content.
 *
 * @param {string}                          content
 * @param {import('discord.js').Message}    message
 * @returns {Promise<{ text: string, mentions: object[] }>}
 */
async function resolveChannelMentions(content, message) {
  const matches = [...content.matchAll(/<#(\d+)>/g)];
  if (matches.length === 0) return { text: content, mentions: [] };

  const uniqueIds = [...new Set(matches.map(m => m[1]))];

  const fetched = await Promise.allSettled(
    uniqueIds.map(id => client.channels.fetch(id).catch(() => null))
  );

  const replacements = new Map();
  const mentions     = [];

  uniqueIds.forEach((cid, i) => {
    const channel = fetched[i].status === 'fulfilled' ? fetched[i].value : null;
    if (channel?.name) {
      replacements.set(cid, formatChannel(cid, channel.name));
      mentions.push({ type: 'channel', id: cid, name: channel.name });
    } else {
      replacements.set(cid, `<#${cid}>`);
    }
  });

  let text = content;
  for (const [cid, label] of replacements) {
    text = text.replace(new RegExp(`<#${cid}>`, 'g'), label);
  }

  return { text, mentions };
}

/**
 * Resolve all <@&rid> mentions in content.
 *
 * @param {string}                          content
 * @param {import('discord.js').Message}    message
 * @returns {Promise<{ text: string, mentions: object[] }>}
 */
async function resolveRoleMentions(content, message) {
  const matches = [...content.matchAll(/<@&(\d+)>/g)];
  if (matches.length === 0) return { text: content, mentions: [] };

  const uniqueIds  = [...new Set(matches.map(m => m[1]))];
  const replacements = new Map();
  const mentions     = [];

  if (message.guild) {
    const fetched = await Promise.allSettled(
      uniqueIds.map(id => message.guild.roles.fetch(id).catch(() => null))
    );
    uniqueIds.forEach((rid, i) => {
      const role = fetched[i].status === 'fulfilled' ? fetched[i].value : null;
      if (role?.name) {
        replacements.set(rid, formatRole(rid, role.name));
        mentions.push({ type: 'role', id: rid, name: role.name });
      } else {
        replacements.set(rid, `<@&${rid}>`);
      }
    });
  } else {
    uniqueIds.forEach(rid => replacements.set(rid, `<@&${rid}>`));
  }

  let text = content;
  for (const [rid, label] of replacements) {
    text = text.replace(new RegExp(`<@&${rid}>`, 'g'), label);
  }

  return { text, mentions };
}

// ============================================================================
// PRIMARY EXPORT — use this everywhere
// ============================================================================

/**
 * Replace ALL Discord mention formats (<@uid>, <#cid>, <@&rid>) with the
 * canonical formatted strings defined by this module.
 *
 * Processing order: users → channels → roles (each pass operates on the
 * already-substituted text so no double-processing occurs).
 *
 * Optionally appends a "Discord Mention Reference" block at the end of the
 * text so the AI always knows the exact Discord syntax to use when it needs
 * to ping a user/channel/role in its reply.
 *
 * @param {string}                          content
 * @param {import('discord.js').Message}    message
 * @param {object}  [options]
 * @param {boolean} [options.appendReference=true]
 *   Set to false when you only need clean display text (e.g. discordHelpers,
 *   embed descriptions) and don't want the AI reference block appended.
 * @returns {Promise<string>}
 *
 * @example
 * // In PromptBuilder — full AI context, reference block included:
 * const clean = await resolveAllMentions(message.content, message);
 *
 * // In discordHelpers — display only, no reference block:
 * const clean = await resolveAllMentions(text, guild, { appendReference: false });
 */
export async function resolveAllMentions(content, message, { appendReference = true } = {}) {
  if (!content) return content ?? '';

  const userResult    = await resolveUserMentions(content, message);
  const channelResult = await resolveChannelMentions(userResult.text, message);
  const roleResult    = await resolveRoleMentions(channelResult.text, message);

  const allMentions = [
    ...userResult.mentions,
    ...channelResult.mentions,
    ...roleResult.mentions,
  ];

  if (!appendReference || allMentions.length === 0) return roleResult.text;

  // ── Append a reference block so the AI knows the exact ping formats ───────
  const lines = ['\n\n[Discord Mention Reference — use these exact formats in your reply:]'];

  const users    = allMentions.filter(m => m.type === 'user');
  const channels = allMentions.filter(m => m.type === 'channel');
  const roles    = allMentions.filter(m => m.type === 'role');

  if (users.length > 0) {
    lines.push('Users (mention with <@ID>):');
    for (const u of users) {
      lines.push(`  • ${u.displayName} (@${u.username}) — ID: ${u.id} → use <@${u.id}> to ping them`);
    }
  }
  if (channels.length > 0) {
    lines.push('Channels (reference with <#ID>):');
    for (const c of channels) {
      lines.push(`  • #${c.name} — ID: ${c.id} → use <#${c.id}> to link the channel`);
    }
  }
  if (roles.length > 0) {
    lines.push('Roles (mention with <@&ID>):');
    for (const r of roles) {
      lines.push(`  • @${r.name} — ID: ${r.id} → use <@&${r.id}> to ping the role`);
    }
  }

  lines.push(']');
  return roleResult.text + lines.join('\n');
}
