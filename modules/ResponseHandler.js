/**
 * @fileoverview Streaming response handler — typing indicator, generation loop,
 *               model fallback, function calling, and history persistence.
 * @module modules/message/ResponseHandler
 */

import { EmbedBuilder } from 'discord.js';
import path              from 'path';
import fs                from 'fs/promises';

import {
  genAI,
  state,
  BOT_CONFIG,
  DEFAULT_USER_SETTINGS,
  TEMP_DIR,
  switchToNextKey
} from '../../managers/BotManager.js';
import { Logger }  from '../../core/Logger.js';
import { Embeds, addGroundingFields, addUrlContextFields, GOOGLE_AI_ICON } from '../shared/embedBuilder.js';
import { executeFunctionCalls }         from '../functions/FunctionExecutor.js';
import { getGenerationConfig, RATE_LIMIT_ERRORS, MODEL_FALLBACK_CHAIN } from '../../modules/config.js';
import { extractFileText }              from './PromptBuilder.js';
import { processPromptAndMediaAttachments } from './MediaHandler.js';
import { saveMessageHistory }           from './HistoryManager.js';
import { addDownloadButton, addDeleteButton } from '../shared/buttonHandlers.js';

const logger = Logger.get('ResponseHandler');

// ============================================================================
// SLEEP HELPER  (replaces `delay` from tools/others.js)
// ============================================================================

/** @param {number} ms @returns {Promise<void>} */
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// ============================================================================
// ABSORBED FROM OLD ROOT responseHandler.js
// (updateEmbed / updateEmbedForInteraction / sendAsTextFile)
// All console.* replaced with logger; grounding builders use shared embedBuilder.
// ============================================================================

const EMBED_DESCRIPTION_MAX = 4096;

/**
 * Update a bot message in-place with a formatted embed containing the AI
 * response. Called both mid-stream (debounced) and at stream completion.
 *
 * @param {import('discord.js').Message} botMessage
 * @param {string}      finalResponse
 * @param {import('discord.js').Message} originalMessage
 * @param {object|null} groundingMetadata
 * @param {object|null} urlContextMetadata
 * @param {object}      effectiveSettings
 */
export function updateEmbed(
  botMessage,
  finalResponse,
  originalMessage,
  groundingMetadata,
  urlContextMetadata,
  effectiveSettings
) {
  try {
    const embedColor      = effectiveSettings.embedColor || BOT_CONFIG.HEX_COLOUR;
    const continuousReply = effectiveSettings.continuousReply ?? DEFAULT_USER_SETTINGS.continuousReply;
    const showMetadata    = effectiveSettings.responseFormat === 'Embedded';
    const isGuild         = originalMessage.guild !== null;

    const embed = new EmbedBuilder()
      .setColor(embedColor)
      .setDescription(finalResponse.slice(0, EMBED_DESCRIPTION_MAX))
      .setTimestamp();

    if (!continuousReply) {
      embed.setAuthor({
        name:    `To ${originalMessage.author.displayName}`,
        iconURL: originalMessage.author.displayAvatarURL()
      });
    }

    if (groundingMetadata  && showMetadata) addGroundingFields(embed, groundingMetadata);
    if (urlContextMetadata && showMetadata) addUrlContextFields(embed, urlContextMetadata);

    if (isGuild) {
      embed.setFooter({
        text:    originalMessage.guild.name,
        iconURL: originalMessage.guild.iconURL() || GOOGLE_AI_ICON
      });
    }

    botMessage.edit({ content: ' ', embeds: [embed], components: [] }).catch(() => {});
  } catch (error) {
    logger.error('Error updating embed', error);
  }
}

/**
 * Edit an interaction reply with a formatted embed.
 *
 * @param {import('discord.js').Interaction} interaction
 * @param {import('discord.js').Message}     botMessage
 * @param {string}      finalResponse
 * @param {object|null} groundingMetadata
 * @param {object|null} urlContextMetadata
 * @param {object}      effectiveSettings
 */
export function updateEmbedForInteraction(
  interaction,
  botMessage,
  finalResponse,
  groundingMetadata,
  urlContextMetadata,
  effectiveSettings
) {
  try {
    const embedColor   = effectiveSettings.embedColor || BOT_CONFIG.HEX_COLOUR;
    const showMetadata = effectiveSettings.responseFormat === 'Embedded';
    const isGuild      = interaction.guild !== null;

    const embed = new EmbedBuilder()
      .setColor(embedColor)
      .setDescription(finalResponse.slice(0, EMBED_DESCRIPTION_MAX))
      .setTimestamp()
      .setAuthor({
        name:    `To ${interaction.user.displayName}`,
        iconURL: interaction.user.displayAvatarURL()
      });

    if (groundingMetadata  && showMetadata) addGroundingFields(embed, groundingMetadata);
    if (urlContextMetadata && showMetadata) addUrlContextFields(embed, urlContextMetadata);

    if (isGuild) {
      embed.setFooter({
        text:    interaction.guild.name,
        iconURL: interaction.guild.iconURL() || GOOGLE_AI_ICON
      });
    }

    interaction.editReply({ content: ' ', embeds: [embed] }).catch(() => {});
  } catch (error) {
    logger.error('Error updating interaction embed', error);
  }
}

/**
 * Write `text` to a temp file and send/edit it as a Discord attachment.
 * Handles both Message-based and Interaction-based contexts.
 *
 * @param {string}  text
 * @param {import('discord.js').Message|import('discord.js').Interaction} messageOrInteraction
 * @param {string}  orgId            - ID of an existing bot message to edit (message path)
 * @param {boolean} [continuousReply=false]
 * @returns {Promise<import('discord.js').Message|null>}
 */
export async function sendAsTextFile(text, messageOrInteraction, orgId, continuousReply = false) {
  const tempFilePath = path.join(TEMP_DIR, `response-${Date.now()}.txt`);
  try {
    await fs.writeFile(tempFilePath, text);

    const userId  = messageOrInteraction.user?.id || messageOrInteraction.author?.id;
    const channel = messageOrInteraction.channel;
    if (!userId || !channel) throw new Error('Could not determine user or channel.');

    const isInteraction = !!messageOrInteraction.isInteraction;
    const mention       = (isInteraction || !continuousReply) ? `<@${userId}>, ` : '';
    const content       = `${mention}Here is the response:`;

    let botMessage;
    if (isInteraction) {
      botMessage = await messageOrInteraction.editReply({
        content, files: [tempFilePath], embeds: [], components: []
      });
    } else {
      const toEdit = await channel.messages.fetch(orgId).catch(() => null);
      if (toEdit) {
        botMessage = await toEdit.edit({ content, files: [tempFilePath], embeds: [], components: [] });
      } else {
        botMessage = await channel.send({ content, files: [tempFilePath] });
      }
    }

    await fs.unlink(tempFilePath).catch(() => {});
    return botMessage;
  } catch (error) {
    logger.error('Error sending as text file', error);
    await fs.unlink(tempFilePath).catch(() => {});
    return null;
  }
}

// ============================================================================
// CONSTANTS
// ============================================================================

const TYPING_INTERVAL_MS = 4_000;
const TYPING_TIMEOUT_MS  = 120_000;
const CHAR_THRESHOLD     = 150;          // chars before initial message is sent
const UPDATE_DEBOUNCE_MS = 350;          // min ms between stream edits

const MAX_RETRY_ATTEMPTS      = 3;
const MAX_FUNCTION_CALL_TURNS = 3;

const CHARACTER_LIMITS = Object.freeze({
  EMBEDDED:    3900,
  NORMAL:      1900,
  DISCORD_MAX: 2000
});

const RETRY_DELAYS = Object.freeze({
  DEFAULT:    1500,
  RATE_LIMIT: 2000,
  FILE_ERROR: 1000
});

// ============================================================================
// TYPING MANAGER
// ============================================================================

class TypingManager {
  constructor() {
    /** @type {Map<string, ReturnType<typeof setInterval>>} */
    this.activeIntervals = new Map();
    /** @type {Map<string, ReturnType<typeof setTimeout>>} */
    this.cleanupTimers   = new Map();
  }

  /** Start a typing indicator on a channel (no-op if already running). */
  start(channel) {
    if (!channel || this.activeIntervals.has(channel.id)) return;
    this._clearCleanup(channel.id);

    channel.sendTyping().catch(() => {});
    const intervalId = setInterval(() => channel.sendTyping().catch(() => {}), TYPING_INTERVAL_MS);
    this.activeIntervals.set(channel.id, intervalId);

    const timer = setTimeout(() => this.stop(channel.id), TYPING_TIMEOUT_MS);
    this.cleanupTimers.set(channel.id, timer);
  }

  /** Stop the typing indicator for a channel. */
  stop(channelId) {
    const id = this.activeIntervals.get(channelId);
    if (id !== undefined) { clearInterval(id); this.activeIntervals.delete(channelId); }
    this._clearCleanup(channelId);
  }

  /** Stop ALL typing indicators (e.g. on shutdown). */
  stopAll() {
    for (const id of this.activeIntervals.values()) clearInterval(id);
    for (const t  of this.cleanupTimers.values())   clearTimeout(t);
    this.activeIntervals.clear();
    this.cleanupTimers.clear();
  }

  _clearCleanup(channelId) {
    const t = this.cleanupTimers.get(channelId);
    if (t !== undefined) { clearTimeout(t); this.cleanupTimers.delete(channelId); }
  }
}

/** Shared singleton — imported by MessageProcessor for start/stop calls. */
export const typingManager = new TypingManager();

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Strip fileUri / fileData parts from history entries, replacing them with
 * text stubs so expired Gemini file references don't cause 403 errors.
 * @param {object[]} history
 * @returns {object[]}
 */
export function cleanHistoryFiles(history) {
  return history
    .map(entry => ({
      role:  entry.role,
      parts: (entry.parts || entry.content || [])
        .map(p => (p.fileUri || p.fileData) ? { text: '[Previous file attachment - content no longer available]' } : p)
        .filter(p => p.text)
    }))
    .filter(entry => entry.parts.length > 0);
}

function isFileError(error) {
  const is403    = error?.status === 403 || error?.code === 403 || error?.message?.includes('403');
  const keywords = error?.message?.includes('File') ||
                   error?.message?.includes('file') ||
                   error?.message?.includes('PERMISSION_DENIED');
  return is403 && keywords;
}

function isRateLimitError(error) {
  return RATE_LIMIT_ERRORS.some(code =>
    error?.message?.includes(code) ||
    error?.status  === code        ||
    error?.code?.includes?.(code)
  );
}

/**
 * Extract all text output from a single stream chunk, including code execution blocks.
 * @param {object} chunk
 * @returns {string}
 */
function extractChunkText(chunk) {
  let text = chunk.text || '';

  if (chunk.executableCode?.code) {
    const lang = (chunk.executableCode.language || 'python').toLowerCase();
    text += `\n**Generated Code (${lang}):**\n\`\`\`${lang}\n${chunk.executableCode.code}\n\`\`\`\n`;
  }

  if (chunk.codeExecutionResult?.output) {
    const outcome = chunk.codeExecutionResult.outcome || 'UNKNOWN';
    text += `\n**Code Execution (${outcome}):**\n\`\`\`\n${chunk.codeExecutionResult.output}\n\`\`\`\n`;
  }

  return text;
}

// ============================================================================
// MAIN GENERATION HANDLER
// ============================================================================

/**
 * Run the full AI generation cycle: stream response, handle retries and model
 * fallback, execute function calls, send/edit the Discord message, and persist
 * the conversation turn.
 *
 * NOTE: `baseGenerationConfig` has been removed — it was always `null` in every
 * call site. `getGenerationConfig(modelName)` is used directly instead.
 *
 * @param {import('discord.js').Message|null} initialBotMessage - Existing reply to update, or null
 * @param {string}   modelName
 * @param {string}   systemInstruction
 * @param {object}   safetySettings
 * @param {object[]} tools
 * @param {object[]} history             - Optimised history from memorySystem
 * @param {object[]} parts               - Gemini content parts for this turn
 * @param {import('discord.js').Message} originalMessage
 * @param {string}   channelId
 * @param {string}   historyId
 * @param {object}   effectiveSettings
 * @param {string}   [originalPrompt]    - Raw prompt text for re-preparation on key rotation
 * @param {object[]} [allAttachments]    - All attachment objects for re-preparation
 * @param {object[]|null} [preparedMessages] - Non-null for batched turns
 * @returns {Promise<void>}
 */
export async function handleModelResponse(
  initialBotMessage,
  modelName,
  systemInstruction,
  safetySettings,
  tools,
  history,
  parts,
  originalMessage,
  channelId,
  historyId,
  effectiveSettings,
  originalPrompt   = '',
  allAttachments   = [],
  preparedMessages = null
) {
  const userId  = originalMessage.author.id;
  const guildId = originalMessage.guild?.id;

  const responseFormat    = effectiveSettings.responseFormat    || BOT_CONFIG.DEFAULT_RESPONSE_FORMAT;
  const showActionButtons = effectiveSettings.showActionButtons ?? DEFAULT_USER_SETTINGS.showActionButtons;
  const continuousReply   = effectiveSettings.continuousReply   ?? DEFAULT_USER_SETTINGS.continuousReply;
  const maxCharLimit      = responseFormat === 'Embedded' ? CHARACTER_LIMITS.EMBEDDED : CHARACTER_LIMITS.NORMAL;

  let currentModelIndex = MODEL_FALLBACK_CHAIN.indexOf(modelName);
  if (currentModelIndex === -1) { currentModelIndex = 0; modelName = MODEL_FALLBACK_CHAIN[0]; }

  let attempts       = MAX_RETRY_ATTEMPTS;
  let modelAttempts  = 0;
  const maxModelAttempts = MODEL_FALLBACK_CHAIN.length;

  // Outer mutable state shared across retry iterations
  let updateTimeout      = null;
  let tempResponse       = '';
  let groundingMetadata  = null;
  let urlContextMetadata = null;
  let botMessage         = initialBotMessage;

  // ── Helpers ────────────────────────────────────────────────────────────────

  const shouldForceReply = () =>
    !continuousReply ||
    (guildId && originalMessage.channel.lastMessageId !== originalMessage.id);

  const scheduleUpdate = () => {
    if (updateTimeout) return;
    updateTimeout = setTimeout(async () => {
      updateTimeout = null;
      if (!botMessage || !tempResponse.trim()) return;
      try {
        if (responseFormat === 'Embedded') {
          updateEmbed(botMessage, tempResponse, originalMessage, groundingMetadata, urlContextMetadata, effectiveSettings);
        } else {
          await botMessage.edit({ content: tempResponse, embeds: [] }).catch(() => {});
        }
      } catch { /* swallow — best-effort update */ }
    }, UPDATE_DEBOUNCE_MS);
  };

  const cleanup = () => {
    typingManager.stop(channelId);
    if (updateTimeout) { clearTimeout(updateTimeout); updateTimeout = null; }
  };

  // ── Build large-response embed (used twice in stream loop) ─────────────────
  const largResponseEmbed = () =>
    new EmbedBuilder()
      .setColor(0xFFAA00)
      .setTitle('📄 Large Response')
      .setDescription('The response is too large. It will be sent as a text file once completed.');

  // ── Consume one stream, accumulating text and function calls ───────────────
  const drainStream = async (stream, params) => {
    const { onFunctionCall } = params;
    let finalResponse = params.initialResponse || '';

    for await (const chunk of stream) {
      if (chunk.functionCalls?.length) onFunctionCall(chunk.functionCalls);

      const chunkText = extractChunkText(chunk);
      if (chunkText) {
        finalResponse += chunkText;
        tempResponse  += chunkText;

        // Create the Discord message once we have enough text
        if (!botMessage && tempResponse.length > CHAR_THRESHOLD) {
          botMessage = shouldForceReply()
            ? await originalMessage.reply({ content: tempResponse })
            : await originalMessage.channel.send({ content: tempResponse });
        }

        if (botMessage) {
          if (finalResponse.length > maxCharLimit && !params.isLargeRef.value) {
            params.isLargeRef.value = true;
            botMessage.edit({ content: ' ', embeds: [largResponseEmbed()], components: [] }).catch(() => {});
          } else if (!params.isLargeRef.value) {
            scheduleUpdate();
          }
        }
      }

      if (chunk.candidates?.[0]?.groundingMetadata)    groundingMetadata   = chunk.candidates[0].groundingMetadata;
      if (chunk.candidates?.[0]?.url_context_metadata) urlContextMetadata  = chunk.candidates[0].url_context_metadata;
    }

    return finalResponse;
  };

  // ── Main retry loop ────────────────────────────────────────────────────────

  try {
    while (modelAttempts < maxModelAttempts && attempts > 0) {
      try {
        let finalResponse  = '';
        const isLargeRef   = { value: false };   // boxed bool so drainStream can mutate it
        const newHistory   = [{ role: 'user', content: parts }];

        const generationConfig = getGenerationConfig(modelName);
        logger.debug(`Using model: ${modelName} (attempt ${modelAttempts + 1}/${maxModelAttempts})`);

        const request = {
          model:    modelName,
          contents: [
            ...(history || []).filter(Boolean),
            { role: 'user', parts: (parts || []).filter(Boolean) }
          ],
          config: { systemInstruction, ...(generationConfig || {}), tools },
          safetySettings
        };

        const stream = await genAI.models.generateContentStream(request);
        if (!stream) throw new Error('API returned undefined — check API keys');

        typingManager.stop(channelId);

        let functionCallParts = [];
        const onFunctionCall  = (calls) => functionCallParts.push(...calls);

        finalResponse = await drainStream(stream, { onFunctionCall, isLargeRef, initialResponse: '' });

        // ── Function calling loop ────────────────────────────────────────
        // BUG FIX (original): function call contents were all bundled in a single
        // user message. Gemini requires them as separate model/user turns:
        //   [history…, user_message, model_function_calls, user_function_results]
        if (functionCallParts.length > 0) {
          logger.debug(`Executing ${functionCallParts.length} function call(s)…`);

          let functionTurnCount = 0;

          while (functionCallParts.length > 0 && functionTurnCount < MAX_FUNCTION_CALL_TURNS) {
            functionTurnCount++;
            logger.debug(`Function turn ${functionTurnCount}/${MAX_FUNCTION_CALL_TURNS}`);

            const functionResponses = await executeFunctionCalls(functionCallParts, userId, guildId, historyId);

            // Correct multi-turn contents layout for the Gemini API
            const turnContents = [
              ...(history || []).filter(Boolean),
              { role: 'user',  parts: (parts || []).filter(Boolean) },
              { role: 'model', parts: functionCallParts.map(call => ({ functionCall: call })) },
              { role: 'user',  parts: functionResponses }
            ];

            const nextRequest = {
              model:    modelName,
              contents: turnContents,
              config:   { systemInstruction, ...(generationConfig || {}), tools },
              safetySettings
            };

            const nextStream = await genAI.models.generateContentStream(nextRequest);

            // Reset for next turn
            finalResponse     = '';
            tempResponse      = '';
            functionCallParts = [];

            finalResponse = await drainStream(nextStream, { onFunctionCall, isLargeRef, initialResponse: '' });

            if (!functionCallParts.length) break;
          }

          if (functionTurnCount >= MAX_FUNCTION_CALL_TURNS && functionCallParts.length > 0) {
            logger.warn(`Function calling limit reached (${MAX_FUNCTION_CALL_TURNS} turns), stopping`);
            finalResponse += '\n\n[Function calling limit reached]';
          }
        }

        // ── Flush pending debounced edit ─────────────────────────────────
        if (updateTimeout) { clearTimeout(updateTimeout); updateTimeout = null; }

        // ── Send if entire response was below initial threshold ──────────
        let wasShortResponse = false;
        if (!botMessage && finalResponse) {
          wasShortResponse = true;
          botMessage = shouldForceReply()
            ? await originalMessage.reply({ content: finalResponse })
            : await originalMessage.channel.send({ content: finalResponse });
        }

        newHistory.push({ role: 'assistant', content: [{ text: finalResponse }] });

        // ── Apply final format ───────────────────────────────────────────
        if (botMessage) {
          if (!isLargeRef.value && responseFormat === 'Embedded') {
            updateEmbed(botMessage, finalResponse, originalMessage, groundingMetadata, urlContextMetadata, effectiveSettings);
          } else if (!isLargeRef.value && !wasShortResponse) {
            await botMessage.edit({
              content: finalResponse.slice(0, CHARACTER_LIMITS.DISCORD_MAX),
              embeds:  []
            }).catch(() => {});
          }
        }

        if (isLargeRef.value && botMessage) {
          botMessage = await sendAsTextFile(finalResponse, originalMessage, botMessage.id, continuousReply);
        }

        if (showActionButtons && botMessage && !isLargeRef.value) {
          botMessage = await addDownloadButton(botMessage);
          botMessage = await addDeleteButton(botMessage, botMessage.id, userId);
        }

        // ── Persist history ──────────────────────────────────────────────
        if (newHistory.length > 1 && botMessage) {
          await saveMessageHistory({
            historyId,
            userId,
            guildId,
            newHistory,
            finalResponse,
            botMessageId: botMessage.id,
            originalMessage,
            preparedMessages
          });
        }

        cleanup();
        return; // success

      } catch (error) {
        attempts--;

        // ── File permission error (expired Gemini file URI) ──────────────
        // NOTE: switchToNextKey() intentionally does NOT rotate on file errors
        // (Gemini files are bound to the key that uploaded them). So we must
        // re-upload the original Discord attachments ourselves with the current
        // key — the Discord CDN URLs are always still valid.
        if (isFileError(error)) {
          logger.warn(`File permission error after key rotation — re-uploading attachments: ${error.message}`);
          history = cleanHistoryFiles(history);

          if (allAttachments?.length && attempts > 0) {
            try {
              logger.info(`Re-uploading ${allAttachments.length} attachment(s) with current key`);
              const { finalPrompt, summaryParts } = await extractFileText(originalMessage, originalPrompt);
              parts = await processPromptAndMediaAttachments(finalPrompt, originalMessage, allAttachments);
              if (summaryParts?.length) parts.push(...summaryParts);
              logger.info('Attachment re-upload succeeded — retrying generation');
              typingManager.start(originalMessage.channel);
              await sleep(RETRY_DELAYS.FILE_ERROR);
              continue;
            } catch (reuploadErr) {
              logger.error('Attachment re-upload failed — stripping file parts as fallback', reuploadErr);
            }
          }

          // Fallback: strip stale file parts and let the user know
          parts = parts.filter(p => !p.fileUri && !p.fileData);
          if (!parts.some(p => p.text?.trim())) {
            parts.unshift({ text: '[File attachments could not be re-uploaded after key rotation. Please re-send your files.]' });
          }
          if (attempts > 0) {
            typingManager.start(originalMessage.channel);
            await sleep(RETRY_DELAYS.FILE_ERROR);
            continue;
          }
        }

        // ── API key rotation ─────────────────────────────────────────────
        const rotated = switchToNextKey(error);
        if (rotated && attempts > 0) {
          typingManager.start(originalMessage.channel);
          try {
            const [cleanedHistory, reprocessedParts] = await Promise.all([
              Promise.resolve(cleanHistoryFiles(history)),
              (async () => {
                const { finalPrompt, summaryParts } = await extractFileText(originalMessage, originalPrompt);
                const updated = await processPromptAndMediaAttachments(finalPrompt, originalMessage, allAttachments);
                if (summaryParts?.length) updated.push(...summaryParts);
                return updated;
              })()
            ]);
            history = cleanedHistory;
            parts   = reprocessedParts;
            continue;
          } catch (reErr) {
            logger.error('Failed to re-prepare context after key rotation', reErr);
          }
        }

        // ── Rate-limit → model fallback ──────────────────────────────────
        if (isRateLimitError(error)) {
          logger.warn(`Rate limit on ${modelName}, falling back…`);
          typingManager.start(originalMessage.channel);
          currentModelIndex++;
          if (currentModelIndex < MODEL_FALLBACK_CHAIN.length) {
            modelName     = MODEL_FALLBACK_CHAIN[currentModelIndex];
            modelAttempts++;
            attempts      = MAX_RETRY_ATTEMPTS;
            await sleep(RETRY_DELAYS.RATE_LIMIT);
            continue;
          }
        }

        // ── All attempts exhausted ───────────────────────────────────────
        if (attempts === 0 && modelAttempts >= maxModelAttempts - 1) {
          cleanup();
          const embed = new EmbedBuilder()
            .setColor(0xFF0000)
            .setTitle('❌ Generation Failed')
            .setDescription(
              `All models failed. Last error: ${error.message || 'Unknown error'}\n\n` +
              `Tried: ${MODEL_FALLBACK_CHAIN.slice(0, modelAttempts + 1).join(', ')}`
            );
          try {
            if (shouldForceReply()) await originalMessage.reply({ embeds: [embed] });
            else await originalMessage.channel.send({ embeds: [embed] });
          } catch { /* swallow */ }
          return;
        }

        await sleep(RETRY_DELAYS.DEFAULT);
      }
    }
  } catch (outerError) {
    logger.error('Critical error in handleModelResponse', outerError);
    try {
      await originalMessage.reply({
        embeds: [Embeds.error('Critical Error', 'An unexpected error occurred while processing your message. Please try again.')]
      });
    } catch { /* swallow */ }
  } finally {
    cleanup();
  }
}
