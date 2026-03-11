/**
 * @fileoverview /game command entry point — shows the game selection menu and
 *               routes to the appropriate game module.
 * @module commands/game/GameRouter
 */

import {
  EmbedBuilder,
  StringSelectMenuBuilder,
  ActionRowBuilder
} from 'discord.js';

import { Logger }                    from '../../core/Logger.js';
import { setButtonExpiry, handleGameError } from './gameUtils.js';
import { handleTDS }                 from './TruthDareSnap.js';
import { handleNHIE }                from './NeverHaveIEver.js';
import { handleWYR }                 from './WouldYouRather.js';
import { showAkinatorModeSelection } from './Akinator.js';

const logger = Logger.get('GameRouter');

// ============================================================================
// COMMAND DEFINITION
// ============================================================================

export const gameCommand = {
  name:        'game',
  description: 'Play interactive games with AI'
};

// ============================================================================
// HANDLERS
// ============================================================================

/**
 * Entry point — present the game selection menu.
 * @param {import('discord.js').CommandInteraction} interaction
 */
export async function handleGameCommand(interaction) {
  try {
    const embed = new EmbedBuilder()
      .setColor(0xE91E63)
      .setTitle('🎮 Interactive Games')
      .setDescription('Choose a game to play!');

    const gameSelect = new StringSelectMenuBuilder()
      .setCustomId('game_select')
      .setPlaceholder('Select a game')
      .addOptions(
        { label: 'Truth, Dare, or Situation', value: 'tds',      description: 'Truth, Dare, or Hypothetical Scenarios', emoji: '🎭' },
        { label: 'Never Have I Ever',          value: 'nhie',     description: 'Share experiences',                       emoji: '🙈' },
        { label: 'Would You Rather',           value: 'wyr',      description: 'Difficult choices',                       emoji: '🤔' },
        { label: 'Akinator',                   value: 'akinator', description: "I'll guess who you're thinking of!",      emoji: '🔮' }
      );

    await interaction.reply({
      embeds:     [embed],
      components: [new ActionRowBuilder().addComponents(gameSelect)]
    });

    const message = await interaction.fetchReply();
    setButtonExpiry(message);

  } catch (error) {
    logger.error('handleGameCommand failed', error);
    await handleGameError(interaction, 'Failed to load game menu. Please try again.');
  }
}

/**
 * Handle game selection from the dropdown.
 * @param {import('discord.js').StringSelectMenuInteraction} interaction
 */
export async function handleGameSelect(interaction) {
  try {
    const game = interaction.values[0];
    await interaction.update({ components: [] });

    switch (game) {
      case 'tds':      await handleTDS(interaction);                 break;
      case 'nhie':     await handleNHIE(interaction);                break;
      case 'wyr':      await handleWYR(interaction);                 break;
      case 'akinator': await showAkinatorModeSelection(interaction); break;
      default:
        await handleGameError(interaction, `Unknown game: \`${game}\``);
    }

  } catch (error) {
    logger.error('handleGameSelect failed', error);
    await handleGameError(interaction, 'Failed to start game. Please try again.');
  }
}
