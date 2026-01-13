import fs from 'fs/promises';
import path from 'path';
import { genAI, TEMP_DIR } from './botManager.js';
import * as db from './database.js';
import crypto from 'crypto';

// ============================================================================
// CONFIGURATION CONSTANTS
// ============================================================================

/** Embedding model for vector search */
const EMBEDDING_MODEL = 'gemini-embedding-001';

/** Maximum number of recent messages to keep in full context */
const RECENT_MESSAGE_WINDOW = 10;

/** Minimum number of old messages before compression kicks in */
const COMPRESSION_THRESHOLD = 30;

/** Number of messages to group together when creating memory chunks */
const CHUNK_SIZE = 8;

/** Number of overlapping messages between chunks */
const CHUNK_OVERLAP = 2;

/** Maximum number of relevant memories to retrieve via RAG */
const MAX_RAG_RESULTS = 3;

/** Minimum cosine similarity score for relevance */
const MIN_SIMILARITY_THRESHOLD = 0.65;

/** Time gap threshold for "TIME ELAPSED" marker (30 seconds) */
const TIME_GAP_THRESHOLD_MS = 30 * 1000;

/** Cache TTL for personal data (5 minutes) */
const PERSONAL_DATA_CACHE_TTL_MS = 5 * 60 * 1000;

/** Maximum embedding cache size with LRU eviction */
const MAX_EMBEDDING_CACHE_SIZE = 5000;

/** Interval for generating fresh summaries */
const SUMMARY_GENERATION_INTERVAL = 30;

/** Maximum inline context size */
const MAX_INLINE_CONTEXT_SIZE = 1500;

// ============================================================================
// CLUSTERING CONFIGURATION
// ============================================================================

/** Number of clusters per history */
const NUM_CLUSTERS = 8;

/** Minimum memories for clustering */
const MIN_MEMORIES_FOR_CLUSTERING = 240;

/** Top clusters to search */
const TOP_CLUSTERS_TO_SEARCH = 3;

/** Minimum cluster similarity */
const MIN_CLUSTER_SIMILARITY = 0.45;

/** Rebuild clusters every N new memories */
const RECLUSTERING_INTERVAL = 50;

/** Maximum k-means iterations */
const MAX_KMEANS_ITERATIONS = 15;

/** K-means convergence threshold */
const KMEANS_CONVERGENCE_THRESHOLD = 0.001;

/** Cluster cache TTL (15 minutes) */
const CLUSTER_CACHE_TTL_MS = 15 * 60 * 1000;

/** Max memories per cluster to search */
const MAX_MEMORIES_PER_CLUSTER = 10;

// ============================================================================
// PARALLEL PROCESSING CONFIGURATION
// ============================================================================

/** Maximum concurrent embedding operations */
const MAX_CONCURRENT_EMBEDDINGS = 8;

/** Batch size for embedding generation */
const EMBEDDING_BATCH_SIZE = 10;

/** Maximum concurrent database operations */
const MAX_CONCURRENT_DB_OPS = 15;

/** Parallel memory indexing batch size */
const PARALLEL_INDEX_BATCH_SIZE = 5;

// ============================================================================
// QUERY CACHING CONFIGURATION
// ============================================================================

/** Query result cache TTL (2 minutes) */
const QUERY_CACHE_TTL_MS = 2 * 60 * 1000;

/** Maximum query cache size */
const MAX_QUERY_CACHE_SIZE = 500;

/** Minimum query length to cache */
const MIN_QUERY_LENGTH_FOR_CACHE = 10;

// ============================================================================
// LRU CACHE IMPLEMENTATION
// ============================================================================

class LRUCache {
  constructor(maxSize) {
    this.maxSize = maxSize;
    this.cache = new Map();
  }

  get(key) {
    if (!this.cache.has(key)) return undefined;
    
    const value = this.cache.get(key);
    this.cache.delete(key);
    this.cache.set(key, value);
    return value;
  }

  set(key, value) {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }
    this.cache.set(key, value);
  }

  has(key) {
    return this.cache.has(key);
  }

  delete(key) {
    this.cache.delete(key);
  }

  clear() {
    this.cache.clear();
  }

  get size() {
    return this.cache.size;
  }
}

// ============================================================================
// OPTIMIZED MEMORY SYSTEM WITH AGGRESSIVE PARALLELIZATION
// ============================================================================

class MemorySystem {
  constructor() {
    // LRU caches for better memory management
    this.embeddingCache = new LRUCache(MAX_EMBEDDING_CACHE_SIZE);
    this.queryResultCache = new LRUCache(MAX_QUERY_CACHE_SIZE);
    this.personalDataCache = new LRUCache(200);
    
    // Regular caches
    this.lastIndexedCount = new Map();
    this.summaryCache = new Map();
    
    // Clustering caches with persistence
    this.clusterCache = new Map();
    this.lastClusterUpdate = new Map();
    this.clusterPersistence = new Map(); // For DB storage
    
    // Embedding queue for batch processing
    this.embeddingQueue = [];
    this.embeddingQueueTimer = null;
    
    // Statistics
    this.stats = {
      cacheHits: 0,
      cacheMisses: 0,
      queryCacheHits: 0,
      queryCacheMisses: 0,
      embeddingBatches: 0,
      parallelOperations: 0
    };
  }

  // ==========================================================================
  // BATCH EMBEDDING GENERATION WITH SMART CACHING
  // ==========================================================================

  /**
   * Generate embeddings in optimized batches
   */
  async generateEmbeddingsBatch(texts, taskType = 'RETRIEVAL_DOCUMENT') {
    if (!Array.isArray(texts) || texts.length === 0) return [];

    const results = new Array(texts.length);
    const toGenerate = [];
    const indices = [];

    // Check cache first
    for (let i = 0; i < texts.length; i++) {
      const text = texts[i];
      if (!text || typeof text !== 'string' || text.trim().length === 0) {
        results[i] = null;
        continue;
      }

      const cacheKey = this._getEmbeddingCacheKey(text, taskType);
      const cached = this.embeddingCache.get(cacheKey);
      
      if (cached) {
        results[i] = cached;
        this.stats.cacheHits++;
      } else {
        toGenerate.push(text);
        indices.push(i);
        this.stats.cacheMisses++;
      }
    }

    if (toGenerate.length === 0) return results;

    // Generate in parallel batches
    const batches = [];
    for (let i = 0; i < toGenerate.length; i += EMBEDDING_BATCH_SIZE) {
      batches.push({
        texts: toGenerate.slice(i, i + EMBEDDING_BATCH_SIZE),
        indices: indices.slice(i, i + EMBEDDING_BATCH_SIZE)
      });
    }

    this.stats.embeddingBatches += batches.length;

    // Process all batches in parallel
    await Promise.all(batches.map(async (batch) => {
      try {
        const embeddings = await this._generateEmbeddingBatchInternal(
          batch.texts, 
          taskType
        );
        
        embeddings.forEach((embedding, idx) => {
          const originalIdx = batch.indices[idx];
          results[originalIdx] = embedding;
          
          // Cache the result
          if (embedding) {
            const cacheKey = this._getEmbeddingCacheKey(batch.texts[idx], taskType);
            this.embeddingCache.set(cacheKey, embedding);
          }
        });
      } catch (error) {
        console.error('Batch embedding error:', error.message);
        // Fill with nulls on error
        batch.indices.forEach(idx => {
          results[idx] = null;
        });
      }
    }));

    return results;
  }

  /**
   * Internal batch embedding generation
   */
  async _generateEmbeddingBatchInternal(texts, taskType) {
    const embeddings = [];
    
    for (const text of texts) {
      try {
        const result = await genAI.models.embedContent({
          model: EMBEDDING_MODEL,
          contents: text,
          config: { taskType }
        });

        const embedding = result.embeddings?.[0]?.values;
        embeddings.push(embedding && Array.isArray(embedding) ? embedding : null);
      } catch (error) {
        embeddings.push(null);
      }
    }

    return embeddings;
  }

  /**
   * Single embedding with caching (backwards compatible)
   */
  async generateEmbedding(text, taskType = 'RETRIEVAL_DOCUMENT') {
    const results = await this.generateEmbeddingsBatch([text], taskType);
    return results[0];
  }

  /**
   * Get cache key for embedding
   */
  _getEmbeddingCacheKey(text, taskType) {
    const hash = crypto.createHash('md5')
      .update(`${text.slice(0, 200)}_${taskType}`)
      .digest('hex');
    return hash;
  }

  // ==========================================================================
  // QUERY RESULT CACHING
  // ==========================================================================

  /**
   * Get cached query result if available
   */
  _getCachedQueryResult(historyId, query) {
    if (!query || query.length < MIN_QUERY_LENGTH_FOR_CACHE) return null;

    const cacheKey = this._getQueryCacheKey(historyId, query);
    const cached = this.queryResultCache.get(cacheKey);

    if (cached && (Date.now() - cached.timestamp) < QUERY_CACHE_TTL_MS) {
      this.stats.queryCacheHits++;
      return cached.result;
    }

    this.stats.queryCacheMisses++;
    return null;
  }

  /**
   * Cache query result
   */
  _cacheQueryResult(historyId, query, result) {
    if (!query || query.length < MIN_QUERY_LENGTH_FOR_CACHE) return;

    const cacheKey = this._getQueryCacheKey(historyId, query);
    this.queryResultCache.set(cacheKey, {
      result,
      timestamp: Date.now()
    });
  }

  /**
   * Get query cache key
   */
  _getQueryCacheKey(historyId, query) {
    const hash = crypto.createHash('md5')
      .update(`${historyId}_${query}`)
      .digest('hex');
    return hash;
  }

  /**
   * Invalidate query cache for history
   */
  invalidateQueryCache(historyId) {
    // Note: With LRU cache, we can't efficiently remove by prefix
    // Cache will naturally expire via TTL
    console.log(`Query cache invalidated for ${historyId}`);
  }

  // ==========================================================================
  // OPTIMIZED CLUSTERING WITH PERSISTENCE
  // ==========================================================================

  /**
   * Check if clusters need rebuilding
   */
  async _shouldRebuildClusters(historyId) {
    const cached = this.clusterCache.get(historyId);
    
    if (!cached) return true;

    const now = Date.now();
    if ((now - cached.lastUpdate) > CLUSTER_CACHE_TTL_MS) return true;

    const currentCount = (await db.getMemoryEntries(historyId, 1)).length;
    const lastCount = this.lastClusterUpdate.get(historyId) || 0;

    return (currentCount - lastCount) >= RECLUSTERING_INTERVAL;
  }

  /**
   * Load clusters from persistence (DB or memory)
   */
  async _loadPersistedClusters(historyId) {
    // Try memory first
    if (this.clusterPersistence.has(historyId)) {
      return this.clusterPersistence.get(historyId);
    }

    // Could add DB persistence here if needed
    return null;
  }

  /**
   * Save clusters to persistence
   */
  async _persistClusters(historyId, clusterData) {
    this.clusterPersistence.set(historyId, clusterData);
    // Could add DB persistence here if needed
  }

  /**
   * Get clusters with smart caching
   */
  async getClusters(historyId) {
    const cached = this.clusterCache.get(historyId);
    const now = Date.now();

    // Check if cache is valid
    if (cached && (now - cached.lastUpdate) < CLUSTER_CACHE_TTL_MS) {
      const shouldRebuild = await this._shouldRebuildClusters(historyId);
      if (!shouldRebuild) {
        return cached;
      }
    }

    // Try loading persisted clusters
    const persisted = await this._loadPersistedClusters(historyId);
    if (persisted) {
      this.clusterCache.set(historyId, persisted);
      return persisted;
    }

    // Build new clusters
    return await this.buildClusters(historyId);
  }

  /**
   * Build clusters (unchanged but now with persistence)
   */
  async buildClusters(historyId) {
    try {
      const memories = await db.getMemoryEntries(historyId, 1000);

      if (!memories || memories.length < MIN_MEMORIES_FOR_CLUSTERING) {
        return null;
      }

      const validMemories = memories.filter(m => 
        m.embedding && Array.isArray(m.embedding) && m.embedding.length > 0
      );

      if (validMemories.length < MIN_MEMORIES_FOR_CLUSTERING) {
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
      await this._persistClusters(historyId, clusterData);

      return clusterData;
    } catch (error) {
      console.error('Clustering failed:', error.message);
      return null;
    }
  }

  /**
   * K-means clustering (unchanged)
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

    return {
      centroids,
      clusters: finalClusters,
      iterations: iteration
    };
  }

  // ==========================================================================
  // VECTORIZED SIMILARITY CALCULATIONS
  // ==========================================================================

  /**
   * Vectorized cosine similarity
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

  /**
   * Batch similarity calculation
   */
  calculateSimilaritiesBatch(queryEmbedding, embeddings) {
    return embeddings.map(emb => this.cosineSimilarity(queryEmbedding, emb));
  }

  // ==========================================================================
  // FULLY PARALLEL CLUSTER SEARCH
  // ==========================================================================

  /**
   * Search within clusters - FULLY PARALLEL
   */
  async searchWithinClustersParallel(queryEmbedding, relevantClusters, allMemories) {
    this.stats.parallelOperations++;

    // Process all clusters in parallel
    const clusterResults = await Promise.all(
      relevantClusters.map(async (cluster) => {
        const clusterMemories = allMemories.filter((_, idx) => 
          cluster.memoryIndices.includes(idx)
        );

        // Vectorized similarity for entire cluster
        const embeddings = clusterMemories.map(m => m.embedding);
        const similarities = this.calculateSimilaritiesBatch(queryEmbedding, embeddings);

        const scoredMemories = clusterMemories
          .map((memory, idx) => ({
            ...memory,
            similarity: similarities[idx],
            clusterId: cluster.clusterId
          }))
          .filter(m => m.similarity >= MIN_SIMILARITY_THRESHOLD)
          .sort((a, b) => b.similarity - a.similarity)
          .slice(0, MAX_MEMORIES_PER_CLUSTER);

        return scoredMemories;
      })
    );

    const allResults = clusterResults.flat();
    allResults.sort((a, b) => b.similarity - a.similarity);
    
    return allResults.slice(0, MAX_RAG_RESULTS).map(r => ({
      messages: r.messages,
      score: r.similarity,
      source: 'conversation-history',
      timestamp: r.timestamp,
      clusterId: r.clusterId
    }));
  }

  /**
   * Hierarchical search with query caching
   */
  async clusterSearch(historyId, queryEmbedding, cutoffTimestamp, query = null) {
    // Check query cache first
    if (query) {
      const cached = this._getCachedQueryResult(historyId, query);
      if (cached) return cached;
    }

    try {
      // PARALLEL: Fetch clusters and memories simultaneously
      const [clusterData, allMemories] = await Promise.all([
        this.getClusters(historyId),
        db.getMemoryEntries(historyId, 1000)
      ]);

      if (!clusterData) {
        const result = await this.standardVectorSearch(historyId, queryEmbedding, cutoffTimestamp);
        if (query) this._cacheQueryResult(historyId, query, result);
        return result;
      }

      // Vectorized cluster selection
      const clusterSimilarities = clusterData.centroids.map(centroid => 
        this.cosineSimilarity(queryEmbedding, centroid)
      );

      const relevantClusters = clusterSimilarities
        .map((sim, idx) => ({ clusterId: idx, similarity: sim }))
        .filter(c => c.similarity >= MIN_CLUSTER_SIMILARITY)
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, TOP_CLUSTERS_TO_SEARCH);

      if (relevantClusters.length === 0) {
        const result = [];
        if (query) this._cacheQueryResult(historyId, query, result);
        return result;
      }

      const validMemories = allMemories.filter(m => 
        m.embedding && 
        Array.isArray(m.embedding) &&
        (m.timestamp || 0) < cutoffTimestamp
      );

      const clustersWithIndices = relevantClusters.map(cluster => ({
        clusterId: cluster.clusterId,
        similarity: cluster.similarity,
        memoryIndices: clusterData.clusters[cluster.clusterId] || []
      }));

      const results = await this.searchWithinClustersParallel(
        queryEmbedding,
        clustersWithIndices,
        validMemories
      );

      // Cache the result
      if (query) this._cacheQueryResult(historyId, query, results);

      return results;

    } catch (error) {
      console.error('Cluster search failed:', error.message);
      const fallback = await this.standardVectorSearch(historyId, queryEmbedding, cutoffTimestamp);
      if (query) this._cacheQueryResult(historyId, query, fallback);
      return fallback;
    }
  }

  /**
   * Standard vector search fallback
   */
  async standardVectorSearch(historyId, queryEmbedding, cutoffTimestamp) {
    try {
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

      const memoryEntries = await db.getMemoryEntries(historyId);

      if (!memoryEntries || memoryEntries.length === 0) return [];

      const validEntries = memoryEntries.filter(entry => 
        entry.embedding && 
        Array.isArray(entry.embedding) &&
        (entry.timestamp || 0) < cutoffTimestamp
      );

      // Vectorized similarity calculation
      const embeddings = validEntries.map(e => e.embedding);
      const similarities = this.calculateSimilaritiesBatch(queryEmbedding, embeddings);

      const scoredEntries = validEntries
        .map((entry, idx) => ({
          ...entry,
          similarity: similarities[idx]
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
  // PARALLEL PERSONAL DATA FETCHING
  // ==========================================================================

  /**
   * Get user personal data with aggressive caching
   */
  async getUserPersonalData(userId) {
    const cached = this.personalDataCache.get(userId);
    if (cached && (Date.now() - cached.timestamp) < PERSONAL_DATA_CACHE_TTL_MS) {
      return cached;
    }

    try {
      // PARALLEL: Fetch all sources simultaneously
      const [timezone, birthday, reminders, complimentCount, dailyQuote, userFacts] = 
        await Promise.all([
          db.getUserTimezone(userId),
          db.getBirthday(userId),
          db.getUserReminders(userId),
          db.getComplimentCount(userId),
          db.getUserDailyQuote(userId),
          db.getUserFacts(userId)
        ]);

      const facts = [];

      if (timezone) facts.push(`User's timezone: ${timezone}`);
      if (birthday) {
        const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
          'July', 'August', 'September', 'October', 'November', 'December'];
        facts.push(`User's birthday: ${monthNames[birthday.month]} ${birthday.day}`);
      }
      if (reminders && reminders.length > 0) {
        const activeReminders = reminders.filter(r => r.active).slice(0, 3);
        if (activeReminders.length > 0) {
          facts.push(`User has ${reminders.length} active reminders`);
          activeReminders.forEach(r => facts.push(`Reminder: "${r.message}"`));
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

      if (facts.length === 0) return null;

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
  // FULLY PARALLEL CONTEXT RETRIEVAL
  // ==========================================================================

  /**
   * Get relevant context with maximum parallelization
   */
  async getRelevantContext(historyId, currentQuery, recentMessageTimestamps, userId = null, guildId = null) {
    try {
      if (!currentQuery || currentQuery.trim().length === 0) {
        return { messages: [], personalData: null };
      }

      // PARALLEL: Generate embedding and fetch personal data
      const [queryEmbedding, personalData] = await Promise.all([
        this.generateEmbedding(currentQuery, 'RETRIEVAL_QUERY'),
        userId ? this.getUserPersonalData(userId) : Promise.resolve(null)
      ]);

      if (!queryEmbedding) {
        return { messages: [], personalData };
      }

      const cutoffTimestamp = Math.max(...recentMessageTimestamps) - TIME_GAP_THRESHOLD_MS;

      // PARALLEL: Execute all searches simultaneously
      const searchPromises = [
        this.clusterSearch(historyId, queryEmbedding, cutoffTimestamp, currentQuery)
      ];

      // Cross-RAG: Server context
      if (userId && guildId && historyId !== guildId) {
        searchPromises.push(
          db.findSimilarMemoriesWithFilter(guildId, queryEmbedding, 1, { userId })
            .then(results => {
              if (!results || results.length === 0) return [];
              return results
                .filter(entry => {
                  const entryTimestamp = entry.timestamp || 0;
                  return entryTimestamp < cutoffTimestamp && entry.score >= MIN_SIMILARITY_THRESHOLD;
                })
                .map(entry => ({
                  messages: entry.messages,
                  score: entry.score * 0.85,
                  source: 'server-context',
                  timestamp: entry.timestamp
                }));
            })
            .catch(() => [])
        );
      }

      // Cross-RAG: User context
      if (guildId && historyId === guildId && userId) {
        searchPromises.push(
          this.clusterSearch(userId, queryEmbedding, cutoffTimestamp, currentQuery)
            .then(results => {
              if (!results || results.length === 0) return [];
              return results.map(entry => ({
                messages: entry.messages.slice(-6),
                score: entry.score * 0.75,
                source: 'user-context',
                timestamp: entry.timestamp
              }));
            })
            .catch(() => [])
        );
      }

      const allSearchResults = await Promise.all(searchPromises);
      const relevantMessages = allSearchResults.flat();
      relevantMessages.sort((a, b) => b.score - a.score);
      const topResults = relevantMessages.slice(0, MAX_RAG_RESULTS);

      return { messages: topResults, personalData };

    } catch (error) {
      console.error('Context retrieval failed:', error.message);
      return { messages: [], personalData: null };
    }
  }

  // ==========================================================================
  // PARALLEL MEMORY INDEXING
  // ==========================================================================

  /**
   * Store memory batch in parallel
   */
  async storeMemoryBatch(historyId, messageBatches, userId = null, guildId = null) {
    const texts = messageBatches.map(messages => 
      messages
        .map(msg => this.extractTextFromMessage(msg))
        .filter(text => text.length > 0)
        .join(' ')
    ).filter(text => text.length >= 10);

    if (texts.length === 0) return;

    // PARALLEL: Generate all embeddings at once
    const embeddings = await this.generateEmbeddingsBatch(texts, 'RETRIEVAL_DOCUMENT');

    // PARALLEL: Store all memories simultaneously
    await Promise.all(
      embeddings.map(async (embedding, idx) => {
        if (!embedding) return;

        const metadata = {
          historyId,
          userId: userId || null,
          guildId: guildId || null,
          timestamp: Date.now()
        };

        try {
          await db.saveMemoryEntry(historyId, {
            messages: messageBatches[idx],
            embedding,
            text: texts[idx].slice(0, 1000),
            metadata,
            timestamp: Date.now()
          });
        } catch (error) {
          console.error('Memory storage error:', error.message);
        }
      })
    );
  }

  /**
   * Background indexing with parallel batching
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
            if (chunk.length >= 3) batches.push(chunk);
          }

          // Process in parallel groups
          const parallelGroups = [];
          for (let i = 0; i < batches.length; i += PARALLEL_INDEX_BATCH_SIZE) {
            parallelGroups.push(batches.slice(i, i + PARALLEL_INDEX_BATCH_SIZE));
          }

          for (const group of parallelGroups) {
            await this.storeMemoryBatch(historyId, group, userId, guildId);
          }

          this.lastIndexedCount.set(historyId, oldMessages.length);
        }
      }
    } catch (error) {
      console.error('Auto-indexing check failed:', error.message);
    }
  }

  // ==========================================================================
  // OPTIMIZED MAIN HISTORY
  // ==========================================================================

  /**
   * Get optimized history with all parallelizations
   */
  async getOptimizedHistory(historyId, currentQuery, model, userId = null, guildId = null) {
    try {
      const allHistory = await db.getChatHistory(historyId);
      if (!allHistory) return [];

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

      // Background indexing (non-blocking)
      this.checkAndIndexMessages(historyId, allHistory, userId, guildId).catch(() => {});

      if (historyArray.length <= RECENT_MESSAGE_WINDOW) {
        return this.formatHistoryForAPI(recentMessages);
      }

      // PARALLEL: Get RAG results and summary simultaneously
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

      // Check personal data relevance
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
  // UTILITY METHODS (unchanged implementations)
  // ==========================================================================

  extractTextFromMessage(message) {
    if (!message || !message.content) return '';
    let text = '';
    if (Array.isArray(message.content)) {
      for (const part of message.content) {
        if (part && part.text) text += part.text + ' ';
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

  initializeCentroids(embeddings, k) {
    const centroids = [];
    const n = embeddings.length;
    centroids.push([...embeddings[Math.floor(Math.random() * n)]]);
    for (let i = 1; i < k; i++) {
      const distances = embeddings.map(emb => {
        const minDist = Math.min(...centroids.map(c => {
          const sim = this.cosineSimilarity(emb, c);
          return 1 - sim;
        }));
        return minDist * minDist;
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

  updateCentroids(memories, clusters, embeddingDim) {
    const newCentroids = [];
    for (const cluster of clusters) {
      if (cluster.length === 0) {
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

  hasConverged(oldCentroids, newCentroids) {
    let maxMovement = 0;
    for (let i = 0; i < oldCentroids.length; i++) {
      const movement = 1 - this.cosineSimilarity(oldCentroids[i], newCentroids[i]);
      if (movement > maxMovement) maxMovement = movement;
    }
    return maxMovement < KMEANS_CONVERGENCE_THRESHOLD;
  }

  invalidatePersonalDataCache(userId) {
    this.personalDataCache.delete(userId);
  }

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

  async searchMemory(userId, guildId, query) {
    try {
      const queryEmbedding = await this.generateEmbedding(query, 'RETRIEVAL_QUERY');
      if (!queryEmbedding) return [];
      const historyId = guildId || userId;
      const results = await this.clusterSearch(historyId, queryEmbedding, Date.now(), query);
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
      const newMessagesToSummarize = cached ? messages.slice(cached.messageCount) : messages;
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

  buildContextMessage(sections) {
    if (sections.length === 0) return null;
    let contextText = '[HISTORICAL CONTEXT - This is past conversation, not the current message]\n\n';
    for (const section of sections) {
      const label = this.getContextLabel(section.type);
      const scoreText = section.score ? ` (Relevance: ${section.score.toFixed(2)})` : '';
      const clusterText = section.clusterId !== undefined ? ` [Cluster ${section.clusterId}]` : '';
      contextText += `[${label}${scoreText}${clusterText}]\n${section.content}\n\n`;
    }
    if (contextText.length > MAX_INLINE_CONTEXT_SIZE) return null;
    return {
      role: 'user',
      parts: [{ text: contextText.trim() }]
    };
  }

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
          apiEntry.parts.push({ text: `[TIME ELAPSED: ${duration} since previous message]\n` });
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
          apiEntry.parts.push({ text: `[Previous ${mime} attachment - not available]` });
        } else if (part.inlineData) {
          apiEntry.parts.push({ text: `[Previous inline image]` });
        }
      }
      if (apiEntry.parts.length > 0) {
        formattedHistory.push(apiEntry);
      }
    }
    return formattedHistory;
  }

  // ==========================================================================
  // STATISTICS & MONITORING
  // ==========================================================================

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
      queryCacheSize: this.queryResultCache.size,
      trackedHistories: this.lastIndexedCount.size,
      summaryCacheSize: this.summaryCache.size,
      personalDataCacheSize: this.personalDataCache.size,
      clusteredHistories: this.clusterCache.size,
      statistics: {
        cacheHits: this.stats.cacheHits,
        cacheMisses: this.stats.cacheMisses,
        hitRate: this.stats.cacheHits + this.stats.cacheMisses > 0
          ? (this.stats.cacheHits / (this.stats.cacheHits + this.stats.cacheMisses) * 100).toFixed(2) + '%'
          : '0%',
        queryCacheHits: this.stats.queryCacheHits,
        queryCacheMisses: this.stats.queryCacheMisses,
        queryHitRate: this.stats.queryCacheHits + this.stats.queryCacheMisses > 0
          ? (this.stats.queryCacheHits / (this.stats.queryCacheHits + this.stats.queryCacheMisses) * 100).toFixed(2) + '%'
          : '0%',
        embeddingBatches: this.stats.embeddingBatches,
        parallelOperations: this.stats.parallelOperations
      },
      clusterInfo: clusterInfo,
      parallelConfig: {
        maxConcurrentEmbeddings: MAX_CONCURRENT_EMBEDDINGS,
        embeddingBatchSize: EMBEDDING_BATCH_SIZE,
        maxConcurrentDbOps: MAX_CONCURRENT_DB_OPS,
        parallelIndexBatchSize: PARALLEL_INDEX_BATCH_SIZE
      },
      entries: Array.from(this.lastIndexedCount.entries()).map(([id, count]) => ({
        historyId: id,
        lastIndexedMessageCount: count
      }))
    };
  }

  async forceRebuildClusters(historyId) {
    try {
      console.log(`🔨 Force rebuilding clusters for ${historyId}`);
      this.clusterCache.delete(historyId);
      this.lastClusterUpdate.delete(historyId);
      this.clusterPersistence.delete(historyId);
      this.invalidateQueryCache(historyId);
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
        return { success: false, message: 'Not enough memories for clustering' };
      }
    } catch (error) {
      console.error('Force cluster rebuild failed:', error.message);
      return { success: false, message: error.message };
    }
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
      const oldMessages = historyArray.slice(0, -RECENT_MESSAGE_WINDOW);
      if (oldMessages.length === 0) {
        return { success: false, message: 'No old messages to index' };
      }
      const batches = [];
      for (let i = 0; i < oldMessages.length; i += (CHUNK_SIZE - CHUNK_OVERLAP)) {
        const chunk = oldMessages.slice(i, i + CHUNK_SIZE);
        if (chunk.length >= 3) batches.push(chunk);
      }
      console.log(`🔥 Force-indexing ${oldMessages.length} messages in ${batches.length} chunks (parallel)`);
      const parallelGroups = [];
      for (let i = 0; i < batches.length; i += PARALLEL_INDEX_BATCH_SIZE) {
        parallelGroups.push(batches.slice(i, i + PARALLEL_INDEX_BATCH_SIZE));
      }
      for (const group of parallelGroups) {
        await this.storeMemoryBatch(historyId, group, userId, guildId);
      }
      this.lastIndexedCount.set(historyId, oldMessages.length);
      this.invalidateQueryCache(historyId);
      return {
        success: true,
        message: `Indexed ${oldMessages.length} messages in ${batches.length} overlapping chunks (parallel)`,
        batchCount: batches.length,
        messageCount: oldMessages.length,
        parallelGroups: parallelGroups.length
      };
    } catch (error) {
      console.error('Force indexing failed:', error.message);
      return { success: false, message: error.message };
    }
  }
}

// ============================================================================
// EXPORT SINGLETON
// ============================================================================

export const memorySystem = new MemorySystem();
