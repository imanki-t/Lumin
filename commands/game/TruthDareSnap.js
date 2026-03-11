/**
 * @fileoverview Truth, Dare, or Situation game.
 * @module commands/game/TruthDareSnap
 */

import {
  EmbedBuilder,
  StringSelectMenuBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} from 'discord.js';

import { genAI }         from '../../managers/BotManager.js';
import { DEFAULT_MODEL } from '../../modules/config.js';
import { Logger }        from '../../core/Logger.js';
import { setButtonExpiry, handleGameError } from './gameUtils.js';

const logger     = Logger.get('TruthDareSnap');
const GAME_MODEL = DEFAULT_MODEL;

const PROMPT_MAP = Object.freeze({
  truth:     'Generate an interesting truth question for a party game. One sentence. Keep it appropriate for all ages.',
  dare:      'Generate a fun, safe dare for a party game. One sentence. Keep it appropriate for all ages.',
  situation: 'Generate a hypothetical "What would you do if..." situation for a party game. One sentence. Keep it appropriate for all ages.'
});

const EMOJI_MAP = Object.freeze({ truth: '💭', dare: '⚡', situation: '🎭' });

// ============================================================================
// HANDLERS
// ============================================================================

export async function handleTDS(interaction) {
  try {
    const embed = new EmbedBuilder()
      .setColor(0xFF6B6B)
      .setTitle('🎭 Truth, Dare, or Situation')
      .setDescription('Choose your challenge type!');

    const choiceSelect = new StringSelectMenuBuilder()
      .setCustomId('tds_choice')
      .setPlaceholder('Pick one')
      .addOptions(
        { label: 'Truth',     value: 'truth',     description: 'Answer a question honestly', emoji: '💭' },
        { label: 'Dare',      value: 'dare',      description: 'Complete a challenge',        emoji: '⚡' },
        { label: 'Situation', value: 'situation', description: 'Hypothetical scenario',        emoji: '🎭' }
      );

    await interaction.followUp({
      embeds:     [embed],
      components: [new ActionRowBuilder().addComponents(choiceSelect)]
    });

    const message = await interaction.fetchReply();
    setButtonExpiry(message);

  } catch (error) {
    logger.error('handleTDS failed', error);
    await handleGameError(interaction, 'Failed to load options.');
  }
}

export async function handleTDSChoice(interaction) {
  try {
    const choice = interaction.values[0];
    await interaction.update({ components: [] });

    const chat   = genAI.chats.create({
      model:  GAME_MODEL,
      config: { systemInstruction: PROMPT_MAP[choice], temperature: 0.9 }
    });
    const result    = await chat.sendMessage({ message: 'Generate one' });
    const challenge = result.text?.trim() || `Here is your ${choice}!`;
    const label     = choice.charAt(0).toUpperCase() + choice.slice(1);

    const embed = new EmbedBuilder()
      .setColor(0xFF6B6B)
      .setTitle(`${EMOJI_MAP[choice]} ${label}`)
      .setDescription(challenge)
      .setFooter({ text: 'Click Play Again for a new turn!' });

    const againButton = new ButtonBuilder()
      .setCustomId('tds_again')
      .setLabel('Play Again')
      .setStyle(ButtonStyle.Primary)
      .setEmoji('🔄');

    await interaction.followUp({
      embeds:     [embed],
      components: [new ActionRowBuilder().addComponents(againButton)]
    });

    const newMessage = await interaction.fetchReply();
    setButtonExpiry(newMessage);

  } catch (error) {
    logger.error('handleTDSChoice failed', error);
    await handleGameError(interaction, 'Failed to generate challenge.');
  }
}

export async function handleTDSAgain(interaction) {
  try {
    await interaction.update({ components: [] });
    await handleTDS(interaction);
  } catch (error) {
    logger.error('handleTDSAgain failed', error);
    await handleGameError(interaction, 'Failed to restart game.');
  }
}
