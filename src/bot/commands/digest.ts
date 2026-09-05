import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  TextChannel
} from 'discord.js';
import { Command } from './types.js';
import { AIRouter } from '@/core/ai/router.js';
import { AI_MODELS } from '@/config/constants.js';
import { LuminEmbedBuilder } from '@/bot/embeds/builder.js';

export const digestCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('digest')
    .setDescription('Generate an AI activity digest of recent server discussions')
    .addIntegerOption((opt) =>
      opt
        .setName('hours')
        .setDescription('Hours of activity to digest (1-24)')
        .setMinValue(1)
        .setMaxValue(24)
    ),

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!interaction.guild) {
      await interaction.reply({
        embeds: [LuminEmbedBuilder.error('Digest can only be run in a server.')],
        ephemeral: true
      });
      return;
    }

    await interaction.deferReply();
    const hours = interaction.options.getInteger('hours') || 12;
    const cutoff = Date.now() - hours * 3600 * 1000;

    // Fetch messages from current channel or top readable channels
    const channel = interaction.channel as TextChannel;
    let messages: string[] = [];

    try {
      const fetched = await channel.messages.fetch({ limit: 100 });
      for (const m of fetched.values()) {
        if (!m.author.bot && m.createdTimestamp >= cutoff && m.content.length > 5) {
          messages.push(`${m.author.username}: ${m.cleanContent}`);
        }
      }
    } catch {
      // Fallback
    }

    if (messages.length < 5) {
      await interaction.editReply({
        embeds: [LuminEmbedBuilder.warning(`Not enough chat activity in the past ${hours} hours to produce a digest.`)]
      });
      return;
    }

    const router = AIRouter.get();
    const prompt = `You are Lumin, summarizing server conversations from the past ${hours} hours.
Produce an energetic, well-structured Community Digest:

Conversations:
${messages.slice(0, 70).join('\n')}

Format:
📰 **The Headline** (Catchy summary title)
🔥 **Hot Topics & Highlights** (Key discussions)
💬 **Quote of the Day / Funniest Moment**
🏆 **Vibe Check** (1 sentence summarizing community mood)`;

    try {
      const response = await router.generateContent(
        [{ role: 'user', parts: [{ text: prompt }] }],
        { model: AI_MODELS.FLASH, temperature: 0.5 }
      );

      const embed = LuminEmbedBuilder.brand({
        title: `📰 Server Digest (Past ${hours}h)`,
        description: response.text.slice(0, 4000),
        user: interaction.user
      });

      await interaction.editReply({ embeds: [embed] });
    } catch (err: any) {
      await interaction.editReply({
        embeds: [LuminEmbedBuilder.error(`Failed to generate digest: ${err.message}`)]
      });
    }
  }
};
