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
const SUMMARY_GENERATION_INTERVAL = 30;

/** Maximum context file size before using file upload (characters) */
const MAX_INLINE_CONTEXT_SIZE = 1500;

// ============================================================================
// CLUSTERING CONFIGURATION CONSTANTS
// ============================================================================

/** Number of clusters to create per history (k-means parameter) */
const NUM_CLUSTERS = 8;

/** Minimum memories required before clustering is enabled */
const MIN_MEMORIES_FOR_CLUSTERING = 24;

/** Number of top clusters to search within */
const TOP_CLUSTERS_TO_SEARCH = 3;

/** Minimum cluster similarity threshold to consider a cluster relevant */
const MIN_CLUSTER_SIMILARITY = 0.45;

/** Reclustering interval - rebuild clusters every N new memories */
const RECLUSTERING_INTERVAL = 20;

/** Maximum k-means iterations to prevent infinite loops */
const MAX_KMEANS_ITERATIONS = 15;

/** Convergence threshold for k-means (centroid movement) */
const KMEANS_CONVERGENCE_THRESHOLD = 0.001;

/** Cache TTL for cluster data (10 minutes) */
const CLUSTER_CACHE_TTL_MS = 10 * 60 * 1000;

/** Maximum number of memories to search within a cluster */
const MAX_MEMORIES_PER_CLUSTER = 10;

// ============================================================================
// MEMORY SYSTEM CLASS WITH CLUSTERING
// ============================================================================

class MemorySystem {
  constructor() {
    this.embeddingCache = new Map();
    this.lastIndexedCount = new Map();
    this.summaryCache = new Map();
    this.personalDataCache = new Map();
    
    // Clustering-specific caches
    this.clusterCache = new Map(); // historyId -> { clusters, centroids, lastUpdate, memoryCount }
    this.lastClusterUpdate = new Map(); // historyId -> memoryCount at last clustering
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
  // CLUSTERING ALGORITHMS
  // ==========================================================================

  /**
   * Initialize cluster centroids using k-means++
   * Better initial centroids lead to faster convergence
   */
  initializeCentroids(embeddings, k) {
    const centroids = [];
    const n = embeddings.length;

    // First centroid: random selection
    centroids.push([...embeddings[Math.floor(Math.random() * n)]]);

    // Remaining centroids: k-means++ initialization
    for (let i = 1; i < k; i++) {
      const distances = embeddings.map(emb => {
        const minDist = Math.min(...centroids.map(c => {
          const sim = this.cosineSimilarity(emb, c);
          return 1 - sim; // Convert similarity to distance
        }));
        return minDist * minDist; // Square the distance
      });

      const totalDist = distances.reduce((sum, d) => sum + d, 0);
      let threshold = Math.random() * totalDist;

      for (let j = 0; j < n; j++) {
        threshold -= distances[j];
        if (threshold <= 0) {
          centroids.push([...embeddings[j]]);
          break;
        }
      }
    }

    return centroids;
  }

  /**
   * Assign memories to nearest cluster centroid
   */
  assignToClusters(memories, centroids) {
    const clusters = Array.from({ length: centroids.length }, () => []);

    for (let i = 0; i < memories.length; i++) {
      const embedding = memories[i].embedding;
      let maxSim = -1;
      let bestCluster = 0;

      for (let j = 0; j < centroids.length; j++) {
        const sim = this.cosineSimilarity(embedding, centroids[j]);
        if (sim > maxSim) {
          maxSim = sim;
          bestCluster = j;
        }
      }

      clusters[bestCluster].push(i);
    }

    return clusters;
  }

  /**
   * Recalculate cluster centroids as mean of assigned embeddings
   */
  updateCentroids(memories, clusters, embeddingDim) {
    const newCentroids = [];

    for (const cluster of clusters) {
      if (cluster.length === 0) {
        // Empty cluster: reinitialize randomly
        const randomIdx = Math.floor(Math.random() * memories.length);
        newCentroids.push([...memories[randomIdx].embedding]);
        continue;
      }

      const centroid = new Array(embeddingDim).fill(0);
      
      for (const memIdx of cluster) {
        const embedding = memories[memIdx].embedding;
        for (let i = 0; i < embeddingDim; i++) {
          centroid[i] += embedding[i];
        }
      }

      for (let i = 0; i < embeddingDim; i++) {
        centroid[i] /= cluster.length;
      }

      newCentroids.push(centroid);
    }

    return newCentroids;
  }

  /**
   * Check if centroids have converged
   */
  hasConverged(oldCentroids, newCentroids) {
    let maxMovement = 0;

    for (let i = 0; i < oldCentroids.length; i++) {
      const movement = 1 - this.cosineSimilarity(oldCentroids[i], newCentroids[i]);
      if (movement > maxMovement) {
        maxMovement = movement;
      }
    }

    return maxMovement < KMEANS_CONVERGENCE_THRESHOLD;
  }

  /**
   * Perform k-means clustering on memory embeddings
   */
  performKMeansClustering(memories, k) {
    if (memories.length < k) {
      k = Math.max(2, Math.floor(memories.length / 3));
    }

    const embeddingDim = memories[0].embedding.length;
    let centroids = this.initializeCentroids(
      memories.map(m => m.embedding),
      k
    );

    let iteration = 0;
    let converged = false;

    while (iteration < MAX_KMEANS_ITERATIONS && !converged) {
      const clusters = this.assignToClusters(memories, centroids);
      const newCentroids = this.updateCentroids(memories, clusters, embeddingDim);
      
      converged = this.hasConverged(centroids, newCentroids);
      centroids = newCentroids;
      iteration++;
    }

    const finalClusters = this.assignToClusters(memories, centroids);

    console.log(`✅ K-means converged in ${iteration} iterations for k=${k}`);

    return {
      centroids,
      clusters: finalClusters,
      iterations: iteration
    };
  }

  /**
   * Build or update clusters for a history
   */
  async buildClusters(historyId) {
    try {
      const memories = await db.getMemoryEntries(historyId, 1000);

      if (!memories || memories.length < MIN_MEMORIES_FOR_CLUSTERING) {
        console.log(`ℹ️ Not enough memories for clustering (${memories.length}/${MIN_MEMORIES_FOR_CLUSTERING})`);
        return null;
      }

      const validMemories = memories.filter(m => 
        m.embedding && Array.isArray(m.embedding) && m.embedding.length > 0
      );

      if (validMemories.length < MIN_MEMORIES_FOR_CLUSTERING) {
        console.log(`ℹ️ Not enough valid embeddings for clustering`);
        return null;
      }

      console.log(`🔨 Building clusters for ${historyId} (${validMemories.length} memories)`);

      const k = Math.min(NUM_CLUSTERS, Math.floor(validMemories.length / 3));
      const clusterResult = this.performKMeansClustering(validMemories, k);

      const clusterData = {
        centroids: clusterResult.centroids,
        clusters: clusterResult.clusters.map(cluster => 
          cluster.map(idx => validMemories[idx]._id || idx)
        ),
        lastUpdate: Date.now(),
        memoryCount: validMemories.length,
        iterations: clusterResult.iterations
      };

      this.clusterCache.set(historyId, clusterData);
      this.lastClusterUpdate.set(historyId, validMemories.length);

      return clusterData;
    } catch (error) {
      console.error('Clustering failed:', error.message);
      return null;
    }
  }

  /**
   * Get clusters for a history (cached or build new)
   */
  async getClusters(historyId) {
    const cached = this.clusterCache.get(historyId);
    const now = Date.now();

    // Check if cache is valid
    if (cached && (now - cached.lastUpdate) < CLUSTER_CACHE_TTL_MS) {
      return cached;
    }

    // Check if we need to recluster
    const currentMemories = await db.getMemoryEntries(historyId, 1);
    const memoryCount = currentMemories.length;
    const lastUpdate = this.lastClusterUpdate.get(historyId) || 0;

    if (memoryCount - lastUpdate >= RECLUSTERING_INTERVAL || !cached) {
      return await this.buildClusters(historyId);
    }

    return cached;
  }

  // ==========================================================================
  // HIERARCHICAL SEARCH (CLUSTER -> MEMORY)
  // ==========================================================================

  /**
   * Find top relevant clusters for a query
   */
  findRelevantClusters(queryEmbedding, centroids) {
    const clusterScores = centroids.map((centroid, idx) => ({
      clusterId: idx,
      similarity: this.cosineSimilarity(queryEmbedding, centroid)
    }));

    return clusterScores
      .filter(c => c.similarity >= MIN_CLUSTER_SIMILARITY)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, TOP_CLUSTERS_TO_SEARCH);
  }

  /**
   * Search within specific clusters for relevant memories
   */
  async searchWithinClusters(historyId, queryEmbedding, relevantClusters, allMemories) {
    const results = [];

    for (const cluster of relevantClusters) {
      const clusterMemories = allMemories.filter((_, idx) => 
        cluster.memoryIndices.includes(idx)
      );

      const scoredMemories = clusterMemories
        .map(memory => ({
          ...memory,
          similarity: this.cosineSimilarity(queryEmbedding, memory.embedding),
          clusterId: cluster.clusterId
        }))
        .filter(m => m.similarity >= MIN_SIMILARITY_THRESHOLD)
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, MAX_MEMORIES_PER_CLUSTER);

      results.push(...scoredMemories);
    }

    results.sort((a, b) => b.similarity - a.similarity);
    return results.slice(0, MAX_RAG_RESULTS);
  }

  /**
   * Hierarchical clustered search (main search method)
   */
  async clusterSearch(historyId, queryEmbedding, cutoffTimestamp) {
    try {
      const clusterData = await this.getClusters(historyId);

      if (!clusterData) {
        // Fallback to standard vector search
        console.log(`ℹ️ No clusters available, using standard search`);
        return await this.standardVectorSearch(historyId, queryEmbedding, cutoffTimestamp);
      }

      console.log(`🔍 Searching ${clusterData.centroids.length} clusters`);

      // Phase 1: Find relevant clusters
      const relevantClusters = this.findRelevantClusters(
        queryEmbedding, 
        clusterData.centroids
      );

      if (relevantClusters.length === 0) {
        console.log(`ℹ️ No relevant clusters found`);
        return [];
      }

      console.log(`✅ Found ${relevantClusters.length} relevant clusters`);

      // Phase 2: Get memories from relevant clusters only
      const allMemories = await db.getMemoryEntries(historyId, 1000);
      const validMemories = allMemories.filter(m => 
        m.embedding && 
        Array.isArray(m.embedding) &&
        (m.timestamp || 0) < cutoffTimestamp
      );

      // Map cluster IDs to memory indices
      const clustersWithIndices = relevantClusters.map(cluster => ({
        clusterId: cluster.clusterId,
        similarity: cluster.similarity,
        memoryIndices: clusterData.clusters[cluster.clusterId] || []
      }));

      // Phase 3: Search within selected clusters
      const results = await this.searchWithinClusters(
        historyId,
        queryEmbedding,
        clustersWithIndices,
        validMemories
      );

      console.log(`✅ Found ${results.length} relevant memories from clusters`);

      return results.map(r => ({
        messages: r.messages,
        score: r.similarity,
        source: 'conversation-history',
        timestamp: r.timestamp,
        clusterId: r.clusterId
      }));

    } catch (error) {
      console.error('Cluster search failed:', error.message);
      return await this.standardVectorSearch(historyId, queryEmbedding, cutoffTimestamp);
    }
  }

  /**
   * Standard vector search (fallback when clustering unavailable)
   */
  async standardVectorSearch(historyId, queryEmbedding, cutoffTimestamp) {
    try {
      // Try database vector search first
      const dbResults = await db.findSimilarMemories(
        historyId, 
        queryEmbedding, 
        MAX_RAG_RESULTS * 2
      );

      if (dbResults && dbResults.length > 0) {
        return dbResults
          .filter(entry => (entry.timestamp || 0) < cutoffTimestamp)
          .filter(entry => entry.score >= MIN_SIMILARITY_THRESHOLD)
          .slice(0, MAX_RAG_RESULTS)
          .map(entry => ({
            messages: entry.messages,
            score: entry.score,
            source: 'conversation-history',
            timestamp: entry.timestamp
          }));
      }

      // Fallback to local cosine similarity
      const memoryEntries = await db.getMemoryEntries(historyId);

      if (!memoryEntries || memoryEntries.length === 0) {
        return [];
      }

      const scoredEntries = memoryEntries
        .filter(entry => 
          entry.embedding && 
          Array.isArray(entry.embedding) &&
          (entry.timestamp || 0) < cutoffTimestamp
        )
        .map(entry => ({
          ...entry,
          similarity: this.cosineSimilarity(queryEmbedding, entry.embedding)
        }))
        .filter(entry => entry.similarity >= MIN_SIMILARITY_THRESHOLD)
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, MAX_RAG_RESULTS);

      return scoredEntries.map(entry => ({
        messages: entry.messages,
        score: entry.similarity,
        source: 'conversation-history',
        timestamp: entry.timestamp
      }));

    } catch (error) {
      console.error('Standard vector search failed:', error.message);
      return [];
    }
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
  // MEMORY SEARCH & RETRIEVAL (WITH CLUSTERING)
  // ==========================================================================

  /**
   * Search memory for specific content
   */
  async searchMemory(userId, guildId, query) {
    try {
      const queryEmbedding = await this.generateEmbedding(query, 'RETRIEVAL_QUERY');
      if (!queryEmbedding) return [];

      const historyId = guildId || userId;
      
      // Use clustered search
      const results = await this.clusterSearch(historyId, queryEmbedding, Date.now());

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
   * Get relevant historical context via RAG with clustering
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

      // 1. Clustered search on conversation history (FASTER!)
      const conversationResults = await this.clusterSearch(historyId, queryEmbedding, cutoffTimestamp);
      relevantMessages.push(...conversationResults);

      // 2. Cross-RAG: Search server context if this is a user query in a server
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

      // 3. Cross-RAG: Search user context if this is a server query
      if (guildId && historyId === guildId && userId && relevantMessages.length < MAX_RAG_RESULTS) {
        const userResults = await this.clusterSearch(userId, queryEmbedding, cutoffTimestamp);
        if (userResults && userResults.length > 0) {
          relevantMessages.push(...userResults.map(entry => ({
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

      const currentInterval = Math.floor(messageCount / SUMMARY_GENERATION_INTERVAL);
      const cachedInterval = cached ? Math.floor(cached.messageCount / SUMMARY_GENERATION_INTERVAL) : -1;

      if (cached && currentInterval === cachedInterval) {
        return {
          role: 'user',
          parts: [{ text: `[METADATA: Conversation Summary]\n${cached.summary}` }],
          timestamp: cached.generatedAt
        };
      }

      const newMessagesToSummarize = cached 
        ? messages.slice(cached.messageCount) 
        : messages;

      const conversationText = newMessagesToSummarize.map(msg => {
        const role = msg.role === 'assistant' ? 'Assistant' : 'User';
        return `${role}: ${this.extractTextFromMessage(msg)}`;
      }).join('\n\n');

      const chat = genAI.chats.create({
        model: model,
        config: {
          systemInstruction: "Update the existing summary by incorporating the new conversation details. Keep it extremely concise and focused on standing facts.",
          temperature: 0.3
        }
      });

      const prompt = cached 
        ? `Existing Summary: ${cached.summary}\n\nNew messages to add to summary:\n${conversationText}`
        : `Summarize this conversation:\n\n${conversationText}`;

      const result = await chat.sendMessage({ message: prompt });
      const summary = result.text || "Context continues...";

      this.summaryCache.set(historyId, {
        summary,
        generatedAt: Date.now(),
        messageCount
      });

      return {
        role: 'user',
        parts: [{ text: `[METADATA: Conversation Summary]\n${summary}` }],
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
   * Get optimized conversation history with RAG and clustering
   */
  async getOptimizedHistory(historyId, currentQuery, model, userId = null, guildId = null) {
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

      historyArray.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

      const recentMessages = historyArray.slice(-RECENT_MESSAGE_WINDOW);
      const oldMessages = historyArray.slice(0, -RECENT_MESSAGE_WINDOW);

      const recentTimestamps = recentMessages.map(msg => msg.timestamp || Date.now());

      this.checkAndIndexMessages(historyId, allHistory, userId, guildId)
        .catch(() => { });

      if (historyArray.length <= RECENT_MESSAGE_WINDOW) {
        return this.formatHistoryForAPI(recentMessages);
      }

      const [ragResults, summary] = await Promise.all([
        this.getRelevantContext(historyId, currentQuery, recentTimestamps, userId, guildId),
        oldMessages.length > COMPRESSION_THRESHOLD ?
          this.generateSummary(oldMessages, model, historyId) :
          Promise.resolve(null)
      ]);

      const { messages: relevantMemories, personalData } = ragResults;

      const contextSections = [];

      if (summary) {
        contextSections.push({
          type: 'summary',
          content: this.extractTextFromMessage(summary),
          timestamp: summary.timestamp
        });
      } else if (oldMessages.length > 0) {
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
            timestamp: memory.timestamp,
            clusterId: memory.clusterId
          });
        }
      }

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

      const formattedContext = this.buildContextMessage(contextSections);
      const formattedRecent = this.formatHistoryForAPI(recentMessages);

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
      const clusterText = section.clusterId !== undefined ? ` [Cluster ${section.clusterId}]` : '';

      contextText += `[${label}${scoreText}${clusterText}]\n${section.content}\n\n`;
    }

    if (contextText.length > MAX_INLINE_CONTEXT_SIZE) {
      return null;
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

      let userInfoAdded = false;
      for (const part of entry.content) {
        if (part.text !== undefined && part.text !== '') {
          let textVal = part.text;

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
   * Get current status of memory system including clustering
   */
  getQueueStatus() {
    const clusterInfo = Array.from(this.clusterCache.entries()).map(([historyId, data]) => ({
      historyId,
      numClusters: data.centroids.length,
      memoryCount: data.memoryCount,
      lastUpdate: new Date(data.lastUpdate).toISOString(),
      iterations: data.iterations
    }));

    return {
      embeddingCacheSize: this.embeddingCache.size,
      trackedHistories: this.lastIndexedCount.size,
      summaryCacheSize: this.summaryCache.size,
      personalDataCacheSize: this.personalDataCache.size,
      clusteredHistories: this.clusterCache.size,
      clusterInfo: clusterInfo,
      entries: Array.from(this.lastIndexedCount.entries()).map(([id, count]) => ({
        historyId: id,
        lastIndexedMessageCount: count
      }))
    };
  }

  /**
   * Force rebuild clusters for a history (for debugging/testing)
   */
  async forceRebuildClusters(historyId) {
    try {
      console.log(`🔨 Force rebuilding clusters for ${historyId}`);
      
      this.clusterCache.delete(historyId);
      this.lastClusterUpdate.delete(historyId);
      
      const result = await this.buildClusters(historyId);
      
      if (result) {
        return {
          success: true,
          message: `Rebuilt ${result.centroids.length} clusters`,
          numClusters: result.centroids.length,
          memoryCount: result.memoryCount,
          iterations: result.iterations
        };
      } else {
        return {
          success: false,
          message: 'Not enough memories for clustering'
        };
      }
    } catch (error) {
      console.error('Force cluster rebuild failed:', error.message);
      return { success: false, message: error.message };
    }
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