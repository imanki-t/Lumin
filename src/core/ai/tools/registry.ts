/**
 * Declarations for all Gemini / Gemma tool function declarations.
 */

export const FUNCTION_NAMES = {
  // Memory
  MANAGE_MEMORY: 'manage_personal_memory',
  MANAGE_SERVER_FACT: 'manage_server_fact',
  SEARCH_MEMORY: 'search_memory',
  CHECK_SESSIONS: 'check_sessions',
  // Scheduling
  SET_REMINDER: 'set_reminder',
  SET_BIRTHDAY: 'set_birthday',
  SET_TIMEZONE: 'set_timezone',
  CHECK_TIME: 'check_time_elapsed',
  GET_TIMESTAMP: 'get_message_timestamp',
  GET_CURRENT_DATETIME: 'get_current_datetime',
  // Media / Expression
  SEARCH_GIF: 'search_gif',
  GET_SERVER_EMOJIS: 'get_server_emojis',
  GET_SERVER_STICKERS: 'get_server_stickers',
  FETCH_MEME: 'fetch_meme',
  SEARCH_GIPHY_STICKER: 'search_giphy_sticker',
  // Discord Actions
  CHECK_PROFILE: 'check_user_profile',
  CREATE_POLL: 'create_poll',
  SEND_DM: 'send_dm',
  SEND_SERVER_MSG: 'send_server_message',
  EDIT_MESSAGE: 'edit_bot_message',
  DELETE_MESSAGE: 'delete_bot_message',
  PIN_MESSAGE: 'pin_message',
  CREATE_THREAD: 'create_thread',
  ADD_REACTION: 'add_reaction',
  // Information
  GET_SERVER_INFO: 'get_server_info',
  GET_CHANNEL_INFO: 'get_channel_info',
  GOOGLE_SEARCH: 'google_search',
  IGNORE_USER: 'ignore_user'
} as const;

export const geminiToolDeclarations = [
  {
    functionDeclarations: [
      {
        name: FUNCTION_NAMES.MANAGE_MEMORY,
        description: 'Add or remove permanent facts about the CURRENT USER ONLY (likes, dislikes, preferences, pets).',
        parameters: {
          type: 'OBJECT',
          properties: {
            action: { type: 'STRING', enum: ['add', 'remove'], description: 'Action to perform' },
            info: { type: 'STRING', description: 'The personal fact to store or delete' }
          },
          required: ['action', 'info']
        }
      },
      {
        name: FUNCTION_NAMES.MANAGE_SERVER_FACT,
        description: 'Add or remove a SHARED fact for this entire Discord server (visible to all members in guild).',
        parameters: {
          type: 'OBJECT',
          properties: {
            action: { type: 'STRING', enum: ['add', 'remove'], description: 'Action to perform' },
            info: { type: 'STRING', description: 'The server fact to store or delete' },
            category: {
              type: 'STRING',
              enum: ['relationship', 'nickname', 'role', 'activity', 'event', 'personal'],
              description: 'Category for the fact'
            }
          },
          required: ['action', 'info']
        }
      },
      {
        name: FUNCTION_NAMES.SEARCH_MEMORY,
        description: 'Search long-term memory stores, user facts, and server facts when context is missing.',
        parameters: {
          type: 'OBJECT',
          properties: {
            query: { type: 'STRING', description: 'The search query to match against memories' }
          },
          required: ['query']
        }
      },
      {
        name: FUNCTION_NAMES.CHECK_SESSIONS,
        description: 'Search historical conversation summaries older than 24 hours.',
        parameters: {
          type: 'OBJECT',
          properties: {
            query: { type: 'STRING', description: 'Query to search past conversation sessions' }
          },
          required: ['query']
        }
      },
      {
        name: FUNCTION_NAMES.SET_REMINDER,
        description: 'Set a timed reminder for the user (e.g., "in 2 hours", "tomorrow at 9am").',
        parameters: {
          type: 'OBJECT',
          properties: {
            message: { type: 'STRING', description: 'The reminder content' },
            time_relative: { type: 'STRING', description: 'Relative or natural language time expression' }
          },
          required: ['message', 'time_relative']
        }
      },
      {
        name: FUNCTION_NAMES.SET_BIRTHDAY,
        description: "Store the user's birthday for automated annual greetings.",
        parameters: {
          type: 'OBJECT',
          properties: {
            day: { type: 'NUMBER', description: 'Day of birth (1-31)' },
            month: { type: 'NUMBER', description: 'Month of birth (1-12)' }
          },
          required: ['day', 'month']
        }
      },
      {
        name: FUNCTION_NAMES.SET_TIMEZONE,
        description: "Set the user's IANA timezone for accurate time adjustments.",
        parameters: {
          type: 'OBJECT',
          properties: {
            timezone: { type: 'STRING', description: 'IANA timezone string (e.g. "America/New_York", "Europe/London")' }
          },
          required: ['timezone']
        }
      },
      {
        name: FUNCTION_NAMES.CHECK_TIME,
        description: 'Check elapsed time since the previous message in this conversation.',
        parameters: {
          type: 'OBJECT',
          properties: {
            reason: { type: 'STRING', description: 'Optional reason for the check' }
          }
        }
      },
      {
        name: FUNCTION_NAMES.GET_TIMESTAMP,
        description: 'Fetch the exact timestamp of a specific past message from long-term memory.',
        parameters: {
          type: 'OBJECT',
          properties: {
            query: { type: 'STRING', description: 'Topic or message content to retrieve timestamp for' }
          },
          required: ['query']
        }
      },
      {
        name: FUNCTION_NAMES.GET_CURRENT_DATETIME,
        description: "Get the current LIVE date and time in the user's timezone.",
        parameters: { type: 'OBJECT', properties: {} }
      },
      {
        name: FUNCTION_NAMES.SEARCH_GIF,
        description: 'Search for a reaction GIF via Tenor. Use rarely for peak moments.',
        parameters: {
          type: 'OBJECT',
          properties: {
            query: { type: 'STRING', description: '2-4 descriptive search keywords' }
          },
          required: ['query']
        }
      },
      {
        name: FUNCTION_NAMES.GET_SERVER_EMOJIS,
        description: 'Retrieve custom emojis in the current guild in <:name:id> format.',
        parameters: { type: 'OBJECT', properties: {} }
      },
      {
        name: FUNCTION_NAMES.GET_SERVER_STICKERS,
        description: 'List or send server custom stickers in the guild.',
        parameters: {
          type: 'OBJECT',
          properties: {
            sticker_id: { type: 'STRING', description: 'Optional sticker ID to send' }
          }
        }
      },
      {
        name: FUNCTION_NAMES.FETCH_MEME,
        description: 'Fetch a fresh meme across Reddit, Tenor, and GIPHY fallback channels.',
        parameters: {
          type: 'OBJECT',
          properties: {
            topic: { type: 'STRING', description: 'Meme topic or keyword' },
            subreddit: { type: 'STRING', description: 'Optional subreddit' },
            sort: { type: 'STRING', enum: ['hot', 'top', 'new'], description: 'Sort order' }
          }
        }
      },
      {
        name: FUNCTION_NAMES.SEARCH_GIPHY_STICKER,
        description: 'Search for an animated transparent sticker on GIPHY.',
        parameters: {
          type: 'OBJECT',
          properties: {
            query: { type: 'STRING', description: 'Sticker description keywords' }
          },
          required: ['query']
        }
      },
      {
        name: FUNCTION_NAMES.CHECK_PROFILE,
        description: "Look up a Discord user's profile, roles, status, activity, and join date.",
        parameters: {
          type: 'OBJECT',
          properties: {
            user_id: { type: 'STRING', description: 'Discord User ID to inspect' }
          },
          required: ['user_id']
        }
      },
      {
        name: FUNCTION_NAMES.CREATE_POLL,
        description: 'Create a Discord native poll in the current guild channel.',
        parameters: {
          type: 'OBJECT',
          properties: {
            question: { type: 'STRING', description: 'Poll question (max 300 chars)' },
            answers: { type: 'STRING', description: 'Comma-separated list of 2-10 options' },
            duration_hours: { type: 'NUMBER', description: 'Duration in hours (1-168, default 24)' },
            allow_multiselect: { type: 'BOOLEAN', description: 'Allow multiple votes' }
          },
          required: ['question', 'answers']
        }
      },
      {
        name: FUNCTION_NAMES.SEND_DM,
        description: 'Send a private direct message to a guild member.',
        parameters: {
          type: 'OBJECT',
          properties: {
            user_id: { type: 'STRING', description: 'Target Discord user ID' },
            content: { type: 'STRING', description: 'Message content' }
          },
          required: ['user_id', 'content']
        }
      },
      {
        name: FUNCTION_NAMES.SEND_SERVER_MSG,
        description: 'Relay a message from a DM to an allowed guild channel.',
        parameters: {
          type: 'OBJECT',
          properties: {
            guild_name: { type: 'STRING', description: 'Guild name or ID' },
            channel_name: { type: 'STRING', description: 'Channel name or ID' },
            content: { type: 'STRING', description: 'Message content' }
          },
          required: ['content']
        }
      },
      {
        name: FUNCTION_NAMES.EDIT_MESSAGE,
        description: "Edit the bot's own most recent message in the channel.",
        parameters: {
          type: 'OBJECT',
          properties: {
            new_content: { type: 'STRING', description: 'New replacement content' },
            message_id: { type: 'STRING', description: 'Optional specific message ID' }
          },
          required: ['new_content']
        }
      },
      {
        name: FUNCTION_NAMES.DELETE_MESSAGE,
        description: "Delete the bot's own most recent message in the channel.",
        parameters: {
          type: 'OBJECT',
          properties: {
            message_id: { type: 'STRING', description: 'Optional specific message ID' }
          }
        }
      },
      {
        name: FUNCTION_NAMES.PIN_MESSAGE,
        description: 'Pin a message in the guild channel.',
        parameters: {
          type: 'OBJECT',
          properties: {
            message_id: { type: 'STRING', description: 'Optional message ID to pin' }
          }
        }
      },
      {
        name: FUNCTION_NAMES.CREATE_THREAD,
        description: 'Create a public thread from a message or channel.',
        parameters: {
          type: 'OBJECT',
          properties: {
            name: { type: 'STRING', description: 'Thread title' },
            message_id: { type: 'STRING', description: 'Optional starter message ID' }
          },
          required: ['name']
        }
      },
      {
        name: FUNCTION_NAMES.ADD_REACTION,
        description: 'Add an emoji reaction to the target or current message.',
        parameters: {
          type: 'OBJECT',
          properties: {
            emoji: { type: 'STRING', description: 'Unicode emoji or custom emoji format' },
            message_id: { type: 'STRING', description: 'Optional target message ID' }
          },
          required: ['emoji']
        }
      },
      {
        name: FUNCTION_NAMES.GET_SERVER_INFO,
        description: 'Get comprehensive server information, member count, and roles.',
        parameters: { type: 'OBJECT', properties: {} }
      },
      {
        name: FUNCTION_NAMES.GET_CHANNEL_INFO,
        description: 'Get details about a specific channel, slowmode, topic, and voice members.',
        parameters: {
          type: 'OBJECT',
          properties: {
            channel_id: { type: 'STRING', description: 'Optional channel ID' }
          }
        }
      },
      {
        name: FUNCTION_NAMES.GOOGLE_SEARCH,
        description: 'Perform real-time Google search for current events and live data.',
        parameters: {
          type: 'OBJECT',
          properties: {
            query: { type: 'STRING', description: 'Search keywords' }
          },
          required: ['query']
        }
      },
      {
        name: FUNCTION_NAMES.IGNORE_USER,
        description: 'Silently skip replying when user asks the bot not to respond.',
        parameters: { type: 'OBJECT', properties: {} }
      }
    ]
  }
];
