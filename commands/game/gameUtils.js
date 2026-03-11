/**
 * @fileoverview Shared utilities for all game modules.
 * @module commands/game/gameUtils
 */

import { EmbedBuilder, MessageFlags } from 'discord.js';
import { Logger } from '../../core/Logger.js';

const logger = Logger.get('GameUtils');

/** How long (ms) before game buttons auto-expire. */
export const BUTTON_EXPIRY_MS = 5 * 60 * 1000;

/**
 * Schedule removal of all components from a message after BUTTON_EXPIRY_MS.
 * Silently ignores errors (message deleted, bot lacks perms, etc.)
 * @param {import('discord.js').Message} message
 */
export function setButtonExpiry(message) {
  if (!message) return;
  setTimeout(async () => {
    try {
      const fetched = await message.channel.messages.fetch(message.id).catch(() => null);
      if (fetched?.components.length > 0) {
        await fetched.edit({ components: [] }).catch(() => {});
      }
    } catch {
      // Message deleted or bot lacks permissions — ignore
    }
  }, BUTTON_EXPIRY_MS);
}

/**
 * Send a standardised game error response.
 * Picks the correct interaction method based on its current state.
 *
 * @param {import('discord.js').Interaction} interaction
 * @param {string} message   Human-readable error description.
 */
export async function handleGameError(interaction, message) {
  const embed = new EmbedBuilder()
    .setColor(0xFF0000)
    .setTitle('❌ Game Error')
    .setDescription(message);

  try {
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ embeds: [embed], flags: MessageFlags.Ephemeral });
    } else {
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }
  } catch (err) {
    logger.error('Failed to send game error embed', err);
  }
}
