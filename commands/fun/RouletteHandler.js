/**
 * @fileoverview /roulette command — randomly react to messages in a channel.
 * @module commands/fun/RouletteHandler
 */

import {
  EmbedBuilder,
  MessageFlags,
  StringSelectMenuBuilder,
  ActionRowBuilder,
  PermissionsBitField
} from 'discord.js';

import { state, saveStateToFile } from '../../managers/BotManager.js';
import { Logger }                  from '../../core/Logger.js';

const logger = Logger.get('RouletteHandler');

const REACTION_POOL = Object.freeze([
  '👍', '❤️', '😂', '😮', '😢', '😡',
  '🎉', '✨', '🔥', '👀', '🎯', '💯'
]);

const RARITY_CHANCES = Object.freeze({
  common:    0.20,
  medium:    0.10,
  rare:      0.05,
  legendary: 0.01
});

// ============================================================================
// COMMAND DEFINITION
// ============================================================================

export const rouletteCommand = {
  name:        'roulette',
  description: 'Bot randomly reacts to messages in this channel'
};

// ============================================================================
// PRIVATE HELPERS
// ============================================================================

/**
 * Send a "Manage Server" permission-denied error.
 * @param {import('discord.js').Interaction} interaction
 */
async function sendPermError(interaction) {
  const embed = new EmbedBuilder()
    .setColor(0xFF0000)
    .setTitle('🚫 Permission Denied')
    .setDescription('You need **Manage Server** permission to configure reaction roulette.');

  if (interaction.replied || interaction.deferred) {
    return interaction.followUp({ embeds: [embed], flags: MessageFlags.Ephemeral });
  }
  return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

/** @param {import('discord.js').GuildMember} member */
function hasManageGuild(member) {
  return member?.permissions.has(PermissionsBitField.Flags.ManageGuild);
}

// ============================================================================
// HANDLERS
// ============================================================================

/**
 * Entry point — show roulette configuration menu.
 * @param {import('discord.js').CommandInteraction} interaction
 */
export async function handleRouletteCommand(interaction) {
  if (!interaction.guild) {
    const embed = new EmbedBuilder()
      .setColor(0xFF5555)
      .setTitle('❌ Server Only')
      .setDescription('This command can only be used in servers!');
    return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  }

  if (!hasManageGuild(interaction.member)) return sendPermError(interaction);

  if (!state.roulette) state.roulette = {};

  const isActive = state.roulette[interaction.channelId]?.active ?? false;

  const embed = new EmbedBuilder()
    .setColor(0xFF6B6B)
    .setTitle('🎰 Reaction Roulette')
    .setDescription(
      `Configure reaction roulette for this channel.\n\n` +
      `**Current Status:** ${isActive ? '✅ Active' : '❌ Inactive'}`
    );

  const actionSelect = new StringSelectMenuBuilder()
    .setCustomId('roulette_action')
    .setPlaceholder('Choose an action')
    .addOptions(
      { label: 'Enable',     value: 'enable',  description: 'Start reacting to random messages', emoji: '✅' },
      { label: 'Disable',    value: 'disable', description: 'Stop reactions',                     emoji: '❌' },
      { label: 'Set Rarity', value: 'rarity',  description: 'Adjust reaction frequency',          emoji: '⚙️' }
    );

  await interaction.reply({
    embeds:     [embed],
    components: [new ActionRowBuilder().addComponents(actionSelect)],
    flags:      MessageFlags.Ephemeral
  });
}

/**
 * Handle Enable / Disable / Rarity selection.
 * @param {import('discord.js').StringSelectMenuInteraction} interaction
 */
export async function handleRouletteActionSelect(interaction) {
  if (!hasManageGuild(interaction.member)) return sendPermError(interaction);

  const action    = interaction.values[0];
  const channelId = interaction.channelId;

  if (!state.roulette) state.roulette = {};

  if (action === 'enable') {
    if (!state.roulette[channelId]) {
      state.roulette[channelId] = { active: true, rarity: 'medium', guildId: interaction.guild.id };
    } else {
      state.roulette[channelId].active = true;
    }
    await saveStateToFile();

    const embed = new EmbedBuilder()
      .setColor(0x00FF00)
      .setTitle('✅ Roulette Enabled')
      .setDescription(
        `I'll now randomly react to messages in this channel! 🎰\n\n` +
        `**Rarity:** ${state.roulette[channelId].rarity || 'medium'}`
      );
    return interaction.update({ embeds: [embed], components: [] });
  }

  if (action === 'disable') {
    if (state.roulette[channelId]) {
      state.roulette[channelId].active = false;
      await saveStateToFile();
    }

    const embed = new EmbedBuilder()
      .setColor(0xFF5555)
      .setTitle('❌ Roulette Disabled')
      .setDescription('Reaction roulette has been disabled for this channel.');
    return interaction.update({ embeds: [embed], components: [] });
  }

  if (action === 'rarity') {
    const embed = new EmbedBuilder()
      .setColor(0xFF6B6B)
      .setTitle('⚙️ Set Reaction Rarity')
      .setDescription('How often should I react to messages?');

    const raritySelect = new StringSelectMenuBuilder()
      .setCustomId('roulette_rarity')
      .setPlaceholder('Select frequency')
      .addOptions(
        { label: 'Common',    value: 'common',    description: '~20% of messages', emoji: '🟢' },
        { label: 'Medium',    value: 'medium',    description: '~10% of messages', emoji: '🟡' },
        { label: 'Rare',      value: 'rare',      description: '~5% of messages',  emoji: '🔴' },
        { label: 'Legendary', value: 'legendary', description: '~1% of messages',  emoji: '✨' }
      );

    return interaction.update({
      embeds:     [embed],
      components: [new ActionRowBuilder().addComponents(raritySelect)]
    });
  }
}

/**
 * Handle rarity selection.
 * @param {import('discord.js').StringSelectMenuInteraction} interaction
 */
export async function handleRouletteRaritySelect(interaction) {
  if (!hasManageGuild(interaction.member)) return sendPermError(interaction);

  const rarity    = interaction.values[0];
  const channelId = interaction.channelId;

  if (!state.roulette) state.roulette = {};
  if (!state.roulette[channelId]) {
    state.roulette[channelId] = { active: true, guildId: interaction.guild.id };
  }
  state.roulette[channelId].rarity = rarity;
  await saveStateToFile();

  const embed = new EmbedBuilder()
    .setColor(0x00FF00)
    .setTitle('✅ Rarity Updated')
    .setDescription(`Reaction rarity set to **${rarity}**!`);

  await interaction.update({ embeds: [embed], components: [] });
}

// ============================================================================
// MESSAGE LISTENER HELPER  (called from index.js on every message)
// ============================================================================

/**
 * Fire a random reaction if roulette is active for the channel.
 * Called in the message create event handler — never throws.
 * @param {import('discord.js').Message} message
 */
export function checkRoulette(message) {
  const config = state.roulette?.[message.channelId];
  if (!config?.active) return;

  const chance = RARITY_CHANCES[config.rarity ?? 'medium'] ?? RARITY_CHANCES.medium;
  if (Math.random() < chance) {
    const emoji = REACTION_POOL[Math.floor(Math.random() * REACTION_POOL.length)];
    message.react(emoji).catch(err => logger.error('Roulette react failed', err));
  }
}
