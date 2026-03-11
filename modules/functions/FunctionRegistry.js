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
  MANAGE_MEMORY: 'manage_personal_memory',
  SEARCH_MEMORY: 'search_memory',
  SET_REMINDER:  'set_reminder',
  SET_BIRTHDAY:  'set_birthday',
  SET_TIMEZONE:  'set_timezone',
  CHECK_TIME:    'check_time_elapsed'
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
        description: 'Add or remove permanent facts/memories about the user (e.g., likes, dislikes, pets).',
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
        name:        FUNCTION_NAMES.SEARCH_MEMORY,
        description: 'Search the database for specific past conversations or facts using a query.',
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
      }
    ]
  }
];
