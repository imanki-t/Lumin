import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  ChannelType,
  PermissionFlagsBits
} from 'discord.js';
import { Command } from './types.js';
import { quoteRepo } from '@/core/database/repositories/index.js';
import { AIRouter } from '@/core/ai/router.js';
import { AI_MODELS } from '@/config/constants.js';
import { LuminEmbedBuilder } from '@/bot/embeds/builder.js';

export const quoteCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('quote')
    .setDescription('Fetch an inspirational quote or schedule daily quotes for the channel')
    .addSubcommand((sub) =>
      sub.setName('fetch').setDescription('Get an immediate inspirational quote')
    )
    .addSubcommand((sub) =>
      sub
        .setName('schedule')
        .setDescription('Schedule daily inspirational quote delivery (Admin only)')
        .addChannelOption((opt) =>
          opt
            .setName('channel')
            .setDescription('Target text channel')
            .setRequired(true)
            .addChannelTypes(ChannelType.GuildText)
        )
    )
    .addSubcommand((sub) =>
      sub.setName('cancel').setDescription('Cancel daily quote deliveries in this server (Admin only)')
    ),

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const sub = interaction.options.getSubcommand();

    if (sub === 'fetch') {
      await interaction.deferReply();
      const router = AIRouter.get();
      const prompt = `Generate an inspiring, deeply philosophical, or motivational quote suitable for a community. Include author/thinker attribution.
Format:
"Quote text" — *Author*`;

      try {
        const response = await router.generateContent(
          [{ role: 'user', parts: [{ text: prompt }] }],
          { model: AI_MODELS.FLASH_LITE, temperature: 0.8 }
        );

        const embed = LuminEmbedBuilder.brand({
          title: '✨ Daily Inspiration',
          description: response.text.trim(),
          user: interaction.user
        }).setColor(0xf1c40f);

        await interaction.editReply({ embeds: [embed] });
      } catch (err: any) {
        await interaction.editReply({
          embeds: [LuminEmbedBuilder.error(`Failed to generate quote: ${err.message}`)]
        });
      }
      return;
    }

    if (sub === 'schedule') {
      if (!interaction.guildId || !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
        await interaction.reply({
          embeds: [LuminEmbedBuilder.error('You need `Manage Server` permission to schedule daily quotes.')],
          ephemeral: true
        });
        return;
      }

      const channel = interaction.options.getChannel('channel', true);
      await quoteRepo.setSchedule({
        guildId: interaction.guildId,
        channelId: channel.id,
        hourUtc: 8,
        active: true
      });

      await interaction.reply({
        embeds: [
          LuminEmbedBuilder.success(
            `Daily inspirational quotes will be delivered to <#${channel.id}> every day at 08:00 UTC.`,
            'Quote Schedule Activated'
          )
        ]
      });
      return;
    }

    if (sub === 'cancel') {
      if (!interaction.guildId || !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
        await interaction.reply({
          embeds: [LuminEmbedBuilder.error('You need `Manage Server` permission.')],
          ephemeral: true
        });
        return;
      }

      await quoteRepo.deleteSchedule(interaction.guildId);
      await interaction.reply({
        embeds: [LuminEmbedBuilder.success('Daily quote schedule cancelled for this server.')]
      });
    }
  }
};
