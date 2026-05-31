/**
 * @fileoverview Gemini function-calling tool declarations for Lumin.
 *               Pure data — no imports, no side effects, zero runtime logic.
 *               Import `functionTools` and pass it directly to the Gemini API
 *               `tools` field.
 * @module modules/functions/FunctionRegistry
 */

// ============================================================================
// CONSTANTS
// ============================================================================

export const FUNCTION_NAMES = Object.freeze({
  // ── Memory ─────────────────────────────────────────────────────────────────
  MANAGE_MEMORY:        'manage_personal_memory',
  MANAGE_SERVER_FACT:   'manage_server_fact',
  SEARCH_MEMORY:        'search_memory',
  // ── Scheduling ─────────────────────────────────────────────────────────────
  SET_REMINDER:         'set_reminder',
  SET_BIRTHDAY:         'set_birthday',
  SET_TIMEZONE:         'set_timezone',
  CHECK_TIME:           'check_time_elapsed',
  GET_TIMESTAMP:        'get_message_timestamp',
  GET_CURRENT_DATETIME: 'get_current_datetime',
  // ── Media / expression ─────────────────────────────────────────────────────
  SEARCH_GIF:           'search_gif',
  GET_SERVER_EMOJIS:    'get_server_emojis',
  GET_SERVER_STICKERS:  'get_server_stickers',
  // ── Discord actions ────────────────────────────────────────────────────────
  CHECK_PROFILE:        'check_user_profile',
  CREATE_POLL:          'create_poll',
  SEND_DM:              'send_dm',
  SEND_SERVER_MSG:      'send_server_message',
  EDIT_MESSAGE:         'edit_bot_message',
  DELETE_MESSAGE:       'delete_bot_message',
  PIN_MESSAGE:          'pin_message',
  CREATE_THREAD:        'create_thread',
  ADD_REACTION:         'add_reaction',
  // ── Information ────────────────────────────────────────────────────────────
  GET_SERVER_INFO:      'get_server_info',
  GET_CHANNEL_INFO:     'get_channel_info',
  // ── Meme / GIPHY sticker ───────────────────────────────────────────────────
  FETCH_MEME:           'fetch_meme',
  SEARCH_GIPHY_STICKER: 'search_giphy_sticker',
  // ── Gemma-only search ──────────────────────────────────────────────────────
  GOOGLE_SEARCH:        'google_search',
});

export const MEMORY_ACTIONS = Object.freeze({
  ADD:    'add',
  REMOVE: 'remove'
});

const S = 'STRING';
const N = 'NUMBER';
const O = 'OBJECT';
const B = 'BOOLEAN';

// ============================================================================
// TOOL DECLARATIONS
// ============================================================================

export const functionTools = [
  {
    functionDeclarations: [

      // ── Memory tools ────────────────────────────────────────────────────────

      {
        name: FUNCTION_NAMES.MANAGE_MEMORY,
        description: 'Add or remove permanent facts/memories about the CURRENT USER ONLY (their personal likes, dislikes, pets, preferences). Do NOT use this for facts involving other server members or group relationships — use manage_server_fact for those instead.',
        parameters: {
          type: O,
          properties: {
            action: { type: S, enum: ['add', 'remove'], description: 'Action to perform' },
            info:   { type: S, description: 'The fact or information to store/delete' }
          },
          required: ['action', 'info']
        }
      },

      {
        name: FUNCTION_NAMES.MANAGE_SERVER_FACT,
        description: [
          'Add or remove a SHARED fact for this entire Discord server — visible to ALL members.',
          'ALWAYS provide a category for new facts.',
          'Categories: relationship, nickname, role, activity, event, personal.',
          'Include Discord user IDs in parentheses where known.',
          'ONLY callable in guild channels, not DMs.',
        ].join(' '),
        parameters: {
          type: O,
          properties: {
            action:   { type: S, enum: ['add', 'remove'], description: 'add or remove' },
            info:     { type: S, description: 'The fact or keyword to delete' },
            category: { type: S, enum: ['relationship', 'nickname', 'role', 'activity', 'event', 'personal'], description: 'Category (required for add)' }
          },
          required: ['action', 'info']
        }
      },

      {
        name: FUNCTION_NAMES.SEARCH_MEMORY,
        description: [
          'Search all memory stores (conversation memories, personal facts, server facts, cross-context).',
          'Call when you lack knowledge to answer or the user asks about past conversations.',
          'Do NOT call for general chat you can already answer from current context.',
        ].join(' '),
        parameters: {
          type: O,
          properties: {
            query: { type: S, description: 'The search query to find relevant memories' }
          },
          required: ['query']
        }
      },

      // ── Scheduling tools ────────────────────────────────────────────────────

      {
        name: FUNCTION_NAMES.SET_REMINDER,
        description: "Set a reminder for the user at a specific time (e.g. 'remind me to buy milk in 2 hours').",
        parameters: {
          type: O,
          properties: {
            message:       { type: S, description: 'What to remind the user about' },
            time_relative: { type: S, description: "Relative time (e.g. '5 minutes', '2 hours', 'tomorrow at 10am')" }
          },
          required: ['message', 'time_relative']
        }
      },

      {
        name: FUNCTION_NAMES.SET_BIRTHDAY,
        description: "Store the user's birthday.",
        parameters: {
          type: O,
          properties: {
            day:   { type: N, description: 'Day of birth' },
            month: { type: N, description: 'Month of birth' }
          },
          required: ['day', 'month']
        }
      },

      {
        name: FUNCTION_NAMES.SET_TIMEZONE,
        description: "Set the user's timezone for reminders and time-sensitive tasks.",
        parameters: {
          type: O,
          properties: {
            timezone: { type: S, description: "IANA timezone string (e.g. 'America/New_York', 'Asia/Kolkata')" }
          },
          required: ['timezone']
        }
      },

      {
        name: FUNCTION_NAMES.CHECK_TIME,
        description: 'Check the exact time elapsed since the last message in this conversation.',
        parameters: {
          type: O,
          properties: {
            reason: { type: S, description: 'Optional reason for checking' }
          }
        }
      },

      {
        name: FUNCTION_NAMES.GET_TIMESTAMP,
        description: "Fetch the exact timestamp of a specific message from long-term memory. Use when the user asks when something was said (e.g. 'when did I tell you about X?').",
        parameters: {
          type: O,
          properties: {
            query: { type: S, description: 'Description of the message or topic to find the timestamp for' }
          },
          required: ['query']
        }
      },

      {
        name: FUNCTION_NAMES.GET_CURRENT_DATETIME,
        description: 'Get the current LIVE date and time adjusted for the user\'s timezone. ALWAYS call this when asked about the current time or date — never guess.',
        parameters: { type: O, properties: {} }
      },

      // ── Media / expression tools ─────────────────────────────────────────────

      {
        name: FUNCTION_NAMES.SEARCH_GIF,
        description: [
          'Search for a GIF to express a reaction. Use RARELY — only for genuinely exciting news,',
          'peak funny moments, or celebratory beats. NOT for every message or generic greetings.',
          'The GIF will be sent automatically as an image — do NOT include any URL in your text response.',
          'If the result seems off, just respond without mentioning the GIF.',
        ].join(' '),
        parameters: {
          type: O,
          properties: {
            query: { type: S, description: 'Short Tenor search term (2–4 descriptive words)' }
          },
          required: ['query']
        }
      },

      {
        name: FUNCTION_NAMES.GET_SERVER_EMOJIS,
        description: 'Get all custom emojis in this server. Returns ready-to-use <:name:id> format. Only in guild channels, not DMs. Call once per turn.',
        parameters: { type: O, properties: {} }
      },

      {
        name: FUNCTION_NAMES.GET_SERVER_STICKERS,
        description: [
          'List or send a server sticker. BROWSE (no sticker_id): returns all stickers.',
          'SEND (with sticker_id): queues it to be sent after your text reply.',
          'Only in guild channels.',
        ].join(' '),
        parameters: {
          type: O,
          properties: {
            sticker_id: { type: S, description: 'Optional sticker ID to send. Omit to browse.' }
          }
        }
      },

      // ── Profile / member info ────────────────────────────────────────────────

      {
        name: FUNCTION_NAMES.CHECK_PROFILE,
        description: [
          'Check a Discord user\'s profile. Works for any user including the bot itself.',
          'Returns: display name, username, avatar URL, account creation date,',
          'server-specific info (nickname, roles, join date), current online status,',
          'current activity (game / stream / custom status), and voice channel if they\'re in one.',
          'Use when someone asks "what is X doing?", "is Y online?", "check my profile", etc.',
          'Pass the bot\'s own user ID to check the bot\'s profile.',
        ].join(' '),
        parameters: {
          type: O,
          properties: {
            user_id: { type: S, description: 'Discord user ID to look up. Use the bot\'s own ID to check itself.' }
          },
          required: ['user_id']
        }
      },

      // ── Poll ─────────────────────────────────────────────────────────────────

      {
        name: FUNCTION_NAMES.CREATE_POLL,
        description: [
          'Create a Discord native poll in the current channel.',
          'Polls support 2–10 answer options. Duration is in hours (1–168, default 24).',
          'Only usable in guild channels (not DMs).',
        ].join(' '),
        parameters: {
          type: O,
          properties: {
            question:        { type: S, description: 'The poll question (max 300 chars)' },
            answers:         { type: S, description: 'Comma-separated list of answer options (2–10 options)' },
            duration_hours:  { type: N, description: 'How long the poll runs in hours (1–168, default 24)' },
            allow_multiselect: { type: B, description: 'Whether users can pick multiple answers (default false)' }
          },
          required: ['question', 'answers']
        }
      },

      // ── DM / cross-context messaging ─────────────────────────────────────────

      {
        name: FUNCTION_NAMES.SEND_DM,
        description: [
          'Send a DM to a user — only callable from a server channel (not from DMs).',
          'The target user must be a member of the current server.',
          'Use for private messages like "DM them the details" or "send her a message privately".',
          'Always tell the user you\'re about to DM someone before doing so.',
        ].join(' '),
        parameters: {
          type: O,
          properties: {
            user_id: { type: S, description: 'Discord user ID of the person to DM' },
            content: { type: S, description: 'The message to send (plain text)' }
          },
          required: ['user_id', 'content']
        }
      },

      {
        name: FUNCTION_NAMES.SEND_SERVER_MSG,
        description: [
          'Send a message to a server channel — only callable from a DM conversation.',
          'The bot must be in that server. Use when a DM user asks to relay a message to a server.',
          'Specify the server and channel by name. If ambiguous, ask the user to clarify.',
          'Can only send to servers where the bot is active.',
        ].join(' '),
        parameters: {
          type: O,
          properties: {
            guild_name:   { type: S, description: 'Name (or partial name) of the target server' },
            channel_name: { type: S, description: 'Name (or partial name) of the target channel (e.g. "general")' },
            content:      { type: S, description: 'The message content to send' }
          },
          required: ['content']
        }
      },

      // ── Edit / delete bot messages ────────────────────────────────────────────

      {
        name: FUNCTION_NAMES.EDIT_MESSAGE,
        description: [
          'Edit the bot\'s own most recent message in this conversation.',
          'Use when asked to correct, update, or change something just said.',
          'The edited message replaces the previous content entirely.',
        ].join(' '),
        parameters: {
          type: O,
          properties: {
            new_content: { type: S, description: 'The new content to replace the previous message with' },
            message_id:  { type: S, description: 'Optional specific message ID to edit. Omit to edit the most recent bot message.' }
          },
          required: ['new_content']
        }
      },

      {
        name: FUNCTION_NAMES.DELETE_MESSAGE,
        description: [
          'Delete the bot\'s own most recent message in this conversation.',
          'Use when asked to remove or unsend something just said.',
        ].join(' '),
        parameters: {
          type: O,
          properties: {
            message_id: { type: S, description: 'Optional specific message ID to delete. Omit to delete the most recent bot message.' }
          }
        }
      },

      // ── Moderation helpers ────────────────────────────────────────────────────

      {
        name: FUNCTION_NAMES.PIN_MESSAGE,
        description: [
          'Pin a message in the current channel. By default pins the triggering user\'s message.',
          'Requires Manage Messages permission. Only works in guild channels.',
        ].join(' '),
        parameters: {
          type: O,
          properties: {
            message_id: { type: S, description: 'Optional message ID to pin. Omit to pin the user\'s current message.' }
          }
        }
      },

      {
        name: FUNCTION_NAMES.CREATE_THREAD,
        description: [
          'Create a thread from the current message or a specific message in the channel.',
          'Works in text channels and forum channels. Only in guild channels.',
        ].join(' '),
        parameters: {
          type: O,
          properties: {
            name:           { type: S, description: 'Thread name (2–100 characters)' },
            message_id:     { type: S, description: 'Optional message ID to start the thread from. Omit to create a standalone thread.' },
            auto_archive:   { type: N, description: 'Auto-archive duration in minutes: 60, 1440 (1 day), 4320 (3 days), 10080 (1 week). Default 1440.' }
          },
          required: ['name']
        }
      },

      {
        name: FUNCTION_NAMES.ADD_REACTION,
        description: [
          'Add an emoji reaction to a message. Use standard Unicode emojis or server custom emojis.',
          'For custom emojis use the format returned by get_server_emojis.',
          'Reacts to the user\'s current message by default.',
        ].join(' '),
        parameters: {
          type: O,
          properties: {
            emoji:      { type: S, description: 'The emoji to react with. Unicode: "👍" or custom: "<:name:id>"' },
            message_id: { type: S, description: 'Optional message ID to react to. Omit to react to the user\'s current message.' }
          },
          required: ['emoji']
        }
      },

      // ── Server / channel info ─────────────────────────────────────────────────

      {
        name: FUNCTION_NAMES.GET_SERVER_INFO,
        description: [
          'Get detailed information about the current Discord server.',
          'Returns: name, member count, channel counts, role count, boost level,',
          'server creation date, owner, verification level, and top roles.',
          'Only available in guild channels.',
        ].join(' '),
        parameters: { type: O, properties: {} }
      },

      {
        name: FUNCTION_NAMES.GET_CHANNEL_INFO,
        description: [
          'Get information about a channel. Defaults to the current channel.',
          'For text channels: name, topic, slowmode, NSFW flag, category.',
          'For voice/stage channels: name, bitrate, user limit, list of connected members',
          '(capped at 500 — shows "500+" if more).',
        ].join(' '),
        parameters: {
          type: O,
          properties: {
            channel_id: { type: S, description: 'Optional channel ID. Omit to use the current channel.' }
          }
        }
      },

      // ── Meme / GIPHY sticker ─────────────────────────────────────────────────

      {
        name: FUNCTION_NAMES.FETCH_MEME,
        description: [
          'Fetch a random meme from Reddit. Use when the user asks for a meme or the vibe genuinely calls for it.',
          'Optionally specify a subreddit (e.g. "memes", "dankmemes", "me_irl"). Defaults to a random popular meme sub.',
          'The meme image and title are sent as an embed automatically — do NOT include any URL in your text response.',
        ].join(' '),
        parameters: {
          type: O,
          properties: {
            subreddit: { type: S, description: 'Optional subreddit to fetch from (e.g. "memes", "dankmemes"). Omit for a random pick.' }
          }
        }
      },

      {
        name: FUNCTION_NAMES.SEARCH_GIPHY_STICKER,
        description: [
          'Search GIPHY for an animated sticker (transparent GIF). Use SPARINGLY — only when a sticker would genuinely',
          'add flair to the moment. The sticker is sent automatically as an image after your reply.',
          'Do NOT include any URL or link in your text response.',
        ].join(' '),
        parameters: {
          type: O,
          properties: {
            query: { type: S, description: 'Short search term (2–4 words) describing the sticker vibe (e.g. "excited celebration", "thumbs up")' }
          },
          required: ['query']
        }
      },

      // ── Gemma-only web search ─────────────────────────────────────────────────

      {
        name: FUNCTION_NAMES.GOOGLE_SEARCH,
        description: [
          'Perform a real-time Google web search. Use this to answer questions about',
          'current events, recent news, live data, or anything that requires up-to-date information.',
          'Returns a summary of search results with sources.',
          'Call this any time you need information you don\'t already have.',
        ].join(' '),
        parameters: {
          type: O,
          properties: {
            query: { type: S, description: 'The search query (be specific for better results)' }
          },
          required: ['query']
        }
      }

    ]
  }
];
