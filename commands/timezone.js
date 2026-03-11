/**
 * @fileoverview /timezone command — set and manage user timezones.
 *               Used by birthday, reminder, and quote commands for local-time scheduling.
 * @module commands/timezone
 */

import {
  EmbedBuilder,
  MessageFlags,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle
} from 'discord.js';

import { state, saveStateToFile } from '../managers/BotManager.js';
import { memorySystem }           from '../memory/MemorySystem.js';
import * as db                    from '../database/index.js';
import { Logger }                 from '../core/Logger.js';

const logger = Logger.get('TimezoneCommand');

// ============================================================================
// COMMAND DEFINITION
// ============================================================================

export const timezoneCommand = {
  name:        'timezone',
  description: 'Set your timezone for time-based features (birthdays, reminders, quotes)'
};

// ============================================================================
// HANDLERS
// ============================================================================

/**
 * Entry point — show current timezone + "Set Custom Timezone" button.
 * @param {import('discord.js').CommandInteraction} interaction
 */
export async function handleTimezoneCommand(interaction) {
  const userId    = interaction.user.id;
  const currentTz = state.userTimezones?.[userId] || 'Not set (using UTC)';

  let currentTime;
  try {
    const tz    = state.userTimezones?.[userId] || 'UTC';
    currentTime = new Date().toLocaleString('en-US', {
      timeZone:  tz,
      dateStyle: 'full',
      timeStyle: 'short'
    });
  } catch {
    currentTime = 'Unknown';
  }

  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle('🌍 Timezone Setup')
    .setDescription(
      `Set your timezone to ensure reminders and events happen at your local time.\n\n` +
      `**Current Setting:** \`${currentTz}\`\n**Your Time:** ${currentTime}`
    )
    .setFooter({ text: 'We use standard IANA timezone IDs (e.g., America/New_York)' });

  const customButton = new ButtonBuilder()
    .setCustomId('timezone_custom')
    .setLabel('Set Custom Timezone')
    .setStyle(ButtonStyle.Primary)
    .setEmoji('⌨️');

  await interaction.reply({
    embeds:     [embed],
    components: [new ActionRowBuilder().addComponents(customButton)],
    flags:      MessageFlags.Ephemeral
  });
}

/**
 * Show the timezone input modal when the "Set Custom Timezone" button is clicked.
 * @param {import('discord.js').ButtonInteraction} interaction
 */
export async function handleTimezoneCustomButton(interaction) {
  const userId    = interaction.user.id;
  const currentTz = state.userTimezones?.[userId] || '';

  const input = new TextInputBuilder()
    .setCustomId('timezone_input')
    .setLabel('Enter IANA Timezone ID')
    .setPlaceholder('e.g., America/New_York, Asia/Tokyo, UTC')
    .setStyle(TextInputStyle.Short)
    .setRequired(true);

  if (currentTz) input.setValue(currentTz);

  const modal = new ModalBuilder()
    .setCustomId('timezone_modal')
    .setTitle('Set Timezone')
    .addComponents(new ActionRowBuilder().addComponents(input));

  await interaction.showModal(modal);
}

/**
 * Process modal submission — validate timezone and persist it.
 * @param {import('discord.js').ModalSubmitInteraction} interaction
 */
export async function handleTimezoneCustomModal(interaction) {
  const timezoneInput = interaction.fields.getTextInputValue('timezone_input').trim();
  const userId        = interaction.user.id;

  try {
    // Validate via Intl.DateTimeFormat — throws if timezone is invalid
    const resolved     = new Intl.DateTimeFormat('en-US', { timeZone: timezoneInput }).resolvedOptions();
    const validTimezone = resolved.timeZone;

    await saveTimezone(userId, validTimezone);
    memorySystem.invalidatePersonalDataCache(userId);

    const currentTime = new Date().toLocaleString('en-US', {
      timeZone:  validTimezone,
      dateStyle: 'full',
      timeStyle: 'short'
    });

    const embed = new EmbedBuilder()
      .setColor(0x00FF00)
      .setTitle('✅ Timezone Set')
      .setDescription(`Your timezone has been updated to **${validTimezone}**`)
      .addFields({ name: '🕐 Current Local Time', value: currentTime })
      .setFooter({ text: 'All reminders and schedules will now follow this timezone.' });

    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });

  } catch (error) {
    // Only log unexpected errors — invalid timezone is expected user input
    if (!(error instanceof RangeError)) {
      logger.error('Unexpected error in handleTimezoneCustomModal', error);
    }

    const embed = new EmbedBuilder()
      .setColor(0xFF5555)
      .setTitle('❌ Invalid Timezone')
      .setDescription(
        `\`${timezoneInput}\` is not a valid timezone identifier supported by this server.\n\n` +
        `**Common Examples:**\n\`America/New_York\`\n\`Europe/London\`\n\`Asia/Tokyo\`\n\`Australia/Sydney\`\n\`UTC\``
      );

    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  }
}

// No-op stubs — kept so index.js import map compiles without errors
export async function handleTimezoneSelect(interaction) {}
export async function handleTimezoneNextPage(interaction) {}
export async function handleTimezonePrevPage(interaction) {}

// ============================================================================
// PRIVATE HELPERS
// ============================================================================

/**
 * Persist a user's timezone to both state and DB.
 * @param {string} userId
 * @param {string} timezone
 */
async function saveTimezone(userId, timezone) {
  if (!state.userTimezones) state.userTimezones = {};
  state.userTimezones[userId] = timezone;
  await db.saveUserTimezone(userId, timezone);
  await saveStateToFile();
}

// ============================================================================
// EXPORTED TIME UTILITIES  (used by birthday, reminder, quote)
// ============================================================================

/**
 * Return a Date object with hours/minutes shifted to the user's local timezone.
 * Use `.getHours()`, `.getMinutes()` etc. on the returned object for local-time comparisons.
 *
 * @param {string} userId
 * @param {Date}   [date=new Date()]
 * @returns {Date}
 */
export function getUserTime(userId, date = new Date()) {
  const timezone = state.userTimezones?.[userId] || 'UTC';
  try {
    return new Date(date.toLocaleString('en-US', { timeZone: timezone }));
  } catch (error) {
    logger.error('Error getting user time', error);
    return date;
  }
}

/**
 * Returns true if the current hour in the user's timezone matches `targetHour`.
 * @param {string} userId
 * @param {number} targetHour
 * @returns {boolean}
 */
export function isUserHour(userId, targetHour) {
  return getUserTime(userId).getHours() === targetHour;
}

/**
 * Returns a Date set to midnight (00:00:00) in the user's local timezone.
 * @param {string} userId
 * @returns {Date}
 */
export function getUserMidnight(userId) {
  const d = getUserTime(userId);
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Format a Date in the user's local timezone for display.
 * @param {string} userId
 * @param {Date}   date
 * @returns {string}
 */
export function formatTimeForUser(userId, date) {
  const timezone = state.userTimezones?.[userId] || 'UTC';
  try {
    return date.toLocaleString('en-US', {
      timeZone:  timezone,
      dateStyle: 'medium',
      timeStyle: 'short'
    });
  } catch {
    return date.toLocaleString();
  }
}
