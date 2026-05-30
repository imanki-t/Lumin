/**
 * @fileoverview /anniversary command — display bot's server anniversary and conversation stats.
 * @module commands/fun/AnniversaryHandler
 */

import { EmbedBuilder, MessageFlags, ContainerBuilder, TextDisplayBuilder, SeparatorBuilder } from 'discord.js';

import { state }   from '../../managers/BotManager.js';
import { Logger }  from '../../core/Logger.js';

const logger = Logger.get('AnniversaryHandler');

// ============================================================================
// COMMAND DEFINITION
// ============================================================================

export const anniversaryCommand = {
  name:        'details',
  description: "View bot's server details and conversation statistics"
};

// ============================================================================
// HANDLER
// ============================================================================

const ACCENT_COLOR     = 0xE53935;
const IS_COMPONENTS_V2 = 1 << 15;

/**
 * Show how long the bot has been in the server and key conversation statistics.
 * @param {import('discord.js').CommandInteraction} interaction
 */
export async function handleAnniversaryCommand(interaction) {
  if (!interaction.guild) {
    const container = new ContainerBuilder().setAccentColor(ACCENT_COLOR);
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent('**Server Only**\nThis command can only be used in servers.')
    );
    return interaction.reply({ components: [container], flags: MessageFlags.Ephemeral | IS_COMPONENTS_V2 });
  }

  try {
    const botMember = interaction.guild.members.cache.get(interaction.client.user.id);
    if (!botMember) throw new Error('Bot member not found in guild cache');

    const joinDate       = botMember.joinedAt;
    const now            = Date.now();
    const daysSince      = Math.floor((now - joinDate.getTime()) / 86_400_000);
    const yearsSince     = Math.floor(daysSince / 365);
    const remainingDays  = daysSince % 365;
    const monthsSince    = Math.floor(remainingDays / 30);
    const finalDays      = remainingDays % 30;

    // --- Aggregate stats from in-memory history ---
    const guildHistory       = state.chatHistories?.[interaction.guild.id] ?? {};
    let totalMessages        = 0;
    let userMessages         = 0;
    let botMessages          = 0;
    const uniqueUsers        = new Set();
    const userMessageCounts  = {};

    for (const [channelId, messages] of Object.entries(guildHistory)) {
      if (!Array.isArray(messages)) continue;
      for (const msg of messages) {
        totalMessages++;
        if (msg.role === 'user') {
          userMessages++;
          uniqueUsers.add(channelId);
          userMessageCounts[channelId] = (userMessageCounts[channelId] ?? 0) + 1;
        } else if (msg.role === 'assistant') {
          botMessages++;
        }
      }
    }

    const mostActiveUser   = Object.entries(userMessageCounts).sort(([, a], [, b]) => b - a)[0];
    const avgPerDay        = daysSince > 0 ? (totalMessages / daysSince).toFixed(1) : '0';
    const avgPerUser       = uniqueUsers.size > 0 ? (userMessages / uniqueUsers.size).toFixed(1) : '0';

    // --- Build human-readable duration string ---
    const parts = [];
    if (yearsSince > 0)  parts.push(`${yearsSince} year${yearsSince  !== 1 ? 's' : ''}`);
    if (monthsSince > 0) parts.push(`${monthsSince} month${monthsSince !== 1 ? 's' : ''}`);
    if (finalDays > 0 || parts.length === 0) parts.push(`${finalDays} day${finalDays !== 1 ? 's' : ''}`);
    const timeDisplay = parts.join(', ');

    const joinDateStr = joinDate.toLocaleDateString('en-US', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    });

    // Resolve most active user display name
    let topUserLine = '';
    if (mostActiveUser && uniqueUsers.size > 0) {
      try {
        const topUser = await interaction.client.users.fetch(mostActiveUser[0]);
        topUserLine = `\n**Most Active:** ${topUser.username} (${mostActiveUser[1]} messages)`;
      } catch (err) {
        logger.error('Could not fetch most active user', err);
      }
    }

    const engagementLine = uniqueUsers.size > 0
      ? `\n**Avg per User:** ${avgPerUser} messages`
      : '';

    const container = new ContainerBuilder().setAccentColor(ACCENT_COLOR);
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `**${interaction.guild.name} — Server Details**\n` +
        `Lumin has been part of this server for **${timeDisplay}**.\n\n` +
        `**Joined:** ${joinDateStr}`
      )
    );
    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `**Statistics**\n` +
        `**Total Messages:** ${totalMessages}\n` +
        `**User Messages:** ${userMessages}\n` +
        `**Bot Responses:** ${botMessages}\n` +
        `**Unique Users:** ${uniqueUsers.size}\n` +
        `**Days Together:** ${daysSince}\n` +
        `**Avg / Day:** ${avgPerDay}` +
        topUserLine +
        engagementLine
      )
    );

    await interaction.reply({ components: [container], flags: IS_COMPONENTS_V2 });

  } catch (error) {
    logger.error('handleAnniversaryCommand failed', error);
    const container = new ContainerBuilder().setAccentColor(ACCENT_COLOR);
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent('**Error**\nFailed to retrieve server details. Please try again later.')
    );
    await interaction.reply({ components: [container], flags: MessageFlags.Ephemeral | IS_COMPONENTS_V2 });
  }
}
