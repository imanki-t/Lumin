/**
 * @fileoverview Database barrel. Re-exports everything from all sub-modules so
 *               callers can keep using:
 *                 import * as db from '../database/index.js'
 *               or the root shim:
 *                 import * as db from '../database.js'
 *
 * Export order mirrors the original database.js public surface so diff-tools
 * show zero logical changes.
 * @module database
 */

// ── Connection & infrastructure ───────────────────────────────────────────
export { connectDB, closeDB, getDB } from './connection.js';

// ── Vector search + personal context helpers ──────────────────────────────
export {
  findSimilarMemories,
  findSimilarMemoriesWithFilter,
  findSimilarMemoriesByUser,
  getBirthday,
  getUserReminders,
  getComplimentCount,
  getUserDailyQuote
} from './vectorSearch.js';

// ── Settings ──────────────────────────────────────────────────────────────
export {
  saveUserSettings,
  getUserSettings,
  getAllUserSettings,
  saveServerSettings,
  getServerSettings,
  getAllServerSettings,
  saveCustomInstructions,
  getCustomInstructions,
  getAllCustomInstructions,
  saveBlacklistedUsers,
  getBlacklistedUsers,
  getAllBlacklistedUsers,
  saveChannelSetting,
  getChannelSetting,
  getAllChannelSettings,
  saveActiveUsersInChannels,
  getActiveUsersInChannels,
  saveUserResponsePreference,
  getUserResponsePreference,
  getAllUserResponsePreferences
} from './collections/settingsRepo.js';

// ── Chat histories ────────────────────────────────────────────────────────
export {
  saveChatHistory,
  getChatHistory,
  getAllChatHistories,
  deleteChatHistory
} from './collections/historyRepo.js';

// ── Memory (RAG) ──────────────────────────────────────────────────────────
export {
  saveMemoryEntry,
  getMemoryEntries,
  getMemoryEmbeddings,
  getMemoryEmbeddingsSampled,
  getMemoryEntriesByIds,
  deleteOldMemoryEntries
} from './collections/memoryRepo.js';

// ── Feature collections ───────────────────────────────────────────────────
export {
  saveBirthday,
  getAllBirthdays,
  deleteBirthday,
  saveReminder,
  getAllReminders,
  updateReminder,
  deleteReminder,
  saveDailyQuote,
  getAllDailyQuotes,
  deleteDailyQuote,
  saveRouletteConfig,
  getAllRouletteConfigs,
  saveComplimentCount,
  getAllComplimentCounts,
  saveComplimentOptOut,
  getAllComplimentOptOuts,
  saveUserTimezone,
  getUserTimezone,
  getAllUserTimezones,
  saveServerDigest,
  getServerDigest,
  getAllServerDigests,
  saveRealiveConfig,
  getAllRealiveConfigs
} from './collections/featuresRepo.js';

// ── Usage tracking + user facts ───────────────────────────────────────────
export {
  saveImageUsage,
  getAllImageUsages,
  saveQuoteUsage,
  getQuoteUsage,
  getAllQuoteUsages,
  saveSummaryUsage,
  getAllSummaryUsages,
  saveUserFact,
  getUserFacts,
  deleteUserFact,
  saveServerFact,
  getServerFacts,
  deleteServerFact,
  saveIndexedCount,
  getIndexedCounts
} from './collections/usageRepo.js';

// ── Batch helper ──────────────────────────────────────────────────────────
export { batchSave } from './batchSave.js';
