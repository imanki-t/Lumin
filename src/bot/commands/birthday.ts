import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  ChannelType
} from 'discord.js';
import { Command } from './types.js';
import { birthdayRepo } from '@/core/database/repositories/index.js';
import { LuminEmbedBuilder } from '@/bot/embeds/builder.js';

export const birthdayCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('birthday')
    .setDescription('Track and celebrate server member birthdays')
    .addSubcommand((sub) =>
      sub
        .setName('set')
        .setDescription('Save your birthday')
        .addIntegerOption((opt) =>
          opt.setName('month').setDescription('Month (1-12)').setRequired(true).setMinValue(1).setMaxValue(12)
        )
        .addIntegerOption((opt) =>
          opt.setName('day').setDescription('Day (1-31)').setRequired(true).setMinValue(1).setMaxValue(31)
        )
        .addChannelOption((opt) =>
          opt
            .setName('announcement_channel')
            .setDescription('Channel where birthday wish should be announced')
            .addChannelTypes(ChannelType.GuildText)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('check')
        .setDescription('Check a member birthday')
        .addUserOption((opt) => opt.setName('user').setDescription('Member to check').setRequired(true))
    )
    .addSubcommand((sub) =>
      sub.setName('list').setDescription('List upcoming birthdays in this server')
    ),

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const sub = interaction.options.getSubcommand();

    if (sub === 'set') {
      const month = interaction.options.getInteger('month', true);
      const day = interaction.options.getInteger('day', true);
      const channel = interaction.options.getChannel('announcement_channel');

      await birthdayRepo.setBirthday({
        userId: interaction.user.id,
        guildId: interaction.guildId || undefined,
        month,
        day,
        timezone: 'UTC'
      });

      const monthNames = [
        'January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'
      ];

      await interaction.reply({
        embeds: [
          LuminEmbedBuilder.success(
            `Your birthday has been registered for **${monthNames[month - 1]} ${day}**! 🎉\n` +
              `Lumin will celebrate your special day in <#${channel?.id || interaction.channelId}>.`,
            'Birthday Registered'
          )
        ],
        ephemeral: true
      });
      return;
    }

    if (sub === 'check') {
      const user = interaction.options.getUser('user', true);
      const bday = await birthdayRepo.getBirthday(user.id);

      if (!bday) {
        await interaction.reply({
          embeds: [LuminEmbedBuilder.info(`${user.displayName} has not registered their birthday yet.`)],
          ephemeral: true
        });
        return;
      }

      const monthNames = [
        'January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'
      ];

      await interaction.reply({
        embeds: [
          LuminEmbedBuilder.brand({
            title: `🎂 ${user.displayName}'s Birthday`,
            description: `Celebrates on **${monthNames[bday.month - 1]} ${bday.day}**!`,
            user
          })
        ]
      });
      return;
    }

    if (sub === 'list') {
      if (!interaction.guildId) {
        await interaction.reply({
          embeds: [LuminEmbedBuilder.error('This command can only be used inside a server.')],
          ephemeral: true
        });
        return;
      }

      const list = await birthdayRepo.getGuildBirthdays(interaction.guildId);
      if (list.length === 0) {
        await interaction.reply({
          embeds: [LuminEmbedBuilder.info('No birthdays registered in this server yet.')],
          ephemeral: true
        });
        return;
      }

      const monthNames = [
        'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
        'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
      ];

      const entries = list.map((b) => `<@${b.userId}> — **${monthNames[b.month - 1]} ${b.day}**`);

      await interaction.reply({
        embeds: [
          LuminEmbedBuilder.brand({
            title: `🎂 Server Birthdays (${list.length})`,
            description: entries.join('\n')
          })
        ]
      });
    }
  }
};
