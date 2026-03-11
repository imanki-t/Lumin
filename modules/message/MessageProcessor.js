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
  requestQueues,          // BUG FIX: was state.requestQueues throughout original
  BOT_CONFIG,
  DEFAULT_SERVER_SETTINGS,
  DEFAULT_USER_SETTINGS
} from '../../managers/BotManager.js';
import { memorySystem }  from '../../memory/MemorySystem.js';
import { Logger }         from '../../core/Logger.js';
import { Embeds }         from '../shared/embedBuilder.js';
import { MODELS, safetySettings, DEFAULT_MODEL } from '../../modules/config.js';
import { typingManager, handleModelResponse } from './ResponseHandler.js';
import { prepareMessageContent, extractFileText } from './PromptBuilder.js';
import { processPromptAndMediaAttachments, isSupportedAttachment } from './MediaHandler.js';
import config from '../../config.js';

const logger = Logger.get('MessageProcessor');

// ============================================================================
// CONSTANTS
// ============================================================================

const COLORS = Object.freeze({ ERROR: 0xFF0000, INFO: 0x5865F2 });

const CONTEXT_MARKERS = Object.freeze({
  QUEUED_MESSAGE: '[QUEUED MESSAGE',
  BATCH_SEPARATOR: '\n\n' + '='.repeat(50) + '\n\n'
});

// All tools enabled per turn — model decides which to invoke
const ALL_TOOLS = Object.freeze([
  { googleSearch: {} },
  { urlContext:   {} },
  { codeExecution: {} }
]);

// ============================================================================
// HELPERS
// ============================================================================

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

  const selectedModel = effectiveSettings.selectedModel || DEFAULT_MODEL;
  const modelName     = MODELS[selectedModel];

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
function buildSystemInstruction(message, effectiveSettings, serverSettings, channelId, guildId, extraSuffix = '') {
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

// ============================================================================
// SINGLE MESSAGE HANDLER
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

    // ── Build Gemini parts array ───────────────────────────────────────
    const [fileExtractResult, initialParts] = await Promise.all([
      extractFileText(message, prepared.messageContent),
      processPromptAndMediaAttachments(prepared.messageContent, message, allAttachments)
    ]);

    const { finalPrompt, summaryParts } = fileExtractResult;
    let parts = initialParts;
    if (summaryParts?.length) parts.push(...summaryParts);

    // ── Resolve context ────────────────────────────────────────────────
    const { effectiveSettings, serverSettings, historyId, modelName } =
      resolveMessageContext(userId, guildId, channelId);

    const systemInstruction = buildSystemInstruction(
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

    let parts = await processPromptAndMediaAttachments(combinedPrompt, firstMessage, allAttachments);
    if (allSummaryParts.length) parts.push(...allSummaryParts);

    const { effectiveSettings, serverSettings, historyId, modelName } =
      resolveMessageContext(userId, guildId, channelId);

    const batchSuffix = `\n\nIMPORTANT: The user has sent ${preparedMessages.length} messages in quick succession. Each is labeled with its queue position and timestamp. Respond to ALL messages together in a natural, cohesive way.`;

    const systemInstruction = buildSystemInstruction(
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
  // BUG FIX: original used state.requestQueues — now uses direct import
  const userQueueData = requestQueues.get(userId);
  if (!userQueueData) return;

  if (userQueueData.isProcessing) {
    logger.debug(`Queue for ${userId} already processing — skipping duplicate call`);
    return;
  }

  userQueueData.isProcessing = true;

  while (userQueueData.queue.length > 0) {
    const currentItem = userQueueData.queue[0];

    try {
      if (currentItem.isChatInputCommand?.()) {
        // Slash command queued via the old search path
        const { executeSearchInteraction } = await import('../../commands/search.js');
        await executeSearchInteraction(currentItem);
        userQueueData.queue.shift();
      } else {
        // Collect all plain messages currently in the queue
        const queuedMessages = userQueueData.queue.filter(
          item => !item.isChatInputCommand?.()
        );

        if (queuedMessages.length > 1) {
          logger.debug(`Batching ${queuedMessages.length} queued messages for ${userId}`);
          await handleBatchedMessages(queuedMessages);
          // Remove all processed plain messages, keep any slash commands
          userQueueData.queue = userQueueData.queue.filter(
            item => item.isChatInputCommand?.()
          );
        } else {
          await handleTextMessage(currentItem);
          userQueueData.queue.shift();
        }
      }
    } catch (error) {
      logger.error(`Error processing queued item for ${userId}`, error);
      if (currentItem.channel) typingManager.stop(currentItem.channel.id);
      userQueueData.queue.shift();
    }
  }

  userQueueData.isProcessing = false;
  // BUG FIX: original used state.requestQueues.delete — now uses direct import
  requestQueues.delete(userId);
}
