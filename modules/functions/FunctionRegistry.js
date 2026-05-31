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
  MANAGE_MEMORY:        'manage_personal_memory',
  MANAGE_SERVER_FACT:   'manage_server_fact',
  SEARCH_MEMORY:        'search_memory',
  SET_REMINDER:         'set_reminder',
  SET_BIRTHDAY:         'set_birthday',
  SET_TIMEZONE:         'set_timezone',
  CHECK_TIME:           'check_time_elapsed',
  GET_TIMESTAMP:        'get_message_timestamp',
  GET_CURRENT_DATETIME: 'get_current_datetime',
  SEARCH_GIF:           'search_gif',
  GET_SERVER_EMOJIS:    'get_server_emojis',
  GET_SERVER_STICKERS:  'get_server_stickers'
});

export const MEMORY_ACTIONS = Object.freeze({
  ADD:    'add',
  REMOVE: 'remove'
});

const PARAMETER_TYPES = Object.freeze({
  STRING: 'STRING',
  NUMBER: 'NUMBER',
  OBJECT: 'OBJECT'
});

// ============================================================================
// TOOL DECLARATIONS
// ============================================================================

/**
 * Gemini function-calling tool declarations.
 * Pass this array directly as the `tools` field in API requests.
 *
 * @type {object[]}
 */
export const functionTools = [
  {
    functionDeclarations: [
      {
        name:        FUNCTION_NAMES.MANAGE_MEMORY,
        description: 'Add or remove permanent facts/memories about the CURRENT USER ONLY (their personal likes, dislikes, pets, preferences). Do NOT use this for facts involving other server members or group relationships — use manage_server_fact for those instead.',
        parameters: {
          type: PARAMETER_TYPES.OBJECT,
          properties: {
            action: {
              type:        PARAMETER_TYPES.STRING,
              enum:        [MEMORY_ACTIONS.ADD, MEMORY_ACTIONS.REMOVE],
              description: 'Action to perform'
            },
            info: {
              type:        PARAMETER_TYPES.STRING,
              description: 'The fact or information to store/delete'
            }
          },
          required: ['action', 'info']
        }
      },
      {
        name:        FUNCTION_NAMES.MANAGE_SERVER_FACT,
        description: [
          'Add or remove a SHARED fact for this entire Discord server — visible to ALL members.',
          'Call this AUTOMATICALLY whenever you learn something involving multiple people or the server community.',
          'ALWAYS provide a category for new facts so they can be grouped and retrieved correctly.',
          '',
          'Categories:',
          '  relationship — bonds between members (romantic, friendship, rivalry, family)',
          '  nickname     — server nicknames / aliases members go by',
          '  role         — who owns, admins, or runs things in the server',
          '  activity     — shared games, hobbies, recurring hangouts',
          '  event        — things that happened in/to the server community',
          '  personal     — facts about one member that the whole server should know',
          '',
          'Include Discord user IDs in parentheses where known so facts survive username changes.',
          'Keep using manage_personal_memory for facts about ONE user only.',
          'ONLY callable when the conversation is in a guild channel (not DMs).',
        ].join('\n'),
        parameters: {
          type: PARAMETER_TYPES.OBJECT,
          properties: {
            action: {
              type:        PARAMETER_TYPES.STRING,
              enum:        [MEMORY_ACTIONS.ADD, MEMORY_ACTIONS.REMOVE],
              description: 'add — store a new server fact; remove — delete facts matching the keyword'
            },
            info: {
              type:        PARAMETER_TYPES.STRING,
              description: 'The fact to store (include Discord user IDs where known) or keyword to delete'
            },
            category: {
              type:        PARAMETER_TYPES.STRING,
              enum:        ['relationship', 'nickname', 'role', 'activity', 'event', 'personal'],
              description: 'Category classifying this fact. Required for add; ignored for remove.'
            }
          },
          required: ['action', 'info']
        }
      },
      {
        name:        FUNCTION_NAMES.SEARCH_MEMORY,
        description: [
          'Search all memory stores for relevant past information.',
          '',
          'STANDARD SEARCH (always runs):',
          '  • Conversation memories  — vector RAG from current context',
          '  • Personal facts         — stored facts about the user',
          '  • Personal data          — timezone, birthday, reminders, preferences',
          '  • Server facts           — shared facts for this guild (when in a server)',
          '',
          'CROSS-CONTEXT SEARCH (when user has cross-context enabled):',
          '  • Cross-server memories  — RAG from other servers this user is in',
          '  • DM memories            — past DM conversation memories',
          '  • Other-server facts     — facts from other guilds this user is in',
          '',
          'Call this when:',
          '  (1) You genuinely lack the knowledge to answer (e.g. "who is X\'s boyfriend?", "what happened with Y?")',
          '  (2) User asks explicitly about a past conversation ("do you remember...", "what did I say about...")',
          '  (3) User asks direct personal questions about themselves or about you',
          '  (4) You are in a DM and the user asks about relationships, nicknames, or server events',
          'Do NOT call for general chat or questions you can already answer from current context.',
        ].join('\n'),
        parameters: {
          type: PARAMETER_TYPES.OBJECT,
          properties: {
            query: {
              type:        PARAMETER_TYPES.STRING,
              description: 'The search query to find relevant memories'
            }
          },
          required: ['query']
        }
      },
      {
        name:        FUNCTION_NAMES.SET_REMINDER,
        description: "Set a reminder for the user at a specific time (e.g., 'remind me to buy milk in 2 hours').",
        parameters: {
          type: PARAMETER_TYPES.OBJECT,
          properties: {
            message: {
              type:        PARAMETER_TYPES.STRING,
              description: 'What to remind the user about'
            },
            time_relative: {
              type:        PARAMETER_TYPES.STRING,
              description: "Relative time (e.g., '5 minutes', '2 hours', 'tomorrow at 10am')"
            }
          },
          required: ['message', 'time_relative']
        }
      },
      {
        name:        FUNCTION_NAMES.SET_BIRTHDAY,
        description: "Store the user's birthday.",
        parameters: {
          type: PARAMETER_TYPES.OBJECT,
          properties: {
            day: {
              type:        PARAMETER_TYPES.NUMBER,
              description: 'Day of birth'
            },
            month: {
              type:        PARAMETER_TYPES.NUMBER,
              description: 'Month of birth'
            }
          },
          required: ['day', 'month']
        }
      },
      {
        name:        FUNCTION_NAMES.SET_TIMEZONE,
        description: "Set the user's timezone for reminders and time-sensitive tasks.",
        parameters: {
          type: PARAMETER_TYPES.OBJECT,
          properties: {
            timezone: {
              type:        PARAMETER_TYPES.STRING,
              description: "IANA timezone string (e.g., 'America/New_York', 'Asia/Kolkata')"
            }
          },
          required: ['timezone']
        }
      },
      {
        name:        FUNCTION_NAMES.CHECK_TIME,
        description: 'Check the exact time elapsed since the last message in this conversation. Use this if the user asks "how long has it been" or if you need to know the passage of time for context.',
        parameters: {
          type: PARAMETER_TYPES.OBJECT,
          properties: {
            reason: {
              type:        PARAMETER_TYPES.STRING,
              description: 'Optional reason for checking the time passage.'
            }
          }
        }
      },
      {
        name:        FUNCTION_NAMES.GET_TIMESTAMP,
        description: 'Fetch the exact timestamp (date and time) of a specific message from long-term memory. Use when the user asks when something was said or when a specific event/conversation occurred (e.g. "when did I tell you about X?", "what date did I mention Y?").',
        parameters: {
          type: PARAMETER_TYPES.OBJECT,
          properties: {
            query: {
              type:        PARAMETER_TYPES.STRING,
              description: 'Description of the message or topic to find the timestamp for'
            }
          },
          required: ['query']
        }
      },
      {
        name: FUNCTION_NAMES.GET_CURRENT_DATETIME,
        description: [
          'Get the current LIVE date and time, adjusted for the user\'s saved timezone.',
          'ALWAYS call this tool when the user asks anything about the current time or date',
          '(e.g. "what time is it?", "what\'s today\'s date?", "what day is it?",',
          '"is it morning/night?", "what\'s the time in my timezone?").',
          'Do NOT guess or rely on your own training data — call this every single time',
          'so the answer is always fresh and accurate.',
        ].join(' '),
        parameters: {
          type:       PARAMETER_TYPES.OBJECT,
          properties: {}
          // No parameters needed — timezone is resolved server-side from the user's stored setting
        }
      },
      // ── Media / expression tools ──────────────────────────────────────────
      {
        name: FUNCTION_NAMES.SEARCH_GIF,
        description: [
          'Search Tenor for a GIF to send alongside your message.',
          '',
          'IMPORTANT — use this RARELY and only when a GIF would genuinely elevate the moment:',
          '  • Someone shares exciting news you\'re actually hyped about',
          '  • A conversation reaches a peak funny moment that earns a reaction',
          '  • A rare celebratory or comforting beat where a GIF fits naturally',
          '',
          'DO NOT call this for:',
          '  • Every message or even most messages — silence is fine',
          '  • Generic greetings, hellos, or casual chat',
          '  • Anything where a GIF would feel forced or performative',
          '',
          'After finding the GIF, you will receive its title and tags.',
          'If the result seems off or irrelevant, DO NOT include the URL in your message.',
          'If it fits, append the Tenor URL on its own line at the very END of your reply — Discord will auto-embed it.',
          'Never mention the URL as text or describe it — just place it on its own line.',
        ].join('\n'),
        parameters: {
          type: PARAMETER_TYPES.OBJECT,
          properties: {
            query: {
              type:        PARAMETER_TYPES.STRING,
              description: 'Short Tenor search term (2–4 descriptive words, e.g. "excited jumping", "shocked face", "disappointed sigh")'
            }
          },
          required: ['query']
        }
      },
      {
        name: FUNCTION_NAMES.GET_SERVER_EMOJIS,
        description: [
          'Get the list of custom emojis available in this Discord server.',
          'Returns each emoji\'s name and its ready-to-use Discord format (<:name:id> or <a:name:id> for animated).',
          'Call this when you want to react with a server-specific emoji that fits the moment.',
          'Use these naturally in your message text exactly as returned — Discord will render them.',
          'Only call once per conversation turn; cache the list mentally for the rest of the chat.',
          'Do NOT call this in DMs — server emojis are only available in guild channels.',
        ].join('\n'),
        parameters: {
          type:       PARAMETER_TYPES.OBJECT,
          properties: {}
        }
      },
      {
        name: FUNCTION_NAMES.GET_SERVER_STICKERS,
        description: [
          'Get the list of stickers available in this Discord server, and optionally queue one to send.',
          '',
          'TWO MODES:',
          '  1. BROWSE (no sticker_id): Returns all sticker names and IDs so you can pick one.',
          '  2. SEND   (sticker_id set): Queues that sticker to be delivered after your text reply.',
          '',
          'Workflow:',
          '  Step 1 — Call with no sticker_id to see the list.',
          '  Step 2 — If a sticker fits the moment, call again with the chosen sticker_id.',
          '',
          'Use stickers only when they genuinely match the mood — not for every message.',
          'The sticker arrives as a follow-up to your text, so keep the text self-contained.',
          'Only call this in guild channels, not DMs.',
        ].join('\n'),
        parameters: {
          type: PARAMETER_TYPES.OBJECT,
          properties: {
            sticker_id: {
              type:        PARAMETER_TYPES.STRING,
              description: 'Optional. ID of the sticker to send after your reply. Omit to just browse the list.'
            }
          }
        }
      }
    ]
  }
];
