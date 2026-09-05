import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  PermissionFlagsBits
} from 'discord.js';
import { Command } from './types.js';
import { userRepo, guildRepo } from '@/core/database/repositories/index.js';
import { LuminEmbedBuilder } from '@/bot/embeds/builder.js';
import { AI_MODELS } from '@/config/constants.js';

export const settingsCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('settings')
    .setDescription('Configure Lumin personal user preferences or server-wide settings')
    .addSubcommand((sub) =>
      sub
        .setName('user')
        .setDescription('View and update your personal Lumin settings')
        .addBooleanOption((opt) =>
          opt
            .setName('continuous_reply')
            .setDescription('Automatically reply without needing to @mention Lumin every time')
        )
        .addStringOption((opt) =>
          opt
            .setName('preferred_model')
            .setDescription('Select your preferred AI engine')
            .addChoices(
              { name: 'Gemini 3.5 Flash (Fast, Conversational)', value: AI_MODELS.FLASH },
              { name: 'Gemini 3.5 Flash-Lite (Ultra Low Latency)', value: AI_MODELS.FLASH_LITE },
              { name: 'Gemma 2 9B (Open Model)', value: AI_MODELS.GEMMA_9B },
              { name: 'Gemma 2 27B (Advanced Reasoning)', value: AI_MODELS.GEMMA_27B }
            )
        )
        .addStringOption((opt) =>
          opt
            .setName('custom_tone')
            .setDescription('Personalized AI response tone (e.g. friendly, concise, sarcastic, witty)')
        )
        .addStringOption((opt) =>
          opt.setName('timezone').setDescription('Your local timezone (e.g. UTC, America/New_York, Asia/Kolkata)')
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('server')
        .setDescription('Configure server-wide Lumin settings (Admins only)')
        .addBooleanOption((opt) =>
          opt.setName('override_user').setDescription('Enforce server settings over personal user preferences')
        )
        .addBooleanOption((opt) =>
          opt.setName('roulette_enabled').setDescription('Enable random reaction roulette on messages')
        )
        .addNumberOption((opt) =>
          opt.setName('roulette_rarity').setDescription('Reaction roulette chance in % (e.g. 5 for 5%)')
        )
        .addBooleanOption((opt) =>
          opt.setName('revive_enabled').setDescription('Enable automated conversation revival for quiet channels')
        )
        .addIntegerOption((opt) =>
          opt.setName('revive_interval').setDescription('Hours of inactivity before revival message (e.g. 12)')
        )
    ),

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const subcommand = interaction.options.getSubcommand();

    if (subcommand === 'user') {
      const continuousReply = interaction.options.getBoolean('continuous_reply');
      const preferredModel = interaction.options.getString('preferred_model');
      const customTone = interaction.options.getString('custom_tone');
      const timezone = interaction.options.getString('timezone');

      const updates: any = {};
      if (continuousReply !== null) updates.continuousReply = continuousReply;
      if (preferredModel) updates.preferredModel = preferredModel;
      if (customTone) updates.customTone = customTone;
      if (timezone) updates.timezone = timezone;

      let currentSettings = await userRepo.getSettings(interaction.user.id);

      if (Object.keys(updates).length > 0) {
        currentSettings = await userRepo.updateSettings(interaction.user.id, updates);
        await interaction.reply({
          embeds: [
            LuminEmbedBuilder.success(
              `Your settings have been updated:\n` +
                `• **Preferred Model**: \`${currentSettings.preferredModel}\`\n` +
                `• **Continuous Reply**: \`${currentSettings.continuousReply ? 'Enabled' : 'Disabled'}\`\n` +
                `• **Custom Tone**: \`${currentSettings.customTone}\`\n` +
                `• **Timezone**: \`${currentSettings.timezone}\``,
              'User Settings Updated'
            )
          ],
          ephemeral: true
        });
      } else {
        await interaction.reply({
          embeds: [
            LuminEmbedBuilder.brand({
              title: '⚙️ Your Personal Lumin Settings',
              description:
                `• **Preferred Model**: \`${currentSettings.preferredModel}\`\n` +
                `• **Continuous Reply**: \`${currentSettings.continuousReply ? 'Enabled' : 'Disabled'}\`\n` +
                `• **Custom Tone**: \`${currentSettings.customTone}\`\n` +
                `• **Timezone**: \`${currentSettings.timezone}\`\n\n` +
                '*Use /settings user with options to change any value.*',
              user: interaction.user
            })
          ],
          ephemeral: true
        });
      }
      return;
    }

    if (subcommand === 'server') {
      if (!interaction.guildId || !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
        await interaction.reply({
          embeds: [LuminEmbedBuilder.error('You need `Manage Server` permission to configure server settings.')],
          ephemeral: true
        });
        return;
      }

      const overrideUser = interaction.options.getBoolean('override_user');
      const rouletteEnabled = interaction.options.getBoolean('roulette_enabled');
      const rouletteRarity = interaction.options.getNumber('roulette_rarity');
      const reviveEnabled = interaction.options.getBoolean('revive_enabled');
      const reviveInterval = interaction.options.getInteger('revive_interval');

      const updates: any = {};
      if (overrideUser !== null) updates.overrideUserSettings = overrideUser;
      if (rouletteEnabled !== null) updates.rouletteEnabled = rouletteEnabled;
      if (rouletteRarity !== null) updates.rouletteRarity = rouletteRarity;
      if (reviveEnabled !== null) updates.reviveEnabled = reviveEnabled;
      if (reviveInterval !== null) updates.reviveIntervalHours = reviveInterval;

      let guildSettings = await guildRepo.getSettings(interaction.guildId);

      if (Object.keys(updates).length > 0) {
        guildSettings = await guildRepo.updateSettings(interaction.guildId, updates);
        await interaction.reply({
          embeds: [
            LuminEmbedBuilder.success(
              `Server settings updated:\n` +
                `• **Override User Settings**: \`${guildSettings.overrideUserSettings ? 'Enabled' : 'Disabled'}\`\n` +
                `• **Reaction Roulette**: \`${guildSettings.rouletteEnabled ? 'Enabled' : 'Disabled'}\` (${guildSettings.rouletteRarity}% chance)\n` +
                `• **Channel Revival**: \`${guildSettings.reviveEnabled ? 'Enabled' : 'Disabled'}\` (Every ${guildSettings.reviveIntervalHours}h)`,
              'Server Settings Updated'
            )
          ]
        });
      } else {
        await interaction.reply({
          embeds: [
            LuminEmbedBuilder.brand({
              title: `⚙️ Server Settings for ${interaction.guild?.name}`,
              description:
                `• **Override User Settings**: \`${guildSettings.overrideUserSettings ? 'Enabled' : 'Disabled'}\`\n` +
                `• **Reaction Roulette**: \`${guildSettings.rouletteEnabled ? 'Enabled' : 'Disabled'}\` (${guildSettings.rouletteRarity}%)\n` +
                `• **Channel Revival**: \`${guildSettings.reviveEnabled ? 'Enabled' : 'Disabled'}\` (${guildSettings.reviveIntervalHours} hours)\n` +
                `• **Allowed Channels**: ${guildSettings.allowedChannels?.length ? guildSettings.allowedChannels.map((c) => `<#${c}>`).join(', ') : 'All channels'}`
            })
          ]
        });
      }
    }
  }
};
