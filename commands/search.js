/**
 * @fileoverview /search slash command handler.
 *               Performs a Gemini-powered web search with optional file attachment.
 *
 * Refactored from the original searchCommand.js:
 *   - All duplicated constants/formatters removed → use modules/shared/embedBuilder.js
 *   - Own retry loop removed                      → use modules/shared/retryUtils.js
 *   - Own sendAsTextFile removed                  → inline using tempFileManager
 *   - Own button building removed                 → use modules/shared/buttonHandlers.js
 *   - Dynamic imports converted to static
 *   - All console.* replaced with Logger
 *   - generateFileName was async with no await    → plain sync helper
 *
 * @module commands/search
 */

import { EmbedBuilder, MessageFlags } from 'discord.js';

import {
  genAI,
  state,
  requestQueues,          // FIX: direct import — avoids state.requestQueues stale-reference bug
  BOT_CONFIG,
  DEFAULT_USER_SETTINGS
} from '../managers/BotManager.js';
import { Logger }            from '../core/Logger.js';
import { Embeds, addGroundingFields, addUrlContextFields, GOOGLE_AI_ICON } from '../modules/shared/embedBuilder.js';
import { addDownloadButton, addDeleteButton } from '../modules/shared/buttonHandlers.js';
import { executeWithRetry }  from '../modules/shared/retryUtils.js';
import { writeTempFile, safeUnlink } from '../modules/shared/tempFileManager.js';
import { initializeBlacklistForGuild } from '../utils.js';
import { processAttachment } from '../modules/attachments/FileUploader.js';
import { processUserQueue }  from '../modules/message/MessageProcessor.js';
import { MODELS, safetySettings, getGenerationConfig, RATE_LIMIT_ERRORS, DEFAULT_MODEL } from '../modules/config.js';
import config                from '../config.js';

const logger = Logger.get('SearchCommand');

// ============================================================================
// CONSTANTS
// ============================================================================

const MAX_QUEUE_SIZE = 5;

const CHARACTER_LIMITS = Object.freeze({
  EMBEDDED:    3900,
  NORMAL:      1900,
  DISCORD_MAX: 2000,
  EMBED_DESC:  4096
});

const EMBED_COLORS = Object.freeze({
  ERROR:   0xFF0000,
  WARNING: 0xFF5555
});

const FILE_PREFIX       = 'search-results-';
const SEARCH_RESULTS_PREFIX = 'your search results:';
const SEARCH_PROMPT_PREFIX  = 'Search the web for current information about: ';

function getCurrentDate() {
  return new Date().toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });
}

const SEARCH_SYSTEM_PROMPT = `${config.coreSystemRules}

You are performing a web search to find current information.

SEARCH INSTRUCTIONS:
- You MUST use the googleSearch tool for every query
- Provide accurate, well-sourced information from search results
- Cite your sources when relevant
- Be concise and informative
- Current date: ${getCurrentDate()}`;

const ERR = Object.freeze({
  NO_INPUT:          'Please provide either a text prompt or a file attachment.',
  INVALID_INPUT:     'Invalid Input',
  BLACKLISTED:       'You are blacklisted and cannot use this command.',
  BLACKLIST_TITLE:   '🚫 Blacklisted',
  CHANNEL_RESTRICTED:       'This bot can only be used in specific channels set by server admins.',
  CHANNEL_RESTRICTED_TITLE: '❌ Channel Restricted',
  PROCESSING_ERROR:  'Processing Error',
  PROCESSING_FAILED: 'Failed to process the attachment',
  SEARCH_FAILED:     'Search Failed',
  SEARCH_ERROR:      'Search Error',
  UNEXPECTED:        'An unexpected error occurred during the search.',
  QUEUE_FULL:        'Queue Full',
  QUEUE_FULL_MSG:    'You have too many requests processing. Please wait.',
  REQUEST_ERROR:     'An error occurred while processing your search request.',
  INVALID_REQUEST:   'Could not process your request. Please try again.',
  FILE_SEND_FAILED:  'Failed to send search results file.'
});

// ============================================================================
// HELPERS
// ============================================================================

/** @param {number} color @param {string} title @param {string} description */
function errorEmbed(color, title, description) {
  return new EmbedBuilder().setColor(color).setTitle(title).setDescription(description);
}

/**
 * Build Gemini tool config for a search request.
 * Code execution is disabled when media is attached (not compatible with file input).
 * @param {boolean} hasMedia
 * @returns {object[]}
 */
function buildSearchTools(hasMedia) {
  const tools = [{ googleSearch: {} }, { urlContext: {} }];
  if (!hasMedia) tools.push({ codeExecution: {} });
  return tools;
}

/**
 * Generate a unique temp filename for search results.
 * BUG FIX: original was `async` with no `await` inside — removed unnecessary async.
 * @returns {string}
 */
function generateSearchFilename() {
  return `${FILE_PREFIX}${Date.now()}.txt`;
}

/**
 * Send large search results as a text-file attachment via `interaction.editReply`.
 * Uses `writeTempFile` + `safeUnlink` from tempFileManager instead of raw fs calls.
 *
 * @param {import('discord.js').Interaction} interaction
 * @param {string} text
 * @returns {Promise<void>}
 */
async function sendSearchAsFile(interaction, text) {
  const filename = generateSearchFilename();
  try {
    const tempFilePath = await writeTempFile(filename, text);
    await interaction.editReply({
      content:    `<@${interaction.user.id}>, ${SEARCH_RESULTS_PREFIX}`,
      files:      [tempFilePath],
      embeds:     [],
      components: []
    });
    await safeUnlink(tempFilePath);
  } catch (error) {
    logger.error('Error sending search as text file', error);
    try {
      await interaction.editReply({
        content: `❌ ${ERR.FILE_SEND_FAILED}`, embeds: [], components: []
      });
    } catch { /* swallow follow-up failure */ }
  }
}

/**
 * Build a full search-result embed with grounding and URL-context metadata.
 * Delegates field rendering to shared `addGroundingFields` / `addUrlContextFields`
 * — no more duplicated formatters.
 *
 * @param {string}  responseText
 * @param {object|null} groundingMetadata
 * @param {object|null} urlContextMetadata
 * @param {string|number} embedColor
 * @param {import('discord.js').Interaction} interaction
 * @returns {EmbedBuilder}
 */
function createSearchEmbed(responseText, groundingMetadata, urlContextMetadata, embedColor, interaction) {
  const embed = new EmbedBuilder()
    .setColor(embedColor)
    .setDescription(responseText.slice(0, CHARACTER_LIMITS.EMBED_DESC))
    .setTimestamp()
    .setAuthor({
      name:    `Search Results for ${interaction.user.displayName}`,
      iconURL: interaction.user.displayAvatarURL()
    });

  addGroundingFields(embed, groundingMetadata);
  addUrlContextFields(embed, urlContextMetadata);

  if (interaction.guild) {
    embed.setFooter({
      text:    interaction.guild.name,
      iconURL: interaction.guild.iconURL() || GOOGLE_AI_ICON
    });
  }

  return embed;
}

/**
 * Send the final search response in the appropriate format:
 *   - text file  → response too long
 *   - embed      → responseFormat === 'Embedded'
 *   - plain text → everything else
 *
 * @param {import('discord.js').Interaction} interaction
 * @param {string}      responseText
 * @param {object|null} groundingMetadata
 * @param {object|null} urlContextMetadata
 * @param {string}      responseFormat
 * @param {string|number} embedColor
 * @param {boolean}     showActionButtons
 * @returns {Promise<void>}
 */
async function sendSearchResponse(
  interaction,
  responseText,
  groundingMetadata,
  urlContextMetadata,
  responseFormat,
  embedColor,
  showActionButtons
) {
  const maxLimit   = responseFormat === 'Embedded' ? CHARACTER_LIMITS.EMBEDDED : CHARACTER_LIMITS.NORMAL;
  const isLarge    = responseText.length > maxLimit;

  if (isLarge) {
    return sendSearchAsFile(interaction, responseText);
  }

  if (responseFormat === 'Embedded') {
    const embed   = createSearchEmbed(responseText, groundingMetadata, urlContextMetadata, embedColor, interaction);
    const payload = { embeds: [embed] };

    if (showActionButtons) {
      const { ButtonBuilder, ButtonStyle, ActionRowBuilder } = await import('discord.js');
      const downloadBtn = new ButtonBuilder()
        .setCustomId('download_message')
        .setLabel('Save')
        .setEmoji('💾')
        .setStyle(ButtonStyle.Secondary);
      const deleteBtn = new ButtonBuilder()
        .setCustomId('delete_search_message')
        .setLabel('Delete')
        .setEmoji('🗑️')
        .setStyle(ButtonStyle.Danger);
      payload.components = [new ActionRowBuilder().addComponents(downloadBtn, deleteBtn)];
    }

    return interaction.editReply(payload);
  }

  // Plain text
  const payload = { content: responseText.slice(0, CHARACTER_LIMITS.DISCORD_MAX) };
  if (showActionButtons) {
    // Re-use same button building pattern as embedded branch above
    const { ButtonBuilder, ButtonStyle, ActionRowBuilder } = await import('discord.js');
    const downloadBtn = new ButtonBuilder()
      .setCustomId('download_message').setLabel('Save').setEmoji('💾').setStyle(ButtonStyle.Secondary);
    const deleteBtn = new ButtonBuilder()
      .setCustomId('delete_search_message').setLabel('Delete').setEmoji('🗑️').setStyle(ButtonStyle.Danger);
    payload.components = [new ActionRowBuilder().addComponents(downloadBtn, deleteBtn)];
  }
  return interaction.editReply(payload);
}

// ============================================================================
// GEMINI CALL (via executeWithRetry)
// ============================================================================

/**
 * Run a single streaming Gemini search generation, returning the full response
 * and any grounding/URL-context metadata.
 *
 * @param {string}   modelName
 * @param {object}   generationConfig
 * @param {object[]} tools
 * @param {object[]} parts
 * @returns {Promise<{ response: string, groundingMetadata: object|null, urlContextMetadata: object|null }>}
 */
async function runSearchGeneration(modelName, generationConfig, tools, parts) {
  let fullResponse       = '';
  let groundingMetadata  = null;
  let urlContextMetadata = null;

  const request = {
    model:    modelName,
    contents: [{ role: 'user', parts }],
    config:   { systemInstruction: SEARCH_SYSTEM_PROMPT, ...generationConfig, tools },
    safetySettings
  };

  const result = await genAI.models.generateContentStream(request);

  for await (const chunk of result) {
    const chunkText = chunk.text || '';

    let executableCode = '';
    if (chunk.executableCode?.code) {
      const lang = (chunk.executableCode.language || 'python').toLowerCase();
      executableCode = `\n**Generated Code (${lang}):**\n\`\`\`${lang}\n${chunk.executableCode.code}\n\`\`\`\n`;
    }

    let codeOutput = '';
    if (chunk.codeExecutionResult?.output) {
      const outcome = chunk.codeExecutionResult.outcome || 'UNKNOWN';
      codeOutput = `\n**Code Execution (${outcome}):**\n\`\`\`\n${chunk.codeExecutionResult.output}\n\`\`\`\n`;
    }

    fullResponse += chunkText + executableCode + codeOutput;

    if (chunk.candidates?.[0]?.groundingMetadata)    groundingMetadata   = chunk.candidates[0].groundingMetadata;
    if (chunk.candidates?.[0]?.url_context_metadata) urlContextMetadata  = chunk.candidates[0].url_context_metadata;
  }

  return { response: fullResponse, groundingMetadata, urlContextMetadata };
}

// ============================================================================
// QUEUE ENTRY-POINT  (called by interactionCreate in index.js)
// ============================================================================

/**
 * Validate, queue, and kick off processing for a /search interaction.
 * Mirrors the queue pattern from MessageProcessor for consistent per-user throttling.
 *
 * @param {import('discord.js').CommandInteraction} interaction
 * @returns {Promise<void>}
 */
export async function handleSearchCommand(interaction) {
  try {
    const prompt     = interaction.options.getString('prompt');
    const attachment = interaction.options.getAttachment('file');

    if (!prompt && !attachment) {
      return interaction.reply({
        content: `❌ ${ERR.NO_INPUT}`,
        flags:   MessageFlags.Ephemeral
      });
    }

    await interaction.deferReply();

    const userId       = interaction.user.id;

    if (!requestQueues.has(userId)) {
      requestQueues.set(userId, { queue: [], isProcessing: false });
    }

    const userQueueData = requestQueues.get(userId);

    if (userQueueData.queue.length >= MAX_QUEUE_SIZE) {
      return interaction.editReply({
        content: `⏳ **${ERR.QUEUE_FULL}:** ${ERR.QUEUE_FULL_MSG}`
      });
    }

    userQueueData.queue.push(interaction);

    if (!userQueueData.isProcessing) {
      // BUG FIX: was a dynamic import on every call
      processUserQueue(userId);
    }

  } catch (error) {
    logger.error('Error queuing search', error);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: `❌ ${ERR.REQUEST_ERROR}`,
        flags:   MessageFlags.Ephemeral
      }).catch(() => {});
    }
  }
}

// ============================================================================
// EXECUTION  (called from processUserQueue when it dequeues a search interaction)
// ============================================================================

/**
 * Execute the full search pipeline: validate, process attachment, call Gemini,
 * format and send the result.
 *
 * @param {import('discord.js').CommandInteraction} interaction
 * @returns {Promise<void>}
 */
export async function executeSearchInteraction(interaction) {
  try {
    const prompt     = interaction.options.getString('prompt') || '';
    const attachment = interaction.options.getAttachment('file');

    if (!prompt && !attachment) {
      return interaction.editReply({
        embeds: [errorEmbed(EMBED_COLORS.WARNING, ERR.INVALID_INPUT, ERR.NO_INPUT)]
      });
    }

    const userId    = interaction.user.id;
    const guildId   = interaction.guild?.id;
    const channelId = interaction.channelId;

    // ── Guild checks (blacklist + channel restriction) ─────────────────────
    if (guildId) {
      initializeBlacklistForGuild(guildId);

      if (state.blacklistedUsers[guildId]?.includes(userId)) {
        return interaction.editReply({
          embeds: [errorEmbed(EMBED_COLORS.ERROR, ERR.BLACKLIST_TITLE, ERR.BLACKLISTED)]
        });
      }

      const allowedChannels = state.serverSettings[guildId]?.allowedChannels;
      if (allowedChannels?.length > 0 && !allowedChannels.includes(channelId)) {
        return interaction.editReply({
          embeds: [errorEmbed(EMBED_COLORS.WARNING, ERR.CHANNEL_RESTRICTED_TITLE, ERR.CHANNEL_RESTRICTED)]
        });
      }
    }

    // ── Build content parts ────────────────────────────────────────────────
    const parts    = [];
    let   hasMedia = false;

    if (prompt) {
      parts.push({ text: `${SEARCH_PROMPT_PREFIX}${prompt}` });
    }

    if (attachment) {
      try {
        // BUG FIX: was a dynamic import on every call
        const processedPart = await processAttachment(attachment, userId, interaction.id);

        if (processedPart) {
          const partsToAdd = Array.isArray(processedPart) ? processedPart : [processedPart];
          for (const part of partsToAdd) {
            if (part.fileUri || part.fileData || part.inlineData) {
              parts.push(part);
              hasMedia = true;
            }
          }
        }
      } catch (error) {
        logger.error('Error processing attachment', error);
        return interaction.editReply({
          embeds: [errorEmbed(EMBED_COLORS.ERROR, ERR.PROCESSING_ERROR, `${ERR.PROCESSING_FAILED}: ${error.message}`)]
        });
      }
    }

    if (parts.length === 0) {
      return interaction.editReply({
        embeds: [errorEmbed(EMBED_COLORS.WARNING, ERR.INVALID_INPUT, ERR.INVALID_REQUEST)]
      });
    }

    // ── Resolve settings ──────────────────────────────────────────────────
    const userSettings   = state.userSettings[userId]   || {};
    const serverSettings = guildId ? (state.serverSettings[guildId] || {}) : {};
    const effective      = serverSettings.overrideUserSettings ? serverSettings : userSettings;

    const showActionButtons = effective.showActionButtons ?? DEFAULT_USER_SETTINGS.showActionButtons;
    const selectedModel     = effective.selectedModel || DEFAULT_MODEL;
    const modelName         = MODELS[selectedModel];
    const responseFormat    = effective.responseFormat || BOT_CONFIG.DEFAULT_RESPONSE_FORMAT;
    const embedColor        = effective.embedColor     || BOT_CONFIG.HEX_COLOUR;

    const tools           = buildSearchTools(hasMedia);
    const generationConfig = getGenerationConfig(modelName);

    // ── Search with retry (replaces own inline retry loop) ────────────────
    let searchResult;
    try {
      searchResult = await executeWithRetry(
        () => runSearchGeneration(modelName, generationConfig, tools, parts),
        {
          maxAttempts:    3,
          initialDelayMs: 1000,
          maxDelayMs:     8000,
          modelName,
          onRateLimit: async () => {
            logger.warn(`Rate limit on search, waiting…`);
          }
        }
      );
    } catch (retryError) {
      logger.error('Search failed after retries', retryError);
      return interaction.editReply({
        embeds: [errorEmbed(EMBED_COLORS.ERROR, ERR.SEARCH_FAILED,
          retryError.message || 'Failed to complete search after multiple attempts.')]
      });
    }

    await sendSearchResponse(
      interaction,
      searchResult.response,
      searchResult.groundingMetadata,
      searchResult.urlContextMetadata,
      responseFormat,
      embedColor,
      showActionButtons
    );

  } catch (error) {
    logger.error('Error in search execution', error);
    try {
      await interaction.editReply({
        embeds: [errorEmbed(EMBED_COLORS.ERROR, ERR.SEARCH_ERROR, ERR.UNEXPECTED)]
      });
    } catch (replyError) {
      logger.error('Failed to send search error embed', replyError);
    }
  }
}
