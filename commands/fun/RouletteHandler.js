/**
 * @fileoverview /roulette command — randomly react to messages in a channel.
 * @module commands/fun/RouletteHandler
 */

import {
  EmbedBuilder,
  MessageFlags,
  StringSelectMenuBuilder,
  ActionRowBuilder,
  PermissionsBitField,
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  ButtonBuilder,
  ButtonStyle
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

export const reactionCommand = {
  name:        'reaction',
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

const ACCENT_COLOR     = 0xE53935;
const IS_COMPONENTS_V2 = 1 << 15;

/**
 * Entry point — show reaction configuration menu.
 * @param {import('discord.js').CommandInteraction} interaction
 */
export async function handleReactionCommand(interaction) {
  if (!interaction.guild) {
    const container = new ContainerBuilder().setAccentColor(ACCENT_COLOR);
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent('**Server Only**\nThis command can only be used in servers.')
    );
    return interaction.reply({ components: [container], flags: MessageFlags.Ephemeral | IS_COMPONENTS_V2 });
  }

  if (!hasManageGuild(interaction.member)) return sendPermError(interaction);

  if (!state.roulette) state.roulette = {};

  const isActive = state.roulette[interaction.channelId]?.active ?? false;
  const rarity   = state.roulette[interaction.channelId]?.rarity  ?? 'medium';

  const actionSelect = new StringSelectMenuBuilder()
    .setCustomId('reaction_action')
    .setPlaceholder('Choose an action')
    .addOptions(
      { label: 'Enable',     value: 'enable',  description: 'Start reacting to random messages', emoji: '✅' },
      { label: 'Disable',    value: 'disable', description: 'Stop reactions',                     emoji: '❌' },
      { label: 'Set Rarity', value: 'rarity',  description: 'Adjust reaction frequency',          emoji: '⚙️' }
    );

  const container = new ContainerBuilder().setAccentColor(ACCENT_COLOR);
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      '**Reaction**\n' +
      'Configure random emoji reactions for messages in this channel.\n\n' +
      `**Status:** ${isActive ? 'Active' : 'Inactive'}\n` +
      `**Rarity:** ${rarity.charAt(0).toUpperCase() + rarity.slice(1)}`
    )
  );
  container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));
  container.addActionRowComponents(new ActionRowBuilder().addComponents(actionSelect));

  await interaction.reply({
    components: [container],
    flags: MessageFlags.Ephemeral | IS_COMPONENTS_V2
  });
}

/**
 * Handle Enable / Disable / Rarity selection.
 * @param {import('discord.js').StringSelectMenuInteraction} interaction
 */
export async function handleReactionActionSelect(interaction) {
  if (!hasManageGuild(interaction.member)) return sendPermError(interaction);

  const action    = interaction.values[0];
  const channelId = interaction.channelId;

  if (!state.roulette) state.roulette = {};

  try {
    if (action === 'enable') {
      // Update state in memory first
      if (!state.roulette[channelId]) {
        state.roulette[channelId] = { active: true, rarity: 'medium', guildId: interaction.guild.id };
      } else {
        state.roulette[channelId].active = true;
      }

      const rarity    = state.roulette[channelId].rarity || 'medium';
      const container = new ContainerBuilder().setAccentColor(0x00C853);
      container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          `**✅ Roulette Enabled**\n` +
          `I'll now randomly react to messages in this channel! 🎰\n\n` +
          `**Rarity:** ${rarity}`
        )
      );
      container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));
      container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`-# This message will be dismissed automatically.`)
      );

      // Respond immediately — before the DB write — to avoid interaction timeout
      await interaction.update({ components: [container], flags: IS_COMPONENTS_V2 });
      saveStateToFile().catch(err => logger.error('Roulette enable save failed', err));

      setTimeout(() => interaction.deleteReply().catch(() => {}), 3 * 60 * 1000);
      return;
    }

    if (action === 'disable') {
      if (state.roulette[channelId]) {
        state.roulette[channelId].active = false;
      }

      const container = new ContainerBuilder().setAccentColor(ACCENT_COLOR);
      container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          '**❌ Roulette Disabled**\nReaction roulette has been disabled for this channel.'
        )
      );
      container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));
      container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`-# This message will be dismissed automatically.`)
      );

      await interaction.update({ components: [container], flags: IS_COMPONENTS_V2 });
      saveStateToFile().catch(err => logger.error('Roulette disable save failed', err));

      setTimeout(() => interaction.deleteReply().catch(() => {}), 3 * 60 * 1000);
      return;
    }

    if (action === 'rarity') {
      const raritySelect = new StringSelectMenuBuilder()
        .setCustomId('reaction_rarity')
        .setPlaceholder('Select frequency')
        .addOptions(
          { label: 'Common',    value: 'common',    description: '~20% of messages', emoji: '🟢' },
          { label: 'Medium',    value: 'medium',    description: '~10% of messages', emoji: '🟡' },
          { label: 'Rare',      value: 'rare',      description: '~5% of messages',  emoji: '🔴' },
          { label: 'Legendary', value: 'legendary', description: '~1% of messages',  emoji: '✨' }
        );

      const container = new ContainerBuilder().setAccentColor(ACCENT_COLOR);
      container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent('**⚙️ Set Reaction Rarity**\nHow often should I react to messages?')
      );
      container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));
      container.addActionRowComponents(new ActionRowBuilder().addComponents(raritySelect));

      return interaction.update({ components: [container], flags: IS_COMPONENTS_V2 });
    }
  } catch (err) {
    logger.error('handleReactionActionSelect failed', err);
    await sendPermError(interaction).catch(() => {});
  }
}

/**
 * Handle rarity selection.
 * @param {import('discord.js').StringSelectMenuInteraction} interaction
 */
export async function handleReactionRaritySelect(interaction) {
  if (!hasManageGuild(interaction.member)) return sendPermError(interaction);

  const rarity    = interaction.values[0];
  const channelId = interaction.channelId;

  try {
    if (!state.roulette) state.roulette = {};
    if (!state.roulette[channelId]) {
      state.roulette[channelId] = { active: false, guildId: interaction.guild.id };
    }
    state.roulette[channelId].rarity = rarity;

    const container = new ContainerBuilder().setAccentColor(0x00C853);
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`**✅ Rarity Updated**\nReaction rarity set to **${rarity}**!`)
    );
    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`-# This message will be dismissed automatically.`)
    );

    // Respond immediately before the DB write to avoid interaction timeout
    await interaction.update({ components: [container], flags: IS_COMPONENTS_V2 });
    saveStateToFile().catch(err => logger.error('Roulette rarity save failed', err));

    setTimeout(() => interaction.deleteReply().catch(() => {}), 3 * 60 * 1000);
  } catch (err) {
    logger.error('handleReactionRaritySelect failed', err);
  }
}

// ============================================================================
// MESSAGE LISTENER HELPER  (called from index.js on every message)
// ============================================================================

/**
 * Fire a random reaction if roulette is active for the channel.
 * Called in the message create event handler — never throws.
 * @param {import('discord.js').Message} message
 */
export function checkReaction(message) {
  const config = state.roulette?.[message.channelId];
  if (!config?.active) return;

  const chance = RARITY_CHANCES[config.rarity ?? 'medium'] ?? RARITY_CHANCES.medium;
  if (Math.random() < chance) {
    const emoji = REACTION_POOL[Math.floor(Math.random() * REACTION_POOL.length)];
    message.react(emoji).catch(err => logger.error('Roulette react failed', err));
  }
}
