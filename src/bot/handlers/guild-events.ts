import { Guild, TextChannel } from 'discord.js';
import { guildRepo } from '@/core/database/repositories/index.js';
import { LuminEmbedBuilder } from '@/bot/embeds/builder.js';
import { Logger } from '@/core/logger/index.js';

const logger = Logger.get('GuildEventsHandler');

export class GuildEventsHandler {
  public static async onGuildCreate(guild: Guild): Promise<void> {
    logger.info(`Joined new guild: ${guild.name} (ID: ${guild.id}, Members: ${guild.memberCount})`);

    try {
      // Ensure guild settings record exists
      await guildRepo.getSettings(guild.id);

      // Send welcome embed to system channel or first readable text channel
      const targetChannel =
        guild.systemChannel ||
        guild.channels.cache.find((c) => c.isTextBased() && c.permissionsFor(guild.members.me!)?.has('SendMessages'));

      if (targetChannel && targetChannel.isTextBased()) {
        const welcomeEmbed = LuminEmbedBuilder.brand({
          title: '✨ Welcome to Lumin AI!',
          description:
            `Hello **${guild.name}**! I am **Lumin**, your intelligent AI companion powered by Google Gemini 3.5 & Gemma.\n\n` +
            `### 🚀 Getting Started\n` +
            `• **Chat with me**: Mention <@${guild.client.user.id}> anywhere or reply directly in conversations.\n` +
            `• **Configure**: Use \`/settings server\` to adjust server preferences, reaction roulette, and revival.\n` +
            `• **Play Games**: Try \`/game akinator\`, \`/game truth_dare\`, or \`/game would_you_rather\`.\n` +
            `• **Productivity**: Use \`/summary\`, \`/reminder\`, \`/birthday\`, and \`/quote\`.\n\n` +
            `*All slash commands are registered and ready to use!*`
        });

        await (targetChannel as TextChannel).send({ embeds: [welcomeEmbed] }).catch(() => null);
      }
    } catch (err: any) {
      logger.error(`Error during onGuildCreate for guild ${guild.id}`, err);
    }
  }

  public static async onGuildDelete(guild: Guild): Promise<void> {
    logger.info(`Left guild: ${guild.name} (ID: ${guild.id})`);
  }
}
