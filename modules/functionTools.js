import * as db from '../database.js';
import { memorySystem } from '../memorySystem.js';
import { state, saveStateToFile, client } from '../botManager.js';
import { scheduleReminder } from '../commands/reminder.js';

/**
 * ✅ Tool Definitions
 * Note: These are wrapped in an object with 'functionDeclarations' 
 * to match the structure expected by the unified tool merger.
 */
export const functionTools = [
  {
    functionDeclarations: [
      {
        name: "manage_personal_memory",
        description: "Add or remove permanent facts/memories about the user (e.g., likes, dislikes, pets).",
        parameters: {
          type: "OBJECT",
          properties: {
            action: {
              type: "STRING",
              enum: ["add", "remove"],
              description: "Action to perform"
            },
            info: {
              type: "STRING",
              description: "The fact or information to store/delete"
            }
          },
          required: ["action", "info"]
        }
      },
      {
        name: "search_memory",
        description: "Search the database for specific past conversations or facts using a query.",
        parameters: {
          type: "OBJECT",
          properties: {
            query: {
              type: "STRING",
              description: "The search query to find relevant memories"
            }
          },
          required: ["query"]
        }
      },
      {
        name: "set_reminder",
        description: "Set a reminder for the user at a specific time (e.g., 'remind me to buy milk in 2 hours').",
        parameters: {
          type: "OBJECT",
          properties: {
            message: { type: "STRING", description: "What to remind the user about" },
            time_relative: { type: "STRING", description: "Relative time (e.g., '5 minutes', '2 hours', 'tomorrow at 10am')" }
          },
          required: ["message", "time_relative"]
        }
      },
      {
        name: "set_birthday",
        description: "Store the user's birthday.",
        parameters: {
          type: "OBJECT",
          properties: {
            day: { type: "NUMBER", description: "Day of birth" },
            month: { type: "NUMBER", description: "Month of birth" }
          },
          required: ["day", "month"]
        }
      },
      {
        name: "set_timezone",
        description: "Set the user's timezone for reminders and time-sensitive tasks.",
        parameters: {
          type: "OBJECT",
          properties: {
            timezone: { type: "STRING", description: "IANA timezone string (e.g., 'America/New_York', 'Asia/Kolkata')" }
          },
          required: ["timezone"]
        }
      }
    ]
  }
];

export async function executeFunctionCalls(calls, userId, guildId) {
  const results = await Promise.all(calls.map(async (call) => {
    let response = {};
    const args = call.args;

    try {
      switch (call.name) {
        case 'manage_personal_memory':
          if (args.action === 'add') {
            await memorySystem.addPersonalData(userId, args.info);
            response = { result: `Memory added: ${args.info}` };
          } else {
            await memorySystem.removePersonalData(userId, args.info);
            response = { result: `Memory removed: ${args.info}` };
          }
          break;

        case 'search_memory':
          const memories = await memorySystem.searchMemory(userId, guildId, args.query);
          response = { result: memories.length > 0 ? memories.join('\n') : "No relevant memories found." };
          break;

        case 'set_reminder':
            try {
              const { parseRelativeTime } = await import('./utils.js');
              const timeDate = parseRelativeTime(args.time_relative);
              
              const reminder = {
                id: Date.now().toString(),
                userId,
                message: args.message,
                time: timeDate.getTime(),
                channelId: null // Handled by the system
              };

              if (!state.reminders) state.reminders = {};
              if (!state.reminders[userId]) state.reminders[userId] = [];
              
              state.reminders[userId].push(reminder);
              await db.saveReminder(userId, reminder);
              await saveStateToFile();
              
              scheduleReminder(client, reminder);
              memorySystem.invalidatePersonalDataCache(userId);
              
              response = { result: `Reminder set for ${timeDate.toLocaleString()}` };
            } catch (err) {
              response = { error: `Failed: ${err.message}` };
            }
            break;

        case 'set_birthday':
           const birthdayKey = `${userId}_${args.month}_${args.day}`;
           await db.saveBirthday(birthdayKey, { 
             month: String(args.month).padStart(2, '0'), 
             day: String(args.day).padStart(2, '0'), 
             nameType: 'self', preference: 'both', guildId 
           });
           memorySystem.invalidatePersonalDataCache(userId);
           response = { result: `Birthday set to ${args.month}/${args.day}` };
           break;

        case 'set_timezone':
           await db.saveUserTimezone(userId, args.timezone);
           memorySystem.invalidatePersonalDataCache(userId);
           response = { result: `Timezone set to ${args.timezone}` };
           break;
      }
    } catch (e) {
      response = { error: e.message };
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
