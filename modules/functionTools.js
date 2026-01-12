import * as db from '../database.js';
import { memorySystem } from '../memorySystem.js';
import { state, saveStateToFile, client } from '../botManager.js';
import { scheduleReminder } from '../commands/reminder.js';

const FUNCTION_NAMES = {
  MANAGE_MEMORY: 'manage_personal_memory',
  SEARCH_MEMORY: 'search_memory',
  SET_REMINDER: 'set_reminder',
  SET_BIRTHDAY: 'set_birthday',
  SET_TIMEZONE: 'set_timezone'
};

const MEMORY_ACTIONS = {
  ADD: 'add',
  REMOVE: 'remove'
};

const PARAMETER_TYPES = {
  STRING: 'STRING',
  NUMBER: 'NUMBER',
  OBJECT: 'OBJECT'
};

const ERROR_MESSAGES = {
  MEMORY_ADD_SUCCESS: 'Memory added',
  MEMORY_REMOVE_SUCCESS: 'Memory removed',
  NO_MEMORIES_FOUND: 'No relevant memories found.',
  REMINDER_SET: 'Reminder set for',
  BIRTHDAY_SET: 'Birthday set to',
  TIMEZONE_SET: 'Timezone set to',
  OPERATION_FAILED: 'Failed'
};

const DATE_FORMATTING = {
  MONTH_PAD_LENGTH: 2,
  DAY_PAD_LENGTH: 2,
  PAD_CHAR: '0'
};

export const functionTools = [
  {
    functionDeclarations: [
      {
        name: FUNCTION_NAMES.MANAGE_MEMORY,
        description: "Add or remove permanent facts/memories about the user (e.g., likes, dislikes, pets).",
        parameters: {
          type: PARAMETER_TYPES.OBJECT,
          properties: {
            action: {
              type: PARAMETER_TYPES.STRING,
              enum: [MEMORY_ACTIONS.ADD, MEMORY_ACTIONS.REMOVE],
              description: "Action to perform"
            },
            info: {
              type: PARAMETER_TYPES.STRING,
              description: "The fact or information to store/delete"
            }
          },
          required: ["action", "info"]
        }
      },
      {
        name: FUNCTION_NAMES.SEARCH_MEMORY,
        description: "Search the database for specific past conversations or facts using a query.",
        parameters: {
          type: PARAMETER_TYPES.OBJECT,
          properties: {
            query: {
              type: PARAMETER_TYPES.STRING,
              description: "The search query to find relevant memories"
            }
          },
          required: ["query"]
        }
      },
      {
        name: FUNCTION_NAMES.SET_REMINDER,
        description: "Set a reminder for the user at a specific time (e.g., 'remind me to buy milk in 2 hours').",
        parameters: {
          type: PARAMETER_TYPES.OBJECT,
          properties: {
            message: { 
              type: PARAMETER_TYPES.STRING, 
              description: "What to remind the user about" 
            },
            time_relative: { 
              type: PARAMETER_TYPES.STRING, 
              description: "Relative time (e.g., '5 minutes', '2 hours', 'tomorrow at 10am')" 
            }
          },
          required: ["message", "time_relative"]
        }
      },
      {
        name: FUNCTION_NAMES.SET_BIRTHDAY,
        description: "Store the user's birthday.",
        parameters: {
          type: PARAMETER_TYPES.OBJECT,
          properties: {
            day: { 
              type: PARAMETER_TYPES.NUMBER, 
              description: "Day of birth" 
            },
            month: { 
              type: PARAMETER_TYPES.NUMBER, 
              description: "Month of birth" 
            }
          },
          required: ["day", "month"]
        }
      },
      {
        name: FUNCTION_NAMES.SET_TIMEZONE,
        description: "Set the user's timezone for reminders and time-sensitive tasks.",
        parameters: {
          type: PARAMETER_TYPES.OBJECT,
          properties: {
            timezone: { 
              type: PARAMETER_TYPES.STRING, 
              description: "IANA timezone string (e.g., 'America/New_York', 'Asia/Kolkata')" 
            }
          },
          required: ["timezone"]
        }
      }
    ]
  }
];

function formatDateComponent(value, padLength) {
  return String(value).padStart(padLength, DATE_FORMATTING.PAD_CHAR);
}

function generateReminderId() {
  return Date.now().toString();
}

function createReminderObject(userId, message, timeDate, channelId = null) {
  return {
    id: generateReminderId(),
    userId,
    message,
    time: timeDate.getTime(),
    channelId,
    active: true
  };
}

function initializeUserReminders(userId) {
  if (!state.reminders) {
    state.reminders = {};
  }
  if (!state.reminders[userId]) {
    state.reminders[userId] = [];
  }
}

function generateBirthdayKey(userId, month, day) {
  return `${userId}_${month}_${day}`;
}

function createBirthdayData(month, day, guildId) {
  return {
    month: formatDateComponent(month, DATE_FORMATTING.MONTH_PAD_LENGTH),
    day: formatDateComponent(day, DATE_FORMATTING.DAY_PAD_LENGTH),
    nameType: 'self',
    preference: 'both',
    guildId
  };
}

async function handleManageMemory(userId, action, info) {
  if (action === MEMORY_ACTIONS.ADD) {
    await memorySystem.addPersonalData(userId, info);
    return { result: `${ERROR_MESSAGES.MEMORY_ADD_SUCCESS}: ${info}` };
  } else {
    await memorySystem.removePersonalData(userId, info);
    return { result: `${ERROR_MESSAGES.MEMORY_REMOVE_SUCCESS}: ${info}` };
  }
}

async function handleSearchMemory(userId, guildId, query) {
  const memories = await memorySystem.searchMemory(userId, guildId, query);
  return { 
    result: memories.length > 0 ? memories.join('\n') : ERROR_MESSAGES.NO_MEMORIES_FOUND 
  };
}

async function handleSetReminder(userId, message, timeRelative) {
  const { parseRelativeTime } = await import('./utils.js');
  const timeDate = parseRelativeTime(timeRelative);
  
  const reminder = createReminderObject(userId, message, timeDate);
  
  initializeUserReminders(userId);
  state.reminders[userId].push(reminder);
  
  await db.saveReminder(userId, reminder);
  await saveStateToFile();
  
  scheduleReminder(client, reminder);
  memorySystem.invalidatePersonalDataCache(userId);
  
  return { result: `${ERROR_MESSAGES.REMINDER_SET} ${timeDate.toLocaleString()}` };
}

async function handleSetBirthday(userId, month, day, guildId) {
  const birthdayKey = generateBirthdayKey(userId, month, day);
  const birthdayData = createBirthdayData(month, day, guildId);
  
  await db.saveBirthday(birthdayKey, birthdayData);
  memorySystem.invalidatePersonalDataCache(userId);
  
  return { result: `${ERROR_MESSAGES.BIRTHDAY_SET} ${month}/${day}` };
}

async function handleSetTimezone(userId, timezone) {
  await db.saveUserTimezone(userId, timezone);
  memorySystem.invalidatePersonalDataCache(userId);
  
  return { result: `${ERROR_MESSAGES.TIMEZONE_SET} ${timezone}` };
}

export async function executeFunctionCalls(calls, userId, guildId) {
  const results = await Promise.all(calls.map(async (call) => {
    let response = {};
    const args = call.args || {};

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

        default:
          response = { error: `Unknown function: ${call.name}` };
      }
    } catch (e) {
      console.error(`Error executing function ${call.name}:`, e);
      response = { error: `${ERROR_MESSAGES.OPERATION_FAILED}: ${e.message}` };
    }

    return {
      functionResponse: {
        name: call.name,
        response: response
      }
    };
  }));

  return results;
}
