import { Client, TextChannel } from 'discord.js';
import { quoteRepo } from '@/core/database/repositories/index.js';
import { AIRouter } from '@/core/ai/router.js';
import { AI_MODELS } from '@/config/constants.js';
import { LuminEmbedBuilder } from '@/bot/embeds/builder.js';
import { Logger } from '@/core/logger/index.js';

const logger = Logger.get('QuoteWorker');

export class QuoteWorker {
  public static async processScheduledQuotes(client: Client): Promise<void> {
    const schedules = await quoteRepo.findActiveSchedules();
    if (schedules.length === 0) return;

    const router = AIRouter.get();

    for (const schedule of schedules) {
      if (!schedule.channelId) continue;
      try {
        const channel = await client.channels.fetch(schedule.channelId).catch(() => null);
        if (!channel || !channel.isTextBased()) continue;

        // Generate daily inspirational quote
        const prompt = `Generate an inspiring, deeply philosophical, or motivational quote suitable for Discord community members. Include author/thinker attribution.
Format:
"Quote text" — *Author*`;

        const response = await router.generateContent(
          [{ role: 'user', parts: [{ text: prompt }] }],
          { model: AI_MODELS.FLASH_LITE, temperature: 0.8 }
        );

        const embed = LuminEmbedBuilder.brand({
          title: '✨ Daily Inspiration',
          description: response.text.trim()
        }).setColor(0xf1c40f);

        await (channel as TextChannel).send({ embeds: [embed] });
        await quoteRepo.updateLastSent(schedule.id, new Date().toISOString().split('T')[0]!);
      } catch (err: any) {
        logger.error(`Failed delivering scheduled quote to channel ${schedule.channelId}`, err);
      }
    }
  }
}
