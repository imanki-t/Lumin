import * as db from '../database.js';
import { memorySystem } from '../memorySystem.js';
import { state, saveStateToFile, client } from '../botManager.js';
import { scheduleReminder } from '../commands/reminder.js';

// ✅ FIXED: Tool Definitions with UPPERCASE types (required by Gemini API)
export const functionTools = [
  {
    functionDeclarations: [
      {
        name: "manage_personal_memory",
        description: "Add or remove permanent facts/memories about the user (e.g., likes, dislikes, pets).",
        parameters: {
          type: "OBJECT",  // ✅ MUST be uppercase
          properties: {
            action: {
              type: "STRING",  // ✅ MUST be uppercase
              enum: ["add", "remove"],
              description: "Action to perform"
            },
            info: {
              type: "STRING",  // ✅ MUST be uppercase
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
          type: "OBJECT",  // ✅ MUST be uppercase
          properties: {
            query: {
              type: "STRING",  // ✅ MUST be uppercase
              description: "The search query to find relevant memories"
            }
          },
          required: ["query"]
        }
      },
      {
        name: "set_reminder",
        description: "Set a reminder for the user. YOU MUST calculate the absolute target time based on the user's request and current time.",
        parameters: {
          type: "OBJECT",  // ✅ MUST be uppercase
          properties: {
            message: {
              type: "STRING",  // ✅ MUST be uppercase
              description: "What to remind about"
            },
            datetime: {
              type: "STRING",  // ✅ MUST be uppercase
              description: "ISO 8601 formatted absolute timestamp (e.g. 2024-12-31T15:00:00) when the reminder should fire."
            }
          },
          required: ["message", "datetime"]
        }
      },
      {
        name: "set_birthday",
        description: "Set the user's birthday.",
        parameters: {
          type: "OBJECT",  // ✅ MUST be uppercase
          properties: {
            month: {
              type: "NUMBER",  // ✅ Use NUMBER (not INTEGER) - uppercase
              description: "Month (1-12)"
            },
            day: {
              type: "NUMBER",  // ✅ Use NUMBER (not INTEGER) - uppercase
              description: "Day (1-31)"
            }
          },
          required: ["month", "day"]
        }
      },
      {
        name: "set_timezone",
        description: "Set the user's timezone.",
        parameters: {
          type: "OBJECT",  // ✅ MUST be uppercase
          properties: {
            timezone: {
              type: "STRING",  // ✅ MUST be uppercase
              description: "IANA Timezone string (e.g. 'America/New_York', 'UTC')"
            }
          },
          required: ["timezone"]
        }
      }
    ]
  }
];

// Execution Logic (unchanged)
export async function executeFunctionCalls(calls, userId, guildId) {
  // Parallel processing of tool calls
  const results = await Promise.all(calls.map(async (call) => {
    const args = call.args;
    let response = { result: "Success" };

    try {
      switch (call.name) {
        case 'manage_personal_memory':
          if (args.action === 'add') {
            await db.saveUserFact(userId, args.info);
            memorySystem.invalidatePersonalDataCache(userId);
            response = { result: `Added to memory: "${args.info}"` };
          } else {
            const count = await db.deleteUserFact(userId, args.info);
            memorySystem.invalidatePersonalDataCache(userId);
            response = { result: `Removed ${count} memories matching "${args.info}"` };
          }
          break;

        case 'search_memory':
          const queryEmbedding = await memorySystem.generateEmbedding(args.query, 'RETRIEVAL_QUERY');
          if (queryEmbedding) {
            const results = await db.findSimilarMemories(guildId || userId, queryEmbedding, 3);
            response = { 
              found: results.length > 0,
              memories: results.map(r => r.text || r.messages.map(m => m.content[0].text).join(' ')).join('\n---\n') 
            };
          } else {
            response = { error: "Failed to generate embedding" };
          }
          break;

        case 'set_reminder':
            try {
              const timeDate = new Date(args.datetime);
              if (isNaN(timeDate.getTime())) {
                  throw new Error("Invalid datetime format.");
              }

              const reminder = {
                  id: `${userId}_${Date.now()}`,
                  type: 'once',
                  message: args.message,
                  time: {
                      year: timeDate.getFullYear(),
                      month: timeDate.getMonth() + 1,
                      day: timeDate.getDate(),
                      hour: timeDate.getHours(),
                      minute: timeDate.getMinutes()
                  },
                  location: 'dm',
                  guildId: null,
                  active: true,
                  createdAt: Date.now()
              };

              if (!state.reminders) state.reminders = {};
              if (!state.reminders[userId]) state.reminders[userId] = [];
              
              state.reminders[userId].push(reminder);
              await db.saveReminder(userId, reminder);
              await saveStateToFile();
              
              // Schedule the reminder immediately
              scheduleReminder(client, reminder);
              
              // Invalidate cache
              memorySystem.invalidatePersonalDataCache(userId);
              
              response = { result: `Reminder successfully set for ${timeDate.toLocaleString()} to: ${args.message}` };
            } catch (err) {
              response = { error: `Failed to set reminder: ${err.message}` };
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
