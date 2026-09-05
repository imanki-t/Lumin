import { Message, TextChannel, ChannelType } from 'discord.js';
import { env } from '@/config/env.js';
import { BOT_LIMITS } from '@/config/constants.js';
import { UserMessageQueue } from '@/core/queue/message-queue.js';
import { userRepo, guildRepo } from '@/core/database/repositories/index.js';
import { MemoryContinuityPipeline } from '@/core/memory/continuity.js';
import { DialogueSummarizer } from '@/core/memory/summarizer.js';
import { AdaptivePersonalizationEngine } from '@/core/memory/personalization.js';
import { AIRouter, ConversationTurn } from '@/core/ai/router.js';
import { MediaProcessor } from '@/bot/media/processor.js';
import { LuminButtons } from '@/bot/components/buttons.js';
import { LuminEmbedBuilder } from '@/bot/embeds/builder.js';
import { Logger } from '@/core/logger/index.js';

const logger = Logger.get('MessageCreateHandler');

export class MessageCreateHandler {
  public static async handle(message: Message): Promise<void> {
    // Ignore bot's own messages and other bots
    if (message.author.bot || !message.client.user) return;

    const botId = message.client.user.id;
    const isDM = message.channel.type === ChannelType.DM;
    const isMentioned = message.mentions.has(botId);

    // Guild specific checks
    let guildSettings = null;
    if (message.guildId) {
      guildSettings = await guildRepo.getSettings(message.guildId);

      // Check user blacklist
      if (guildSettings.blacklistedUsers?.includes(message.author.id)) {
        return;
      }

      // Reaction roulette check
      if (guildSettings.rouletteEnabled && Math.random() * 100 < (guildSettings.rouletteRarity || 5)) {
        const emojis = ['✨', '🔥', '👀', '💡', '🤖', '🎉', '🧠', '⭐'];
        const randomEmoji = emojis[Math.floor(Math.random() * emojis.length)]!;
        message.react(randomEmoji).catch(() => null);
      }
    }

    const userSettings = await userRepo.getSettings(message.author.id);
    const continuousReply = userSettings.continuousReply;

    // Check if message is addressed to Lumin
    const shouldRespond = isDM || isMentioned || continuousReply;
    if (!shouldRespond) return;

    // Clean bot mention from message text
    let cleanPrompt = message.cleanContent.replace(new RegExp(`@${message.client.user.username}`, 'gi'), '').trim();

    // Attachments processing
    const mediaPayloads: any[] = [];
    if (message.attachments.size > 0) {
      for (const attachment of message.attachments.values()) {
        const processed = await MediaProcessor.processAttachment(attachment);
        if (processed.inlineData) {
          mediaPayloads.push({ inlineData: processed.inlineData });
        } else if (processed.textContent) {
          cleanPrompt += `\n\n[Attached File "${processed.filename}"]:\n${processed.textContent}`;
        }
      }
    }

    if (!cleanPrompt && mediaPayloads.length === 0) {
      return; // Empty message
    }

    // Context identifier: channelId for server conversations, userId for DMs
    const contextId = isDM ? message.author.id : message.channelId;

    // Dispatch to per-user queue to guarantee turn order and prevent spam
    await UserMessageQueue.get().enqueue(message.author.id, async () => {
      await MessageCreateHandler.processTurn(
        message,
        contextId,
        cleanPrompt,
        mediaPayloads,
        userSettings,
        guildSettings
      );
    });
  }

  private static async processTurn(
    message: Message,
    contextId: string,
    promptText: string,
    mediaPayloads: any[],
    userSettings: any,
    guildSettings: any
  ): Promise<void> {
    try {
      // Show typing indicator in channel
      if ('sendTyping' in message.channel) {
        await message.channel.sendTyping().catch(() => null);
      }

      const continuity = MemoryContinuityPipeline.get();
      const personalization = AdaptivePersonalizationEngine.get();
      const aiRouter = AIRouter.get();

      // 1. Fetch sub-50ms active sliding window from Redis
      const slidingWindow = await continuity.getSlidingWindow(contextId);

      // 2. Fetch rolling summary for older context
      const rollingSummary = await continuity.getRollingSummary(contextId);

      // 3. Synthesize dynamic system prompt with user personas & server facts
      const systemInstruction = await personalization.buildSystemPrompt({
        userId: message.author.id,
        userName: message.author.displayName || message.author.username,
        guildId: message.guildId || undefined,
        contextSummary: rollingSummary || undefined,
        preferredTone: userSettings.customTone
      });

      // 4. Assemble turn payload
      const userTurnParts: any[] = [];
      if (promptText) userTurnParts.push({ text: promptText });
      userTurnParts.push(...mediaPayloads);

      const conversationPayload: ConversationTurn[] = [
        ...slidingWindow,
        { role: 'user', parts: userTurnParts }
      ];

      // 5. Model routing selection
      const targetModel =
        guildSettings?.overrideUserSettings && guildSettings?.preferredModel
          ? guildSettings.preferredModel
          : userSettings.preferredModel;

      // 6. Generate AI response
      let streamedResponse = '';
      let initialReplyMessage: Message | null = null;
      let lastEditTime = Date.now();

      const result = await aiRouter.generateContent(conversationPayload, {
        model: targetModel,
        systemInstruction,
        toolContext: {
          guildId: message.guildId || undefined,
          channelId: message.channelId,
          userId: message.author.id,
          userName: message.author.username
        },
        onTokenChunk: async (chunk: string) => {
          streamedResponse += chunk;
          const now = Date.now();

          // Discord rate limit guard: Edit message at most once every 1200ms
          if (now - lastEditTime > 1200 && streamedResponse.length > 20) {
            lastEditTime = now;
            const preview = streamedResponse.slice(0, 1950);

            if (!initialReplyMessage) {
              initialReplyMessage = await message.reply({ content: preview }).catch(() => null);
            } else {
              await initialReplyMessage.edit({ content: preview }).catch(() => null);
            }
          }
        }
      });

      const finalText = result.text.trim();
      const actionRow = LuminButtons.responseActions(contextId, message.author.id);

      // 7. Deliver final response
      const existingReply = initialReplyMessage as Message | null;
      if (existingReply) {
        if (finalText.length <= BOT_LIMITS.DISCORD_MESSAGE_MAX_CHARS) {
          await existingReply.edit({
            content: finalText,
            components: [actionRow]
          });
        } else {
          // Split into multiple chunks if exceeding 2000 chars
          const chunks = splitIntoChunks(finalText, 1950);
          await existingReply.edit({ content: chunks[0]! });
          for (let i = 1; i < chunks.length; i++) {
            const isLast = i === chunks.length - 1;
            await (message.channel as any).send({
              content: chunks[i]!,
              components: isLast ? [actionRow] : []
            });
          }
        }
      } else {
        if (finalText.length <= BOT_LIMITS.DISCORD_MESSAGE_MAX_CHARS) {
          await message.reply({
            content: finalText,
            components: [actionRow]
          });
        } else {
          const chunks = splitIntoChunks(finalText, 1950);
          for (let i = 0; i < chunks.length; i++) {
            const isLast = i === chunks.length - 1;
            if (i === 0) {
              await message.reply({ content: chunks[i]! });
            } else {
              await (message.channel as any).send({
                content: chunks[i]!,
                components: isLast ? [actionRow] : []
              });
            }
          }
        }
      }

      // 8. Commit turns to active sliding window (LPUSH in Redis)
      await continuity.appendTurn(contextId, 'user', promptText, {
        senderId: message.author.id,
        senderName: message.author.username
      });

      const turnCount = await continuity.appendTurn(contextId, 'model', finalText);

      // 9. Asynchronous rolling summarization if threshold reached
      if (turnCount >= 10) {
        DialogueSummarizer.get().triggerAsyncSummary(contextId, slidingWindow).catch((e) =>
          logger.warn(`Async summary failed for context ${contextId}`, e)
        );
      }
    } catch (err: any) {
      logger.error('Error in message turn pipeline', err);
      const embed = LuminEmbedBuilder.error(
        `I encountered an issue generating a response: ${err.message || 'Upstream service error'}\nPlease try again in a moment.`
      );
      await message.reply({ embeds: [embed] }).catch(() => null);
    }
  }
}

function splitIntoChunks(str: string, size: number): string[] {
  const chunks: string[] = [];
  let i = 0;
  while (i < str.length) {
    chunks.push(str.slice(i, i + size));
    i += size;
  }
  return chunks;
}
