/**
 * @fileoverview /summary command — route to YouTube, Discord or website summarisation.
 *               Pure entry point + URL classification; heavy lifting lives in SummaryExecutor.js.
 * @module commands/summary/SummaryHandler
 */

import {
  MessageFlags,
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder
} from 'discord.js';

import { checkSummaryRateLimit }           from '../../managers/BotManager.js';
import { Logger }                           from '../../core/Logger.js';
import {
  summarizeYouTubeVideo,
  summarizeDiscordConversation,
  summarizeWebsite
} from './SummaryExecutor.js';

const logger = Logger.get('SummaryHandler');

const ACCENT_COLOR     = 0xE53935;
const IS_COMPONENTS_V2 = 1 << 15;

/** Build a compact error container. */
function errContainer(title, description) {
  const c = new ContainerBuilder().setAccentColor(ACCENT_COLOR);
  c.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`## ${title}\n${description}`)
  );
  return c;
}

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
      return interaction.reply({
        components: [errContainer('⏳  Rate Limit Reached', limitCheck.message)],
        flags: MessageFlags.Ephemeral | IS_COMPONENTS_V2
      });
    }

    const inputLink = interaction.options.getString('link')?.trim();
    const count     = interaction.options.getInteger('count') ?? 50;

    // --- Input validation ---
    if (!inputLink) {
      return interaction.reply({
        components: [errContainer('❌  Invalid Input', 'Please provide a valid link to summarize.')],
        flags: MessageFlags.Ephemeral | IS_COMPONENTS_V2
      });
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
      await interaction.editReply({
        components: [errContainer(
          '❌  Unsupported URL',
          'I can only summarize:\n' +
          '> 📺  YouTube videos\n' +
          '> 💬  Discord message links\n' +
          '> 🌐  Website URLs\n\n' +
          'Please provide a valid link.'
        )],
        flags: IS_COMPONENTS_V2
      });
    }

  } catch (error) {
    logger.error('Critical error in summary command', error);

    const c = errContainer('❌  Unexpected Error', 'An unexpected error occurred while processing the summary. Please try again later.');

    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({ components: [c], flags: MessageFlags.Ephemeral | IS_COMPONENTS_V2 }).catch(() => {});
    } else {
      await interaction.editReply({ components: [c], flags: IS_COMPONENTS_V2 }).catch(() => {});
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
