import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  PermissionFlagsBits
} from 'discord.js';
import { Command } from './types.js';
import { guildRepo } from '@/core/database/repositories/index.js';
import { LuminEmbedBuilder } from '@/bot/embeds/builder.js';

export const reactionCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('reaction')
    .setDescription('Configure reaction roulette for random emoji reactions on messages (Admin only)')
    .addSubcommand((sub) =>
      sub
        .setName('toggle')
        .setDescription('Turn reaction roulette on or off')
        .addBooleanOption((opt) => opt.setName('enabled').setDescription('Enable reaction roulette').setRequired(true))
    )
    .addSubcommand((sub) =>
      sub
        .setName('rate')
        .setDescription('Set trigger rate percentage (1-20%)')
        .addNumberOption((opt) =>
          opt.setName('chance').setDescription('Trigger probability percentage (e.g. 5 for 5%)').setRequired(true).setMinValue(1).setMaxValue(20)
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

    if (sub === 'toggle') {
      const enabled = interaction.options.getBoolean('enabled', true);
      await guildRepo.updateSettings(interaction.guildId, { rouletteEnabled: enabled });

      await interaction.reply({
        embeds: [
          LuminEmbedBuilder.success(
            `Reaction roulette is now **${enabled ? 'Enabled' : 'Disabled'}** for this server.`,
            'Roulette Status'
          )
        ]
      });
      return;
    }

    if (sub === 'rate') {
      const chance = interaction.options.getNumber('chance', true);
      await guildRepo.updateSettings(interaction.guildId, { rouletteRarity: chance });

      await interaction.reply({
        embeds: [
          LuminEmbedBuilder.success(
            `Reaction roulette trigger rate updated to **${chance}%** of active messages.`,
            'Roulette Rate'
          )
        ]
      });
    }
  }
};
