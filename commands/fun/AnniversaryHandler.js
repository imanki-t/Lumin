/**
 * @fileoverview /anniversary command — display bot's server anniversary and conversation stats.
 * @module commands/fun/AnniversaryHandler
 */

import { EmbedBuilder, MessageFlags } from 'discord.js';

import { state }   from '../../managers/BotManager.js';
import { Logger }  from '../../core/Logger.js';

const logger = Logger.get('AnniversaryHandler');

// ============================================================================
// COMMAND DEFINITION
// ============================================================================

export const anniversaryCommand = {
  name:        'anniversary',
  description: "View bot's server anniversary info with detailed stats"
};

// ============================================================================
// HANDLER
// ============================================================================

/**
 * Show how long the bot has been in the server and key conversation statistics.
 * @param {import('discord.js').CommandInteraction} interaction
 */
export async function handleAnniversaryCommand(interaction) {
  if (!interaction.guild) {
    const embed = new EmbedBuilder()
      .setColor(0xFF5555)
      .setTitle('❌ Server Only')
      .setDescription('This command can only be used in servers!');
    return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
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

    const embed = new EmbedBuilder()
      .setColor(0xFFD700)
      .setTitle(`🎊 ${interaction.guild.name} Anniversary`)
      .setDescription(
        `I've been part of **${interaction.guild.name}** for **${timeDisplay}**!\n\n` +
        `**Join Date:** ${joinDate.toLocaleDateString('en-US', {
          weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
        })}`
      )
      .addFields(
        { name: '📊 Total Messages', value: String(totalMessages), inline: true },
        { name: '👥 Unique Users',   value: String(uniqueUsers.size), inline: true },
        { name: '📅 Days Together',  value: String(daysSince), inline: true },
        { name: '💬 User Messages',  value: String(userMessages), inline: true },
        { name: '🤖 Bot Responses',  value: String(botMessages), inline: true },
        { name: '📈 Avg/Day',        value: avgPerDay, inline: true }
      )
      .setThumbnail(interaction.guild.iconURL())
      .setFooter({ text: 'Thank you for having me! 💙' })
      .setTimestamp();

    // Most active user field
    if (mostActiveUser && uniqueUsers.size > 0) {
      try {
        const topUser = await interaction.client.users.fetch(mostActiveUser[0]);
        embed.addFields({
          name:   '⭐ Most Active User',
          value:  `${topUser.username} (${mostActiveUser[1]} messages)`,
          inline: false
        });
      } catch (err) {
        logger.error('Could not fetch most active user', err);
      }
    }

    if (uniqueUsers.size > 0) {
      embed.addFields({ name: '📊 Engagement', value: `${avgPerUser} avg messages per user`, inline: false });
    }

    await interaction.reply({ embeds: [embed] });

  } catch (error) {
    logger.error('handleAnniversaryCommand failed', error);

    const embed = new EmbedBuilder()
      .setColor(0xFF0000)
      .setTitle('❌ Error')
      .setDescription('Failed to retrieve anniversary information. Please try again later.');

    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  }
}
