import * as db from '../database.js';
import { state, saveStateToFile } from '../botManager.js';
import { memorySystem } from '../memorySystem.js';

export async function executeTool(name, args, userId, guildId) {
  try {
    console.log(`🛠️ Executing Tool: ${name} for User: ${userId}`, args);

    switch (name) {
      case 'set_birthday':
        return await handleSetBirthday(userId, guildId, args);
      
      case 'set_timezone':
        return await handleSetTimezone(userId, args);
      
      case 'add_personal_memory':
        return await handleAddPersonalMemory(userId, args);
      
      case 'search_memory':
        return await handleSearchMemory(userId, guildId, args);
      
      default:
        return { error: `Unknown tool: ${name}` };
    }
  } catch (error) {
    console.error(`Error executing tool ${name}:`, error);
    return { error: `Tool execution failed: ${error.message}` };
  }
}

async function handleSetBirthday(userId, guildId, args) {
  const { month, day, nameType, name } = args;
  
  const birthdayKey = `${userId}_${month}_${day}`;
  
  if (!state.birthdays) state.birthdays = {};
  
  const data = {
    month,
    day,
    preference: guildId ? 'both' : 'dm', // Default preference
    guildId: guildId || null,
    year: null,
    nameType,
    name: name || null,
    ownerUsername: 'User' // We don't have username passed here easily, can update later
  };

  state.birthdays[birthdayKey] = data;
  await db.saveBirthday(birthdayKey, data);
  await saveStateToFile();

  const person = nameType === 'self' ? 'your' : `${name || 'their'}`;
  return { result: `✅ Successfully set ${person} birthday for ${month}/${day}.` };
}

async function handleSetTimezone(userId, args) {
  const { timezone } = args;
  
  // Validate basic IANA format
  try {
    Intl.DateTimeFormat(undefined, { timeZone: timezone });
  } catch (e) {
    return { error: `Invalid timezone ID: ${timezone}. Please use a valid IANA format like 'America/New_York'.` };
  }

  if (!state.userTimezones) state.userTimezones = {};
  state.userTimezones[userId] = timezone;
  
  await db.saveUserTimezone(userId, timezone);
  await saveStateToFile();

  return { result: `✅ Timezone set to ${timezone}.` };
}

async function handleAddPersonalMemory(userId, args) {
  const { text } = args;
  
  await db.saveUserContext(userId, text);
  
  // Clear cache so it updates immediately
  if (memorySystem.personalDataCache) {
    memorySystem.personalDataCache.delete(userId);
  }

  return { result: `✅ Added to personal context: "${text}"` };
}

async function handleSearchMemory(userId, guildId, args) {
  const { query } = args;
  const historyId = guildId || userId; // Default to current context
  
  // Use manual vector search
  const embedding = await memorySystem.generateEmbedding(query, 'RETRIEVAL_QUERY');
  if (!embedding) return { result: "Failed to generate search embedding." };

  const results = await db.findSimilarMemories(historyId, embedding, 3);
  
  if (!results || results.length === 0) {
    return { result: "No relevant memories found." };
  }

  const foundText = results.map(r => `[Date: ${new Date(r.timestamp).toLocaleDateString()}] ${r.text}`).join('\n\n');
  
  return { result: `Found these memories:\n${foundText}` };
}
