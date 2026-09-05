import {
  SlashCommandBuilder,
  ChatInputCommandInteraction
} from 'discord.js';
import { Command } from './types.js';
import { AIRouter } from '@/core/ai/router.js';
import { AI_MODELS } from '@/config/constants.js';

export const starterCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('starter')
    .setDescription('Generate an AI conversation starter to get people talking')
    .addStringOption((opt) =>
      opt.setName('topic').setDescription('Optional topic or theme (e.g. gaming, philosophy, hot takes, food)')
    ),

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    await interaction.deferReply();
    const topic = interaction.options.getString('topic');

    const router = AIRouter.get();
    const prompt = topic
      ? `Generate a fun, intriguing, or spicy question/conversation starter about "${topic}" for a Discord group. Keep it to 1-2 sentences. Make it debate-worthy or fun.`
      : `Generate a fun, thought-provoking, or controversial (low-stakes) conversation starter for a Discord channel. Keep it to 1-2 sentences.`;

    try {
      const response = await router.generateContent(
        [{ role: 'user', parts: [{ text: prompt }] }],
        { model: AI_MODELS.FLASH_LITE, temperature: 0.9 }
      );

      await interaction.editReply({
        content: `💬 **Conversation Starter:**\n> ${response.text.trim()}`
      });
    } catch (err: any) {
      await interaction.editReply({
        content: '💬 **Conversation Starter:**\n> What is a food opinion that would get your cooking license revoked immediately?'
      });
    }
  }
};
