/**
 * @fileoverview Would You Rather game.
 * @module commands/game/WouldYouRather
 */

import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} from 'discord.js';

import { genAI }         from '../../managers/BotManager.js';
import { DEFAULT_MODEL } from '../../modules/config.js';
import { Logger }        from '../../core/Logger.js';
import { setButtonExpiry, handleGameError } from './gameUtils.js';

const logger     = Logger.get('WouldYouRather');
const GAME_MODEL = DEFAULT_MODEL;

const SYSTEM_PROMPT =
  'Generate a "Would You Rather" question with two difficult but interesting choices. ' +
  'Format exactly: "Would you rather [option A] or [option B]?"';

// ============================================================================
// HANDLERS
// ============================================================================

/**
 * Generate and send a new WYR question.
 * @param {import('discord.js').Interaction} interaction  Already acknowledged.
 */
export async function handleWYR(interaction) {
  try {
    const chat   = genAI.chats.create({
      model:  GAME_MODEL,
      config: { systemInstruction: SYSTEM_PROMPT, temperature: 0.9 }
    });
    const result   = await chat.sendMessage({ message: 'Generate one' });
    const question = result.text?.trim() || 'Would you rather have the ability to fly or be invisible?';

    const embed = new EmbedBuilder()
      .setColor(0x3498DB)
      .setTitle('🤔 Would You Rather')
      .setDescription(question)
      .setFooter({ text: 'React 1️⃣ for Option 1, 2️⃣ for Option 2' });

    const nextButton = new ButtonBuilder()
      .setCustomId('wyr_next')
      .setLabel('Next Question')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('➡️');

    await interaction.followUp({
      embeds:     [embed],
      components: [new ActionRowBuilder().addComponents(nextButton)]
    });

    const message = await interaction.fetchReply();
    setButtonExpiry(message);

    // Best-effort reactions
    await message.react('1️⃣').catch(() => {});
    await message.react('2️⃣').catch(() => {});

  } catch (error) {
    logger.error('handleWYR failed', error);
    await handleGameError(interaction, 'Failed to generate question.');
  }
}

/**
 * "Next Question" button — clear old message buttons and generate a new one.
 * @param {import('discord.js').ButtonInteraction} interaction
 */
export async function handleWYRNext(interaction) {
  try {
    await interaction.update({ components: [] });
    await handleWYR(interaction);
  } catch (error) {
    logger.error('handleWYRNext failed', error);
    await handleGameError(interaction, 'Failed to get next question.');
  }
}
