/**
 * @fileoverview Runtime execution of Gemini function calls.
 *               Each handler is a focused async function; `executeFunctionCalls`
 *               fans out all calls in parallel and returns the API-shaped results.
 * @module modules/functions/FunctionExecutor
 */

import * as db                   from '../../database/index.js';
import { memorySystem }          from '../../memory/MemorySystem.js';
import { state, saveStateToFile, client } from '../../managers/BotManager.js';
import { scheduleReminder }      from '../../commands/reminder/ReminderScheduler.js';
import { parseRelativeTime }     from '../../utils.js';
import { formatDuration }        from '../shared/messageFormatter.js';
import { Logger }                from '../../core/Logger.js';
import { FUNCTION_NAMES, MEMORY_ACTIONS } from './FunctionRegistry.js';

const logger = Logger.get('FunctionExecutor');

// ============================================================================
// RESPONSE STRING CONSTANTS
// ============================================================================

const MSG = Object.freeze({
  MEMORY_ADD_SUCCESS:  'Memory added',
  MEMORY_REMOVE_SUCCESS: 'Memory removed',
  NO_MEMORIES_FOUND:   'No relevant memories found.',
  REMINDER_SET:        'Reminder set for',
  BIRTHDAY_SET:        'Birthday set to',
  TIMEZONE_SET:        'Timezone set to',
  TIME_CHECKED:        'Time elapsed since last message:',
  OPERATION_FAILED:    'Failed'
});

// ============================================================================
// PRIVATE HELPERS
// ============================================================================

/**
 * Left-pad a date component to a fixed width.
 * @param {number} value
 * @param {number} padLength
 * @returns {string}
 */
function padDateComponent(value, padLength) {
  return String(value).padStart(padLength, '0');
}

/** Generate a timestamp-based reminder ID. */
function generateReminderId() {
  return Date.now().toString();
}

/**
 * Build a new reminder object with all required fields.
 * @param {string}      userId
 * @param {string}      message
 * @param {Date}        timeDate
 * @param {string|null} [channelId]
 * @returns {object}
 */
function createReminderObject(userId, message, timeDate, channelId = null) {
  return {
    id:        generateReminderId(),
    userId,
    message,
    time:      timeDate.getTime(),
    channelId,
    active:    true
  };
}

/**
 * Ensure `state.reminders[userId]` is initialised.
 * @param {string} userId
 */
function initializeUserReminders(userId) {
  if (!state.reminders) state.reminders = {};
  if (!state.reminders[userId]) state.reminders[userId] = [];
}

/**
 * Build the birthday data object for DB persistence.
 * @param {number}      month
 * @param {number}      day
 * @param {string|null} guildId
 * @returns {object}
 */
function createBirthdayData(month, day, guildId) {
  return {
    month:      padDateComponent(month, 2),
    day:        padDateComponent(day, 2),
    nameType:   'self',
    preference: 'both',
    guildId
  };
}

// ============================================================================
// INDIVIDUAL FUNCTION HANDLERS
// ============================================================================

/**
 * Handle `manage_personal_memory` — add or remove a user fact.
 * @param {string} userId
 * @param {string} action - 'add' | 'remove'
 * @param {string} info
 * @returns {Promise<{ result: string }>}
 */
async function handleManageMemory(userId, action, info) {
  if (action === MEMORY_ACTIONS.ADD) {
    await memorySystem.addPersonalData(userId, info);
    return { result: `${MSG.MEMORY_ADD_SUCCESS}: ${info}` };
  }
  await memorySystem.removePersonalData(userId, info);
  return { result: `${MSG.MEMORY_REMOVE_SUCCESS}: ${info}` };
}

/**
 * Handle `search_memory` — vector-search past conversations.
 * @param {string}      userId
 * @param {string|null} guildId
 * @param {string}      query
 * @returns {Promise<{ result: string }>}
 */
async function handleSearchMemory(userId, guildId, query) {
  const memories = await memorySystem.searchMemory(userId, guildId, query);
  return {
    result: memories.length > 0 ? memories.join('\n') : MSG.NO_MEMORIES_FOUND
  };
}

/**
 * Handle `set_reminder` — parse relative time, persist, and schedule the reminder.
 *
 * BUG FIX (original): `parseRelativeTime` was loaded via dynamic
 * `import('./utils.js')` on every invocation. Now it is a static top-level
 * import, which avoids repeated module resolution overhead and makes the
 * dependency visible at load time.
 *
 * @param {string} userId
 * @param {string} message
 * @param {string} timeRelative  - e.g. "5 minutes", "tomorrow at 10am"
 * @returns {Promise<{ result: string }>}
 */
async function handleSetReminder(userId, message, timeRelative) {
  const timeDate = parseRelativeTime(timeRelative);
  const reminder = createReminderObject(userId, message, timeDate);

  initializeUserReminders(userId);
  state.reminders[userId].push(reminder);

  await db.saveReminder(userId, reminder);
  await saveStateToFile();

  scheduleReminder(client, reminder);
  memorySystem.invalidatePersonalDataCache(userId);

  return { result: `${MSG.REMINDER_SET} ${timeDate.toLocaleString()}` };
}

/**
 * Handle `set_birthday` — persist the user's birthday.
 * @param {string}      userId
 * @param {number}      month
 * @param {number}      day
 * @param {string|null} guildId
 * @returns {Promise<{ result: string }>}
 */
async function handleSetBirthday(userId, month, day, guildId) {
  const birthdayKey  = `${userId}_${month}_${day}`;
  const birthdayData = createBirthdayData(month, day, guildId);

  await db.saveBirthday(birthdayKey, birthdayData);
  memorySystem.invalidatePersonalDataCache(userId);

  return { result: `${MSG.BIRTHDAY_SET} ${month}/${day}` };
}

/**
 * Handle `set_timezone` — persist the user's IANA timezone.
 * @param {string} userId
 * @param {string} timezone
 * @returns {Promise<{ result: string }>}
 */
async function handleSetTimezone(userId, timezone) {
  await db.saveUserTimezone(userId, timezone);
  memorySystem.invalidatePersonalDataCache(userId);

  return { result: `${MSG.TIMEZONE_SET} ${timezone}` };
}

/**
 * Handle `check_time_elapsed` — calculate time since the last history entry.
 *
 * BUG FIX (original): used `for...in` with `hasOwnProperty` to iterate history.
 * Replaced with `Object.keys()`.
 *
 * BUG FIX (original): called `memorySystem.formatDuration()` which no longer
 * exists as a public method. Now imports `formatDuration` from shared
 * `messageFormatter.js`.
 *
 * @param {string|null} historyId
 * @param {string}      userId
 * @param {string|null} guildId
 * @returns {Promise<{ result: string }>}
 */
async function handleCheckTimeElapsed(historyId, userId, guildId) {
  const targetId = historyId || guildId || userId;
  try {
    const allHistory = await db.getChatHistory(targetId);
    if (!allHistory) return { result: 'No conversation history found.' };

    // BUG FIX: Object.keys() instead of for...in + hasOwnProperty
    const historyArray = [];
    for (const key of Object.keys(allHistory)) {
      historyArray.push(...(allHistory[key] || []));
    }

    if (historyArray.length === 0) return { result: 'No previous messages found.' };

    historyArray.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
    const lastMsg = historyArray[historyArray.length - 1];
    const diff    = Date.now() - (lastMsg.timestamp || Date.now());

    // BUG FIX: formatDuration imported from shared module, not called on memorySystem
    return { result: `${MSG.TIME_CHECKED} ${formatDuration(diff)}` };
  } catch (error) {
    logger.error('Error checking time elapsed', error);
    return { result: `${MSG.OPERATION_FAILED}: ${error.message}` };
  }
}

// ============================================================================
// MAIN DISPATCHER
// ============================================================================

/**
 * Execute all function calls produced by the model in a single turn.
 * Calls are processed in parallel; each call is individually try-caught so
 * one failure does not abort the others.
 *
 * Returns an array of `{ functionResponse: { name, response } }` objects
 * ready to be included in the next Gemini `contents` turn.
 *
 * @param {object[]}    calls      - array of { name: string, args: object }
 * @param {string}      userId
 * @param {string|null} guildId
 * @param {string|null} historyId
 * @returns {Promise<object[]>}
 */
export async function executeFunctionCalls(calls, userId, guildId, historyId) {
  return Promise.all(
    calls.map(async (call) => {
      const args = call.args || {};
      let response = {};

      try {
        switch (call.name) {
          case FUNCTION_NAMES.MANAGE_MEMORY:
            response = await handleManageMemory(userId, args.action, args.info);
            break;

          case FUNCTION_NAMES.SEARCH_MEMORY:
            response = await handleSearchMemory(userId, guildId, args.query);
            break;

          case FUNCTION_NAMES.SET_REMINDER:
            response = await handleSetReminder(userId, args.message, args.time_relative);
            break;

          case FUNCTION_NAMES.SET_BIRTHDAY:
            response = await handleSetBirthday(userId, args.month, args.day, guildId);
            break;

          case FUNCTION_NAMES.SET_TIMEZONE:
            response = await handleSetTimezone(userId, args.timezone);
            break;

          case FUNCTION_NAMES.CHECK_TIME:
            response = await handleCheckTimeElapsed(historyId, userId, guildId);
            break;

          default:
            logger.warn(`Unknown function call received: ${call.name}`);
            response = { error: `Unknown function: ${call.name}` };
        }
      } catch (error) {
        logger.error(`Error executing function "${call.name}"`, error);
        response = { error: `${MSG.OPERATION_FAILED}: ${error.message}` };
      }

      return {
        functionResponse: {
          name:     call.name,
          response: response
        }
      };
    })
  );
}
