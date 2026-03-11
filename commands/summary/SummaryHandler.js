/**
 * @fileoverview /summary command — route to YouTube, Discord or website summarisation.
 *               Pure entry point + URL classification; heavy lifting lives in SummaryExecutor.js.
 * @module commands/summary/SummaryHandler
 */

import { EmbedBuilder, MessageFlags } from 'discord.js';

import { checkSummaryRateLimit }           from '../../managers/BotManager.js';
import { Logger }                           from '../../core/Logger.js';
import {
  summarizeYouTubeVideo,
  summarizeDiscordConversation,
  summarizeWebsite
} from './SummaryExecutor.js';

const logger = Logger.get('SummaryHandler');

// ============================================================================
// COMMAND DEFINITION
// ============================================================================

export const summaryCommand = {
  name:        'summary',
  description: 'Summarize a Discord conversation, YouTube video, or website',
  options: [
    {
      name:        'link',
      description: 'YouTube URL, Discord message link, or website URL',
      type:        3,
      required:    true
    },
    {
      name:        'count',
      description: 'Number of messages to include (Discord links only, default: 50)',
      type:        4,
      required:    false,
      min_value:   5,
      max_value:   500
    }
  ]
};

// ============================================================================
// ENTRY POINT
// ============================================================================

/**
 * Main command handler — validates rate limit, classifies URL, delegates.
 * @param {import('discord.js').CommandInteraction} interaction
 */
export async function handleSummaryCommand(interaction) {
  try {
    // --- Rate-limit check ---
    const limitCheck = checkSummaryRateLimit(interaction.user.id);
    if (!limitCheck.allowed) {
      const embed = new EmbedBuilder()
        .setColor(0xFFAA00)
        .setTitle('⏳ Rate Limit Reached')
        .setDescription(limitCheck.message);
      return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }

    const inputLink = interaction.options.getString('link')?.trim();
    const count     = interaction.options.getInteger('count') ?? 50;

    // --- Input validation ---
    if (!inputLink) {
      const embed = new EmbedBuilder()
        .setColor(0xFF5555)
        .setTitle('❌ Invalid Input')
        .setDescription('Please provide a valid link to summarize.');
      return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }

    await interaction.deferReply();

    // --- Route by URL type ---
    if (isYouTubeUrl(inputLink)) {
      await summarizeYouTubeVideo(interaction, inputLink);
    } else if (isDiscordMessageLink(inputLink)) {
      await summarizeDiscordConversation(interaction, inputLink, count);
    } else if (isWebsiteUrl(inputLink)) {
      await summarizeWebsite(interaction, inputLink);
    } else {
      const embed = new EmbedBuilder()
        .setColor(0xFF5555)
        .setTitle('❌ Unsupported URL')
        .setDescription(
          'I can only summarize:\n' +
          '• YouTube videos\n' +
          '• Discord message links\n' +
          '• Website URLs\n\n' +
          'Please provide a valid link.'
        );
      await interaction.editReply({ embeds: [embed] });
    }

  } catch (error) {
    logger.error('Critical error in summary command', error);

    const errorEmbed = new EmbedBuilder()
      .setColor(0xFF0000)
      .setTitle('❌ Unexpected Error')
      .setDescription('An unexpected error occurred while processing the summary. Please try again later.');

    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral }).catch(() => {});
    } else {
      await interaction.editReply({ embeds: [errorEmbed] }).catch(() => {});
    }
  }
}

// ============================================================================
// PRIVATE — URL CLASSIFIERS
// ============================================================================

/** @param {string} url */
function isYouTubeUrl(url) {
  return /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\/.+$/.test(url);
}

/** @param {string} url */
function isDiscordMessageLink(url) {
  return /https?:\/\/(?:www\.)?discord\.com\/channels\/\d+\/\d+\/\d+/.test(url);
}

/** @param {string} url */
function isWebsiteUrl(url) {
  try {
    const { protocol } = new URL(url);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}
