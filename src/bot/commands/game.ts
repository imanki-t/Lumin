import {
  SlashCommandBuilder,
  ChatInputCommandInteraction
} from 'discord.js';
import { Command } from './types.js';
import { AkinatorEngine } from '@/core/games/akinator.js';
import { TruthDareEngine, TDSMode, TDSRating } from '@/core/games/truth-dare.js';
import { NeverHaveIEverEngine } from '@/core/games/never-have-i-ever.js';
import { WouldYouRatherEngine } from '@/core/games/would-you-rather.js';
import { LuminEmbedBuilder } from '@/bot/embeds/builder.js';
import { LuminButtons } from '@/bot/components/buttons.js';
import { cryptoRandomId } from '@/core/cache/redis.js';

export const gameCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('game')
    .setDescription('Launch interactive AI games')
    .addSubcommand((sub) =>
      sub.setName('akinator').setDescription('Think of a real or fictional character, and Lumin will guess who!')
    )
    .addSubcommand((sub) =>
      sub
        .setName('truth_dare')
        .setDescription('Truth, Dare, or Situation game')
        .addStringOption((opt) =>
          opt
            .setName('mode')
            .setDescription('Mode')
            .addChoices(
              { name: 'Truth', value: 'truth' },
              { name: 'Dare', value: 'dare' },
              { name: 'Situation', value: 'situation' },
              { name: 'Random', value: 'random' }
            )
        )
        .addStringOption((opt) =>
          opt
            .setName('rating')
            .setDescription('Intensity level')
            .addChoices(
              { name: 'Mild (Friendly)', value: 'mild' },
              { name: 'Party (Fun)', value: 'party' },
              { name: 'Wild (Bold)', value: 'wild' }
            )
        )
    )
    .addSubcommand((sub) =>
      sub.setName('never_have_i_ever').setDescription('Play Never Have I Ever with your friends')
    )
    .addSubcommand((sub) =>
      sub.setName('would_you_rather').setDescription('Vote on agonizing AI-generated dilemma choices')
    ),

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const sub = interaction.options.getSubcommand();

    if (sub === 'akinator') {
      const gameId = cryptoRandomId(8);
      const state = await AkinatorEngine.get().startGame(
        gameId,
        interaction.user.id,
        interaction.channelId
      );

      const embed = LuminEmbedBuilder.brand({
        title: '🧞 Akinator 20 Questions',
        description:
          `Think of a character (real or fictional), and answer honestly!\n\n` +
          `**Question 1:**\n### ${state.currentQuestion}`,
        user: interaction.user
      }).setColor(0x9b59b6);

      const row = LuminButtons.akinatorChoices(gameId, interaction.user.id);
      await interaction.reply({ embeds: [embed], components: [row] });
      return;
    }

    if (sub === 'truth_dare') {
      await interaction.deferReply();
      const mode = (interaction.options.getString('mode') as TDSMode) || 'random';
      const rating = (interaction.options.getString('rating') as TDSRating) || 'party';

      const promptData = await TruthDareEngine.generatePrompt(mode, rating);

      const colors = {
        Truth: 0x3498db,
        Dare: 0xe74c3c,
        Situation: 0xe67e22
      };

      const embed = LuminEmbedBuilder.brand({
        title: `🎲 ${promptData.type} (${rating.toUpperCase()})`,
        description: `### "${promptData.content}"\n\n*Dare you to answer or take the challenge in chat!*`,
        user: interaction.user
      }).setColor(colors[promptData.type] || 0x5865f2);

      await interaction.editReply({ embeds: [embed] });
      return;
    }

    if (sub === 'never_have_i_ever') {
      await interaction.deferReply();
      const prompt = await NeverHaveIEverEngine.generatePrompt();

      const embed = LuminEmbedBuilder.brand({
        title: '🙈 Never Have I Ever...',
        description: `### "${prompt}"\n\n*React or reply if you are guilty!*`,
        user: interaction.user
      }).setColor(0x1abc9c);

      await interaction.editReply({ embeds: [embed] });
      return;
    }

    if (sub === 'would_you_rather') {
      await interaction.deferReply();
      const gameId = cryptoRandomId(8);
      const dilemma = await WouldYouRatherEngine.generateDilemma(gameId);

      const embed = LuminEmbedBuilder.brand({
        title: '🤔 Would You Rather...',
        description:
          `**Option A:**\n🅰️ ${dilemma.optionA}\n\n` +
          `**Option B:**\n🅱️ ${dilemma.optionB}\n\n` +
          `*Vote below to see what the community chose!*`,
        user: interaction.user
      }).setColor(0xe67e22);

      const row = LuminButtons.wouldYouRather(gameId);
      await interaction.editReply({ embeds: [embed], components: [row] });
    }
  }
};
