import {
  Interaction,
  ChatInputCommandInteraction,
  ButtonInteraction
} from 'discord.js';
import { CommandRegistry } from '@/bot/commands/registry.js';
import { MemoryContinuityPipeline } from '@/core/memory/continuity.js';
import { AkinatorEngine } from '@/core/games/akinator.js';
import { WouldYouRatherEngine } from '@/core/games/would-you-rather.js';
import { LuminEmbedBuilder } from '@/bot/embeds/builder.js';
import { LuminButtons } from '@/bot/components/buttons.js';
import { Logger } from '@/core/logger/index.js';

const logger = Logger.get('InteractionCreateHandler');

export class InteractionCreateHandler {
  public static async handle(interaction: Interaction): Promise<void> {
    if (interaction.isChatInputCommand()) {
      await InteractionCreateHandler.handleCommand(interaction);
      return;
    }

    if (interaction.isButton()) {
      await InteractionCreateHandler.handleButton(interaction);
      return;
    }
  }

  private static async handleCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    const registry = CommandRegistry.get();
    const command = registry.commands.get(interaction.commandName);

    if (!command) {
      logger.warn(`Unknown command executed: ${interaction.commandName}`);
      await interaction.reply({
        embeds: [LuminEmbedBuilder.error(`Command \`/${interaction.commandName}\` is not recognized.`)],
        ephemeral: true
      });
      return;
    }

    try {
      await command.execute(interaction);
    } catch (err: any) {
      logger.error(`Error executing slash command /${interaction.commandName}`, err);

      const errorMessage = LuminEmbedBuilder.error(
        `An unexpected error occurred while executing this command: ${err.message || 'Internal error'}`
      );

      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({ embeds: [errorMessage] }).catch(() => null);
      } else {
        await interaction.reply({ embeds: [errorMessage], ephemeral: true }).catch(() => null);
      }
    }
  }

  private static async handleButton(interaction: ButtonInteraction): Promise<void> {
    const customId = interaction.customId;

    // Quick Action Buttons
    if (customId.startsWith('act:')) {
      const parts = customId.split(':');
      const action = parts[1];
      const contextId = parts[2];
      const ownerUserId = parts[3];

      if (ownerUserId && ownerUserId !== interaction.user.id) {
        await interaction.reply({
          content: 'Only the user who initiated this conversation can use these action buttons.',
          ephemeral: true
        });
        return;
      }

      if (action === 'clear' && contextId) {
        await MemoryContinuityPipeline.get().clearSlidingWindow(contextId);
        await interaction.reply({
          content: '🧹 Active conversation context has been cleared for this channel/DM.',
          ephemeral: true
        });
        return;
      }

      if (action === 'settings') {
        await interaction.reply({
          content: 'Use `/settings user` to adjust your AI model, response tone, or continuous reply settings.',
          ephemeral: true
        });
        return;
      }

      if (action === 'retry') {
        await interaction.reply({
          content: 'To retry, please send your last message or question again.',
          ephemeral: true
        });
        return;
      }
    }

    // Akinator Game Buttons
    if (customId.startsWith('aki:')) {
      const parts = customId.split(':');
      const gameId = parts[1]!;
      const choice = parts[2] as 'yes' | 'probably' | 'dontknow' | 'probablynot' | 'no';
      const playerUserId = parts[3];

      if (playerUserId && playerUserId !== interaction.user.id) {
        await interaction.reply({
          content: 'Only the person playing this Akinator session can select answers.',
          ephemeral: true
        });
        return;
      }

      await interaction.deferUpdate();

      try {
        const nextState = await AkinatorEngine.get().submitAnswer(gameId, choice);

        if (nextState.isFinished && nextState.candidateGuess) {
          const finishedEmbed = LuminEmbedBuilder.brand({
            title: '🧞 Akinator Final Guess!',
            description:
              `I have thought about all your answers...\n\n` +
              `### Are you thinking of: **${nextState.candidateGuess}**?\n` +
              `*Confidence: ${nextState.confidence}% • Questions asked: ${nextState.questionCount - 1}*`,
            user: interaction.user
          }).setColor(0x2ecc71);

          await interaction.editReply({ embeds: [finishedEmbed], components: [] });
        } else {
          const stepEmbed = LuminEmbedBuilder.brand({
            title: `🧞 Akinator 20 Questions (Question #${nextState.questionCount})`,
            description: `### ${nextState.currentQuestion}\n\n*Confidence estimate: ${nextState.confidence}%*`,
            user: interaction.user
          }).setColor(0x9b59b6);

          const choiceRow = LuminButtons.akinatorChoices(gameId, interaction.user.id);
          await interaction.editReply({ embeds: [stepEmbed], components: [choiceRow] });
        }
      } catch (err: any) {
        logger.error('Error handling Akinator choice', err);
        await interaction.followUp({
          content: 'This Akinator session has expired. Start a new game with `/game akinator`.',
          ephemeral: true
        });
      }
      return;
    }

    // Would You Rather Game Buttons
    if (customId.startsWith('wyr:')) {
      const parts = customId.split(':');
      const gameId = parts[1]!;
      const action = parts[2]!;

      if (action === 'opt_a' || action === 'opt_b') {
        const choice = action === 'opt_a' ? 'A' : 'B';
        const updated = await WouldYouRatherEngine.vote(gameId, interaction.user.id, choice);

        if (!updated) {
          await interaction.reply({
            content: 'This dilemma has expired. Start a new one with `/game would_you_rather`.',
            ephemeral: true
          });
          return;
        }

        const totalVotes = updated.votesA + updated.votesB;
        const pctA = totalVotes > 0 ? Math.round((updated.votesA / totalVotes) * 100) : 0;
        const pctB = totalVotes > 0 ? Math.round((updated.votesB / totalVotes) * 100) : 0;

        const updatedEmbed = LuminEmbedBuilder.brand({
          title: '🤔 Would You Rather...',
          description:
            `**Option A:**\n🅰️ ${updated.optionA}\n📊 **${pctA}%** (${updated.votesA} votes)\n\n` +
            `**Option B:**\n🅱️ ${updated.optionB}\n📊 **${pctB}%** (${updated.votesB} votes)\n\n` +
            `*Total Votes: ${totalVotes}*`,
          user: interaction.user
        }).setColor(0xe67e22);

        const row = LuminButtons.wouldYouRather(gameId);
        await interaction.update({ embeds: [updatedEmbed], components: [row] });
        return;
      }

      if (action === 'next') {
        await interaction.deferUpdate();
        const dilemma = await WouldYouRatherEngine.generateDilemma(gameId);

        const newEmbed = LuminEmbedBuilder.brand({
          title: '🤔 Would You Rather...',
          description:
            `**Option A:**\n🅰️ ${dilemma.optionA}\n\n` +
            `**Option B:**\n🅱️ ${dilemma.optionB}\n\n` +
            `*Vote below to see what the community chose!*`,
          user: interaction.user
        }).setColor(0xe67e22);

        const row = LuminButtons.wouldYouRather(gameId);
        await interaction.editReply({ embeds: [newEmbed], components: [row] });
        return;
      }
    }
  }
}
