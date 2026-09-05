import { Client, TextChannel } from 'discord.js';
import { guildRepo } from '@/core/database/repositories/index.js';
import { AIRouter } from '@/core/ai/router.js';
import { AI_MODELS } from '@/config/constants.js';
import { Logger } from '@/core/logger/index.js';

const logger = Logger.get('RevivalWorker');

export class RevivalWorker {
  public static async processGuildRevival(client: Client): Promise<void> {
    const guilds = await guildRepo.findAllReviveEligible();
    if (guilds.length === 0) return;

    const router = AIRouter.get();

    for (const settings of guilds) {
      if (!settings.reviveEnabled || !settings.reviveIntervalHours) continue;

      try {
        const guild = await client.guilds.fetch(settings.guildId).catch(() => null);
        if (!guild) continue;

        // Target designated channel or system channel
        const channelId = settings.allowedChannels?.[0] || guild.systemChannelId;
        if (!channelId) continue;

        const channel = await guild.channels.fetch(channelId).catch(() => null);
        if (!channel || !channel.isTextBased()) continue;

        const textChannel = channel as TextChannel;
        const messages = await textChannel.messages.fetch({ limit: 1 }).catch(() => null);
        const lastMessage = messages?.first();

        const now = Date.now();
        const intervalMs = settings.reviveIntervalHours * 3600 * 1000;

        if (lastMessage && now - lastMessage.createdTimestamp < intervalMs) {
          continue; // Channel has recent activity
        }

        // Generate engaging conversation starter
        const prompt = `You are Lumin, a lively, intelligent AI companion in Discord. The channel has been quiet. Generate an intriguing, fun question or thought-provoking discussion starter to re-engage the community. Keep it conversational and friendly (1-2 sentences).`;

        const response = await router.generateContent(
          [{ role: 'user', parts: [{ text: prompt }] }],
          { model: AI_MODELS.FLASH_LITE, temperature: 0.9 }
        );

        await textChannel.send({ content: `💬 ${response.text.trim()}` });
        await guildRepo.updateLastRevive(settings.guildId);
        logger.info(`Sent revival message to guild ${guild.name} (#${textChannel.name})`);
      } catch (err: any) {
        logger.error(`Failed executing revival for guild ${settings.guildId}`, err);
      }
    }
  }
}
