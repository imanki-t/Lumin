import fs from 'fs/promises';
import path from 'path';
import { genAI, TEMP_DIR } from './botManager.js';
import * as db from './database.js';

const EMBEDDING_MODEL = 'gemini-embedding-001';

const MAX_CONTEXT_TOKENS = 10000;
const TOKENS_PER_MESSAGE = 100;
const MAX_FULL_MESSAGES = 1;
const COMPRESSION_THRESHOLD = 60;

// Summary caching config
const SUMMARY_INTERVAL = 30; // Generate new summary every 30 messages
const SUMMARY_REUSE_UNTIL = 90; // Reuse summary until this many messages

// Chunking Config
const CHUNK_SIZE = 10;
const CHUNK_OVERLAP = 3;

class MemorySystem {
 constructor() {
   this.embeddingCache = new Map();
   this.indexingQueue = new Map();
   this.lastIndexedCount = new Map();
   
   // Summary cache: historyId -> { summary, generatedAt, messageCount }
   this.summaryCache = new Map();
   
   // Personal data cache: userId -> { data, embedding, timestamp }
   this.personalDataCache = new Map();
   this.PERSONAL_DATA_TTL = 5 * 60 * 1000; // 5 minutes
 }

 async generateEmbedding(text, taskType = 'RETRIEVAL_DOCUMENT') {
   if (!text || typeof text !== 'string' || text.trim().length === 0) {
     return null;
   }

   const cacheKey = text.slice(0, 100) + taskType;
   if (this.embeddingCache.has(cacheKey)) {
     return this.embeddingCache.get(cacheKey);
   }

   try {
     const result = await genAI.models.embedContent({
       model: EMBEDDING_MODEL,
       contents: text, 
       config: {
         taskType: taskType,
       }
     });
     
     const embedding = result.embeddings?.[0]?.values;
     
     if (!embedding || !Array.isArray(embedding)) {
       return null;
     }

     this.embeddingCache.set(cacheKey, embedding);
     
     if (this.embeddingCache.size > 1000) {
       const firstKey = this.embeddingCache.keys().next().value;
       this.embeddingCache.delete(firstKey);
     }
     
     return embedding;
   } catch (error) {
     console.error('Embedding generation failed:', error.message);
     return null;
   }
 }

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

 /**
  * Clear cache when tools update data
  */
 invalidatePersonalDataCache(userId) {
   this.personalDataCache.delete(userId);
 }

 /**
  * Fetch and embed user's personal data (timezone, birthday, reminders, facts, etc.)
  */
 async getUserPersonalData(userId) {
   // Check cache first
   const cached = this.personalDataCache.get(userId);
   if (cached && (Date.now() - cached.timestamp) < this.PERSONAL_DATA_TTL) {
     return cached;
   }

   try {
     // Parallel fetch all personal data
     const [timezone, birthday, reminders, complimentCount, dailyQuote, userFacts] = await Promise.all([
       db.getUserTimezone(userId),
       db.getBirthday(userId),
       db.getUserReminders(userId),
       db.getComplimentCount(userId),
       db.getUserDailyQuote(userId),
       db.getUserFacts(userId) // Fetch unstructured facts
     ]);

     let personalContext = '';
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

     // Append User Facts
     if (userFacts && userFacts.length > 0) {
       facts.push(`\n[User's Personal Context/Memories]:`);
       userFacts.forEach(f => facts.push(`- ${f}`));
     }

     if (facts.length === 0) {
       return null;
     }

     personalContext = facts.join('\n');
     
     // Generate embedding for personal data
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

 /**
  * Enhanced context retrieval with personal data RAG
  */
 async getRelevantContext(historyId, currentQuery, allHistory, userId = null, guildId = null, maxRelevant = 5) {
   try {
     if (!currentQuery || currentQuery.trim().length === 0) return [];

     // PARALLEL: Generate query embedding + fetch personal data
     const [queryEmbedding, personalData] = await Promise.all([
       this.generateEmbedding(currentQuery, 'RETRIEVAL_QUERY'),
       userId ? this.getUserPersonalData(userId) : Promise.resolve(null)
     ]);

     if (!queryEmbedding) {
       return [];
     }

     const relevantMessages = [];

     // 1. Try Database-Level Vector Search (conversation history)
     const dbResults = await db.findSimilarMemories(historyId, queryEmbedding, maxRelevant);
     
     if (dbResults && dbResults.length > 0) {
       relevantMessages.push(...dbResults.map(entry => ({
         messages: entry.messages,
         score: entry.score,
         source: 'conversation'
       })));
     } else {
       // Fallback: Manual Cosine Similarity
       console.log(`ℹ️ Using local vector search for ${historyId}`);
       const memoryEntries = await db.getMemoryEntries(historyId);
       
       if (memoryEntries && memoryEntries.length > 0) {
         const scoredEntries = memoryEntries
           .filter(entry => entry.embedding && Array.isArray(entry.embedding))
           .map(entry => ({
             ...entry,
             similarity: this.cosineSimilarity(queryEmbedding, entry.embedding)
           }))
           .filter(entry => entry.similarity > 0.7)
           .sort((a, b) => b.similarity - a.similarity)
           .slice(0, maxRelevant);

         relevantMessages.push(...scoredEntries.map(entry => ({
           messages: entry.messages,
           score: entry.similarity,
           source: 'conversation'
         })));
       }
     }

     // 2. Cross-RAG: If this is a user query in a server with server-wide history, also search server context
     if (userId && guildId && historyId !== guildId) {
       const serverResults = await db.findSimilarMemoriesWithFilter(guildId, queryEmbedding, 2, { userId });
       if (serverResults && serverResults.length > 0) {
         relevantMessages.push(...serverResults.map(entry => ({
           messages: entry.messages,
           score: entry.score,
           source: 'server-context'
         })));
       }
     }

     // 3. Cross-RAG: If this is a server query, include relevant user-specific context
     if (guildId && historyId === guildId && userId) {
       const userResults = await db.findSimilarMemories(userId, queryEmbedding, 2);
       if (userResults && userResults.length > 0) {
         relevantMessages.push(...userResults.map(entry => ({
           messages: entry.messages.slice(-6), // Last 6 messages for context
           score: entry.score * 0.8, // Slightly lower weight
           source: 'user-context'
         })));
       }
     }

     // 4. Check personal data relevance
     if (personalData && personalData.embedding) {
       const personalSimilarity = this.cosineSimilarity(queryEmbedding, personalData.embedding);
       
       if (personalSimilarity > 0.3) {
         relevantMessages.push({
           messages: [{
             role: 'user',
             content: [{
               text: `[METADATA: User Personal Context (Relevance: ${personalSimilarity.toFixed(2)})]\n${personalData.text}`
             }],
             timestamp: Date.now()
           }],
           score: personalSimilarity,
           source: 'personal-data'
         });
       }
     }

     // Sort all results by score and take top results
     relevantMessages.sort((a, b) => b.score - a.score);
     const topResults = relevantMessages.slice(0, maxRelevant + 2); // +2 for personal/cross-rag

     // Format results
     return topResults.map(entry => {
       return entry.messages.map(msg => {
         const taggedMsg = JSON.parse(JSON.stringify(msg));
         const score = entry.score ? entry.score.toFixed(2) : 'N/A';
         const sourceLabel = entry.source === 'personal-data' ? 'Personal Data' :
                           entry.source === 'server-context' ? 'Server Context' :
                           entry.source === 'user-context' ? 'Personal Context' :
                           'Past Message';
         const existingText = this.extractTextFromMessage(taggedMsg);
         
         taggedMsg.content = [{
           text: `[METADATA: Relevant ${sourceLabel} (Score: ${score})]\n${existingText}`
         }];
         return taggedMsg;
       });
     }).flat();

   } catch (error) {
     console.error('Context retrieval failed:', error.message);
     return [];
   }
 }

 /**
  * Store memory with user/server tagging for cross-RAG
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
       metadata
     });
     
   } catch (error) {
     console.error('Memory storage failed:', error.message);
   }
 }

 /**
  * Optimized summary generation with caching
  */
 async compressOldMessages(messages, model, historyId) {
   if (messages.length <= 5) return messages;

   try {
     const messageCount = messages.length;
     
     // Check if we have a cached summary
     const cached = this.summaryCache.get(historyId);
     
     // Reuse cached summary if:
     // 1. It exists
     // 2. It was generated in the current "interval" (e.g., messages 30-59, 60-89, etc.)
     // 3. We haven't exceeded the reuse threshold
     if (cached) {
       const currentInterval = Math.floor(messageCount / SUMMARY_INTERVAL);
       const cachedInterval = Math.floor(cached.messageCount / SUMMARY_INTERVAL);
       
       if (currentInterval === cachedInterval && messageCount < (cachedInterval + 1) * SUMMARY_INTERVAL) {
         console.log(`♻️ Reusing cached summary (${cached.messageCount} msgs, current: ${messageCount})`);
         return [{
           role: 'user',
           content: [{
             text: `[METADATA: Cached summary from ${cached.messageCount} previous messages]\n${cached.summary}`
           }],
           timestamp: cached.generatedAt
         }];
       }
     }

     // Generate new summary
     console.log(`📝 Generating new summary for ${messageCount} messages`);
     
     const chat = genAI.chats.create({
       model: model,
       config: {
         systemInstruction: "Summarize the following conversation history concisely while preserving key information, context, and important details. Keep the summary factual and comprehensive.",
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

     // Cache the summary
     this.summaryCache.set(historyId, {
       summary,
       generatedAt: Date.now(),
       messageCount
     });

     return [{
       role: 'user',
       content: [{
         text: `[METADATA: Summary of ${messageCount} previous messages]\n${summary}`
       }],
       timestamp: Date.now()
     }];
   } catch (error) {
     console.error('Compression failed:', error.message);
     return messages.slice(-3);
   }
 }

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
     
     const messagesSinceLastIndex = currentCount - lastIndexed;

     if (messagesSinceLastIndex >= (CHUNK_SIZE - CHUNK_OVERLAP)) {
       const oldMessages = historyArray.slice(0, -MAX_FULL_MESSAGES);
       
       if (oldMessages.length > lastIndexed) {
         const batches = [];
         let startIndex = Math.max(0, lastIndexed - CHUNK_OVERLAP);
         
         for (let i = startIndex; i < oldMessages.length; i += (CHUNK_SIZE - CHUNK_OVERLAP)) {
           const chunk = oldMessages.slice(i, i + CHUNK_SIZE);
           
           if (chunk.length >= 3) {
             batches.push(chunk);
           }
         }

         // Parallel indexing
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

 async getOptimizedHistory(historyId, currentQuery, model, userId = null, guildId = null) {
   try {
     // PARALLEL: Fetch history + trigger background indexing
     const [allHistory] = await Promise.all([
       db.getChatHistory(historyId),
       this.checkAndIndexMessages(historyId, await db.getChatHistory(historyId), userId, guildId)
         .catch(() => {}) // Non-blocking
     ]);

     if (!allHistory) {
       return [];
     }

     const historyArray = [];
     for (const messagesId in allHistory) {
       if (allHistory.hasOwnProperty(messagesId)) {
         historyArray.push(...allHistory[messagesId]);
       }
     }

     if (historyArray.length === 0) return [];

     if (historyArray.length <= MAX_FULL_MESSAGES) {
       return this.formatHistoryWithContext(historyArray, '[METADATA: Recent Conversation]');
     }

     const recentMessages = historyArray.slice(-MAX_FULL_MESSAGES);
     const oldMessages = historyArray.slice(0, -MAX_FULL_MESSAGES);

     // PARALLEL: Get relevant context + compress old messages
     const [relevantContext, compressedOld] = await Promise.all([
       this.getRelevantContext(historyId, currentQuery, allHistory, userId, guildId, 3),
       oldMessages.length > COMPRESSION_THRESHOLD
         ? this.compressOldMessages(oldMessages, model, historyId)
         : Promise.resolve(
             oldMessages.slice(-10).map(msg => {
               const tagged = JSON.parse(JSON.stringify(msg));
               const txt = this.extractTextFromMessage(tagged);
               tagged.content = [{ text: `[METADATA: Previous Conversation Context]\n${txt}` }];
               return tagged;
             })
           )
     ]);

     let contextContent = '';
     
     // Build textual context for File/System prompt if needed
     if (compressedOld.length > 0) {
       const isSummary = oldMessages.length > COMPRESSION_THRESHOLD;
       const label = isSummary ? `Last ${oldMessages.length} messages summary` : `Previous conversation`;
       
       const text = compressedOld.map(msg => {
         if (isSummary) return this.extractTextFromMessage(msg);
         const role = msg.role === 'assistant' ? 'Model' : 'User';
         return `${role}: ${this.extractTextFromMessage(msg)}`;
       }).join('\n');
       
       if (text.trim()) {
         contextContent += `[METADATA: ${label}]\n${text}\n\n`;
       }
     }

     if (relevantContext.length > 0) {
       const ragText = relevantContext.map(msg => {
         const role = msg.role === 'assistant' ? 'Model' : 'User';
         const txt = this.extractTextFromMessage(msg);
         return `${role}: ${txt}`;
       }).join('\n');
       
       if (ragText.trim()) {
         contextContent += `[METADATA: Relevant Context Retrieved via Vector Search]\n${ragText}`;
       }
     }

     // If context is huge, use file upload strategy (returns special contextEntry)
     if (contextContent.length > 1500) {
       const recentText = recentMessages.map(msg => {
         const role = msg.role === 'assistant' ? 'Model' : 'User';
         const txt = this.extractTextFromMessage(msg);
         const name = msg.displayName || msg.username || '';
         const header = name ? `${role} (${name})` : role;
         return `${header}: ${txt}`;
       }).join('\n\n');

       if (recentText.trim()) {
         contextContent += `\n\n[METADATA: Recent Conversation History]\n${recentText}`;
       }

       try {
         const filename = `context_${historyId}_${Date.now()}.txt`;
         const filePath = path.join(TEMP_DIR, filename);
         
         await fs.writeFile(filePath, contextContent);
         
         const uploadResult = await genAI.files.upload({
           file: filePath,
           config: { mimeType: 'text/plain', displayName: 'Conversation Context' }
         });

         await fs.unlink(filePath).catch(() => {});

         const contextEntry = {
           role: 'user',
           parts: [
             { text: "System: The attached file contains the conversation summary, relevant historical context, and the most recent messages. Use this information to reply to the user." },
             { fileData: { mimeType: uploadResult.mimeType, fileUri: uploadResult.uri } }
           ]
         };

         return [contextEntry];
       } catch (fileError) {
         console.error('Failed to create context file, falling back to inline text:', fileError);
       }
     }

     // IMPORTANT: Ensure all segments are formatted as API 'parts'
     // compressedOld and relevantContext use 'content' (internal structure), 
     // so we MUST pass them through formatHistoryWithContext.
     const combined = [
       ...this.formatHistoryWithContext(compressedOld),
       ...this.formatHistoryWithContext(relevantContext),
       ...this.formatHistoryWithContext(recentMessages, '[METADATA: Recent Message]')
     ];

     const uniqueMessages = Array.from(
       new Map(combined.map(msg => [
         this.extractTextFromMessage({ content: msg.parts }) + (msg.timestamp || ''),
         msg
       ])).values()
     );

     uniqueMessages.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
     return uniqueMessages;
     
   } catch (error) {
     console.error('History optimization failed:', error.message);
     return [];
   }
 }

 formatHistoryWithContext(historyArray, metadataTag = null) {
   let previousTimestamp = null;
   const timeThresholdMs = 30 * 60 * 1000;

   return historyArray.map(entry => {
     const apiEntry = {
       role: entry.role === 'assistant' ? 'model' : entry.role,
       parts: [],
       timestamp: entry.timestamp
     };

     let timeContext = '';
     if (previousTimestamp && entry.timestamp) {
       const timeDiffMs = entry.timestamp - previousTimestamp;
       if (timeDiffMs > timeThresholdMs) {
         const durationString = this.formatDuration(timeDiffMs);
         timeContext = `[TIME ELAPSED: ${durationString} since the previous turn]\n`;
       }
     }
     previousTimestamp = entry.timestamp;

     let userInfoAdded = false;

     for (const part of entry.content) {
       if (part.text !== undefined && part.text !== '') {
         let finalText = part.text;
         
         if (!userInfoAdded && entry.role === 'user' && entry.username && entry.displayName) {
           finalText = `[${entry.displayName} (@${entry.username})]: ${finalText}`;
           userInfoAdded = true;
         }
         
         let content = timeContext + finalText;
         
         if (metadataTag) {
           content = `${metadataTag}\n${content}`;
         }
         
         apiEntry.parts.push({ text: content });
       } 
       else if (part.fileUri) {
         const mime = part.mimeType || 'unknown';
         let text = `[Attachment: Previous file (${mime}) - Content no longer available to vision model]`;
         if (metadataTag) text = `${metadataTag}\n${text}`;
         apiEntry.parts.push({ text });
       }
       else if (part.inlineData) {
         let text = `[Attachment: Previous inline image]`;
         if (metadataTag) text = `${metadataTag}\n${text}`;
         apiEntry.parts.push({ text });
       }
     }

     return apiEntry;
   }).filter(entry => entry.parts.length > 0);
 }
 
 getQueueStatus() {
   return {
     indexingQueueSize: this.indexingQueue.size,
     cacheSize: this.embeddingCache.size,
     trackedHistories: this.lastIndexedCount.size,
     summaryCacheSize: this.summaryCache.size,
     personalDataCacheSize: this.personalDataCache.size,
     entries: Array.from(this.lastIndexedCount.entries()).map(([id, count]) => ({
       historyId: id,
       lastIndexedMessageCount: count
     }))
   };
 }

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

     const oldMessages = historyArray.slice(0, -MAX_FULL_MESSAGES);
     
     if (oldMessages.length === 0) {
       return { success: false, message: 'No old messages to index' };
     }

     const batches = [];
     for (let i = 0; i < oldMessages.length; i += (CHUNK_SIZE - CHUNK_OVERLAP)) {
       const chunk = oldMessages.slice(i, i + CHUNK_SIZE);
       if (chunk.length >= 3) batches.push(chunk);
     }

     console.log(`🔥 Force-indexing ${oldMessages.length} messages in ${batches.length} chunks`);

     // Parallel indexing
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

export const memorySystem = new MemorySystem();
