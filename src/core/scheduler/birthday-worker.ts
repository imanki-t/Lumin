import { Client, TextChannel } from 'discord.js';
import { birthdayRepo } from '@/core/database/repositories/index.js';
import { AIRouter } from '@/core/ai/router.js';
import { AI_MODELS } from '@/config/constants.js';
import { LuminEmbedBuilder } from '@/bot/embeds/builder.js';
import { Logger } from '@/core/logger/index.js';

const logger = Logger.get('BirthdayWorker');

export class BirthdayWorker {
  public static async processBirthdays(client: Client): Promise<void> {
    const today = new Date();
    const month = today.getUTCMonth() + 1;
    const day = today.getUTCDate();

    const birthdays = await birthdayRepo.findBirthdaysByDate(month, day);
    if (birthdays.length === 0) return;

    logger.info(`Found ${birthdays.length} birthdays today (${month}/${day})`);
    const router = AIRouter.get();

    for (const bday of birthdays) {
      if (!bday.guildId) continue;

      try {
        const guild = await client.guilds.fetch(bday.guildId).catch(() => null);
        if (!guild) continue;

        const member = await guild.members.fetch(bday.userId).catch(() => null);
        if (!member) continue;

        // Choose announcement channel or default system channel
        const channel =
          guild.systemChannel ||
          guild.channels.cache.find((c) => c.isTextBased());

        if (!channel || !channel.isTextBased()) continue;

        // Generate personalized celebratory AI wish
        const prompt = `Write a joyful, warm, and uplifting 2-sentence birthday announcement message for ${member.displayName} celebrating their special day in a Discord community.`;
        const aiResponse = await router.generateContent(
          [{ role: 'user', parts: [{ text: prompt }] }],
          { model: AI_MODELS.FLASH_LITE, temperature: 0.8 }
        );

        const embed = LuminEmbedBuilder.brand({
          title: `🎉 Happy Birthday, ${member.displayName}! 🎂`,
          description: `${aiResponse.text}\n\nJoin us in wishing them an incredible year ahead!`
        }).setColor(0xff73fa);

        await (channel as TextChannel).send({
          content: `🎈 <@${member.id}>`,
          embeds: [embed]
        });
      } catch (err: any) {
        logger.error(`Error announcing birthday for user ${bday.userId}`, err);
      }
    }
  }
}
