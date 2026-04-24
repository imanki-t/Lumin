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
  sanitizeRequestForModel,
  state,
  requestQueues,          // FIX: direct import — avoids state.requestQueues stale-reference bug
  BOT_CONFIG,
  DEFAULT_USER_SETTINGS
} from '../managers/BotManager.js';
import { getCurrentClient } from '../managers/ApiKeyManager.js';
import { Logger }            from '../core/Logger.js';
import { Embeds, GOOGLE_AI_ICON } from '../modules/shared/embedBuilder.js';
import { addDownloadButton, addDeleteButton } from '../modules/shared/buttonHandlers.js';
import { executeWithRetry }  from '../modules/shared/retryUtils.js';
import { writeTempFile, safeUnlink } from '../modules/shared/tempFileManager.js';
import { initializeBlacklistForGuild } from '../utils.js';
import { processAttachment } from '../modules/attachments/FileUploader.js';
import { processUserQueue }  from '../modules/message/MessageProcessor.js';
import { MODELS, safetySettings, getGenerationConfig, RATE_LIMIT_ERRORS, DEFAULT_MODEL, ENABLE_GEMMA, GEMMA_DEFAULT_MODEL, GEMMA_FALLBACK_MODEL, GEMMA_SUPPORTED_MIME_PREFIXES, GEMMA_SUPPORTED_EXTENSIONS, isGemmaModel } from '../modules/config.js';
import config                from '../config.js';

const logger = Logger.get('SearchCommand');

// ============================================================================
// CONSTANTS
// ============================================================================

const MAX_QUEUE_SIZE = 5;

const CHARACTER_LIMITS = Object.freeze({
  EMBEDDED:    4096,   // Discord embed description hard limit
  NORMAL:      2000,   // Discord message hard limit
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
- You MUST use the googleSearch tool for EVERY query without exception
- Always perform a Google search before answering — never answer from memory alone
- Provide accurate, well-sourced information strictly from search results
- Current date: ${getCurrentDate()}

RESPONSE FORMAT (follow this structure exactly, using these exact headings):

## 🔍 Search Query
State the exact search query or queries you used.

## Answer
Write in clear prose paragraphs. Only use bullet points or numbered lists when the content is inherently list-like (steps, comparisons, ranked items). Do not bullet-point explanations, facts, or narrative answers.

## TL;DR
One to two sentences summarising the key finding.

## Sources
List each source as: - [Title](URL) — one-line description of what it contributed.

RULES:
- Do NOT ask follow-up questions
- Do NOT add phrases like "Let me know if you need more info" or any similar closing prompt
- Do NOT add disclaimers about information currency — just state the date if relevant
- Every factual claim must be traceable to a cited source in the Sources section`;

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
  FILE_SEND_FAILED:  'Failed to send search results file.',
  GEMMA_MEDIA:       'Unsupported Attachment',
  GEMMA_MEDIA_MSG:   'Only images (JPG, PNG, WEBP, GIF, BMP, TIFF) are supported when Gemma mode is active. Please remove the attachment or use an image instead.'
});

// ============================================================================
// HELPERS
// ============================================================================

/** @param {number} color @param {string} title @param {string} description */
function errorEmbed(color, title, description) {
  return new EmbedBuilder().setColor(color).setTitle(title).setDescription(description);
}

/**
 * googleSearch tool config that forces grounding on every request at the API level.
 *
 * dynamicRetrievalConfig.dynamicThreshold = 0 tells the Gemini API to always
 * perform a Google Search regardless of whether the model thinks it's needed.
 * Without this, the model can silently skip searching for queries it considers
 * "known" — the system prompt instruction alone is not sufficient to prevent that.
 *
 * Gemma does not support dynamicRetrievalConfig, so it gets a plain googleSearch.
 */
const FORCED_GOOGLE_SEARCH = Object.freeze({
  googleSearch: {
    dynamicRetrievalConfig: {
      mode:             'MODE_DYNAMIC',
      dynamicThreshold: 0   // 0 = always search, 1 = never search, default ~0.3
    }
  }
});

const GEMMA_GOOGLE_SEARCH = Object.freeze({ googleSearch: {} });

/**
 * Build tool config for a search request.
 * - googleSearch is ALWAYS included regardless of model — search command requires it.
 * - Gemma models: plain googleSearch only (no dynamicRetrievalConfig, urlContext, or codeExecution).
 * - Gemini models: forced googleSearch + urlContext, plus codeExecution when no media attached.
 * @param {boolean} hasMedia
 * @param {string}  [modelName='']
 * @returns {object[]}
 */
function buildSearchTools(hasMedia, modelName = '') {
  // Gemma only supports plain googleSearch — no dynamicRetrievalConfig, urlContext or codeExecution
  if (isGemmaModel(modelName)) {
    return [GEMMA_GOOGLE_SEARCH];
  }
  // Gemini: forced googleSearch + urlContext; codeExecution only when no media
  const tools = [FORCED_GOOGLE_SEARCH, { urlContext: {} }];
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
 * Build a search-result embed.
 *
 * NOTE: addGroundingFields / addUrlContextFields are intentionally NOT called here.
 * The model's response already contains structured ## Search Query / ## Answer /
 * ## TL;DR / ## Sources sections in the description — appending Gemini's raw
 * grounding metadata fields on top would duplicate the sources and clutter the embed.
 *
 * @param {string}        responseText
 * @param {string|number} embedColor
 * @param {import('discord.js').Interaction} interaction
 * @returns {EmbedBuilder}
 */
function createSearchEmbed(responseText, embedColor, interaction) {
  const embed = new EmbedBuilder()
    .setColor(embedColor)
    .setDescription(responseText.slice(0, CHARACTER_LIMITS.EMBED_DESC))
    .setTimestamp()
    .setAuthor({
      name:    `Search Results for ${interaction.user.displayName}`,
      iconURL: interaction.user.displayAvatarURL()
    });

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
 *   - text file  → response too long (exceeds Discord hard limits)
 *   - embed      → responseFormat === 'Embedded'
 *   - plain text → everything else
 *
 * Grounding/URL-context metadata is no longer forwarded here — the model's
 * structured response (## Search Query / ## Answer / ## TL;DR / ## Sources)
 * already contains all citation information in the text itself.
 *
 * @param {import('discord.js').Interaction} interaction
 * @param {string}      responseText
 * @param {string}      responseFormat
 * @param {string|number} embedColor
 * @param {boolean}     showActionButtons
 * @returns {Promise<void>}
 */
async function sendSearchResponse(
  interaction,
  responseText,
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
    const embed   = createSearchEmbed(responseText, embedColor, interaction);
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
// GEMINI CALL (direct — bypasses genAI proxy / withRetryPerModel)
// ============================================================================

/**
 * Run a single streaming search generation against the raw Gemini client,
 * deliberately bypassing the genAI proxy.
 *
 * WHY bypass the proxy:
 *   The genAI proxy wraps every call in ApiKeyManager.withRetryPerModel, which
 *   uses the global MODEL_FALLBACK_CHAIN for internal model switching.  When
 *   ENABLE_GEMMA=true that chain is replaced with Gemma-only models, so a rate
 *   limit on gemini-3.1-flash-lite-preview causes withRetryPerModel to jump
 *   straight to Gemma — silently skipping gemini-2.5-flash — before the
 *   searchFallbackChain loop in executeSearchInteraction ever sees the error.
 *
 *   By calling getCurrentClient() directly, rate-limit errors propagate as real
 *   throws.  executeWithRetry re-throws them to the outer for-loop, which then
 *   steps correctly through:
 *     gemini-3.1-flash-lite-preview → gemini-2.5-flash → gemma (if ENABLE_GEMMA)
 *
 *   sanitizeRequestForModel is called explicitly here to strip tools that the
 *   target model doesn't support (e.g. urlContext / codeExecution for Gemma).
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

  // Strip tools incompatible with this specific model (e.g. urlContext + codeExecution for Gemma)
  // before sending — mirrors what the genAI proxy does inside withRetryPerModel.
  sanitizeRequestForModel(request, modelName);

  // Use the raw client — do NOT go through genAI proxy, which would re-wrap
  // this in withRetryPerModel and hijack model switching away from our chain.
  const result = await getCurrentClient().models.generateContentStream(request);

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

    // ── Search attachment restriction (all models) ────────────────────────
    // /search only accepts images. Video, audio, PDFs, and plain-text files
    // are disabled for all models — Gemini and Gemma alike.
    // GEMMA_SUPPORTED_MIME_PREFIXES ('image/') and GEMMA_SUPPORTED_EXTENSIONS
    // already define exactly the image set we want, so we reuse them here.
    if (attachment) {
      const mimeType = attachment.contentType || '';
      const fileName = attachment.name || '';
      const ext      = fileName.slice(fileName.lastIndexOf('.')).toLowerCase();
      const isSupportedMime = GEMMA_SUPPORTED_MIME_PREFIXES.some(prefix => mimeType.startsWith(prefix));
      const isSupportedExt  = GEMMA_SUPPORTED_EXTENSIONS.includes(ext);
      if (!isSupportedMime && !isSupportedExt) {
        return interaction.editReply({
          embeds: [errorEmbed(EMBED_COLORS.WARNING, ERR.GEMMA_MEDIA,
            'Only images (JPG, PNG, WEBP, GIF, BMP, TIFF) can be attached to a search query. Video, audio, PDFs, and text files are not supported.')]
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
    const responseFormat    = effective.responseFormat || BOT_CONFIG.DEFAULT_RESPONSE_FORMAT;
    const embedColor        = effective.embedColor     || BOT_CONFIG.HEX_COLOUR;

    // ── Search fallback chain ──────────────────────────────────────────────
    // Order (regardless of ENABLE_GEMMA global mode):
    //   1. gemini-3.1-flash-lite-preview  (primary Gemini)
    //   2. gemini-2.5-flash               (Gemini fallback)
    //   3. GEMMA_DEFAULT_MODEL            (Gemma primary, only when ENABLE_GEMMA)
    //   4. GEMMA_FALLBACK_MODEL           (Gemma fallback, only when ENABLE_GEMMA)
    //
    // Gemini models always come first — even when ENABLE_GEMMA is true.
    // Gemma is appended as a last-resort tier, not as a primary route.
    // User's selectedModel setting is intentionally ignored here — search always
    // needs googleSearch tooling; Gemma only partially supports it.
    const gemmaModels = ENABLE_GEMMA
      ? [
          MODELS[GEMMA_DEFAULT_MODEL]  ?? 'gemma-4-26b-a4b-it',
          MODELS[GEMMA_FALLBACK_MODEL] ?? 'gemma-4-31b-it'
        ]
      : [];

    const searchFallbackChain = [
      'gemini-3.1-flash-lite-preview',
      'gemini-2.5-flash',
      ...gemmaModels
    ];

    // ── Search with per-model retry + chain fallback ───────────────────────
    let searchResult;
    let searchError;

    for (const currentModel of searchFallbackChain) {
      const modelTools     = buildSearchTools(hasMedia, currentModel);
      const modelGenConfig = getGenerationConfig(currentModel);
      try {
        searchResult = await executeWithRetry(
          () => runSearchGeneration(currentModel, modelGenConfig, modelTools, parts),
          {
            maxAttempts:    2,
            initialDelayMs: 1000,
            maxDelayMs:     8000,
            modelName:      currentModel,
            onRateLimit: async () => {
              logger.warn(`Rate limit on search with ${currentModel}, moving to next fallback…`);
            }
          }
        );
        searchError = null;
        break; // succeeded — stop walking the chain
      } catch (err) {
        logger.warn(`Search failed with ${currentModel}, trying next fallback`, err);
        searchError = err;
      }
    }

    if (searchError) {
      logger.error('Search failed after all fallbacks', searchError);
      return interaction.editReply({
        embeds: [errorEmbed(EMBED_COLORS.ERROR, ERR.SEARCH_FAILED,
          searchError.message || 'Failed to complete search after multiple attempts.')]
      });
    }

    await sendSearchResponse(
      interaction,
      searchResult.response,
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
