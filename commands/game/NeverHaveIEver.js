/**
 * @fileoverview Never Have I Ever game.
 * @module commands/game/NeverHaveIEver
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

const logger     = Logger.get('NeverHaveIEver');
const GAME_MODEL = DEFAULT_MODEL;

const SYSTEM_PROMPT =
  'Generate a "Never Have I Ever" statement. Keep it appropriate, interesting, and relatable. ' +
  'Format exactly: "Never have I ever [action]"';

// ============================================================================
// HANDLERS
// ============================================================================

/**
 * Generate and send a new NHIE statement.
 * @param {import('discord.js').Interaction} interaction  Already acknowledged.
 */
export async function handleNHIE(interaction) {
  try {
    const chat   = genAI.chats.create({
      model:  GAME_MODEL,
      config: { systemInstruction: SYSTEM_PROMPT, temperature: 0.9 }
    });
    const result    = await chat.sendMessage({ message: 'Generate one' });
    const statement = result.text?.trim() || 'Never have I ever stayed up all night gaming';

    const embed = new EmbedBuilder()
      .setColor(0xF39C12)
      .setTitle('🙈 Never Have I Ever')
      .setDescription(statement)
      .setFooter({ text: 'React with 👍 if you HAVE, 👎 if you HAVEN\'T' });

    const nextButton = new ButtonBuilder()
      .setCustomId('nhie_next')
      .setLabel('Next Statement')
      .setStyle(ButtonStyle.Primary)
      .setEmoji('➡️');

    await interaction.followUp({
      embeds:     [embed],
      components: [new ActionRowBuilder().addComponents(nextButton)]
    });

    const message = await interaction.fetchReply();
    setButtonExpiry(message);

    // Best-effort reactions — ignore if bot lacks permissions
    await message.react('👍').catch(() => {});
    await message.react('👎').catch(() => {});

  } catch (error) {
    logger.error('handleNHIE failed', error);
    await handleGameError(interaction, 'Failed to generate statement.');
  }
}

/**
 * "Next Statement" button — clear old message buttons and generate a new one.
 * @param {import('discord.js').ButtonInteraction} interaction
 */
export async function handleNHIENext(interaction) {
  try {
    await interaction.update({ components: [] });
    await handleNHIE(interaction);
  } catch (error) {
    logger.error('handleNHIENext failed', error);
    await handleGameError(interaction, 'Failed to get next statement.');
  }
}
