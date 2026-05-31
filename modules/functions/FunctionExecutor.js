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
import { setPendingSticker }     from './pendingMedia.js';
import axios                     from 'axios';

const logger = Logger.get('FunctionExecutor');

// ============================================================================
// RESPONSE STRING CONSTANTS
// ============================================================================

const MSG = Object.freeze({
  MEMORY_ADD_SUCCESS:   'Memory added',
  MEMORY_REMOVE_SUCCESS:'Memory removed',
  NO_MEMORIES_FOUND:    'No relevant memories found.',
  REMINDER_SET:         'Reminder set for',
  BIRTHDAY_SET:         'Birthday set to',
  TIMEZONE_SET:         'Timezone set to',
  TIME_CHECKED:         'Time elapsed since last message:',
  OPERATION_FAILED:     'Failed',
  GIF_NO_API_KEY:       'GIF search is unavailable: TENOR_API_KEY is not configured.',
  GIF_NO_RESULTS:       'No GIF found for that search. Skip the GIF this time.',
  GIF_API_ERROR:        'GIF search failed. Skip the GIF this time.',
  NO_GUILD:             'This tool is only available in server channels, not DMs.',
  STICKER_QUEUED:       'Sticker queued for delivery.',
  STICKER_NOT_FOUND:    'Sticker not found on this server.'
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
 * Handle `search_memory` — unified parallel search across all memory stores.
 *
 * Resolves cross-context parameters from the Discord client here so that
 * MemorySystem.searchMemory() remains framework-agnostic.  All actual search
 * logic, parallelism, timeouts, and deduplication live in searchMemory().
 *
 * Standard search (always):
 *   • Vector RAG memories (current context)
 *   • User personal facts
 *   • Personal data (timezone, birthday, etc.)
 *   • Current server facts
 *
 * Cross-context search (crossContextEnabled only):
 *   • RAG memories from other servers / DMs this user appears in
 *   • Server facts from other guilds the user is in
 *
 * @param {string}      userId
 * @param {string|null} guildId
 * @param {string}      historyId
 * @param {string}      query
 * @returns {Promise<{ result: string }>}
 */
async function handleSearchMemory(userId, guildId, historyId, query) {
  // ── Resolve cross-context settings ───────────────────────────────────────
  const crossContextEnabled = state.userSettings?.[userId]?.crossContextEnabled ?? false;

  // Pre-compute other guild IDs from the Discord client cache.
  // Only pay this cost when cross-context is actually on; skipped entirely otherwise.
  let otherGuildIds = [];
  if (crossContextEnabled && userId) {
    try {
      otherGuildIds = client.guilds.cache
        .filter(g => g.members.cache.has(userId) && g.id !== guildId)
        .map(g => g.id);
    } catch { /* non-fatal — cross-guild is best-effort */ }
  }

  // ── Delegate to fully parallel searchMemory ───────────────────────────────
  const results = await memorySystem.searchMemory(
    userId,
    guildId,
    historyId,
    query,
    { crossContextEnabled, otherGuildIds }
  );

  return {
    result: results.length > 0 ? results.join('\n') : MSG.NO_MEMORIES_FOUND
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

// ── Simple word-based content filter for GIF titles/tags ──────────────────────
// Tenor's contentfilter=medium handles most cases at the API level.
// This is a last-line defence for edge cases that slip through.
const GIF_BLOCK_TERMS = new Set([
  'nsfw', 'sexy', 'nude', 'naked', 'porn', 'sex', 'hentai',
  'gore', 'blood', 'dead', 'kill', 'murder', 'shoot',
  'slur', 'racist', 'hate'
]);

/**
 * Returns true if the GIF title or tags contain a blocked term.
 * @param {string}   title
 * @param {string[]} tags
 * @returns {boolean}
 */
function isGifBlocked(title, tags) {
  const haystack = [title, ...tags].join(' ').toLowerCase();
  for (const term of GIF_BLOCK_TERMS) {
    if (haystack.includes(term)) return true;
  }
  return false;
}

/**
 * Handle `search_gif` — search Tenor for a GIF and validate it.
 *
 * Returns the Tenor page URL to the model so it can decide whether to include
 * it at the end of its reply. Discord auto-embeds Tenor URLs.
 *
 * Requires TENOR_API_KEY in environment. Uses contentfilter=medium at the API
 * level plus a local term blocklist for extra safety.
 *
 * @param {string} query  - Search terms (2–4 words)
 * @returns {Promise<{ result: string }>}
 */
async function handleSearchGif(query) {
  const apiKey = process.env.TENOR_API_KEY;
  if (!apiKey) return { result: MSG.GIF_NO_API_KEY };

  try {
    const { data } = await axios.get('https://tenor.googleapis.com/v2/search', {
      params: {
        q:             query,
        key:           apiKey,
        limit:         5,
        contentfilter: 'medium',   // server-side content filter
        media_filter:  'gif',
        ar_range:      'wide'
      },
      timeout: 5000
    });

    const results = data?.results;
    if (!results?.length) return { result: MSG.GIF_NO_RESULTS };

    // Pick first safe result
    for (const item of results) {
      const title = item.content_description || item.title || '';
      const tags  = item.tags || [];

      if (isGifBlocked(title, tags)) {
        logger.debug(`GIF blocked by content filter: "${title}"`);
        continue;
      }

      const pageUrl = item.url;
      if (!pageUrl) continue;

      const tagList = tags.slice(0, 6).join(', ') || 'none';
      return {
        result: [
          `GIF found!`,
          `Title: "${title}"`,
          `Tags: [${tagList}]`,
          `URL: ${pageUrl}`,
          ``,
          `If this GIF fits the moment, put the URL on its own line at the very END of your message.`,
          `If it doesn't feel right, just don't include it — no explanation needed.`
        ].join('\n')
      };
    }

    return { result: MSG.GIF_NO_RESULTS };

  } catch (error) {
    logger.error('GIF search failed', error);
    return { result: MSG.GIF_API_ERROR };
  }
}

/**
 * Handle `get_server_emojis` — return all custom emojis in the guild.
 *
 * Returns the ready-to-use Discord format string for each emoji so the model
 * can copy-paste it directly into its reply text. Discord renders these as images.
 *
 * @param {string|null} guildId
 * @returns {{ result: string }}
 */
function handleGetServerEmojis(guildId) {
  if (!guildId) return { result: MSG.NO_GUILD };

  const guild = client.guilds.cache.get(guildId);
  if (!guild) return { result: 'Could not access server emoji list.' };

  const emojis = guild.emojis.cache;
  if (!emojis.size) return { result: 'This server has no custom emojis.' };

  const lines = emojis.map(e => {
    const fmt = e.animated ? `<a:${e.name}:${e.id}>` : `<:${e.name}:${e.id}>`;
    return `${e.name}: ${fmt}`;
  });

  return {
    result: [
      `Server has ${emojis.size} custom emoji(s). Use the format exactly as shown:`,
      '',
      ...lines,
      '',
      'Copy the format string directly into your message text — Discord renders it.'
    ].join('\n')
  };
}

/**
 * Handle `get_server_stickers` — list guild stickers, and optionally queue one.
 *
 * When called WITHOUT sticker_id: returns names and IDs of all server stickers.
 * When called WITH sticker_id: validates the sticker exists and parks it in
 * pendingMedia so ResponseHandler sends it as a follow-up after the text reply.
 *
 * @param {string|null} guildId
 * @param {string|null} historyId
 * @param {string|null} stickerId  - If provided, queue this sticker for sending
 * @returns {Promise<{ result: string }>}
 */
async function handleGetServerStickers(guildId, historyId, stickerId) {
  if (!guildId) return { result: MSG.NO_GUILD };

  const guild = client.guilds.cache.get(guildId);
  if (!guild) return { result: 'Could not access server sticker list.' };

  // Fetch from Discord API to ensure cache is fresh (stickers aren't always in cache)
  let stickers;
  try {
    stickers = await guild.stickers.fetch();
  } catch {
    stickers = guild.stickers.cache;
  }

  if (!stickers.size) return { result: 'This server has no custom stickers.' };

  // SEND mode: validate and queue
  if (stickerId) {
    const sticker = stickers.get(stickerId);
    if (!sticker) return { result: MSG.STICKER_NOT_FOUND };

    setPendingSticker(historyId, stickerId);
    return {
      result: `${MSG.STICKER_QUEUED} Will send sticker "${sticker.name}" after your reply.`
    };
  }

  // BROWSE mode: return the list
  const lines = stickers.map(s =>
    `"${s.name}" — ID: ${s.id}${s.description ? ` (${s.description})` : ''}`
  );

  return {
    result: [
      `Server has ${stickers.size} sticker(s):`,
      '',
      ...lines,
      '',
      'To send one, call this tool again with the chosen sticker_id.',
      'The sticker will be sent as a follow-up to your text reply.'
    ].join('\n')
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

          case FUNCTION_NAMES.SEARCH_GIF:
            response = await handleSearchGif(args.query);
            break;

          case FUNCTION_NAMES.GET_SERVER_EMOJIS:
            response = handleGetServerEmojis(guildId);
            break;

          case FUNCTION_NAMES.GET_SERVER_STICKERS:
            response = await handleGetServerStickers(guildId, historyId, args.sticker_id ?? null);
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
