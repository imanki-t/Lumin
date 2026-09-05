import {
  SlashCommandBuilder,
  ChatInputCommandInteraction
} from 'discord.js';
import { Command } from './types.js';
import { AIRouter } from '@/core/ai/router.js';
import { AI_MODELS } from '@/config/constants.js';
import { LuminEmbedBuilder } from '@/bot/embeds/builder.js';

export const complimentCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('compliment')
    .setDescription('Send a thoughtful, personalized AI compliment to a friend')
    .addUserOption((opt) =>
      opt.setName('user').setDescription('The person to compliment').setRequired(true)
    )
    .addBooleanOption((opt) =>
      opt.setName('anonymous').setDescription('Send anonymously via DM or hidden sender (Default: false)')
    ),

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const targetUser = interaction.options.getUser('user', true);
    const isAnonymous = interaction.options.getBoolean('anonymous') || false;

    if (targetUser.id === interaction.client.user.id) {
      await interaction.reply({
        content: 'Aww, thank you! But I think you deserve all the appreciation today! ✨',
        ephemeral: true
      });
      return;
    }

    await interaction.deferReply({ ephemeral: isAnonymous });

    const router = AIRouter.get();
    const prompt = `Generate a genuine, unique, uplifting, and wholesome compliment for ${targetUser.username}.
Make it heartwarming, memorable, and creative (1-2 sentences). Do not use generic cliches.`;

    try {
      const response = await router.generateContent(
        [{ role: 'user', parts: [{ text: prompt }] }],
        { model: AI_MODELS.FLASH_LITE, temperature: 0.85 }
      );

      const embed = LuminEmbedBuilder.brand({
        title: '💖 A Special Compliment For You!',
        description: `**${targetUser.username}**, ${response.text.trim()}`,
        user: isAnonymous ? undefined : interaction.user
      }).setColor(0xff69b4);

      if (isAnonymous) {
        // Attempt to DM target user or send in channel anonymously
        try {
          await targetUser.send({ embeds: [embed] });
          await interaction.editReply({
            content: `Your anonymous compliment was delivered to **${targetUser.username}** via DM! 💌`
          });
        } catch {
          // If DMs closed, send in channel without author
          if (interaction.channel && interaction.channel.isTextBased()) {
            await (interaction.channel as any).send({
              content: `<@${targetUser.id}> Someone in this server sent you an anonymous compliment!`,
              embeds: [embed]
            });
            await interaction.editReply({
              content: `Their DMs were closed, so the anonymous compliment was posted in the channel without naming you!`
            });
          }
        }
      } else {
        await interaction.editReply({
          content: `<@${targetUser.id}>`,
          embeds: [embed]
        });
      }
    } catch (err: any) {
      await interaction.editReply({
        embeds: [LuminEmbedBuilder.error(`Could not generate compliment: ${err.message}`)]
      });
    }
  }
};
