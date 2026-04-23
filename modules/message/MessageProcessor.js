/**
 * @fileoverview Message queue orchestrator — dequeues messages, resolves settings,
 *               builds history, and delegates to the model response handler.
 * @module modules/message/MessageProcessor
 */

import { EmbedBuilder, ChannelType } from 'discord.js';
import path from 'path';

import {
  client,
  state,
  requestQueues,
  BOT_CONFIG,
  DEFAULT_SERVER_SETTINGS,
  DEFAULT_USER_SETTINGS
} from '../../managers/BotManager.js';
import { checkAndIncrementDailyMessages } from '../../managers/QueueManager.js';
import { getWeeklySummary } from '../../commands/summary/WeeklySummaryJob.js';
import { memorySystem }  from '../../memory/MemorySystem.js';
import { Logger }         from '../../core/Logger.js';
import { Embeds }         from '../shared/embedBuilder.js';
import {
  MODELS, safetySettings, DEFAULT_MODEL, GEMMA_MODELS,
  ENABLE_GEMMA, GEMMA_DEFAULT_MODEL,
  PDF_ENABLED_FOR_GEMINI, RAM_MEDIA_SUSPEND_THRESHOLD_MB,
  isGemmaModel
} from '../../modules/config.js';
import { typingManager, handleModelResponse } from './ResponseHandler.js';
import { prepareMessageContent, extractFileText } from './PromptBuilder.js';
import { processPromptAndMediaAttachments, isSupportedAttachment } from './MediaHandler.js';
import config from '../../config.js';
import { functionTools } from '../functions/FunctionRegistry.js';

const logger = Logger.get('MessageProcessor');

// ============================================================================
// CONSTANTS
// ============================================================================

const COLORS = Object.freeze({ ERROR: 0xFF0000, INFO: 0x5865F2 });

/** Maximum time (ms) a single queue item may run before it is forcibly cancelled. */
const PROCESSING_TIMEOUT_MS = 6 * 60 * 1_000; // 6 minutes

const CONTEXT_MARKERS = Object.freeze({
  QUEUED_MESSAGE: '[QUEUED MESSAGE',
  BATCH_SEPARATOR: '\n\n' + '='.repeat(50) + '\n\n'
});

// ── Gemini tools: built-in (server-side) + custom function declarations ──────
// Gemini 3 series supports combining built-in tools with function calling in a
// single request. Built-in tools run server-side (no extra round-trip needed).
// - googleSearch  → real-time web grounding
// - urlContext    → deep-read any URL the model finds or is given
// - codeExecution → run Python for maths/data tasks
// - functionDeclarations → Lumin's custom tools (memory, reminders, etc.)
//
// NOTE: tool combinations are Preview, Gemini 3 models only. The fallback
// model (gemini-2.5-flash) does NOT support mixing built-in tools with
// functionDeclarations — ResponseHandler strips them dynamically per-model.
const ALL_TOOLS = Object.freeze([
  { googleSearch:  {} },
  { urlContext:    {} },
  { codeExecution: {} },
  ...functionTools        // spreads the { functionDeclarations: [...] } object
]);

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Filter attachments based on model capabilities and current RAM pressure.
 *
 * Rules:
 *  - PDFs are stripped for Gemini when PDF_ENABLED_FOR_GEMINI = false
 *  - All media (images/video/audio) is stripped when RAM is above the
 *    safety threshold (isMediaSuspended()) to give the process room to breathe
 *
 * @param {object[]} attachments
 * @param {string}   modelName
 * @returns {object[]}
 */
function filterAttachments(attachments, modelName) {
  if (!attachments?.length) return attachments;

  // RAM safety guard — suspend all media processing when under pressure
  const ramMB = process.memoryUsage().rss / 1024 / 1024;
  if (RAM_MEDIA_SUSPEND_THRESHOLD_MB > 0 && ramMB > RAM_MEDIA_SUSPEND_THRESHOLD_MB) {
    logger.warn(`RAM pressure: ${Math.round(ramMB)}MB > ${RAM_MEDIA_SUSPEND_THRESHOLD_MB}MB — suspending media for this message`);
    return []; // drop all attachments to protect stability
  }

  // PDF filter — strip PDFs for Gemini models unless explicitly enabled
  if (!PDF_ENABLED_FOR_GEMINI && !isGemmaModel(modelName)) {
    return attachments.filter(att => {
      const name = (att.name || att.filename || '').toLowerCase();
      return !name.endsWith('.pdf') && att.contentType !== 'application/pdf';
    });
  }

  return attachments;
}

/**
 * Resolve effective settings, history ID, and model name for a message.
 * @param {string}  userId
 * @param {string|null} guildId
 * @param {string}  channelId
 * @returns {{ userSettings, serverSettings, effectiveSettings, historyId, modelName }}
 */
function resolveMessageContext(userId, guildId, channelId) {
  const userSettings   = state.userSettings[userId]    || {};
  const serverSettings = guildId ? (state.serverSettings[guildId] || {}) : {};
  const effectiveSettings = serverSettings.overrideUserSettings ? serverSettings : userSettings;

  const isServerHistory  = guildId ? (serverSettings.serverChatHistory  ?? DEFAULT_SERVER_SETTINGS.serverChatHistory) : false;
  const isChannelHistory = guildId ? !!state.channelWideChatHistory[channelId] : false;
  const historyId = isServerHistory ? guildId : (isChannelHistory ? channelId : userId);

  // ENABLE_GEMMA in config.js is a server-side master override.
  // When true, all chat conversations use GEMMA_DEFAULT_MODEL.
  // NOTE: Gemma is NOT applied to slash commands that need incompatible tools
  // (e.g. /search, /summary) — those contexts override modelName themselves.
  let modelName;
  if (ENABLE_GEMMA) {
    modelName = MODELS[GEMMA_DEFAULT_MODEL] || GEMMA_MODELS[0];
  } else {
    const gemmaEnabled  = effectiveSettings.gemmaEnabled ?? false;
    modelName = gemmaEnabled
      ? (MODELS[GEMMA_DEFAULT_MODEL] || GEMMA_MODELS[0])
      : (MODELS[effectiveSettings.selectedModel] || DEFAULT_MODEL);
  }

  return { userSettings, serverSettings, effectiveSettings, historyId, modelName };
}

/**
 * Build the system instruction string for a message context.
 * @param {import('discord.js').Message} message
 * @param {object} effectiveSettings
 * @param {object} serverSettings
 * @param {string} channelId
 * @param {string|null} guildId
 * @param {string} [extraSuffix]
 * @returns {string}
 */
async function buildSystemInstruction(message, effectiveSettings, serverSettings, channelId, guildId, extraSuffix = '') {
  let instructions = config.coreSystemRules;

  let customInstructions;
  if (guildId) {
    if (state.channelWideChatHistory[channelId]) {
      customInstructions = state.customInstructions[channelId];
    } else if (serverSettings.customPersonality) {
      customInstructions = serverSettings.customPersonality;
    } else if (effectiveSettings.customPersonality) {
      customInstructions = effectiveSettings.customPersonality;
    } else {
      customInstructions = state.customInstructions[message.author.id];
    }
  } else {
    customInstructions = effectiveSettings.customPersonality || state.customInstructions[message.author.id];
  }

  instructions += customInstructions
    ? `\n\nADDITIONAL PERSONALITY:\n${customInstructions}`
    : `\n\n${config.defaultPersonality}`;

  const userInfo = `Username: \`${message.author.username}\`\nDisplay Name: \`${message.author.displayName}\``;

  if (guildId) {
    instructions += `\nYou are currently engaging with users in the ${message.guild.name} Discord server.\n\n## Current User Information\n${userInfo}`;
  } else {
    instructions += `\n## Current User Information\n${userInfo}`;
  }

  // ── Weekly summary injection (Redis L1 ~1ms — zero RAG cost) ───────────────
  // Gives Lumin persistent baseline knowledge about the user so it never needs
  // to run RAG just to recall basic facts. Falls through silently if not ready.
  try {
    const weeklySummary = await getWeeklySummary(message.author.id);
    if (weeklySummary) {
      instructions += `\n\n## User Background (Weekly Summary)\n${weeklySummary}`;
    }
  } catch { /* non-fatal */ }

  if (extraSuffix) instructions += extraSuffix;

  return instructions;
}

/**
 * Return true if the attachment array contains at least one processable file.
 * @param {string} combinedText
 * @param {object[]} attachments
 * @returns {boolean}
 */
function hasAnyContent(combinedText, attachments) {
  if (combinedText.trim()) return true;
  return attachments.some(isSupportedAttachment);
}

/**
 * Race `promise` against a 6-minute hard deadline.
 *
 * If the deadline fires first:
 *  - Stops typing for the channel
 *  - Sends a timeout error embed to the user
 *  - Throws so the queue loop's catch block can shift the item and continue
 *
 * Works for both regular messages (message.reply) and slash-command
 * interactions (interaction.editReply) — caller passes the raw item so we
 * can pick the right reply surface.
 *
 * @param {Promise<void>}                                  promise    The handler promise to race
 * @param {import('discord.js').Message|import('discord.js').CommandInteraction} item  Original message/interaction
 * @param {string}                                         channelId  For typingManager.stop
 * @returns {Promise<void>}
 */
async function withProcessingTimeout(promise, item, channelId) {
  let timer;

  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('PROCESSING_TIMEOUT')), PROCESSING_TIMEOUT_MS);
  });

  try {
    await Promise.race([promise, timeoutPromise]);
  } catch (error) {
    if (error.message === 'PROCESSING_TIMEOUT') {
      logger.warn(`Processing timeout hit for channel ${channelId} — cancelling item`);
      typingManager.stop(channelId);

      const timeoutEmbed = new EmbedBuilder()
        .setColor(COLORS.ERROR)
        .setTitle('⏱️ Request Timed Out')
        .setDescription(
          "Your request took too long to process and was cancelled.\n" +
          "This can happen with large files, videos, or during high load.\n\n" +
          "Please try again — if this keeps happening, try splitting your request!"
        );

      try {
        // Slash-command interactions use editReply; messages use reply
        if (typeof item.editReply === 'function') {
          await item.editReply({ embeds: [timeoutEmbed] }).catch(() => {});
        } else if (typeof item.reply === 'function') {
          await item.reply({ embeds: [timeoutEmbed] }).catch(() => {});
        }
      } catch { /* swallow — best-effort */ }
    }
    throw error; // always re-throw so queue catch block shifts the item
  } finally {
    clearTimeout(timer);
  }
}

// ============================================================================
// ============================================================================

/**
 * Handle one Discord message: prepare content, resolve settings, get history,
 * and kick off the generation pipeline.
 *
 * @param {import('discord.js').Message} message
 */
export async function handleTextMessage(message) {
  const userId    = message.author.id;
  const guildId   = message.guild?.id;
  const channelId = message.channel.id;

  typingManager.start(message.channel);

  // ── Daily message limit (Gemini 3.1 Flash Lite: 500/day free tier) ────────
  const limitCheck = checkAndIncrementDailyMessages();
  if (!limitCheck.allowed) {
    typingManager.stop(channelId);
    const resetTime = new Date(limitCheck.resetAt).toUTCString();
    await message.reply({
      embeds: [Embeds.error('Daily Limit Reached',
        `Lumin has reached the 500 message/day limit for today.\nResets at: **${resetTime}**`
      )]
    }).catch(() => {});
    return;
  }

  try {
    // Update realive tracking
    if (guildId && state.realive?.[guildId]) {
      const rc = state.realive[guildId];
      if (rc.enabled && rc.lastChannelId !== channelId) {
        rc.lastChannelId = channelId;
        const { default: db } = await import('../../database.js');
        db.saveRealiveConfig(guildId, rc).catch(e => logger.error('Realive update failed', e));
      }
    }

    // ── Prepare message content (mentions, reply context, GIFs, etc.) ──
    const prepared = await prepareMessageContent(message);
    message = prepared.message; // may be a refetched version

    const allAttachments = prepared.allAttachments;

    if (!hasAnyContent(prepared.messageContent, allAttachments)) {
      typingManager.stop(channelId);
      await message.reply({
        embeds: [Embeds.info('💬 Empty Message', "You didn't provide any content. What would you like to talk about?")]
      });
      return;
    }

    // ── Poll / unsupported types ───────────────────────────────────────
    if (message.poll || message.type === 46) {
      typingManager.stop(channelId);
      return;
    }

    // ── Resolve context ────────────────────────────────────────────────
    const { effectiveSettings, serverSettings, historyId, modelName } =
      resolveMessageContext(userId, guildId, channelId);

    // ── Filter attachments based on model capabilities + RAM safety ───
    const filteredAttachments = filterAttachments(allAttachments, modelName);

    // ── Build Gemini parts array ───────────────────────────────────────
    const [fileExtractResult, initialParts] = await Promise.all([
      extractFileText(message, prepared.messageContent),
      processPromptAndMediaAttachments(prepared.messageContent, message, filteredAttachments, modelName)
    ]);

    const { finalPrompt, summaryParts } = fileExtractResult;
    let parts = initialParts;
    if (summaryParts?.length) parts.push(...summaryParts);

    const systemInstruction = await buildSystemInstruction(
      message, effectiveSettings, serverSettings, channelId, guildId
    );

    const history = await memorySystem.getOptimizedHistory(
      historyId, finalPrompt, modelName, userId, guildId
    );

    await handleModelResponse(
      null,
      modelName,
      systemInstruction,
      safetySettings,
      ALL_TOOLS,
      history,
      parts,
      message,
      channelId,
      historyId,
      effectiveSettings,
      finalPrompt,
      allAttachments
    );

  } catch (error) {
    logger.error('Unhandled error in handleTextMessage', error);
    typingManager.stop(channelId);
    try {
      await message.reply({
        embeds: [Embeds.error('Critical Error', 'An unexpected error occurred while processing your message. Please try again.')]
      });
    } catch { /* swallow */ }
  }
}

// ============================================================================
// BATCH MESSAGE HANDLER
// ============================================================================

/**
 * Handle multiple queued messages as a single combined generation turn.
 * Each message is individually tracked in history but sent as one unified prompt.
 *
 * @param {import('discord.js').Message[]} queuedMessages
 */
export async function handleBatchedMessages(queuedMessages) {
  const firstMessage = queuedMessages[0];
  const userId       = firstMessage.author.id;
  const guildId      = firstMessage.guild?.id;
  const channelId    = firstMessage.channel.id;

  typingManager.start(firstMessage.channel);

  try {
    // Prepare all messages in parallel
    const preparedMessages = await Promise.all(
      queuedMessages.map(msg => prepareMessageContent(msg))
    );

    // Combine all messages into one labelled prompt
    let combinedPrompt  = '';
    let allAttachments  = [];
    let allSummaryParts = [];

    for (let i = 0; i < preparedMessages.length; i++) {
      const prepared   = preparedMessages[i];
      const timestamp  = new Date(prepared.timestamp).toLocaleTimeString();
      const header     = `${CONTEXT_MARKERS.QUEUED_MESSAGE} #${i + 1} of ${preparedMessages.length} - Sent at ${timestamp}]:\n`;

      combinedPrompt += header + prepared.messageContent;
      if (i < preparedMessages.length - 1) combinedPrompt += CONTEXT_MARKERS.BATCH_SEPARATOR;

      allAttachments.push(...prepared.allAttachments);
      allSummaryParts.push(...prepared.summaryParts);
    }

    if (!hasAnyContent(combinedPrompt, allAttachments)) {
      typingManager.stop(channelId);
      await firstMessage.reply({
        embeds: [Embeds.info('💬 Empty Message', "You didn't provide any content. What would you like to talk about?")]
      });
      return;
    }

    const { effectiveSettings, serverSettings, historyId, modelName } =
      resolveMessageContext(userId, guildId, channelId);

    const filteredAttachments = filterAttachments(allAttachments, modelName);
    let parts = await processPromptAndMediaAttachments(combinedPrompt, firstMessage, filteredAttachments, modelName);
    if (allSummaryParts.length) parts.push(...allSummaryParts);

    const batchSuffix = `\n\nIMPORTANT: The user has sent ${preparedMessages.length} messages in quick succession. Each is labeled with its queue position and timestamp. Respond to ALL messages together in a natural, cohesive way.`;

    const systemInstruction = await buildSystemInstruction(
      firstMessage, effectiveSettings, serverSettings, channelId, guildId, batchSuffix
    );

    const history = await memorySystem.getOptimizedHistory(
      historyId, combinedPrompt, modelName, userId, guildId
    );

    await handleModelResponse(
      null,
      modelName,
      systemInstruction,
      safetySettings,
      ALL_TOOLS,
      history,
      parts,
      firstMessage,
      channelId,
      historyId,
      effectiveSettings,
      combinedPrompt,
      allAttachments,
      preparedMessages
    );

  } catch (error) {
    logger.error('Error in handleBatchedMessages', error);
    typingManager.stop(channelId);
    try {
      await firstMessage.reply({
        embeds: [Embeds.error('Critical Error', 'An unexpected error occurred while processing your message. Please try again.')]
      });
    } catch { /* swallow */ }
  }
}

// ============================================================================
// QUEUE PROCESSOR
// ============================================================================

/**
 * Drain the per-user message queue, processing items one at a time.
 * Multiple regular messages are batched together for efficiency.
 *
 * @param {string} userId
 */
export async function processUserQueue(userId) {
  const userQueueData = requestQueues.get(userId);
  if (!userQueueData) return;

  if (userQueueData.isProcessing) {
    logger.debug(`Queue for ${userId} already processing — skipping duplicate call`);
    return;
  }

  userQueueData.isProcessing = true;

  try {
    while (userQueueData.queue.length > 0) {
      const currentItem = userQueueData.queue[0];
      const channelId   = currentItem.channelId ?? currentItem.channel?.id;

      try {
        if (currentItem.isChatInputCommand?.()) {
          // Slash command (e.g. /search) — wrap with watchdog
          const { executeSearchInteraction } = await import('../../commands/search.js');
          await withProcessingTimeout(
            executeSearchInteraction(currentItem),
            currentItem,
            channelId
          );
          userQueueData.queue.shift();
        } else {
          // Collect all plain messages currently in the queue
          const queuedMessages = userQueueData.queue.filter(
            item => !item.isChatInputCommand?.()
          );

          if (queuedMessages.length > 1) {
            logger.debug(`Batching ${queuedMessages.length} queued messages for ${userId}`);
            await withProcessingTimeout(
              handleBatchedMessages(queuedMessages),
              queuedMessages[0],
              channelId
            );
            // Remove all processed plain messages, keep any slash commands
            userQueueData.queue = userQueueData.queue.filter(
              item => item.isChatInputCommand?.()
            );
          } else {
            await withProcessingTimeout(
              handleTextMessage(currentItem),
              currentItem,
              channelId
            );
            userQueueData.queue.shift();
          }
        }
      } catch (error) {
        logger.error(`Error processing queued item for ${userId}`, error);
        if (channelId) typingManager.stop(channelId);
        userQueueData.queue.shift();
      }
    }
  } finally {
    // Guaranteed cleanup — runs even if an unhandled error escapes all catch blocks
    userQueueData.isProcessing = false;
    requestQueues.delete(userId);
  }
}
