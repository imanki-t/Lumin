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
  GET_CURRENT_DATETIME: 'get_current_datetime'
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
          'Use this when you learn something that is true at the server level, not just about one person.',
          '',
          'STORE as a server fact when:',
          '  • Relationships between members ("UserA and UserB are dating/best friends/rivals")',
          '  • Server-wide nicknames ("Everyone calls Shreyash \'Shrey\'")',
          '  • Group activities ("They play Minecraft together every Friday")',
          '  • Informal server roles ("Anshul is the server owner / the designated memer")',
          '  • Events that happened in/to the server community',
          '',
          'Keep using manage_personal_memory for facts that belong to ONE user only.',
          'ONLY callable when the conversation is happening in a guild (not DMs).',
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
              description: 'The server-level fact to store or the keyword to match for deletion'
            }
          },
          required: ['action', 'info']
        }
      },
      {
        name:        FUNCTION_NAMES.SEARCH_MEMORY,
        description: 'Search the database for specific past conversations or facts. ONLY call this when: (1) you genuinely lack the knowledge to answer and cannot infer it from current context, (2) user asks explicitly about a past conversation ("do you remember...", "what did I say about..."), or (3) user asks direct personal questions about themselves. Do NOT call for general chat, questions answerable from current context, or casual conversation.',
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
      }
    ]
  }
];
