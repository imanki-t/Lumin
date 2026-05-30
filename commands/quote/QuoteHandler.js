/**
 * @fileoverview /quote command — get instant quotes, schedule daily quotes,
 *               view and remove scheduled quotes.
 *               Pure interaction handler; scheduling lives in QuoteScheduler.js.
 * @module commands/quote/QuoteHandler
 */

import {
  EmbedBuilder,
  MessageFlags,
  StringSelectMenuBuilder,
  ActionRowBuilder,
  ChannelSelectMenuBuilder,
  ChannelType,
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder
} from 'discord.js';

import { state, saveStateToFile }      from '../../managers/BotManager.js';
import { memorySystem }                 from '../../memory/MemorySystem.js';
import * as db                          from '../../database/index.js';
import { Logger }                       from '../../core/Logger.js';
import { scheduleDailyQuote, generateQuote } from './QuoteScheduler.js';

const logger = Logger.get('QuoteHandler');

const MAX_QUOTES_PER_DAY            = 5;
const MAX_SCHEDULED_QUOTES_PER_USER = 2;
const ONE_DAY_MS                    = 24 * 60 * 60 * 1000;
/** Auto-delete the /quote menu after 3 minutes of inactivity. */
const MENU_AUTO_DELETE_MS           = 3 * 60 * 1000;

// ============================================================================
// COMMAND DEFINITION
// ============================================================================

export const quoteCommand = {
  name:        'quote',
  description: 'Daily inspirational quotes (5 instant/day, 2 scheduled max)'
};

// ============================================================================
// HELPERS — REUSED ACROSS HANDLERS
// ============================================================================

/**
 * Return (and lazily initialise) the usage record for a user.
 * Resets the counter if more than 24 hours have passed.
 * @param {string} userId
 * @returns {{ count: number, lastReset: number }}
 */
function getUsage(userId) {
  if (!state.quoteUsage)         state.quoteUsage         = {};
  if (!state.quoteUsage[userId]) state.quoteUsage[userId] = { count: 0, lastReset: Date.now() };

  const usage = state.quoteUsage[userId];
  if (Date.now() - usage.lastReset > ONE_DAY_MS) {
    usage.count     = 0;
    usage.lastReset = Date.now();
  }
  return usage;
}

/**
 * Count how many scheduled quotes a user already has.
 * Keys are either `"userId"` (first slot) or `"userId_N"` (subsequent slots).
 * @param {string} userId
 * @returns {number}
 */
function countScheduled(userId) {
  if (!state.dailyQuotes) return 0;
  return Object.keys(state.dailyQuotes)
    .filter(k => k === userId || k.startsWith(userId + '_'))
    .length;
}

// ============================================================================
// ENTRY POINT
// ============================================================================

const ACCENT_COLOR     = 0xE53935;
const IS_COMPONENTS_V2 = 1 << 15;

/**
 * @param {import('discord.js').CommandInteraction} interaction
 */
export async function handleQuoteCommand(interaction) {
  try {
    const userId         = interaction.user.id;
    const usage          = getUsage(userId);
    const scheduledCount = countScheduled(userId);
    const remaining      = MAX_QUOTES_PER_DAY - usage.count;

    const actionSelect = new StringSelectMenuBuilder()
      .setCustomId('quote_action')
      .setPlaceholder('Choose an action')
      .addOptions(
        { label: 'Get Quote Now',           value: 'now',    description: `Instant quote (${remaining} left)`,                                    emoji: '💭' },
        { label: 'Set Daily Quote',         value: 'setup',  description: `Schedule automatic quotes (${scheduledCount}/${MAX_SCHEDULED_QUOTES_PER_USER})`, emoji: '⏰' },
        { label: 'View Scheduled Quotes',   value: 'view',   description: 'See your scheduled quotes',                                            emoji: '📋' },
        { label: 'Remove Daily Quote',      value: 'remove', description: 'Stop a scheduled quote',                                               emoji: '🗑️' }
      );

    const container = new ContainerBuilder().setAccentColor(ACCENT_COLOR);
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        '**Daily Quote**\n' +
        'Get an instant quote or schedule one to be delivered at a set time each day.\n\n' +
        `**Instant Quotes:** ${usage.count}/${MAX_QUOTES_PER_DAY} used today\n` +
        `**Scheduled Quotes:** ${scheduledCount}/${MAX_SCHEDULED_QUOTES_PER_USER} active\n` +
        `**Resets:** ${new Date(usage.lastReset + ONE_DAY_MS).toLocaleString()}`
      )
    );
    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));
    container.addActionRowComponents(new ActionRowBuilder().addComponents(actionSelect));

    await interaction.reply({
      components: [container],
      flags: MessageFlags.Ephemeral | IS_COMPONENTS_V2
    });

    // Auto-delete after 3 minutes if unused
    setTimeout(() => interaction.deleteReply().catch(() => {}), MENU_AUTO_DELETE_MS);
  } catch (error) {
    logger.error('handleQuoteCommand failed', error);
  }
}

// ============================================================================
// SELECT MENU HANDLERS
// ============================================================================

/**
 * Route Now / Setup / View / Remove.
 * @param {import('discord.js').StringSelectMenuInteraction} interaction
 */
export async function handleQuoteActionSelect(interaction) {
  try {
    const action = interaction.values[0];
    if      (action === 'now')    await sendQuoteNow(interaction);
    else if (action === 'setup')  await showQuoteSetup(interaction);
    else if (action === 'view')   await viewScheduledQuotes(interaction);
    else if (action === 'remove') await removeQuoteSetup(interaction);
  } catch (error) {
    logger.error('handleQuoteActionSelect failed', error);
  }
}

/**
 * Category selected → show time picker.
 * @param {import('discord.js').StringSelectMenuInteraction} interaction
 */
export async function handleQuoteCategorySelect(interaction) {
  try {
    const category = interaction.values[0];

    const embed = new EmbedBuilder()
      .setColor(0x9B59B6)
      .setTitle('✨ Daily Quote Setup — Time')
      .setDescription(`Category: **${category}**\n\nWhat time should I send your daily quote? (24 h)`)
      .setFooter({ text: 'Times are in your local timezone if set via /timezone' });

    const timeSelect = new StringSelectMenuBuilder()
      .setCustomId(`quote_time_${category}`)
      .setPlaceholder('Select time')
      .addOptions(
        { label: '06:00 (Morning)',      value: '06:00', emoji: '🌅' },
        { label: '09:00 (Start of day)', value: '09:00', emoji: '☕' },
        { label: '12:00 (Noon)',         value: '12:00', emoji: '🌞' },
        { label: '18:00 (Evening)',      value: '18:00', emoji: '🌆' },
        { label: '21:00 (Night)',        value: '21:00', emoji: '🌙' }
      );

    await interaction.update({
      embeds:     [embed],
      components: [new ActionRowBuilder().addComponents(timeSelect)]
    });
  } catch (error) {
    logger.error('handleQuoteCategorySelect failed', error);
  }
}

/**
 * Time selected → show location picker (DM vs server).
 * customId pattern: `quote_time_<category>`
 * @param {import('discord.js').StringSelectMenuInteraction} interaction
 */
export async function handleQuoteTimeSelect(interaction) {
  try {
    const category = interaction.customId.split('_')[2];
    const time     = interaction.values[0];
    const guildId  = interaction.guild?.id;

    const embed = new EmbedBuilder()
      .setColor(0x9B59B6)
      .setTitle('✨ Daily Quote Setup — Location')
      .setDescription(`Category: **${category}**\nTime: **${time}**\n\nWhere should I send your daily quote?`);

    const locationSelect = new StringSelectMenuBuilder()
      .setCustomId(`quote_location_${category}_${time.replace(':', '-')}`);

    if (guildId) {
      locationSelect.setPlaceholder('Choose delivery location').addOptions(
        { label: 'DM Only',        value: 'dm',     description: 'Receive in direct messages',    emoji: '📬' },
        { label: 'Server Channel', value: 'server', description: 'Post in a specific channel',    emoji: '💬' }
      );
    } else {
      locationSelect.setPlaceholder('Choose delivery location').addOptions(
        { label: 'DM', value: 'dm', description: 'Receive in direct messages', emoji: '📬' }
      );
    }

    await interaction.update({
      embeds:     [embed],
      components: [new ActionRowBuilder().addComponents(locationSelect)]
    });
  } catch (error) {
    logger.error('handleQuoteTimeSelect failed', error);
  }
}

/**
 * Location selected — if server, show channel picker; otherwise finalize.
 * customId pattern: `quote_location_<category>_<HH-MM>`
 * @param {import('discord.js').StringSelectMenuInteraction} interaction
 */
export async function handleQuoteLocationSelect(interaction) {
  try {
    const parts    = interaction.customId.split('_');
    const category = parts[2];
    const timeStr  = parts[3];
    const time     = timeStr.replace('-', ':');
    const location = interaction.values[0];

    if (location === 'server' && interaction.guild) {
      const embed = new EmbedBuilder()
        .setColor(0x9B59B6)
        .setTitle('✨ Daily Quote Setup — Channel')
        .setDescription('Select the channel where quotes should be posted:');

      const channelSelect = new ChannelSelectMenuBuilder()
        .setCustomId(`quote_channel_${category}_${timeStr}`)
        .setChannelTypes([ChannelType.GuildText, ChannelType.GuildAnnouncement])
        .setPlaceholder('Select a channel');

      return interaction.update({
        embeds:     [embed],
        components: [new ActionRowBuilder().addComponents(channelSelect)]
      });
    }

    await finalizeQuoteSetup(interaction, category, time, 'dm', null);
  } catch (error) {
    logger.error('handleQuoteLocationSelect failed', error);
  }
}

/**
 * Channel selected → finalize.
 * customId pattern: `quote_channel_<category>_<HH-MM>`
 * @param {import('discord.js').ChannelSelectMenuInteraction} interaction
 */
export async function handleQuoteChannelSelect(interaction) {
  try {
    const parts     = interaction.customId.split('_');
    const category  = parts[2];
    const time      = parts[3].replace('-', ':');
    const channelId = interaction.values[0];

    await finalizeQuoteSetup(interaction, category, time, 'server', channelId);
  } catch (error) {
    logger.error('handleQuoteChannelSelect failed', error);
  }
}

/**
 * Quote chosen for removal → delete.
 * @param {import('discord.js').StringSelectMenuInteraction} interaction
 */
export async function handleQuoteRemoveSelect(interaction) {
  try {
    const quoteKey = interaction.values[0];

    if (!state.dailyQuotes?.[quoteKey]) {
      const embed = new EmbedBuilder()
        .setColor(0xFF5555)
        .setTitle('❌ Quote Not Found')
        .setDescription('Could not find that scheduled quote.');
      return interaction.update({ embeds: [embed], components: [] });
    }

    const quote = state.dailyQuotes[quoteKey];
    delete state.dailyQuotes[quoteKey];

    // Cancel the live interval if registered
    if (interaction.client.quoteIntervals?.has(quoteKey)) {
      clearInterval(interaction.client.quoteIntervals.get(quoteKey));
      interaction.client.quoteIntervals.delete(quoteKey);
    }

    await db.deleteDailyQuote(quoteKey);
    await saveStateToFile();
    memorySystem.invalidatePersonalDataCache(interaction.user.id);

    const remaining = countScheduled(interaction.user.id);

    const embed = new EmbedBuilder()
      .setColor(0x00FF00)
      .setTitle('✅ Scheduled Quote Removed')
      .setDescription(
        `Removed ${quote.category} quote at ` +
        `${String(quote.hour).padStart(2, '0')}:${String(quote.minute).padStart(2, '0')}`
      )
      .setFooter({ text: `${remaining}/${MAX_SCHEDULED_QUOTES_PER_USER} scheduled quotes remaining` });

    await interaction.update({ embeds: [embed], components: [] });
  } catch (error) {
    logger.error('handleQuoteRemoveSelect failed', error);
  }
}

// ============================================================================
// PRIVATE — UI HELPERS
// ============================================================================

/**
 * "Get Quote Now" flow — defers, deletes menu, generates, posts publicly.
 * Rate-limited to MAX_QUOTES_PER_DAY per user.
 */
async function sendQuoteNow(interaction) {
  await interaction.deferUpdate();
  // Delete the ephemeral menu immediately
  await interaction.deleteReply().catch(() => {});

  const userId = interaction.user.id;
  const usage  = getUsage(userId);

  if (usage.count >= MAX_QUOTES_PER_DAY) {
    const hoursLeft = Math.ceil(
      (usage.lastReset + ONE_DAY_MS - Date.now()) / (60 * 60 * 1000)
    );
    const errorEmbed = new EmbedBuilder()
      .setColor(0xFF5555)
      .setTitle('❌ Daily Limit Reached')
      .setDescription(
        `You've used all ${MAX_QUOTES_PER_DAY} instant quotes for today.\n\n` +
        `**Resets in:** ${hoursLeft} hour${hoursLeft !== 1 ? 's' : ''}\n\n` +
        `*Scheduled quotes don't count toward this limit.*`
      );
    // Menu is gone; DM is the only available channel
    await interaction.user.send({ embeds: [errorEmbed] }).catch(err =>
      logger.error(`Could not send limit DM to ${userId}`, err)
    );
    return;
  }

  const quote = await generateQuote('inspirational');
  usage.count++;
  await saveStateToFile();

  const remaining = MAX_QUOTES_PER_DAY - usage.count;

  const embed = new EmbedBuilder()
    .setColor(0x9B59B6)
    .setTitle('💭 Quote of the Moment')
    .setDescription(quote)
    .setFooter({ text: `Requested by ${interaction.user.displayName} • ${remaining} left today` })
    .setTimestamp();

  await interaction.channel?.send({ embeds: [embed] }).catch(err =>
    logger.error('Error sending public quote', err)
  );
}

/** Show category picker for scheduled setup. */
async function showQuoteSetup(interaction) {
  try {
    const userId         = interaction.user.id;
    const scheduledCount = countScheduled(userId);

    if (scheduledCount >= MAX_SCHEDULED_QUOTES_PER_USER) {
      const embed = new EmbedBuilder()
        .setColor(0xFF5555)
        .setTitle('❌ Scheduled Quote Limit')
        .setDescription(
          `You have reached the maximum of ${MAX_SCHEDULED_QUOTES_PER_USER} scheduled quotes.\n\n` +
          `Please remove one before adding another using \`/quote action:remove\``
        )
        .setFooter({ text: `${scheduledCount}/${MAX_SCHEDULED_QUOTES_PER_USER} scheduled quotes active` });
      return interaction.update({ embeds: [embed], components: [] });
    }

    const embed = new EmbedBuilder()
      .setColor(0x9B59B6)
      .setTitle('✨ Daily Quote Setup — Category')
      .setDescription(
        `What type of quotes do you prefer?\n\n` +
        `**Active Scheduled Quotes:** ${scheduledCount}/${MAX_SCHEDULED_QUOTES_PER_USER}`
      )
      .setFooter({ text: "Scheduled quotes don't count toward your 5/day instant quote limit" });

    const categorySelect = new StringSelectMenuBuilder()
      .setCustomId('quote_category')
      .setPlaceholder('Select quote category')
      .addOptions(
        { label: 'Inspirational', value: 'inspirational', description: 'Motivational and uplifting',   emoji: '🌟' },
        { label: 'Funny',         value: 'funny',         description: 'Humor and wit',                emoji: '😂' },
        { label: 'Wisdom',        value: 'wisdom',        description: 'Philosophical and thoughtful', emoji: '🧠' },
        { label: 'Love',          value: 'love',          description: 'Romance and relationships',    emoji: '💖' },
        { label: 'Success',       value: 'success',       description: 'Achievement and growth',       emoji: '🎯' }
      );

    await interaction.update({
      embeds:     [embed],
      components: [new ActionRowBuilder().addComponents(categorySelect)]
    });
  } catch (error) {
    logger.error('showQuoteSetup failed', error);
  }
}

/** Show the user's active scheduled quotes. */
async function viewScheduledQuotes(interaction) {
  try {
    const userId     = interaction.user.id;
    const userQuotes = Object.entries(state.dailyQuotes ?? {}).filter(
      ([k]) => k === userId || k.startsWith(userId + '_')
    );

    if (userQuotes.length === 0) {
      const embed = new EmbedBuilder()
        .setColor(0xFF5555)
        .setTitle('📋 No Scheduled Quotes')
        .setDescription("You don't have any scheduled quotes set up.\n\nUse `/quote action:setup` to create one!");
      return interaction.update({ embeds: [embed], components: [] });
    }

    const list = userQuotes.map(([, data], i) => {
      const time     = `${String(data.hour).padStart(2, '0')}:${String(data.minute).padStart(2, '0')}`;
      const location = data.location === 'dm' ? 'DMs' : `<#${data.channelId}>`;
      return `**${i + 1}.** ${data.category} quote at ${time} → ${location}`;
    }).join('\n');

    const embed = new EmbedBuilder()
      .setColor(0x9B59B6)
      .setTitle('📋 Your Scheduled Quotes')
      .setDescription(list)
      .setFooter({ text: `${userQuotes.length}/${MAX_SCHEDULED_QUOTES_PER_USER} scheduled quotes • These don't count toward your 5/day limit` });

    await interaction.update({ embeds: [embed], components: [] });
  } catch (error) {
    logger.error('viewScheduledQuotes failed', error);
  }
}

/** Show dropdown to pick a quote to remove. */
async function removeQuoteSetup(interaction) {
  try {
    const userId     = interaction.user.id;
    const userQuotes = Object.entries(state.dailyQuotes ?? {}).filter(
      ([k]) => k === userId || k.startsWith(userId + '_')
    );

    if (userQuotes.length === 0) {
      const embed = new EmbedBuilder()
        .setColor(0xFF5555)
        .setTitle('❌ No Scheduled Quotes')
        .setDescription("You don't have any scheduled quotes to remove.\n\nUse `/quote action:setup` to create one!");
      return interaction.update({ embeds: [embed], components: [] });
    }

    const embed = new EmbedBuilder()
      .setColor(0xFF6B6B)
      .setTitle('🗑️ Remove Scheduled Quote')
      .setDescription('Select which scheduled quote to remove:');

    const removeSelect = new StringSelectMenuBuilder()
      .setCustomId('quote_remove_select')
      .setPlaceholder('Choose quote to remove')
      .addOptions(
        userQuotes.map(([key, data], i) => {
          const time     = `${String(data.hour).padStart(2, '0')}:${String(data.minute).padStart(2, '0')}`;
          const location = data.location === 'dm' ? 'DMs' : 'Server';
          return { label: `${i + 1}. ${data.category} at ${time}`, description: `Sent to ${location}`, value: key };
        })
      );

    await interaction.update({
      embeds:     [embed],
      components: [new ActionRowBuilder().addComponents(removeSelect)]
    });
  } catch (error) {
    logger.error('removeQuoteSetup failed', error);
  }
}

/**
 * Persist and activate a new scheduled quote entry.
 * @param {import('discord.js').Interaction} interaction
 * @param {string}      category
 * @param {string}      time        "HH:MM"
 * @param {'dm'|'server'} location
 * @param {string|null} channelId
 */
async function finalizeQuoteSetup(interaction, category, time, location, channelId) {
  try {
    const userId         = interaction.user.id;
    const guildId        = interaction.guild?.id;
    const scheduledCount = countScheduled(userId);

    if (scheduledCount >= MAX_SCHEDULED_QUOTES_PER_USER) {
      const embed = new EmbedBuilder()
        .setColor(0xFF5555)
        .setTitle('❌ Scheduled Quote Limit')
        .setDescription(`You have reached the maximum of ${MAX_SCHEDULED_QUOTES_PER_USER} scheduled quotes.`);
      return interaction.update({ embeds: [embed], components: [] });
    }

    const [hour, minute] = time.split(':').map(Number);
    // Key is just userId for the first slot, userId_N for subsequent
    const quoteKey = scheduledCount === 0 ? userId : `${userId}_${scheduledCount + 1}`;

    if (!state.dailyQuotes) state.dailyQuotes = {};
    state.dailyQuotes[quoteKey] = { category, hour, minute, location, channelId, guildId, active: true };

    await db.saveDailyQuote(quoteKey, state.dailyQuotes[quoteKey]);
    await saveStateToFile();
    memorySystem.invalidatePersonalDataCache(userId);

    scheduleDailyQuote(interaction.client, quoteKey, state.dailyQuotes[quoteKey]);

    const locationText = location === 'dm' ? 'your DMs' : `<#${channelId}>`;
    const newCount     = scheduledCount + 1;

    const embed = new EmbedBuilder()
      .setColor(0x00FF00)
      .setTitle('✅ Daily Quote Activated!')
      .setDescription(
        `**Category:** ${category}\n**Time:** ${time}\n**Location:** ${locationText}\n\n` +
        `You'll receive a quote every day at this time! ✨\n\n` +
        `*Scheduled quotes don't count toward your 5/day instant quote limit.*`
      )
      .setFooter({ text: `${newCount}/${MAX_SCHEDULED_QUOTES_PER_USER} scheduled quotes active • Use /quote to manage` });

    await interaction.update({ embeds: [embed], components: [] });
  } catch (error) {
    logger.error('finalizeQuoteSetup failed', error);
  }
}
