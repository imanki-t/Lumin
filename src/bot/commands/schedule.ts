import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  ChannelType,
  PermissionFlagsBits
} from 'discord.js';
import { Command } from './types.js';
import { guildRepo } from '@/core/database/repositories/index.js';
import { LuminEmbedBuilder } from '@/bot/embeds/builder.js';

export const scheduleCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('schedule')
    .setDescription('Configure automated background schedules and channel revival (Admin only)')
    .addSubcommand((sub) =>
      sub
        .setName('revival')
        .setDescription('Configure automated conversation revival messages when a channel is inactive')
        .addBooleanOption((opt) => opt.setName('enable').setDescription('Enable or disable revival').setRequired(true))
        .addIntegerOption((opt) =>
          opt
            .setName('interval_hours')
            .setDescription('Hours of inactivity before sending a starter (e.g. 6, 12, 24)')
            .setMinValue(2)
            .setMaxValue(72)
        )
        .addChannelOption((opt) =>
          opt
            .setName('channel')
            .setDescription('Designated channel for revival messages')
            .addChannelTypes(ChannelType.GuildText)
        )
    ),

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!interaction.guildId || !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      await interaction.reply({
        embeds: [LuminEmbedBuilder.error('You need `Manage Server` permission.')],
        ephemeral: true
      });
      return;
    }

    const sub = interaction.options.getSubcommand();

    if (sub === 'revival') {
      const enable = interaction.options.getBoolean('enable', true);
      const interval = interaction.options.getInteger('interval_hours') || 12;
      const channel = interaction.options.getChannel('channel');

      const updates: any = {
        reviveEnabled: enable,
        reviveIntervalHours: interval
      };

      if (channel) {
        updates.allowedChannels = [channel.id];
      }

      await guildRepo.updateSettings(interaction.guildId, updates);

      await interaction.reply({
        embeds: [
          LuminEmbedBuilder.success(
            `Channel revival is now **${enable ? 'Enabled' : 'Disabled'}**.\n` +
              `• **Inactivity Threshold**: \`${interval} hours\`\n` +
              `• **Target Channel**: ${channel ? `<#${channel.id}>` : 'Default server channels'}`,
            'Revival Schedule Updated'
          )
        ]
      });
    }
  }
};
