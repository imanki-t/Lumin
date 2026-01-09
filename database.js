import { MongoClient } from 'mongodb';

let client;
let db;

const collections = {
userSettings: 'userSettings',
serverSettings: 'serverSettings',
chatHistories: 'chatHistories',
customInstructions: 'customInstructions',
blacklistedUsers: 'blacklistedUsers',
channelSettings: 'channelSettings',
memoryEntries: 'memoryEntries',
imageUsage: 'imageUsage',
birthdays: 'birthdays',
reminders: 'reminders',
dailyQuotes: 'dailyQuotes',
roulette: 'roulette',
compliments: 'compliments',
complimentOptOut: 'complimentOptOut',
userTimezones: 'userTimezones',
serverDigests: 'serverDigests',
activeUsersInChannels: 'activeUsersInChannels', 
userResponsePreference: 'userResponsePreference',
realive: 'realive',
summaryUsage: 'summaryUsage',
userFacts: 'userFacts'
};

export async function connectDB() {
try {
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/gemini-discord-bot';
  
  client = new MongoClient(uri, {
    maxPoolSize: 10,
    minPoolSize: 2,
    serverSelectionTimeoutMS: 5000,
  });

  await client.connect();
  db = client.db();
  
  console.log('✅ Connected to MongoDB successfully');
  
  await createIndexes();
  
  return db;
} catch (error) {
  console.error('❌ MongoDB connection error:', error);
  throw error;
}
}

async function createIndexes() {
try {
  await db.collection(collections.userSettings).createIndex({ userId: 1 }, { unique: true });
  await db.collection(collections.serverSettings).createIndex({ guildId: 1 }, { unique: true });
  await db.collection(collections.chatHistories).createIndex({ id: 1 }, { unique: true });
  await db.collection(collections.customInstructions).createIndex({ id: 1 }, { unique: true });
  await db.collection(collections.blacklistedUsers).createIndex({ guildId: 1 }, { unique: true });
  await db.collection(collections.channelSettings).createIndex({ channelId: 1 }, { unique: true });
  await db.collection(collections.memoryEntries).createIndex({ "metadata.historyId": 1, timestamp: -1 });
  await db.collection(collections.memoryEntries).createIndex({ "metadata.userId": 1 });
  await db.collection(collections.memoryEntries).createIndex({ "metadata.guildId": 1 });
  // Note: Vector Index "vector_index" must be created in MongoDB Atlas manually for findSimilarMemories to work
  
  await db.collection(collections.imageUsage).createIndex({ userId: 1 }, { unique: true });
  await db.collection(collections.birthdays).createIndex({ userId: 1 }, { unique: true });
  await db.collection(collections.reminders).createIndex({ userId: 1, id: 1 });
  await db.collection(collections.dailyQuotes).createIndex({ userId: 1 }, { unique: true });
  await db.collection(collections.roulette).createIndex({ channelId: 1 }, { unique: true });
  await db.collection(collections.compliments).createIndex({ userId: 1 }, { unique: true });
  await db.collection(collections.userTimezones).createIndex({ userId: 1 }, { unique: true });
  await db.collection(collections.serverDigests).createIndex({ guildId: 1 }, { unique: true });
  await db.collection(collections.realive).createIndex({ guildId: 1 }, { unique: true });
  await db.collection(collections.summaryUsage).createIndex({ userId: 1 }, { unique: true });
  
  // Added compound index for userFacts
  await db.collection(collections.userFacts).createIndex({ userId: 1, createdAt: -1 });
  
  console.log('✅ Database indexes created');
} catch (error) {
  console.error('⚠️ Error creating indexes:', error.message);
}
}

export async function closeDB() {
if (client) {
  await client.close();
  console.log('MongoDB connection closed');
}
}

// --- VECTOR SEARCH IMPLEMENTATION ---

export async function findSimilarMemories(historyId, queryEmbedding, limit = 5) {
 try {
   // Requires a Vector Search Index named "vector_index" on the "embedding" field
   const pipeline = [
     {
       $vectorSearch: {
         index: "vector_index",
         path: "embedding",
         queryVector: queryEmbedding,
         numCandidates: limit * 20,
         limit: limit,
         filter: { "metadata.historyId": { $eq: historyId } }
       }
     },
     {
       $project: {
         _id: 0,
         messages: 1,
         timestamp: 1,
         text: 1,
         metadata: 1,
         score: { $meta: "vectorSearchScore" }
       }
     }
   ];

   const results = await db.collection(collections.memoryEntries).aggregate(pipeline).toArray();
   return results;
 } catch (error) {
   // Graceful fallback if vector search fails
   if (error.codeName === 'IndexNotFound' || error.message.includes('$vectorSearch')) {
     console.log('ℹ️ Vector search index not available, using local search');
   } else {
     console.error('Vector search error:', error.message);
   }
   return null;
 }
}

export async function findSimilarMemoriesWithFilter(historyId, queryEmbedding, limit = 5, extraFilter = {}) {
 try {
   const filter = { "metadata.historyId": { $eq: historyId } };
   
   if (extraFilter.userId) {
     filter["metadata.userId"] = { $eq: extraFilter.userId };
   }
   if (extraFilter.guildId) {
     filter["metadata.guildId"] = { $eq: extraFilter.guildId };
   }
   
   const pipeline = [
     {
       $vectorSearch: {
         index: "vector_index",
         path: "embedding",
         queryVector: queryEmbedding,
         numCandidates: limit * 20,
         limit: limit,
         filter: filter
       }
     },
     {
       $project: {
         _id: 0,
         messages: 1,
         timestamp: 1,
         text: 1,
         metadata: 1,
         score: { $meta: "vectorSearchScore" }
       }
     }
   ];

   const results = await db.collection(collections.memoryEntries).aggregate(pipeline).toArray();
   return results;
 } catch (error) {
   if (error.codeName === 'IndexNotFound' || error.message.includes('$vectorSearch')) {
     console.log('ℹ️ Vector search index not available for filtered search');
   } else {
     console.error('Filtered vector search error:', error.message);
   }
   return null;
 }
}

// --- HELPER FUNCTIONS FOR PERSONAL DATA ---

export async function getBirthday(userId) {
 try {
   const doc = await db.collection(collections.birthdays).findOne({ userId });
   if (!doc) return null;
   return {
     month: doc.month,
     day: doc.day,
     name: doc.name
   };
 } catch (error) {
   console.error('Error getting birthday:', error);
   return null;
 }
}

export async function getUserReminders(userId) {
 try {
   const reminders = await db.collection(collections.reminders)
     .find({ userId, active: true })
     .toArray();
   return reminders;
 } catch (error) {
   console.error('Error getting user reminders:', error);
   return [];
 }
}

export async function getComplimentCount(userId) {
 try {
   const doc = await db.collection(collections.compliments).findOne({ userId });
   return doc?.count || 0;
 } catch (error) {
   console.error('Error getting compliment count:', error);
   return 0;
 }
}

export async function getUserDailyQuote(userId) {
 try {
   const doc = await db.collection(collections.dailyQuotes).findOne({ userId });
   if (!doc) return null;
   return {
     active: doc.active,
     category: doc.category,
     time: doc.time
   };
 } catch (error) {
   console.error('Error getting daily quote:', error);
   return null;
 }
}

// --- STANDARD DB FUNCTIONS ---

export async function saveUserSettings(userId, settings) {
try {
  await db.collection(collections.userSettings).updateOne(
    { userId },
    { $set: { userId, ...settings, updatedAt: new Date() } },
    { upsert: true }
  );
} catch (error) {
  console.error('Error saving user settings:', error);
  throw error;
}
}

export async function getUserSettings(userId) {
try {
  const settings = await db.collection(collections.userSettings).findOne({ userId });
  return settings || null;
} catch (error) {
  console.error('Error getting user settings:', error);
  return null;
}
}

export async function getAllUserSettings() {
try {
  const settings = await db.collection(collections.userSettings).find({}).toArray();
  const result = {};
  settings.forEach(setting => {
    const { userId, _id, updatedAt, ...rest } = setting;
    result[userId] = rest;
  });
  return result;
} catch (error) {
  console.error('Error getting all user settings:', error);
  return {};
}
}

export async function saveServerSettings(guildId, settings) {
try {
  await db.collection(collections.serverSettings).updateOne(
    { guildId },
    { $set: { guildId, ...settings, updatedAt: new Date() } },
    { upsert: true }
  );
} catch (error) {
  console.error('Error saving server settings:', error);
  throw error;
}
}

export async function getServerSettings(guildId) {
try {
  const settings = await db.collection(collections.serverSettings).findOne({ guildId });
  return settings || null;
} catch (error) {
  console.error('Error getting server settings:', error);
  return null;
}
}

export async function getAllServerSettings() {
try {
  const settings = await db.collection(collections.serverSettings).find({}).toArray();
  const result = {};
  settings.forEach(setting => {
    const { guildId, _id, updatedAt, ...rest } = setting;
    result[guildId] = rest;
  });
  return result;
} catch (error) {
  console.error('Error getting all server settings:', error);
  return {};
}
}

export async function saveChatHistory(id, history) {
try {
  await db.collection(collections.chatHistories).updateOne(
    { id },
    { $set: { id, history, updatedAt: new Date() } },
    { upsert: true }
  );
} catch (error) {
  console.error('Error saving chat history:', error);
  throw error;
}
}

export async function getChatHistory(id) {
try {
  const record = await db.collection(collections.chatHistories).findOne({ id });
  return record ? record.history : null;
} catch (error) {
  console.error('Error getting chat history:', error);
  return null;
}
}

export async function getAllChatHistories() {
try {
  const histories = await db.collection(collections.chatHistories).find({}).toArray();
  const result = {};
  histories.forEach(history => {
    result[history.id] = history.history;
  });
  return result;
} catch (error) {
  console.error('Error getting all chat histories:', error);
  return {};
}
}

export async function deleteChatHistory(id) {
try {
  await db.collection(collections.chatHistories).deleteOne({ id });
} catch (error) {
  console.error('Error deleting chat history:', error);
  throw error;
}
}

export async function saveCustomInstructions(id, instructions) {
try {
  await db.collection(collections.customInstructions).updateOne(
    { id },
    { $set: { id, instructions, updatedAt: new Date() } },
    { upsert: true }
  );
} catch (error) {
  console.error('Error saving custom instructions:', error);
  throw error;
}
}

export async function getCustomInstructions(id) {
try {
  const record = await db.collection(collections.customInstructions).findOne({ id });
  return record ? record.instructions : null;
} catch (error) {
  console.error('Error getting custom instructions:', error);
  return null;
}
}

export async function getAllCustomInstructions() {
try {
  const instructions = await db.collection(collections.customInstructions).find({}).toArray();
  const result = {};
  instructions.forEach(instruction => {
    result[instruction.id] = instruction.instructions;
  });
  return result;
} catch (error) {
  console.error('Error getting all custom instructions:', error);
  return {};
}
}

export async function saveBlacklistedUsers(guildId, users) {
try {
  await db.collection(collections.blacklistedUsers).updateOne(
    { guildId },
    { $set: { guildId, users, updatedAt: new Date() } },
    { upsert: true }
  );
} catch (error) {
  console.error('Error saving blacklisted users:', error);
  throw error;
}
}

export async function getBlacklistedUsers(guildId) {
try {
  const record = await db.collection(collections.blacklistedUsers).findOne({ guildId });
  return record ? record.users : null;
} catch (error) {
  console.error('Error getting blacklisted users:', error);
  return null;
}
}

export async function getAllBlacklistedUsers() {
try {
  const blacklists = await db.collection(collections.blacklistedUsers).find({}).toArray();
  const result = {};
  blacklists.forEach(blacklist => {
    result[blacklist.guildId] = blacklist.users;
  });
  return result;
} catch (error) {
  console.error('Error getting all blacklisted users:', error);
  return {};
}
}

export async function saveChannelSetting(channelId, settingType, value) {
try {
  await db.collection(collections.channelSettings).updateOne(
    { channelId },
    { $set: { channelId, [settingType]: value, updatedAt: new Date() } },
    { upsert: true }
  );
} catch (error) {
  console.error('Error saving channel setting:', error);
  throw error;
}
}

export async function getChannelSetting(channelId, settingType) {
try {
  const record = await db.collection(collections.channelSettings).findOne({ channelId });
  return record ? record[settingType] : null;
} catch (error) {
  console.error('Error getting channel setting:', error);
  return null;
}
}

export async function getAllChannelSettings(settingType) {
try {
  const settings = await db.collection(collections.channelSettings).find({}).toArray();
  const result = {};
  settings.forEach(setting => {
    if (setting[settingType] !== undefined) {
      result[setting.channelId] = setting[settingType];
    }
  });
  return result;
} catch (error) {
  console.error('Error getting all channel settings:', error);
  return {};
}
}

export async function saveActiveUsersInChannels(data) {
try {
  await db.collection(collections.activeUsersInChannels).updateOne(
    { _id: 'active_users' },
    { $set: { data, updatedAt: new Date() } },
    { upsert: true }
  );
} catch (error) {
  console.error('Error saving active users:', error);
  throw error;
}
}

export async function getActiveUsersInChannels() {
try {
  const record = await db.collection(collections.activeUsersInChannels).findOne({ _id: 'active_users' });
  return record ? record.data : {};
} catch (error) {
  console.error('Error getting active users:', error);
  return {};
}
}

export async function saveUserResponsePreference(userId, preference) {
try {
  await db.collection(collections.userResponsePreference).updateOne(
    { userId },
    { $set: { userId, preference, updatedAt: new Date() } },
    { upsert: true }
  );
} catch (error) {
  console.error('Error saving user response preference:', error);
  throw error;
}
}

export async function getUserResponsePreference(userId) {
try {
  const record = await db.collection(collections.userResponsePreference).findOne({ userId });
  return record ? record.preference : null;
} catch (error) {
  console.error('Error getting user response preference:', error);
  return null;
}
}

export async function getAllUserResponsePreferences() {
try {
  const prefs = await db.collection(collections.userResponsePreference).find({}).toArray();
  const result = {};
  prefs.forEach(pref => {
    result[pref.userId] = pref.preference;
  });
  return result;
} catch (error) {
  console.error('Error getting all user response preferences:', error);
  return {};
}
}

export async function saveMemoryEntry(historyId, entry) {
try {
  await db.collection(collections.memoryEntries).insertOne({
    ...entry,
    metadata: entry.metadata || { historyId },
    createdAt: new Date()
  });
} catch (error) {
  console.error('Error saving memory entry:', error);
  throw error;
}
}

export async function getMemoryEntries(historyId, limit = 50) {
try {
  const entries = await db.collection(collections.memoryEntries)
    .find({ "metadata.historyId": historyId })
    .sort({ timestamp: -1 })
    .limit(limit)
    .toArray();
  return entries;
} catch (error) {
  console.error('Error getting memory entries:', error);
  return [];
}
}

export async function deleteOldMemoryEntries(cutoffTimestamp) {
try {
  const result = await db.collection(collections.memoryEntries)
    .deleteMany({ timestamp: { $lt: cutoffTimestamp } });
  return result.deletedCount;
} catch (error) {
  console.error('Error deleting old memory entries:', error);
  return 0;
}
}

export async function saveImageUsage(userId, usageData) {
try {
  await db.collection(collections.imageUsage).updateOne(
    { userId },
    { $set: { userId, ...usageData, updatedAt: new Date() } },
    { upsert: true }
  );
} catch (error) {
  console.error('Error saving image usage:', error);
  throw error;
}
}

export async function getAllImageUsages() {
try {
  const usages = await db.collection(collections.imageUsage).find({}).toArray();
  const result = {};
  usages.forEach(u => {
    result[u.userId] = {
      count: u.count,
      lastReset: u.lastReset,
      lastRequest: u.lastRequest
    };
  });
  return result;
} catch (error) {
  console.error('Error getting all image usages:', error);
  return {};
}
}

export async function saveBirthday(userId, data) {
try {
  await db.collection(collections.birthdays).updateOne(
    { userId },
    { $set: { userId, ...data, updatedAt: new Date() } },
    { upsert: true }
  );
} catch (error) {
  console.error('Error saving birthday:', error);
  throw error;
}
}

export async function getAllBirthdays() {
try {
  const birthdays = await db.collection(collections.birthdays).find({}).toArray();
  const result = {};
  birthdays.forEach(birthday => {
    const { userId, _id, updatedAt, ...rest } = birthday;
    result[userId] = rest;
  });
  return result;
} catch (error) {
  console.error('Error getting birthdays:', error);
  return {};
}
}

export async function deleteBirthday(userId) {
try {
  await db.collection(collections.birthdays).deleteOne({ userId });
} catch (error) {
  console.error('Error deleting birthday:', error);
  throw error;
}
}

export async function saveReminder(userId, reminder) {
try {
  await db.collection(collections.reminders).insertOne({
    userId,
    ...reminder,
    createdAt: new Date()
  });
} catch (error) {
  console.error('Error saving reminder:', error);
  throw error;
}
}

export async function getAllReminders() {
try {
  const reminders = await db.collection(collections.reminders).find({ active: true }).toArray();
  const result = {};
  reminders.forEach(reminder => {
    if (!result[reminder.userId]) {
      result[reminder.userId] = [];
    }
    result[reminder.userId].push(reminder);
  });
  return result;
} catch (error) {
  console.error('Error getting reminders:', error);
  return {};
}
}

export async function updateReminder(reminderId, updates) {
try {
  await db.collection(collections.reminders).updateOne(
    { id: reminderId },
    { $set: updates }
  );
} catch (error) {
  console.error('Error updating reminder:', error);
  throw error;
}
}

export async function deleteReminder(reminderId) {
try {
  await db.collection(collections.reminders).deleteOne({ id: reminderId });
} catch (error) {
  console.error('Error deleting reminder:', error);
  throw error;
}
}

export async function saveDailyQuote(userId, config) {
try {
  await db.collection(collections.dailyQuotes).updateOne(
    { userId },
    { $set: { userId, ...config, updatedAt: new Date() } },
    { upsert: true }
  );
} catch (error) {
  console.error('Error saving daily quote:', error);
  throw error;
}
}

export async function getAllDailyQuotes() {
try {
  const quotes = await db.collection(collections.dailyQuotes).find({ active: true }).toArray();
  const result = {};
  quotes.forEach(quote => {
    const { userId, _id, updatedAt, ...rest } = quote;
    result[userId] = rest;
  });
  return result;
} catch (error) {
  console.error('Error getting daily quotes:', error);
  return {};
}
}

export async function deleteDailyQuote(userId) {
try {
  await db.collection(collections.dailyQuotes).deleteOne({ userId });
} catch (error) {
  console.error('Error deleting daily quote:', error);
  throw error;
}
}

export async function saveRouletteConfig(channelId, config) {
try {
  await db.collection(collections.roulette).updateOne(
    { channelId },
    { $set: { channelId, ...config, updatedAt: new Date() } },
    { upsert: true }
  );
} catch (error) {
  console.error('Error saving roulette config:', error);
  throw error;
}
}

export async function getAllRouletteConfigs() {
try {
  const configs = await db.collection(collections.roulette).find({}).toArray();
  const result = {};
  configs.forEach(config => {
    const { channelId, _id, updatedAt, ...rest } = config;
    result[channelId] = rest;
  });
  return result;
} catch (error) {
  console.error('Error getting roulette configs:', error);
  return {};
}
}

export async function saveComplimentCount(userId, count) {
try {
  await db.collection(collections.compliments).updateOne(
    { userId },
    { $set: { userId, count, updatedAt: new Date() } },
    { upsert: true }
  );
} catch (error) {
  console.error('Error saving compliment count:', error);
  throw error;
}
}

export async function getAllComplimentCounts() {
try {
  const counts = await db.collection(collections.compliments).find({}).toArray();
  const result = {};
  counts.forEach(c => {
    result[c.userId] = c.count;
  });
  return result;
} catch (error) {
  console.error('Error getting compliment counts:', error);
  return {};
}
}

export async function saveComplimentOptOut(userId, optedOut) {
try {
  if (optedOut) {
    await db.collection(collections.complimentOptOut).updateOne(
      { userId },
      { $set: { userId, optedOut: true, updatedAt: new Date() } },
      { upsert: true }
    );
  } else {
    await db.collection(collections.complimentOptOut).deleteOne({ userId });
  }
} catch (error) {
  console.error('Error saving compliment opt-out:', error);
  throw error;
}
}

export async function getAllComplimentOptOuts() {
try {
  const optOuts = await db.collection(collections.complimentOptOut).find({}).toArray();
  const result = {};
  optOuts.forEach(o => {
    result[o.userId] = true;
  });
  return result;
} catch (error) {
  console.error('Error getting compliment opt-outs:', error);
  return {};
}
}

export async function saveUserTimezone(userId, timezone) {
try {
  await db.collection(collections.userTimezones).updateOne(
    { userId },
    { 
      $set: { 
        userId, 
        timezone, 
        updatedAt: new Date()
      }
    },
    { upsert: true }
  );
} catch (error) {
  console.error('Error saving user timezone:', error);
  throw error;
}
}

export async function getUserTimezone(userId) {
try {
  const doc = await db.collection(collections.userTimezones).findOne({ userId });
  return doc?.timezone || null;
} catch (error) {
  console.error('Error getting user timezone:', error);
  return null;
}
}

export async function getAllUserTimezones() {
try {
  const docs = await db.collection(collections.userTimezones).find({}).toArray();
  const result = {};
  docs.forEach(doc => {
    result[doc.userId] = doc.timezone;
  });
  return result;
} catch (error) {
  console.error('Error getting all user timezones:', error);
  return {};
}
}

export async function saveServerDigest(guildId, digest) {
try {
  await db.collection(collections.serverDigests).updateOne(
    { guildId },
    { 
      $set: { 
        guildId,
        ...digest,
        updatedAt: new Date()
      }
    },
    { upsert: true }
  );
} catch (error) {
  console.error('Error saving server digest:', error);
  throw error;
}
}

export async function getServerDigest(guildId) {
try {
  const doc = await db.collection(collections.serverDigests).findOne({ guildId });
  if (!doc) return null;
  return {
    timestamp: doc.timestamp,
    messageCount: doc.messageCount,
    summary: doc.summary,
    daysAnalyzed: doc.daysAnalyzed
  };
} catch (error) {
  console.error('Error getting server digest:', error);
  return null;
}
}

export async function getAllServerDigests() {
try {
  const docs = await db.collection(collections.serverDigests).find({}).toArray();
  const result = {};
  docs.forEach(doc => {
    result[doc.guildId] = {
      timestamp: doc.timestamp,
      messageCount: doc.messageCount,
      summary: doc.summary,
      daysAnalyzed: doc.daysAnalyzed
    };
  });
  return result;
} catch (error) {
  console.error('Error getting all server digests:', error);
  return {};
}
}

export async function saveQuoteUsage(userId, usage) {
try {
  await db.collection('quoteUsage').updateOne(
    { userId },
    { 
      $set: { 
        userId, 
        count: usage.count,
        lastReset: usage.lastReset,
        updatedAt: new Date()
      }
    },
    { upsert: true }
  );
} catch (error) {
  console.error('Error saving quote usage:', error);
  throw error;
}
}

export async function getQuoteUsage(userId) {
try {
  const doc = await db.collection('quoteUsage').findOne({ userId });
  if (!doc) return null;
  return {
    count: doc.count,
    lastReset: doc.lastReset
  };
} catch (error) {
  console.error('Error getting quote usage:', error);
  return null;
}
}

export async function getAllQuoteUsages() {
try {
  const docs = await db.collection('quoteUsage').find({}).toArray();
  const result = {};
  docs.forEach(doc => {
    result[doc.userId] = {
      count: doc.count,
      lastReset: doc.lastReset
    };
  });
  return result;
} catch (error) {
  console.error('Error getting all quote usages:', error);
  return {};
}
}

export async function saveRealiveConfig(guildId, config) {
try {
  await db.collection(collections.realive).updateOne(
    { guildId },
    { $set: { guildId, ...config, updatedAt: new Date() } },
    { upsert: true }
  );
} catch (error) {
  console.error('Error saving realive config:', error);
  throw error;
}
}

export async function getAllRealiveConfigs() {
try {
  const configs = await db.collection(collections.realive).find({}).toArray();
  const result = {};
  configs.forEach(config => {
    const { guildId, _id, updatedAt, ...rest } = config;
    result[guildId] = rest;
  });
  return result;
} catch (error) {
  console.error('Error getting realive configs:', error);
  return {};
}
}

export async function saveSummaryUsage(userId, usage) {
try {
  await db.collection(collections.summaryUsage).updateOne(
    { userId },
    { $set: { userId, ...usage, updatedAt: new Date() } },
    { upsert: true }
  );
} catch (error) {
  console.error('Error saving summary usage:', error);
  throw error;
}
}

export async function getAllSummaryUsages() {
try {
  const usages = await db.collection(collections.summaryUsage).find({}).toArray();
  const result = {};
  usages.forEach(u => {
    result[u.userId] = {
      count: u.count,
      lastReset: u.lastReset
    };
  });
  return result;
} catch (error) {
  console.error('Error getting summary usages:', error);
  return {};
}
}

// --- USER FACTS FUNCTIONS ---

export async function saveUserFact(userId, fact) {
 try {
   await db.collection(collections.userFacts).insertOne({
     userId,
     fact,
     createdAt: new Date()
   });
 } catch (error) {
   console.error('Error saving user fact:', error);
   throw error;
 }
}

export async function getUserFacts(userId) {
 try {
   const docs = await db.collection(collections.userFacts)
     .find({ userId })
     .sort({ createdAt: -1 })
     .limit(20) // Limit context size
     .toArray();
   return docs.map(d => d.fact);
 } catch (error) {
   console.error('Error getting user facts:', error);
   return [];
 }
}

export async function deleteUserFact(userId, factKeyword) {
 try {
   // Simple deletion by regex matching keyword
   const result = await db.collection(collections.userFacts).deleteMany({
     userId,
     fact: { $regex: factKeyword, $options: 'i' }
   });
   return result.deletedCount;
 } catch (error) {
   console.error('Error deleting user fact:', error);
   return 0;
 }
}

export function getDB() {
return db;
}