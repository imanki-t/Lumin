import {
  SlashCommandBuilder,
  ChatInputCommandInteraction
} from 'discord.js';
import { Command } from './types.js';
import { AIRouter } from '@/core/ai/router.js';
import { AI_MODELS } from '@/config/constants.js';
import { LuminEmbedBuilder } from '@/bot/embeds/builder.js';
import { MediaProcessor } from '@/bot/media/processor.js';

export const searchCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('search')
    .setDescription('Search the web or analyze documents with Gemini AI')
    .addStringOption((opt) =>
      opt.setName('query').setDescription('The search question or topic to research').setRequired(true)
    )
    .addAttachmentOption((opt) =>
      opt.setName('file').setDescription('Optional image, PDF, or document to analyze alongside the search')
    ),

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    await interaction.deferReply();

    const query = interaction.options.getString('query', true);
    const attachment = interaction.options.getAttachment('file');

    const router = AIRouter.get();
    const parts: any[] = [{ text: `User search query: ${query}\nProvide a comprehensive, accurate answer with sources if applicable.` }];

    if (attachment) {
      const media = await MediaProcessor.processAttachment(attachment);
      if (media.inlineData) {
        parts.push({ inlineData: media.inlineData });
      } else if (media.textContent) {
        parts.push({ text: `Attached Document Content:\n${media.textContent}` });
      }
    }

    try {
      const result = await router.generateContent(
        [{ role: 'user', parts }],
        {
          model: AI_MODELS.FLASH,
          temperature: 0.3
        }
      );

      const embed = LuminEmbedBuilder.brand({
        title: `🔍 Search Results: ${query.slice(0, 80)}`,
        description: result.text.slice(0, 4000),
        user: interaction.user
      });

      await interaction.editReply({ embeds: [embed] });
    } catch (err: any) {
      await interaction.editReply({
        embeds: [LuminEmbedBuilder.error(`Failed to execute search: ${err.message}`)]
      });
    }
  }
};
