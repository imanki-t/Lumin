import {
  SlashCommandBuilder,
  ChatInputCommandInteraction
} from 'discord.js';
import { Command } from './types.js';
import { userRepo } from '@/core/database/repositories/index.js';
import { LuminEmbedBuilder } from '@/bot/embeds/builder.js';

export const timezoneCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('timezone')
    .setDescription('Set or view your personal timezone for reminders and scheduled tasks')
    .addSubcommand((sub) =>
      sub
        .setName('set')
        .setDescription('Set your timezone')
        .addStringOption((opt) =>
          opt
            .setName('name')
            .setDescription('Timezone name (e.g. UTC, America/New_York, Europe/London, Asia/Kolkata, Asia/Tokyo)')
            .setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub.setName('get').setDescription('View your current registered timezone')
    ),

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const sub = interaction.options.getSubcommand();

    if (sub === 'set') {
      const tz = interaction.options.getString('name', true).trim();

      // Validate timezone
      try {
        Intl.DateTimeFormat(undefined, { timeZone: tz });
      } catch {
        await interaction.reply({
          embeds: [
            LuminEmbedBuilder.error(
              `Invalid timezone: \`${tz}\`.\nPlease provide a valid IANA timezone like \`UTC\`, \`America/New_York\`, \`Europe/London\`, or \`Asia/Kolkata\`.`
            )
          ],
          ephemeral: true
        });
        return;
      }

      await userRepo.updateSettings(interaction.user.id, { timezone: tz });
      const nowStr = new Date().toLocaleTimeString('en-US', { timeZone: tz });

      await interaction.reply({
        embeds: [
          LuminEmbedBuilder.success(
            `Timezone set to **${tz}**.\nYour current local time is **${nowStr}**.`,
            'Timezone Saved'
          )
        ],
        ephemeral: true
      });
      return;
    }

    if (sub === 'get') {
      const settings = await userRepo.getSettings(interaction.user.id);
      const tz = settings.timezone || 'UTC';
      const nowStr = new Date().toLocaleTimeString('en-US', { timeZone: tz });

      await interaction.reply({
        embeds: [
          LuminEmbedBuilder.brand({
            title: '🌐 Your Timezone',
            description: `• **Timezone**: \`${tz}\`\n• **Current Local Time**: \`${nowStr}\``,
            user: interaction.user
          })
        ],
        ephemeral: true
      });
    }
  }
};
