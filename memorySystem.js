import fs from 'fs/promises';
import path from 'path';
import { genAI, TEMP_DIR } from './botManager.js';
import * as db from './database.js';

const EMBEDDING_MODEL = 'gemini-embedding-001';

const MAX_CONTEXT_TOKENS = 10000;
const TOKENS_PER_MESSAGE = 100;
const MAX_FULL_MESSAGES = 1;
const COMPRESSION_THRESHOLD = 60;

// Chunking Config
const CHUNK_SIZE = 10;
const CHUNK_OVERLAP = 3;

class MemorySystem {
 constructor() {
   this.embeddingCache = new Map();
   this.indexingQueue = new Map();
   this.lastIndexedCount = new Map();
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

 // Legacy manual cosine similarity (Keep as fallback)
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

 async compressOldMessages(messages, model) {
   if (messages.length <= 5) return messages;

   try {
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

     return [{
       role: 'user',
       content: [{
         text: `[METADATA: Summary of previous conversation]\n${summary}`
       }],
       timestamp: Date.now()
     }];
   } catch (error) {
     console.error('Compression failed:', error.message);
     return messages.slice(-3);
   }
 }

 async getRelevantContext(historyId, currentQuery, allHistory, maxRelevant = 5) {
   try {
     if (!currentQuery || currentQuery.trim().length === 0) return [];

     const queryEmbedding = await this.generateEmbedding(currentQuery, 'RETRIEVAL_QUERY');
     if (!queryEmbedding) {
       return [];
     }

     // 1. Try Database-Level Vector Search first (Faster)
     const dbResults = await db.findSimilarMemories(historyId, queryEmbedding, maxRelevant);
     
     if (dbResults && dbResults.length > 0) {
       // Tag DB results with metadata
       return dbResults.map(entry => {
         return entry.messages.map(msg => {
            // Clone message to avoid mutating DB state in memory
            const taggedMsg = JSON.parse(JSON.stringify(msg));
            const score = entry.score ? entry.score.toFixed(2) : 'N/A';
            const existingText = this.extractTextFromMessage(taggedMsg);
            
            taggedMsg.content = [{
                text: `[METADATA: Relevant Past Message (Score: ${score})]\n${existingText}`
            }];
            return taggedMsg;
         });
       }).flat();
     }

     // 2. Fallback: Manual Cosine Similarity (If DB search unavailable)
     console.warn("⚠️ Falling back to manual vector search");
     const memoryEntries = await db.getMemoryEntries(historyId);
     if (!memoryEntries || memoryEntries.length === 0) {
       return [];
     }

     const scoredEntries = memoryEntries
       .filter(entry => entry.embedding && Array.isArray(entry.embedding))
       .map(entry => ({
         ...entry,
         similarity: this.cosineSimilarity(queryEmbedding, entry.embedding)
       }));

     scoredEntries.sort((a, b) => b.similarity - a.similarity);

     const relevant = scoredEntries
       .filter(entry => entry.similarity > 0.7)
       .slice(0, maxRelevant);

     return relevant.map(entry => {
         return entry.messages.map(msg => {
            const taggedMsg = JSON.parse(JSON.stringify(msg));
            const score = entry.similarity.toFixed(2);
            const existingText = this.extractTextFromMessage(taggedMsg);
            taggedMsg.content = [{
                text: `[METADATA: Relevant Past Message (Score: ${score})]\n${existingText}`
            }];
            return taggedMsg;
         });
     }).flat();

   } catch (error) {
     console.error('Context retrieval failed:', error.message);
     return [];
   }
 }

 async storeMemoryWithEmbedding(historyId, messages) {
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

     await db.saveMemoryEntry(historyId, {
       messages,
       embedding,
       timestamp: Date.now(),
       text: conversationText.slice(0, 1000) // Store explicit text for search verification
     });
     
   } catch (error) {
     console.error('Memory storage failed:', error.message);
   }
 }

 async checkAndIndexMessages(historyId, allHistory) {
   try {
     const historyArray = [];
     for (const messagesId in allHistory) {
       if (allHistory.hasOwnProperty(messagesId)) {
         historyArray.push(...allHistory[messagesId]);
       }
     }

     const currentCount = historyArray.length;
     const lastIndexed = this.lastIndexedCount.get(historyId) || 0;
     
     // Calculate how many messages are "new" and unindexed
     const messagesSinceLastIndex = currentCount - lastIndexed;

     // Only run if we have enough new messages to form a chunk
     if (messagesSinceLastIndex >= (CHUNK_SIZE - CHUNK_OVERLAP)) {
       
       // We consider messages before the "active" recent conversation
       const oldMessages = historyArray.slice(0, -MAX_FULL_MESSAGES);
       
       if (oldMessages.length > lastIndexed) {
         const batches = [];
         
         // Contextual Chunking: Sliding Window
         // Start from lastIndexed, but back up by OVERLAP to ensure context continuity
         let startIndex = Math.max(0, lastIndexed - CHUNK_OVERLAP);
         
         for (let i = startIndex; i < oldMessages.length; i += (CHUNK_SIZE - CHUNK_OVERLAP)) {
           const chunk = oldMessages.slice(i, i + CHUNK_SIZE);
           
           // Don't index tiny fragments at the end unless it's a significant chunk
           if (chunk.length >= 3) {
               batches.push(chunk);
           }
         }

         // Index all generated chunks
         for (const batch of batches) {
           this.storeMemoryWithEmbedding(historyId, batch).catch(err => {
             console.error('Background indexing error:', err.message);
           });
         }
         
         // Update pointer to the end of oldMessages
         this.lastIndexedCount.set(historyId, oldMessages.length);
       }
     }
   } catch (error) {
     console.error('Auto-indexing check failed:', error.message);
   }
 }

 async getOptimizedHistory(historyId, currentQuery, model) {
   try {
     const allHistory = await db.getChatHistory(historyId);
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

     // Trigger background indexing
     this.checkAndIndexMessages(historyId, allHistory).catch(() => {});

     // Short conversations: Just return recent context with metadata
     if (historyArray.length <= MAX_FULL_MESSAGES) {
       return this.formatHistoryWithContext(historyArray, '[METADATA: Recent Conversation]');
     }

     // --- RAG PIPELINE ---
     
     const recentMessages = historyArray.slice(-MAX_FULL_MESSAGES);
     const oldMessages = historyArray.slice(0, -MAX_FULL_MESSAGES);

     // 1. Vector Search (Database Level)
     const relevantContext = await this.getRelevantContext(
       historyId,
       currentQuery,
       allHistory,
       3
     );

     // 2. Summary of Old Messages
     const compressedOld = oldMessages.length > COMPRESSION_THRESHOLD
       ? await this.compressOldMessages(oldMessages, model)
       : oldMessages.slice(-10).map(msg => {
           // Tag manual slice if not compressing
           const tagged = JSON.parse(JSON.stringify(msg));
           const txt = this.extractTextFromMessage(tagged);
           tagged.content = [{ text: `[METADATA: Previous Conversation Context]\n${txt}` }];
           return tagged;
       });

     let contextContent = '';
     
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

     if (contextContent.length > 1500) {
        // Include recent messages in the file content
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

     // Combine parts with tagging
     const combined = [
       ...compressedOld, // Already tagged in compressOldMessages or slice fallback
       ...relevantContext, // Already tagged in getRelevantContext
       ...this.formatHistoryWithContext(recentMessages, '[METADATA: Recent Message]') // Tag recent
     ];

     // Deduplicate
     const uniqueMessages = Array.from(
       new Map(combined.map(msg => [
         this.extractTextFromMessage(msg) + (msg.timestamp || ''),
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
         
         // Apply metadata tag if requested and strictly needed
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
     entries: Array.from(this.lastIndexedCount.entries()).map(([id, count]) => ({
       historyId: id,
       lastIndexedMessageCount: count
     }))
   };
 }

 async forceIndexNow(historyId) {
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
     // Force overlapping chunks logic for force-index too
     for (let i = 0; i < oldMessages.length; i += (CHUNK_SIZE - CHUNK_OVERLAP)) {
       const chunk = oldMessages.slice(i, i + CHUNK_SIZE);
       if (chunk.length >= 3) batches.push(chunk);
     }

     console.log(`🔥 Force-indexing ${oldMessages.length} messages in ${batches.length} chunks`);

     for (const batch of batches) {
       await this.storeMemoryWithEmbedding(historyId, batch);
     }

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