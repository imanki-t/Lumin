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

/** M-11 fix: generate collision-safe reminder ID (timestamp + random suffix). */
function generateReminderId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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
 * Stores month/day as zero-padded strings for consistent DB format.
 * L-16 fix: document that month/day must be parsed with parseInt when read back.
 * @param {number}      month
 * @param {number}      day
 * @param {string|null} guildId
 * @returns {object}
 */
function createBirthdayData(month, day, guildId) {
  return {
    month:      padDateComponent(parseInt(month, 10), 2),  // L-16: ensure int before padding
    day:        padDateComponent(parseInt(day, 10), 2),
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
 * Handle `manage_server_fact` — add or remove a guild-scoped shared fact.
 * These facts are visible to ALL users in the server, making it possible
 * to give consistent answers about inter-member relationships and server context.
 *
 * @param {string|null} guildId
 * @param {string}      action   - 'add' | 'remove'
 * @param {string}      info
 * @param {string}      [category='general']
 * @returns {Promise<{ result: string }>}
 */
async function handleManageServerFact(guildId, action, info, category = 'general') {
  if (!guildId) {
    return { result: 'Server facts are only available in guild (server) channels, not DMs.' };
  }
  try {
    if (action === MEMORY_ACTIONS.ADD) {
      await db.saveServerFact(guildId, info, category);
      return { result: `Server fact saved [${category}]: ${info}` };
    }
    const deleted = await db.deleteServerFact(guildId, info);
    return { result: deleted > 0 ? `Server fact removed (${deleted} entries)` : 'No matching server fact found.' };
  } catch (error) {
    logger.error('handleManageServerFact failed', error);
    return { result: `${MSG.OPERATION_FAILED}: ${error.message}` };
  }
}

/**
 * Handle `search_memory` — vector-search past conversations + stored facts.
 * Also searches server facts for the current guild AND cross-server facts if the
 * user is a member of other guilds the bot is in.
 *
 * @param {string}      userId
 * @param {string|null} guildId
 * @param {string}      historyId
 * @param {string}      query
 * @returns {Promise<{ result: string }>}
 */
async function handleSearchMemory(userId, guildId, historyId, query) {
  // ── 1. Core RAG + user facts search ─────────────────────────────────────
  const memories = await memorySystem.searchMemory(userId, guildId, historyId, query);

  // ── 2. Current guild server facts (keyword match) ────────────────────────
  const serverFactResults = [];
  if (guildId) {
    try {
      const serverFacts = await db.getServerFacts(guildId);
      const queryLower  = query.toLowerCase();
      const queryWords  = queryLower.split(/\s+/).filter(w => w.length > 2);
      const matched = serverFacts.filter(f =>
        queryWords.some(w => f.toLowerCase().includes(w))
      );
      matched.forEach(f => serverFactResults.push(`[Server Fact] ${f}`));
    } catch { /* non-fatal */ }
  }

  // ── 3. Cross-guild server facts (other servers this user is in) ──────────
  // Works when guild members are cached (standard for active guilds).
  const crossGuildResults = [];
  try {
    const otherGuildIds = client.guilds.cache
      .filter(g => g.members.cache.has(userId) && g.id !== guildId)
      .map(g => g.id);

    if (otherGuildIds.length > 0) {
      const crossFacts = await db.getServerFactsMultiGuild(otherGuildIds);
      const queryLower  = query.toLowerCase();
      const queryWords  = queryLower.split(/\s+/).filter(w => w.length > 2);
      const matched = crossFacts.filter(f =>
        queryWords.some(w => f.toLowerCase().includes(w))
      );
      matched.forEach(f => crossGuildResults.push(`[Cross-Server Fact] ${f}`));
    }
  } catch { /* non-fatal — cross-guild is best-effort */ }

  // ── 4. Merge all results ─────────────────────────────────────────────────
  const all = [...memories, ...serverFactResults, ...crossGuildResults];
  return {
    result: all.length > 0 ? all.join('\n') : MSG.NO_MEMORIES_FOUND
  };
}

/**
 * Handle `set_reminder` — parse relative time, persist, and schedule.
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

  // L-15 fix: only save the specific reminder — no need for full saveStateToFile()
  await db.saveReminder(userId, reminder);

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

    const historyArray = [];
    for (const key of Object.keys(allHistory)) {
      historyArray.push(...(allHistory[key] || []));
    }

    if (historyArray.length === 0) return { result: 'No previous messages found.' };

    historyArray.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
    const lastMsg = historyArray[historyArray.length - 1];
    const diff    = Date.now() - (lastMsg.timestamp || Date.now());

    return { result: `${MSG.TIME_CHECKED} ${formatDuration(diff)}` };
  } catch (error) {
    logger.error('Error checking time elapsed', error);
    return { result: `${MSG.OPERATION_FAILED}: ${error.message}` };
  }
}

/**
 * Handle `get_message_timestamp` — find the exact timestamp of a message matching a query.
 * Uses vector search to locate the closest memory entry, then returns its stored timestamp.
 *
 * @param {string}      userId
 * @param {string|null} guildId
 * @param {string|null} historyId
 * @param {string}      query
 * @returns {Promise<{ result: string }>}
 */
async function handleGetMessageTimestamp(userId, guildId, historyId, query) {
  try {
    const targetId = historyId || guildId || userId;
    const { embeddingService } = await import('../../memory/EmbeddingService.js');
    const { findSimilarMemories } = await import('../../database/vectorSearch.js');

    const queryEmbedding = await embeddingService.generateEmbedding(query, 'RETRIEVAL_QUERY');
    if (!queryEmbedding) return { result: 'Could not generate embedding for timestamp search.' };

    const results = await findSimilarMemories(targetId, queryEmbedding, 1);
    if (!results?.length) return { result: 'No matching message found in memory.' };

    const entry = results[0];
    if (!entry.timestamp) return { result: 'Message found but timestamp not recorded.' };

    const date = new Date(entry.timestamp);
    const formatted = date.toLocaleString('en-US', {
      weekday: 'long', year: 'numeric', month: 'long',
      day: 'numeric', hour: '2-digit', minute: '2-digit', timeZoneName: 'short'
    });

    // Extract a snippet of the matched message text
    const snippet = entry.text ? ` (about: "${entry.text.slice(0, 80)}...")` : '';
    return { result: `That message was sent on: ${formatted}${snippet}` };
  } catch (error) {
    logger.error('Error getting message timestamp', error);
    return { result: `${MSG.OPERATION_FAILED}: ${error.message}` };
  }
}

/**
 * Handle `get_current_datetime` — return the live current date and time.
 *
 * Critically, `new Date()` is called at invocation time, NOT at bot startup,
 * so the result is always fresh regardless of how long the bot has been running.
 * The user's stored IANA timezone (if any) is applied so the response reflects
 * their local time instead of the server's system clock.
 *
 * @param {string} userId
 * @returns {{ result: string }}
 */
function handleGetCurrentDatetime(userId) {
  // `state` is top-level imported — read .userTimezones at call-time, never at startup
  const timezone = state.userTimezones?.[userId] || 'UTC';
  const now      = new Date();  // fresh every single call, never stale from startup

  let formatted, tzLabel;
  try {
    // Full human-readable datetime in the user's timezone
    formatted = now.toLocaleString('en-US', {
      timeZone:     timezone,
      weekday:      'long',
      year:         'numeric',
      month:        'long',
      day:          'numeric',
      hour:         '2-digit',
      minute:       '2-digit',
      second:       '2-digit',
      hour12:       true,
      timeZoneName: 'short'
    });

    tzLabel = timezone === 'UTC'
      ? 'UTC (no timezone saved — use /timezone to personalise)'
      : timezone;

  } catch {
    // Fallback: the IANA string stored for this user is unrecognised — use server local time
    formatted = now.toLocaleString('en-US', {
      weekday:      'long',
      year:         'numeric',
      month:        'long',
      day:          'numeric',
      hour:         '2-digit',
      minute:       '2-digit',
      second:       '2-digit',
      hour12:       true,
      timeZoneName: 'short'
    });
    tzLabel = 'UTC (stored timezone was invalid — please use /timezone to fix it)';
  }

  return {
    result: `Current date/time: ${formatted} | Timezone used: ${tzLabel}`
  };
}



/**
 * Execute all function calls produced by the model in a single turn.
 * Calls are processed in parallel; each call is individually try-caught so
 * one failure does not abort the others.
 *
 * Returns an array of `{ functionResponse: { name, response } }` objects
 * ready to be included in the next Gemini `contents` turn.
 *
 * @param {object[]}    calls      - array of { name, args } OR { functionCall: { name, args } }
 * @param {string}      userId
 * @param {string|null} guildId
 * @param {string|null} historyId
 * @returns {Promise<object[]>}
 */
export async function executeFunctionCalls(calls, userId, guildId, historyId) {
  return Promise.all(
    calls.map(async (raw) => {
      // Normalise: handle both flat {name,args} and wrapped {functionCall:{name,args}}
      const call = raw?.functionCall ?? raw;
      const args = call.args || {};
      let response = {};

      try {
        switch (call.name) {
          case FUNCTION_NAMES.MANAGE_MEMORY:
            response = await handleManageMemory(userId, args.action, args.info);
            break;

          case FUNCTION_NAMES.MANAGE_SERVER_FACT:
            response = await handleManageServerFact(guildId, args.action, args.info, args.category);
            break;

          case FUNCTION_NAMES.SEARCH_MEMORY:
            response = await handleSearchMemory(userId, guildId, historyId, args.query);
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

          case FUNCTION_NAMES.GET_TIMESTAMP:
            response = await handleGetMessageTimestamp(userId, guildId, historyId, args.query);
            break;

          case FUNCTION_NAMES.GET_CURRENT_DATETIME:
            response = handleGetCurrentDatetime(userId);
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
