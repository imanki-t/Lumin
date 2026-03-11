/**
 * @fileoverview Reminder background scheduler — registers per-reminder intervals,
 *               triggers delivery via DM and/or server channel, and self-cleans
 *               one-time reminders after firing.
 *
 *               No interaction handling lives here; that's in ReminderHandler.js.
 * @module commands/reminder/ReminderScheduler
 */

import { EmbedBuilder } from 'discord.js';

import { state, saveStateToFile }  from '../../managers/BotManager.js';
import { memorySystem }             from '../../memory/MemorySystem.js';
import * as db                      from '../../database/index.js';
import { getUserTime }               from '../timezone.js';
import { Logger }                   from '../../core/Logger.js';

const logger = Logger.get('ReminderScheduler');

/** Check every 45 s so we never miss a minute boundary due to execution drift. */
const CHECK_INTERVAL_MS = 45 * 1000;

// ============================================================================
// PUBLIC
// ============================================================================

/**
 * Register a repeating 45-second check for a single reminder.
 * Stores the intervalId on `client.reminderIntervals` (Map) so it can be
 * cancelled on deletion.
 *
 * @param {import('discord.js').Client} client
 * @param {object} reminder  Reminder record from state.reminders[userId][].
 */
export function scheduleReminder(client, reminder) {
  if (!client.reminderIntervals) client.reminderIntervals = new Map();

  const intervalId = setInterval(
    () => checkAndTrigger(client, reminder),
    CHECK_INTERVAL_MS
  );

  client.reminderIntervals.set(reminder.id, intervalId);
}

/**
 * Re-register all active reminders from state on bot startup.
 * Called once from commands/index.js → initializeScheduledTasks.
 *
 * @param {import('discord.js').Client} client
 */
export function initializeReminders(client) {
  if (!state.reminders) return;

  let count = 0;
  for (const userId of Object.keys(state.reminders)) {
    for (const reminder of state.reminders[userId]) {
      if (reminder.active) {
        scheduleReminder(client, reminder);
        count++;
      }
    }
  }

  logger.info(`Reminder scheduler started — ${count} active reminder(s) registered`);
}

// ============================================================================
// PRIVATE — TRIGGER LOGIC
// ============================================================================

/**
 * Called every CHECK_INTERVAL_MS per reminder.
 * Compares current user-local time against the stored trigger components.
 *
 * @param {import('discord.js').Client} client
 * @param {object} reminder
 */
async function checkAndTrigger(client, reminder) {
  if (!reminder.active) return;

  try {
    const userId  = reminder.id.split('_')[0];
    const userNow = getUserTime(userId);

    if (!shouldTrigger(reminder, userNow)) return;

    await sendReminder(client, reminder);

    // One-time reminders: hard-delete after firing
    if (reminder.type === 'once') {
      const idx = state.reminders[userId]?.findIndex(r => r.id === reminder.id) ?? -1;
      if (idx !== -1) state.reminders[userId].splice(idx, 1);

      await db.deleteReminder(reminder.id);
      await saveStateToFile();

      if (client.reminderIntervals?.has(reminder.id)) {
        clearInterval(client.reminderIntervals.get(reminder.id));
        client.reminderIntervals.delete(reminder.id);
      }

      memorySystem.invalidatePersonalDataCache(userId);
    }
  } catch (error) {
    logger.error(`checkAndTrigger failed for reminder ${reminder.id}`, error);
  }
}

/**
 * Pure time-comparison logic — no side effects.
 * @param {object} reminder
 * @param {Date}   userNow   Date in the user's local timezone (from getUserTime).
 * @returns {boolean}
 */
function shouldTrigger(reminder, userNow) {
  const t = reminder.time;

  switch (reminder.type) {
    case 'once': {
      // Compare as YYYYMMDDHHMM integers — triggers if now >= target
      const nowVal =
        userNow.getFullYear()  * 100_000_000 +
        (userNow.getMonth() + 1) * 1_000_000  +
        userNow.getDate()      * 10_000       +
        userNow.getHours()     * 100           +
        userNow.getMinutes();

      const targetVal =
        t.year  * 100_000_000 +
        t.month * 1_000_000   +
        t.day   * 10_000      +
        t.hour  * 100         +
        t.minute;

      return nowVal >= targetVal;
    }

    case 'daily':
      return userNow.getHours() === t.hour && userNow.getMinutes() === t.minute;

    case 'weekly':
      return (
        userNow.getDay()     === t.day &&
        userNow.getHours()   === t.hour &&
        userNow.getMinutes() === t.minute
      );

    case 'monthly':
      return (
        userNow.getDate()    === t.day &&
        userNow.getHours()   === t.hour &&
        userNow.getMinutes() === t.minute
      );

    default:
      return false;
  }
}

// ============================================================================
// PRIVATE — DELIVERY
// ============================================================================

/**
 * Send the reminder embed to the user's DM and/or a server channel.
 * @param {import('discord.js').Client} client
 * @param {object} reminder
 */
async function sendReminder(client, reminder) {
  const userId = reminder.id.split('_')[0];
  const user   = await client.users.fetch(userId).catch(() => null);
  if (!user) return;

  const embed = new EmbedBuilder()
    .setColor(0xFF8C00)
    .setTitle('⏰ Reminder!')
    .setDescription(reminder.message)
    .setFooter({ text: `Type: ${reminder.type}` })
    .setTimestamp();

  // --- DM ---
  if (reminder.location === 'dm' || reminder.location === 'both') {
    await user.send({ embeds: [embed] }).catch(err =>
      logger.error(`Reminder DM failed for user ${userId}`, err)
    );
  }

  // --- Server ---
  if ((reminder.location === 'server' || reminder.location === 'both') && reminder.guildId) {
    try {
      const guild = client.guilds.cache.get(reminder.guildId);
      if (!guild) return;

      const channel = guild.channels.cache.find(ch =>
        ch.isTextBased() &&
        guild.members.me &&
        ch.permissionsFor(guild.members.me)?.has('SendMessages')
      );

      if (channel) {
        await channel.send({ content: `<@${userId}>`, embeds: [embed] });
      }
    } catch (err) {
      logger.error(`Reminder server delivery failed for guild ${reminder.guildId}`, err);
    }
  }
}
