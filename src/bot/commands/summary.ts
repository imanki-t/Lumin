import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  TextChannel
} from 'discord.js';
import { Command } from './types.js';
import { AIRouter } from '@/core/ai/router.js';
import { AI_MODELS } from '@/config/constants.js';
import { LuminEmbedBuilder } from '@/bot/embeds/builder.js';

export const summaryCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('summary')
    .setDescription('Summarize recent channel conversation or a web link')
    .addIntegerOption((opt) =>
      opt
        .setName('count')
        .setDescription('Number of recent messages to analyze (10-100)')
        .setMinValue(10)
        .setMaxValue(100)
    )
    .addStringOption((opt) =>
      opt.setName('link').setDescription('URL or YouTube link to summarize')
    ),

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    await interaction.deferReply();

    const count = interaction.options.getInteger('count') || 50;
    const link = interaction.options.getString('link');

    const router = AIRouter.get();

    if (link) {
      try {
        const prompt = `Analyze and provide a structured summary for this link/content: ${link}
Format:
- **Title / Subject**
- **Executive Summary**
- **Key Takeaways (Bullet points)**`;

        const response = await router.generateContent(
          [{ role: 'user', parts: [{ text: prompt }] }],
          { model: AI_MODELS.FLASH, temperature: 0.3 }
        );

        const embed = LuminEmbedBuilder.brand({
          title: '📑 Content Summary',
          description: response.text.slice(0, 4000),
          user: interaction.user
        });

        await interaction.editReply({ embeds: [embed] });
      } catch (err: any) {
        await interaction.editReply({
          embeds: [LuminEmbedBuilder.error(`Failed to summarize link: ${err.message}`)]
        });
      }
      return;
    }

    // Channel message summarization
    const channel = interaction.channel;
    if (!channel || !channel.isTextBased()) {
      await interaction.editReply({
        embeds: [LuminEmbedBuilder.error('Summary can only be run in text channels.')]
      });
      return;
    }

    try {
      const fetched = await (channel as TextChannel).messages.fetch({ limit: count });
      const messageLogs = fetched
        .filter((m) => !m.author.bot && m.content.length > 0)
        .reverse()
        .map((m) => `${m.author.username} (${m.createdAt.toLocaleTimeString()}): ${m.cleanContent}`)
        .join('\n');

      if (!messageLogs) {
        await interaction.editReply({
          embeds: [LuminEmbedBuilder.warning('No recent text messages found to summarize.')]
        });
        return;
      }

      const prompt = `You are Lumin AI. Synthesize an intelligent summary of this Discord chat segment (${count} messages).
Analyze the discussions, decisions, funny moments, and key topics.

Chat Segment:
${messageLogs}

Format:
### 📌 Executive Summary
(1-2 clear sentences summarizing the overall chat)

### 💡 Key Discussions & Topics
(Bullet points with member mentions)

### 🎯 Decisions or Action Items
(If any, else skip)`;

      const response = await router.generateContent(
        [{ role: 'user', parts: [{ text: prompt }] }],
        { model: AI_MODELS.FLASH, temperature: 0.4 }
      );

      const embed = LuminEmbedBuilder.brand({
        title: `📑 Channel Summary (Past ${count} Messages)`,
        description: response.text.slice(0, 4000),
        user: interaction.user
      });

      await interaction.editReply({ embeds: [embed] });
    } catch (err: any) {
      await interaction.editReply({
        embeds: [LuminEmbedBuilder.error(`Failed generating summary: ${err.message}`)]
      });
    }
  }
};
