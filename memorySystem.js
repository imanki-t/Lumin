import fs from 'fs/promises';
import path from 'path';
import { genAI, TEMP_DIR } from './botManager.js';
import * as db from './database.js';

// ============================================================================
// CONFIGURATION CONSTANTS - Adjust these to customize memory behavior
// ============================================================================

/** Embedding model for vector search */
const EMBEDDING_MODEL = 'gemini-embedding-001';

/** Maximum number of recent messages to keep in full context (always visible to model) */
const RECENT_MESSAGE_WINDOW = 10;

/** Minimum number of old messages before compression kicks in */
const COMPRESSION_THRESHOLD = 30;

/** Number of messages to group together when creating memory chunks for indexing */
const CHUNK_SIZE = 8;

/** Number of overlapping messages between chunks to maintain context */
const CHUNK_OVERLAP = 2;

/** Maximum number of relevant memories to retrieve via RAG */
const MAX_RAG_RESULTS = 3;

/** Minimum cosine similarity score for a memory to be considered relevant (0.0 to 1.0) */
const MIN_SIMILARITY_THRESHOLD = 0.65;

/** Time gap in milliseconds that triggers a "TIME ELAPSED" marker (30 minutes) */
const TIME_GAP_THRESHOLD_MS = 30 * 60 * 1000;

/** Cache TTL for personal data (5 minutes) */
const PERSONAL_DATA_CACHE_TTL_MS = 5 * 60 * 1000;

/** Maximum embedding cache size before cleanup */
const MAX_EMBEDDING_CACHE_SIZE = 1000;

/** Interval for generating fresh summaries (every N messages) */
const SUMMARY_GENERATION_INTERVAL = 25;

/** Maximum context file size before using file upload (characters) */
const MAX_INLINE_CONTEXT_SIZE = 1500;

// ============================================================================
// MEMORY SYSTEM CLASS
// ============================================================================

class MemorySystem {
  constructor() {
    this.embeddingCache = new Map();
    this.lastIndexedCount = new Map();
    this.summaryCache = new Map();
    this.personalDataCache = new Map();
  }

  // ==========================================================================
  // EMBEDDING UTILITIES
  // ==========================================================================

  /**
   * Generate embedding for text with caching
   */
  async generateEmbedding(text, taskType = 'RETRIEVAL_DOCUMENT') {
    if (!text || typeof text !== 'string' || text.trim().length === 0) {
      return null;
    }

    const cacheKey = `${text.slice(0, 100)}_${taskType}`;
    if (this.embeddingCache.has(cacheKey)) {
      return this.embeddingCache.get(cacheKey);
    }

    try {
      const result = await genAI.models.embedContent({
        model: EMBEDDING_MODEL,
        contents: text,
        config: { taskType }
      });

      const embedding = result.embeddings?.[0]?.values;
      if (!embedding || !Array.isArray(embedding)) {
        return null;
      }

      this.embeddingCache.set(cacheKey, embedding);

      if (this.embeddingCache.size > MAX_EMBEDDING_CACHE_SIZE) {
        const firstKey = this.embeddingCache.keys().next().value;
        this.embeddingCache.delete(firstKey);
      }

      return embedding;
    } catch (error) {
      console.error('Embedding generation failed:', error.message);
      return null;
    }
  }

  /**
   * Calculate cosine similarity between two embeddings
   */
  cosineSimilarity(a, b) {
    if (!a || !b || a.length !== b.length) return 0;

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  // ==========================================================================
  // TEXT EXTRACTION UTILITIES
  // ==========================================================================

  /**
   * Extract text from message content parts
   */
  extractTextFromMessage(message) {
    if (!message || !message.content) {
      return '';
    }

    let text = '';
    if (Array.isArray(message.content)) {
      for (const part of message.content) {
        if (part && part.text) {
          text += part.text + ' ';
        }
      }
    }
    return text.trim();
  }

  /**
   * Format duration in human-readable form
   */
  formatDuration(milliseconds) {
    const seconds = Math.floor(milliseconds / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days} day${days > 1 ? 's' : ''}`;
    if (hours > 0) return `${hours} hour${hours > 1 ? 's' : ''}`;
    if (minutes > 0) return `${minutes} minute${minutes > 1 ? 's' : ''}`;
    return `${seconds} second${seconds > 1 ? 's' : ''}`;
  }

  // ==========================================================================
  // PERSONAL DATA MANAGEMENT
  // ==========================================================================

  /**
   * Invalidate cached personal data for a user
   */
  invalidatePersonalDataCache(userId) {
    this.personalDataCache.delete(userId);
  }

  /**
   * Add a fact to user's personal memory
   */
  async addPersonalData(userId, fact) {
    try {
      await db.saveUserFact(userId, fact);
      this.invalidatePersonalDataCache(userId);
      return true;
    } catch (error) {
      console.error('Failed to add personal data:', error);
      return false;
    }
  }

  /**
   * Remove a fact from user's personal memory
   */
  async removePersonalData(userId, factKeyword) {
    try {
      const deletedCount = await db.deleteUserFact(userId, factKeyword);
      this.invalidatePersonalDataCache(userId);
      return deletedCount > 0;
    } catch (error) {
      console.error('Failed to remove personal data:', error);
      return false;
    }
  }

  /**
   * Retrieve user's personal data with caching and embedding
   */
  async getUserPersonalData(userId) {
    const cached = this.personalDataCache.get(userId);
    if (cached && (Date.now() - cached.timestamp) < PERSONAL_DATA_CACHE_TTL_MS) {
      return cached;
    }

    try {
      const [timezone, birthday, reminders, complimentCount, dailyQuote, userFacts] = await Promise.all([
        db.getUserTimezone(userId),
        db.getBirthday(userId),
        db.getUserReminders(userId),
        db.getComplimentCount(userId),
        db.getUserDailyQuote(userId),
        db.getUserFacts(userId)
      ]);

      const facts = [];

      if (timezone) {
        facts.push(`User's timezone: ${timezone}`);
      }

      if (birthday) {
        const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
          'July', 'August', 'September', 'October', 'November', 'December'];
        facts.push(`User's birthday: ${monthNames[birthday.month]} ${birthday.day}`);
      }

      if (reminders && reminders.length > 0) {
        const activeReminders = reminders.filter(r => r.active).slice(0, 3);
        if (activeReminders.length > 0) {
          facts.push(`User has ${reminders.length} active reminders`);
          activeReminders.forEach(r => {
            facts.push(`Reminder: "${r.message}"`);
          });
        }
      }

      if (complimentCount > 0) {
        facts.push(`User has received ${complimentCount} compliments`);
      }

      if (dailyQuote && dailyQuote.active) {
        facts.push(`User receives daily ${dailyQuote.category || 'motivational'} quotes`);
      }

      if (userFacts && userFacts.length > 0) {
        facts.push(`\n[User's Personal Context/Memories]:`);
        userFacts.forEach(f => facts.push(`- ${f}`));
      }

      if (facts.length === 0) {
        return null;
      }

      const personalContext = facts.join('\n');
      const embedding = await this.generateEmbedding(personalContext, 'RETRIEVAL_DOCUMENT');

      const result = {
        text: personalContext,
        embedding: embedding,
        timestamp: Date.now()
      };

      this.personalDataCache.set(userId, result);
      return result;

    } catch (error) {
      console.error('Failed to fetch user personal data:', error);
      return null;
    }
  }

  // ==========================================================================
  // MEMORY SEARCH & RETRIEVAL
  // ==========================================================================

  /**
   * Search memory for specific content
   */
  async searchMemory(userId, guildId, query) {
    try {
      const queryEmbedding = await this.generateEmbedding(query, 'RETRIEVAL_QUERY');
      if (!queryEmbedding) return [];

      const historyId = guildId || userId;
      const results = await db.findSimilarMemories(historyId, queryEmbedding, 5);

      if (!results || results.length === 0) return [];

      return results.map(entry => {
        const text = this.extractTextFromMessage({ content: entry.messages[0].content });
        return `[Memory] ${text}`;
      });
    } catch (error) {
      console.error('Memory search failed:', error);
      return [];
    }
  }

  /**
   * Get relevant historical context via RAG (excludes recent messages)
   */
  async getRelevantContext(historyId, currentQuery, recentMessageTimestamps, userId = null, guildId = null) {
    try {
      if (!currentQuery || currentQuery.trim().length === 0) {
        return { messages: [], personalData: null };
      }

      const [queryEmbedding, personalData] = await Promise.all([
        this.generateEmbedding(currentQuery, 'RETRIEVAL_QUERY'),
        userId ? this.getUserPersonalData(userId) : Promise.resolve(null)
      ]);

      if (!queryEmbedding) {
        return { messages: [], personalData };
      }

      const relevantMessages = [];
      const cutoffTimestamp = Math.max(...recentMessageTimestamps) - TIME_GAP_THRESHOLD_MS;

      // 1. Search conversation history (exclude recent messages by timestamp)
      const dbResults = await db.findSimilarMemories(historyId, queryEmbedding, MAX_RAG_RESULTS * 2);

      if (dbResults && dbResults.length > 0) {
        const filteredResults = dbResults
          .filter(entry => {
            const entryTimestamp = entry.timestamp || 0;
            return entryTimestamp < cutoffTimestamp;
          })
          .filter(entry => entry.score >= MIN_SIMILARITY_THRESHOLD)
          .slice(0, MAX_RAG_RESULTS);

        relevantMessages.push(...filteredResults.map(entry => ({
          messages: entry.messages,
          score: entry.score,
          source: 'conversation-history',
          timestamp: entry.timestamp
        })));
      }

      // 2. Fallback to manual cosine similarity if DB search failed
      if (relevantMessages.length === 0) {
        console.log(`ℹ️ Using local vector search for ${historyId}`);
        const memoryEntries = await db.getMemoryEntries(historyId);

        if (memoryEntries && memoryEntries.length > 0) {
          const scoredEntries = memoryEntries
            .filter(entry => entry.embedding && Array.isArray(entry.embedding))
            .filter(entry => {
              const entryTimestamp = entry.timestamp || 0;
              return entryTimestamp < cutoffTimestamp;
            })
            .map(entry => ({
              ...entry,
              similarity: this.cosineSimilarity(queryEmbedding, entry.embedding)
            }))
            .filter(entry => entry.similarity >= MIN_SIMILARITY_THRESHOLD)
            .sort((a, b) => b.similarity - a.similarity)
            .slice(0, MAX_RAG_RESULTS);

          relevantMessages.push(...scoredEntries.map(entry => ({
            messages: entry.messages,
            score: entry.similarity,
            source: 'conversation-history',
            timestamp: entry.timestamp
          })));
        }
      }

      // 3. Cross-RAG: Search server context if this is a user query in a server
      if (userId && guildId && historyId !== guildId && relevantMessages.length < MAX_RAG_RESULTS) {
        const serverResults = await db.findSimilarMemoriesWithFilter(guildId, queryEmbedding, 1, { userId });
        if (serverResults && serverResults.length > 0) {
          const filtered = serverResults.filter(entry => {
            const entryTimestamp = entry.timestamp || 0;
            return entryTimestamp < cutoffTimestamp && entry.score >= MIN_SIMILARITY_THRESHOLD;
          });

          relevantMessages.push(...filtered.map(entry => ({
            messages: entry.messages,
            score: entry.score * 0.85,
            source: 'server-context',
            timestamp: entry.timestamp
          })));
        }
      }

      // 4. Cross-RAG: Search user context if this is a server query
      if (guildId && historyId === guildId && userId && relevantMessages.length < MAX_RAG_RESULTS) {
        const userResults = await db.findSimilarMemories(userId, queryEmbedding, 1);
        if (userResults && userResults.length > 0) {
          const filtered = userResults.filter(entry => {
            const entryTimestamp = entry.timestamp || 0;
            return entryTimestamp < cutoffTimestamp && entry.score >= MIN_SIMILARITY_THRESHOLD;
          });

          relevantMessages.push(...filtered.map(entry => ({
            messages: entry.messages.slice(-6),
            score: entry.score * 0.75,
            source: 'user-context',
            timestamp: entry.timestamp
          })));
        }
      }

      relevantMessages.sort((a, b) => b.score - a.score);
      const topResults = relevantMessages.slice(0, MAX_RAG_RESULTS);

      return { messages: topResults, personalData };

    } catch (error) {
      console.error('Context retrieval failed:', error.message);
      return { messages: [], personalData: null };
    }
  }

  // ==========================================================================
  // MEMORY STORAGE & INDEXING
  // ==========================================================================

  /**
   * Store conversation chunk with embedding for RAG retrieval
   */
  async storeMemoryWithEmbedding(historyId, messages, userId = null, guildId = null) {
    try {
      const conversationText = messages
        .map(msg => this.extractTextFromMessage(msg))
        .filter(text => text.length > 0)
        .join(' ');

      if (conversationText.length < 10) {
        return;
      }

      const embedding = await this.generateEmbedding(conversationText, 'RETRIEVAL_DOCUMENT');
      if (!embedding) {
        return;
      }

      const metadata = {
        historyId,
        userId: userId || null,
        guildId: guildId || null,
        timestamp: Date.now()
      };

      await db.saveMemoryEntry(historyId, {
        messages,
        embedding,
        text: conversationText.slice(0, 1000),
        metadata,
        timestamp: Date.now()
      });

    } catch (error) {
      console.error('Memory storage failed:', error.message);
    }
  }

  /**
   * Background indexing of conversation history in chunks
   */
  async checkAndIndexMessages(historyId, allHistory, userId = null, guildId = null) {
    try {
      const historyArray = [];
      for (const messagesId in allHistory) {
        if (allHistory.hasOwnProperty(messagesId)) {
          historyArray.push(...allHistory[messagesId]);
        }
      }

      const currentCount = historyArray.length;
      const lastIndexed = this.lastIndexedCount.get(historyId) || 0;

      if (currentCount - lastIndexed >= (CHUNK_SIZE - CHUNK_OVERLAP)) {
        const oldMessages = historyArray.slice(0, -RECENT_MESSAGE_WINDOW);

        if (oldMessages.length > lastIndexed) {
          const batches = [];
          let startIndex = Math.max(0, lastIndexed - CHUNK_OVERLAP);

          for (let i = startIndex; i < oldMessages.length; i += (CHUNK_SIZE - CHUNK_OVERLAP)) {
            const chunk = oldMessages.slice(i, i + CHUNK_SIZE);
            if (chunk.length >= 3) {
              batches.push(chunk);
            }
          }

          await Promise.all(batches.map(batch =>
            this.storeMemoryWithEmbedding(historyId, batch, userId, guildId)
              .catch(err => console.error('Background indexing error:', err.message))
          ));

          this.lastIndexedCount.set(historyId, oldMessages.length);
        }
      }
    } catch (error) {
      console.error('Auto-indexing check failed:', error.message);
    }
  }

  // ==========================================================================
  // SUMMARY GENERATION
  // ==========================================================================

  /**
   * Generate or retrieve cached summary of old messages
   */
  async generateSummary(messages, model, historyId) {
    if (messages.length <= 5) return null;

    try {
      const messageCount = messages.length;
      const cached = this.summaryCache.get(historyId);

      // Reuse cached summary if recent enough
      const currentInterval = Math.floor(messageCount / SUMMARY_GENERATION_INTERVAL);
      const cachedInterval = cached ? Math.floor(cached.messageCount / SUMMARY_GENERATION_INTERVAL) : -1;

      if (cached && currentInterval === cachedInterval) {
        console.log(`♻️ Reusing cached summary (${cached.messageCount} msgs, current: ${messageCount})`);
        return {
          role: 'user',
          parts: [{
            text: `[METADATA: Summary of previous ${cached.messageCount} messages]\n${cached.summary}`
          }],
          timestamp: cached.generatedAt
        };
      }

      console.log(`📝 Generating new summary for ${messageCount} messages`);

      const chat = genAI.chats.create({
        model: model,
        config: {
          systemInstruction: "Create a concise summary of the conversation that preserves key information, decisions, and context. Focus on facts and important details.",
          temperature: 0.3,
          topP: 0.95
        }
      });

      const conversationText = messages.map((msg, idx) => {
        const role = msg.role === 'user' ? 'User' : 'Assistant';
        const text = this.extractTextFromMessage(msg);
        return `${role}: ${text}`;
      }).join('\n\n');

      const result = await chat.sendMessage({
        message: `Summarize this conversation:\n\n${conversationText}`
      });

      const summary = result.text || conversationText.slice(0, 500);

      this.summaryCache.set(historyId, {
        summary,
        generatedAt: Date.now(),
        messageCount
      });

      return {
        role: 'user',
        parts: [{
          text: `[METADATA: Summary of previous ${messageCount} messages]\n${summary}`
        }],
        timestamp: Date.now()
      };
    } catch (error) {
      console.error('Summary generation failed:', error.message);
      return null;
    }
  }

  // ==========================================================================
  // MAIN HISTORY OPTIMIZATION
  // ==========================================================================

  /**
   * Get optimized conversation history with RAG
   * This is the main entry point for retrieving history
   */
  async getOptimizedHistory(historyId, currentQuery, model, userId = null, guildId = null) {
    try {
      // Step 1: Load full history from database
      const allHistory = await db.getChatHistory(historyId);
      if (!allHistory) {
        return [];
      }

      // Step 2: Convert to flat array
      const historyArray = [];
      for (const messagesId in allHistory) {
        if (allHistory.hasOwnProperty(messagesId)) {
          historyArray.push(...allHistory[messagesId]);
        }
      }

      if (historyArray.length === 0) return [];

      // Step 3: Sort by timestamp to ensure chronological order
      historyArray.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

      // Step 4: Keep most recent messages in full (never compress these)
      const recentMessages = historyArray.slice(-RECENT_MESSAGE_WINDOW);
      const oldMessages = historyArray.slice(0, -RECENT_MESSAGE_WINDOW);

      // Step 5: Get recent message timestamps for filtering RAG results
      const recentTimestamps = recentMessages.map(msg => msg.timestamp || Date.now());

      // Step 6: Background indexing (non-blocking)
      this.checkAndIndexMessages(historyId, allHistory, userId, guildId)
        .catch(() => { });

      // If we have few messages, just return them all formatted
      if (historyArray.length <= RECENT_MESSAGE_WINDOW) {
        return this.formatHistoryForAPI(recentMessages);
      }

      // Step 7: Get relevant historical context and personal data in parallel
      const [ragResults, summary] = await Promise.all([
        this.getRelevantContext(historyId, currentQuery, recentTimestamps, userId, guildId),
        oldMessages.length > COMPRESSION_THRESHOLD ?
          this.generateSummary(oldMessages, model, historyId) :
          Promise.resolve(null)
      ]);

      const { messages: relevantMemories, personalData } = ragResults;

      // Step 8: Build context sections
      const contextSections = [];

      // Add summary if we have one
      if (summary) {
        contextSections.push({
          type: 'summary',
          content: this.extractTextFromMessage(summary),
          timestamp: summary.timestamp
        });
      } else if (oldMessages.length > 0) {
        // Add sampled old messages if no summary
        const sampledOld = oldMessages.slice(-8);
        contextSections.push({
          type: 'previous-conversation',
          content: sampledOld.map(msg => {
            const role = msg.role === 'assistant' ? 'Assistant' : 'User';
            const text = this.extractTextFromMessage(msg);
            return `${role}: ${text}`;
          }).join('\n'),
          timestamp: sampledOld[sampledOld.length - 1]?.timestamp || 0
        });
      }

      // Add RAG retrieved memories
      if (relevantMemories.length > 0) {
        for (const memory of relevantMemories) {
          const memoryText = memory.messages.map(msg => {
            const role = msg.role === 'assistant' ? 'Assistant' : 'User';
            const text = this.extractTextFromMessage(msg);
            return `${role}: ${text}`;
          }).join('\n');

          contextSections.push({
            type: memory.source,
            content: memoryText,
            score: memory.score,
            timestamp: memory.timestamp
          });
        }
      }

      // Add personal data if relevant
      if (personalData && personalData.embedding) {
        const queryEmbedding = await this.generateEmbedding(currentQuery, 'RETRIEVAL_QUERY');
        if (queryEmbedding) {
          const personalSimilarity = this.cosineSimilarity(queryEmbedding, personalData.embedding);
          if (personalSimilarity >= 0.3) {
            contextSections.push({
              type: 'personal-data',
              content: personalData.text,
              score: personalSimilarity,
              timestamp: Date.now()
            });
          }
        }
      }

      // Step 9: Format context for API
      const formattedContext = this.buildContextMessage(contextSections);

      // Step 10: Format recent messages for API
      const formattedRecent = this.formatHistoryForAPI(recentMessages);

      // Step 11: Combine everything
      if (formattedContext) {
        return [formattedContext, ...formattedRecent];
      } else {
        return formattedRecent;
      }

    } catch (error) {
      console.error('History optimization failed:', error.message);
      return [];
    }
  }

  // ==========================================================================
  // FORMATTING UTILITIES
  // ==========================================================================

  /**
   * Build a single context message from multiple sections
   */
  buildContextMessage(sections) {
    if (sections.length === 0) return null;

    let contextText = '[HISTORICAL CONTEXT - This is past conversation, not the current message]\n\n';

    for (const section of sections) {
      const label = this.getContextLabel(section.type);
      const scoreText = section.score ? ` (Relevance: ${section.score.toFixed(2)})` : '';

      contextText += `[${label}${scoreText}]\n${section.content}\n\n`;
    }

    // If context is huge, use file upload
    if (contextText.length > MAX_INLINE_CONTEXT_SIZE) {
      return null; // Return null to trigger file upload in caller
    }

    return {
      role: 'user',
      parts: [{ text: contextText.trim() }]
    };
  }

  /**
   * Get human-readable label for context type
   */
  getContextLabel(type) {
    const labels = {
      'summary': 'Summary of Previous Conversation',
      'previous-conversation': 'Recent Previous Messages',
      'conversation-history': 'Relevant Past Conversation',
      'server-context': 'Related Server Discussion',
      'user-context': 'Your Previous Conversation',
      'personal-data': 'Your Personal Information'
    };
    return labels[type] || 'Context';
  }

  /**
   * Format message array for Gemini API with time gaps
   */
  formatHistoryForAPI(messages) {
    if (!messages || messages.length === 0) return [];

    const formattedHistory = [];
    let previousTimestamp = null;

    for (const entry of messages) {
      const apiEntry = {
        role: entry.role === 'assistant' ? 'model' : entry.role,
        parts: []
      };

      // Add time gap marker if significant time passed
      if (previousTimestamp && entry.timestamp) {
        const timeDiff = entry.timestamp - previousTimestamp;
        if (timeDiff > TIME_GAP_THRESHOLD_MS) {
          const duration = this.formatDuration(timeDiff);
          apiEntry.parts.push({
            text: `[TIME ELAPSED: ${duration} since previous message]\n`
          });
        }
      }
      previousTimestamp = entry.timestamp;

      // Process content parts
      let userInfoAdded = false;
      for (const part of entry.content) {
        if (part.text !== undefined && part.text !== '') {
          let textVal = part.text;

          // Add user info to first text part for user messages
          if (!userInfoAdded && entry.role === 'user' && entry.username && entry.displayName) {
            textVal = `[${entry.displayName} (@${entry.username})]: ${textVal}`;
            userInfoAdded = true;
          }

          apiEntry.parts.push({ text: textVal });
        } else if (part.fileUri) {
          const mime = part.mimeType || 'media';
          apiEntry.parts.push({
            text: `[Previous ${mime} attachment - not available]`
          });
        } else if (part.inlineData) {
          apiEntry.parts.push({
            text: `[Previous inline image]`
          });
        }
      }

      if (apiEntry.parts.length > 0) {
        formattedHistory.push(apiEntry);
      }
    }

    return formattedHistory;
  }

  // ==========================================================================
  // UTILITY & DEBUG METHODS
  // ==========================================================================

  /**
   * Get current status of memory system
   */
  getQueueStatus() {
    return {
      embeddingCacheSize: this.embeddingCache.size,
      trackedHistories: this.lastIndexedCount.size,
      summaryCacheSize: this.summaryCache.size,
      personalDataCacheSize: this.personalDataCache.size,
      entries: Array.from(this.lastIndexedCount.entries()).map(([id, count]) => ({
        historyId: id,
        lastIndexedMessageCount: count
      }))
    };
  }

  /**
   * Force immediate indexing of a history (for debugging/testing)
   */
  async forceIndexNow(historyId, userId = null, guildId = null) {
    try {
      const allHistory = await db.getChatHistory(historyId);
      if (!allHistory) return { success: false, message: 'No history found' };

      const historyArray = [];
      for (const messagesId in allHistory) {
        if (allHistory.hasOwnProperty(messagesId)) {
          historyArray.push(...allHistory[messagesId]);
        }
      }

      const oldMessages = historyArray.slice(0, -RECENT_MESSAGE_WINDOW);

      if (oldMessages.length === 0) {
        return { success: false, message: 'No old messages to index' };
      }

      const batches = [];
      for (let i = 0; i < oldMessages.length; i += (CHUNK_SIZE - CHUNK_OVERLAP)) {
        const chunk = oldMessages.slice(i, i + CHUNK_SIZE);
        if (chunk.length >= 3) batches.push(chunk);
      }

      console.log(`🔥 Force-indexing ${oldMessages.length} messages in ${batches.length} chunks`);

      await Promise.all(batches.map(batch =>
        this.storeMemoryWithEmbedding(historyId, batch, userId, guildId)
      ));

      this.lastIndexedCount.set(historyId, oldMessages.length);

      return {
        success: true,
        message: `Indexed ${oldMessages.length} messages in ${batches.length} overlapping chunks`,
        batchCount: batches.length,
        messageCount: oldMessages.length
      };
    } catch (error) {
      console.error('Force indexing failed:', error.message);
      return { success: false, message: error.message };
    }
  }
}

// ============================================================================
// EXPORT SINGLETON INSTANCE
// ============================================================================

export const memorySystem = new MemorySystem();
