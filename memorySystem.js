import fs from 'fs/promises';
import path from 'path';
import { genAI, TEMP_DIR } from './botManager.js';
import * as db from './database.js';
import crypto from 'crypto';

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

/** Time gap in milliseconds that triggers a "TIME ELAPSED" marker (30 seconds) */
const TIME_GAP_THRESHOLD_MS = 30 * 1000; // Changed from 30 minutes to 30 seconds

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
const MIN_MEMORIES_FOR_CLUSTERING = 240;

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
// PARALLEL PROCESSING CONFIGURATION
// ============================================================================

/** Maximum number of concurrent embedding generation operations */
const MAX_CONCURRENT_EMBEDDINGS = 5;

/** Maximum number of concurrent database operations */
const MAX_CONCURRENT_DB_OPS = 10;

/** Batch size for parallel memory indexing */
const PARALLEL_INDEX_BATCH_SIZE = 3;

// ============================================================================
// QUERY CACHE CONFIGURATION
// ============================================================================

/** Query result cache TTL (2 minutes) */
const QUERY_CACHE_TTL_MS = 2 * 60 * 1000;

/** Maximum query cache size */
const MAX_QUERY_CACHE_SIZE = 200;

/** Minimum query length for caching */
const MIN_QUERY_LENGTH_FOR_CACHE = 10;

// ============================================================================
// MEMORY SYSTEM CLASS WITH OPTIMIZED PARALLEL PROCESSING
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
    
    // Query result cache - NEW
    this.queryCache = new Map(); // queryHash -> { results, timestamp, historyId }
    
    // Parallel processing controls
    this.activeEmbeddingOps = 0;
    this.embeddingQueue = [];
    
    // Batch embedding queue - NEW
    this.batchEmbeddingQueue = [];
    this.batchProcessingTimer = null;
    
    // Background clustering tracking - NEW
    this.clusteringInProgress = new Map(); // historyId -> boolean
    this.backgroundClusterQueue = []; // Queue of pending background rebuilds
  }

  // ==========================================================================
  // QUERY CACHING UTILITIES
  // ==========================================================================

  /**
   * Generate hash for query caching
   */
  generateQueryHash(historyId, query, userId = null, guildId = null) {
    const hashInput = `${historyId}:${query}:${userId || ''}:${guildId || ''}`;
    return crypto.createHash('md5').update(hashInput).digest('hex');
  }

  /**
   * Get cached query results if available and not expired
   */
  getCachedQueryResults(historyId, query, userId = null, guildId = null) {
    if (!query || query.length < MIN_QUERY_LENGTH_FOR_CACHE) {
      return null;
    }

    const queryHash = this.generateQueryHash(historyId, query, userId, guildId);
    const cached = this.queryCache.get(queryHash);

    if (!cached) {
      return null;
    }

    const now = Date.now();
    if (now - cached.timestamp > QUERY_CACHE_TTL_MS) {
      this.queryCache.delete(queryHash);
      return null;
    }

    return cached.results;
  }

  /**
   * Cache query results
   */
  cacheQueryResults(historyId, query, results, userId = null, guildId = null) {
    if (!query || query.length < MIN_QUERY_LENGTH_FOR_CACHE) {
      return;
    }

    const queryHash = this.generateQueryHash(historyId, query, userId, guildId);
    
    this.queryCache.set(queryHash, {
      results: results,
      timestamp: Date.now(),
      historyId: historyId
    });

    // LRU eviction
    if (this.queryCache.size > MAX_QUERY_CACHE_SIZE) {
      const oldestKey = this.queryCache.keys().next().value;
      this.queryCache.delete(oldestKey);
    }
  }

  /**
   * Invalidate query cache for a history (call when new memories added)
   */
  invalidateQueryCache(historyId) {
    const toDelete = [];
    for (const [hash, data] of this.queryCache.entries()) {
      if (data.historyId === historyId) {
        toDelete.push(hash);
      }
    }
    toDelete.forEach(hash => this.queryCache.delete(hash));
  }

  // ==========================================================================
  // EMBEDDING UTILITIES WITH BATCH PROCESSING
  // ==========================================================================

  /**
   * Generate embedding for text with caching and rate limiting
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

      // LRU cache cleanup
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
   * Generate multiple embeddings in parallel with controlled concurrency
   * OPTIMIZED: Processes embeddings in optimal batch sizes
   */
  async generateEmbeddingsBatch(texts, taskType = 'RETRIEVAL_DOCUMENT') {
    if (!texts || texts.length === 0) return [];

    const results = new Array(texts.length);
    const toGenerate = [];
    
    // First pass: Check cache
    for (let i = 0; i < texts.length; i++) {
      const text = texts[i];
      if (!text || typeof text !== 'string' || text.trim().length === 0) {
        results[i] = null;
        continue;
      }

      const cacheKey = `${text.slice(0, 100)}_${taskType}`;
      if (this.embeddingCache.has(cacheKey)) {
        results[i] = this.embeddingCache.get(cacheKey);
      } else {
        toGenerate.push({ index: i, text, cacheKey });
      }
    }

    if (toGenerate.length === 0) {
      return results;
    }

    // Second pass: Generate missing embeddings in parallel batches
    const batches = [];
    for (let i = 0; i < toGenerate.length; i += MAX_CONCURRENT_EMBEDDINGS) {
      batches.push(toGenerate.slice(i, i + MAX_CONCURRENT_EMBEDDINGS));
    }
    
    // Process batches sequentially, but items within batch in parallel
    for (const batch of batches) {
      const batchResults = await Promise.allSettled(
        batch.map(async ({ index, text, cacheKey }) => {
          try {
            const result = await genAI.models.embedContent({
              model: EMBEDDING_MODEL,
              contents: text,
              config: { taskType }
            });

            const embedding = result.embeddings?.[0]?.values;
            if (embedding && Array.isArray(embedding)) {
              this.embeddingCache.set(cacheKey, embedding);
              return { index, embedding };
            }
            return { index, embedding: null };
          } catch (error) {
            console.error(`Batch embedding failed for index ${index}:`, error.message);
            return { index, embedding: null };
          }
        })
      );

      // Populate results
      batchResults.forEach(result => {
        if (result.status === 'fulfilled' && result.value) {
          results[result.value.index] = result.value.embedding;
        }
      });
    }
    
    // Cleanup cache if too large
    if (this.embeddingCache.size > MAX_EMBEDDING_CACHE_SIZE) {
      const toRemove = this.embeddingCache.size - MAX_EMBEDDING_CACHE_SIZE;
      const keys = Array.from(this.embeddingCache.keys());
      for (let i = 0; i < toRemove; i++) {
        this.embeddingCache.delete(keys[i]);
      }
    }

    return results;
  }

  /**
   * Calculate cosine similarity between two embeddings (vectorized)
   */
  cosineSimilarity(a, b) {
    if (!a || !b || a.length !== b.length) return 0;

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    // Vectorized computation
    for (let i = 0; i < a.length; i++) {
      const aVal = a[i];
      const bVal = b[i];
      dotProduct += aVal * bVal;
      normA += aVal * aVal;
      normB += bVal * bVal;
    }

    const denominator = Math.sqrt(normA) * Math.sqrt(normB);
    return denominator === 0 ? 0 : dotProduct / denominator;
  }

  /**
   * Calculate similarity between query and multiple embeddings in parallel
   * OPTIMIZED: Vectorized batch computation
   */
  calculateSimilaritiesBatch(queryEmbedding, embeddings) {
    if (!queryEmbedding || !embeddings || embeddings.length === 0) {
      return [];
    }

    // Pre-calculate query norm once
    let queryNorm = 0;
    for (let i = 0; i < queryEmbedding.length; i++) {
      queryNorm += queryEmbedding[i] * queryEmbedding[i];
    }
    queryNorm = Math.sqrt(queryNorm);

    // Vectorized similarity calculation
    return embeddings.map(embedding => {
      if (!embedding || embedding.length !== queryEmbedding.length) {
        return 0;
      }

      let dotProduct = 0;
      let embeddingNorm = 0;

      for (let i = 0; i < queryEmbedding.length; i++) {
        const qVal = queryEmbedding[i];
        const eVal = embedding[i];
        dotProduct += qVal * eVal;
        embeddingNorm += eVal * eVal;
      }

      embeddingNorm = Math.sqrt(embeddingNorm);
      const denominator = queryNorm * embeddingNorm;
      return denominator === 0 ? 0 : dotProduct / denominator;
    });
  }

  // ==========================================================================
  // CLUSTERING ALGORITHMS (WITH CACHING)
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
   * Assign memories to nearest cluster centroid - VECTORIZED
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
   * OPTIMIZED: Vectorized mean calculation
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
      
      // Vectorized accumulation
      for (const memIdx of cluster) {
        const embedding = memories[memIdx].embedding;
        for (let i = 0; i < embeddingDim; i++) {
          centroid[i] += embedding[i];
        }
      }

      // Vectorized normalization
      const count = cluster.length;
      for (let i = 0; i < embeddingDim; i++) {
        centroid[i] /= count;
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
   * OPTIMIZED: Early stopping and vectorized operations
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
   * OPTIMIZED: Only rebuilds when necessary
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

      // Invalidate query cache for this history since we have new clusters
      this.invalidateQueryCache(historyId);

      return clusterData;
    } catch (error) {
      console.error('Clustering failed:', error.message);
      return null;
    }
  }

  /**
   * Build clusters in background (non-blocking)
   * Allows queries to continue using old clusters while rebuilding
   */
  async buildClustersInBackground(historyId) {
    // Check if already rebuilding
    if (this.clusteringInProgress.get(historyId)) {
      console.log(`⏳ Clustering already in progress for ${historyId}`);
      return;
    }

    // Mark as in progress
    this.clusteringInProgress.set(historyId, true);

    try {
      console.log(`🔄 Starting background clustering for ${historyId}`);
      
      // Build clusters without blocking
      const newClusterData = await this.buildClusters(historyId);
      
      if (newClusterData) {
        console.log(`✅ Background clustering completed for ${historyId}`);
        // Query cache is already invalidated in buildClusters
      } else {
        console.log(`⚠️ Background clustering returned null for ${historyId}`);
      }
    } catch (error) {
      console.error(`❌ Background clustering failed for ${historyId}:`, error.message);
    } finally {
      // Mark as complete
      this.clusteringInProgress.set(historyId, false);
    }
  }

  /**
   * Get clusters for a history (cached or build new)
   * OPTIMIZED: Non-blocking - returns stale cache while rebuilding in background
   */
  async getClusters(historyId) {
    const cached = this.clusterCache.get(historyId);
    const now = Date.now();

    // If we have cached clusters (even if slightly stale), use them
    if (cached) {
      const cacheAge = now - cached.lastUpdate;
      const lastUpdate = this.lastClusterUpdate.get(historyId) || 0;
      
      // Quick check: only fetch count if cache might be very stale
      if (cacheAge < CLUSTER_CACHE_TTL_MS * 2) { // Allow 2x TTL for stale cache
        // Check if we need to trigger background rebuild
        const memories = await db.getMemoryEntries(historyId, 1);
        const currentCount = memories.length;
        
        // If significant new memories AND not currently rebuilding, trigger background rebuild
        if (currentCount - lastUpdate >= RECLUSTERING_INTERVAL && 
            !this.clusteringInProgress.get(historyId)) {
          console.log(`🔄 Triggering background cluster rebuild for ${historyId} (${currentCount - lastUpdate} new memories)`);
          
          // Fire and forget - don't await
          this.buildClustersInBackground(historyId).catch(err => 
            console.error('Background clustering error:', err)
          );
        }
        
        // Return cached clusters immediately (non-blocking)
        return cached;
      }
    }

    // No cache at all, need to build synchronously (first time only)
    if (!cached) {
      console.log(`🔨 No cache found for ${historyId}, building clusters synchronously`);
      return await this.buildClusters(historyId);
    }

    // Cache is too old and might be invalid, rebuild
    console.log(`⚠️ Cache too old for ${historyId}, rebuilding`);
    return await this.buildClusters(historyId);
  }

  // ==========================================================================
  // HIERARCHICAL SEARCH WITH MAXIMUM PARALLELIZATION
  // ==========================================================================

  /**
   * Find top relevant clusters for a query
   * OPTIMIZED: Vectorized similarity calculation
   */
  findRelevantClusters(queryEmbedding, centroids) {
    const similarities = this.calculateSimilaritiesBatch(queryEmbedding, centroids);
    
    const clusterScores = similarities.map((similarity, idx) => ({
      clusterId: idx,
      similarity: similarity
    }));

    return clusterScores
      .filter(c => c.similarity >= MIN_CLUSTER_SIMILARITY)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, TOP_CLUSTERS_TO_SEARCH);
  }

  /**
   * Search within specific clusters for relevant memories - FULLY PARALLEL
   */
  async searchWithinClustersParallel(queryEmbedding, relevantClusters, allMemories) {
    // PARALLEL: Search all clusters simultaneously
    const clusterResults = await Promise.all(
      relevantClusters.map(async (cluster) => {
        const clusterMemories = allMemories.filter((_, idx) => 
          cluster.memoryIndices.includes(idx)
        );

        if (clusterMemories.length === 0) {
          return [];
        }

        // Vectorized similarity calculation for all memories in cluster
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

    // Flatten and sort all results
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
   * Hierarchical clustered search - FULLY OPTIMIZED
   */
  async clusterSearch(historyId, queryEmbedding, cutoffTimestamp) {
    try {
      // PARALLEL: Fetch cluster data and memories simultaneously
      const [clusterData, allMemories] = await Promise.all([
        this.getClusters(historyId),
        db.getMemoryEntries(historyId, 1000)
      ]);

      if (!clusterData) {
        console.log(`ℹ️ No clusters available, using standard search`);
        return await this.standardVectorSearch(historyId, queryEmbedding, cutoffTimestamp);
      }

      // Phase 1: Find relevant clusters using vectorized similarity
      const relevantClusters = this.findRelevantClusters(
        queryEmbedding, 
        clusterData.centroids
      );

      if (relevantClusters.length === 0) {
        console.log(`ℹ️ No relevant clusters found`);
        return [];
      }

      // Filter memories once (avoid redundant filtering)
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

      // Phase 2: PARALLEL search within all clusters simultaneously
      const results = await this.searchWithinClustersParallel(
        queryEmbedding,
        clustersWithIndices,
        validMemories
      );

      return results;

    } catch (error) {
      console.error('Cluster search failed:', error.message);
      return await this.standardVectorSearch(historyId, queryEmbedding, cutoffTimestamp);
    }
  }

  /**
   * Standard vector search (fallback) - OPTIMIZED WITH VECTORIZATION
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

      // Fallback to local vectorized search
      const memoryEntries = await db.getMemoryEntries(historyId);

      if (!memoryEntries || memoryEntries.length === 0) {
        return [];
      }

      // Filter valid entries
      const validEntries = memoryEntries.filter(entry => 
        entry.embedding && 
        Array.isArray(entry.embedding) &&
        (entry.timestamp || 0) < cutoffTimestamp
      );

      if (validEntries.length === 0) {
        return [];
      }

      // VECTORIZED: Calculate all similarities at once
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
  // TEXT EXTRACTION UTILITIES
  // ==========================================================================

  /**
   * Extract text from message content parts
   */
  extractTextFromMessage(message) {
    if (!message || (!message.content && !message.parts)) {
      return '';
    }

    let text = '';
    const contentArray = message.content || message.parts;
    if (Array.isArray(contentArray)) {
      for (const part of contentArray) {
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
  // PERSONAL DATA MANAGEMENT WITH PARALLEL FETCHING
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
   * Retrieve user's personal data with caching - FULLY PARALLEL
   */
  async getUserPersonalData(userId) {
    const cached = this.personalDataCache.get(userId);
    if (cached && (Date.now() - cached.timestamp) < PERSONAL_DATA_CACHE_TTL_MS) {
      return cached;
    }

    try {
      // PARALLEL: Fetch all personal data sources simultaneously
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
  // MEMORY SEARCH & RETRIEVAL WITH CACHING
  // ==========================================================================

  /**
   * Search memory for specific content - WITH CACHING
   */
  async searchMemory(userId, guildId, query) {
    try {
      const historyId = guildId || userId;
      
      // Check cache first
      const cached = this.getCachedQueryResults(historyId, query, userId, guildId);
      if (cached) {
        return cached.map(entry => {
          const text = this.extractTextFromMessage({ content: entry.messages[0].content });
          return `[Memory] ${text}`;
        });
      }

      const queryEmbedding = await this.generateEmbedding(query, 'RETRIEVAL_QUERY');
      if (!queryEmbedding) return [];
      
      // Use clustered search
      const results = await this.clusterSearch(historyId, queryEmbedding, Date.now());

      if (!results || results.length === 0) return [];

      // Cache results
      this.cacheQueryResults(historyId, query, results, userId, guildId);

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
   * Get relevant historical context via RAG - FULLY PARALLEL WITH CACHING
   */
  async getRelevantContext(historyId, currentQuery, recentMessageTimestamps, userId = null, guildId = null) {
    try {
      if (!currentQuery || currentQuery.trim().length === 0) {
        return { messages: [], personalData: null };
      }

      // Check query cache
      const cachedResults = this.getCachedQueryResults(historyId, currentQuery, userId, guildId);
      if (cachedResults) {
        // Still fetch personal data fresh
        const personalData = userId ? await this.getUserPersonalData(userId) : null;
        return { messages: cachedResults, personalData };
      }

      // PARALLEL: Generate query embedding and fetch personal data simultaneously
      const [queryEmbedding, personalData] = await Promise.all([
        this.generateEmbedding(currentQuery, 'RETRIEVAL_QUERY'),
        userId ? this.getUserPersonalData(userId) : Promise.resolve(null)
      ]);

      if (!queryEmbedding) {
        return { messages: [], personalData };
      }

      const cutoffTimestamp = Math.max(...recentMessageTimestamps) - TIME_GAP_THRESHOLD_MS;

      // PARALLEL RAG: Execute all searches simultaneously
      const searchPromises = [
        // 1. Main conversation history search
        this.clusterSearch(historyId, queryEmbedding, cutoffTimestamp)
      ];

      // 2. Cross-RAG: Server context (if user query in server)
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

      // 3. Cross-RAG: User context (if server query)
      if (guildId && historyId === guildId && userId) {
        searchPromises.push(
          this.clusterSearch(userId, queryEmbedding, cutoffTimestamp)
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

      // Wait for all parallel searches to complete
      const allSearchResults = await Promise.all(searchPromises);
      
      // Flatten and combine all results
      const relevantMessages = allSearchResults.flat();
      relevantMessages.sort((a, b) => b.score - a.score);
      const topResults = relevantMessages.slice(0, MAX_RAG_RESULTS);

      // Cache results
      this.cacheQueryResults(historyId, currentQuery, topResults, userId, guildId);

      return { messages: topResults, personalData };

    } catch (error) {
      console.error('Context retrieval failed:', error.message);
      return { messages: [], personalData: null };
    }
  }

  // ==========================================================================
  // MEMORY STORAGE & INDEXING WITH PARALLEL PROCESSING
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

      // Invalidate query cache for this history
      this.invalidateQueryCache(historyId);

    } catch (error) {
      console.error('Memory storage failed:', error.message);
    }
  }

  /**
   * Background indexing of conversation history - FULLY PARALLEL
   */
  async checkAndIndexMessages(historyId, allHistory, userId = null, guildId = null) {
    try {
      const historyArray = [];
      for (const messagesId in allHistory) {
        if (allHistory.hasOwnProperty(messagesId)) {
          historyArray.push(...(allHistory[messagesId] || []));
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

          // PARALLEL: Process batches in controlled parallel groups
          const parallelBatches = [];
          for (let i = 0; i < batches.length; i += PARALLEL_INDEX_BATCH_SIZE) {
            parallelBatches.push(batches.slice(i, i + PARALLEL_INDEX_BATCH_SIZE));
          }

          for (const parallelGroup of parallelBatches) {
            await Promise.all(
              parallelGroup.map(batch =>
                this.storeMemoryWithEmbedding(historyId, batch, userId, guildId)
                  .catch(err => console.error('Background indexing error:', err.message))
              )
            );
          }

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
  // MAIN HISTORY OPTIMIZATION WITH MAXIMUM PARALLELIZATION
  // ==========================================================================

  /**
   * Get optimized conversation history with RAG and clustering - FULLY PARALLEL
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
          historyArray.push(...(allHistory[messagesId] || []));
        }
      }

      if (historyArray.length === 0) return [];

      historyArray.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

      const recentMessages = historyArray.slice(-RECENT_MESSAGE_WINDOW);
      const oldMessages = historyArray.slice(0, -RECENT_MESSAGE_WINDOW);

      const recentTimestamps = recentMessages.map(msg => msg.timestamp || Date.now());

      // PARALLEL: Background indexing (fire and forget)
      this.checkAndIndexMessages(historyId, allHistory, userId, guildId)
        .catch(() => { });

      if (historyArray.length <= RECENT_MESSAGE_WINDOW) {
        return this.formatHistoryForAPI(recentMessages);
      }

      // PARALLEL: Fetch RAG results and generate summary simultaneously
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

      // Check personal data relevance if available
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
      for (const part of (entry.content || entry.parts || [])) {
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
   * Get current status of memory system including all caches
   */
  getQueueStatus() {
    const clusterInfo = Array.from(this.clusterCache.entries()).map(([historyId, data]) => ({
      historyId,
      numClusters: data.centroids.length,
      memoryCount: data.memoryCount,
      lastUpdate: new Date(data.lastUpdate).toISOString(),
      cacheAge: Math.floor((Date.now() - data.lastUpdate) / 1000) + 's',
      iterations: data.iterations,
      rebuildingInBackground: this.clusteringInProgress.get(historyId) || false
    }));

    return {
      embeddingCacheSize: this.embeddingCache.size,
      trackedHistories: this.lastIndexedCount.size,
      summaryCacheSize: this.summaryCache.size,
      personalDataCacheSize: this.personalDataCache.size,
      queryCacheSize: this.queryCache.size,
      clusteredHistories: this.clusterCache.size,
      backgroundClusteringActive: Array.from(this.clusteringInProgress.values()).filter(v => v).length,
      clusterInfo: clusterInfo,
      parallelConfig: {
        maxConcurrentEmbeddings: MAX_CONCURRENT_EMBEDDINGS,
        maxConcurrentDbOps: MAX_CONCURRENT_DB_OPS,
        parallelIndexBatchSize: PARALLEL_INDEX_BATCH_SIZE
      },
      cacheConfig: {
        queryCacheTTL: QUERY_CACHE_TTL_MS / 1000 + 's',
        clusterCacheTTL: CLUSTER_CACHE_TTL_MS / 1000 + 's',
        personalDataCacheTTL: PERSONAL_DATA_CACHE_TTL_MS / 1000 + 's',
        timeGapThreshold: TIME_GAP_THRESHOLD_MS / 1000 + 's',
        backgroundClustering: 'enabled'
      },
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
   * Force immediate indexing of a history - PARALLEL VERSION
   */
  async forceIndexNow(historyId, userId = null, guildId = null) {
    try {
      const allHistory = await db.getChatHistory(historyId);
      if (!allHistory) return { success: false, message: 'No history found' };

      const historyArray = [];
      for (const messagesId in allHistory) {
        if (allHistory.hasOwnProperty(messagesId)) {
          historyArray.push(...(allHistory[messagesId] || []));
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

      // PARALLEL: Process in controlled groups
      const parallelBatches = [];
      for (let i = 0; i < batches.length; i += PARALLEL_INDEX_BATCH_SIZE) {
        parallelBatches.push(batches.slice(i, i + PARALLEL_INDEX_BATCH_SIZE));
      }

      for (const parallelGroup of parallelBatches) {
        await Promise.all(
          parallelGroup.map(batch =>
            this.storeMemoryWithEmbedding(historyId, batch, userId, guildId)
          )
        );
      }

      this.lastIndexedCount.set(historyId, oldMessages.length);
      this.invalidateQueryCache(historyId);

      return {
        success: true,
        message: `Indexed ${oldMessages.length} messages in ${batches.length} overlapping chunks (parallel)`,
        batchCount: batches.length,
        messageCount: oldMessages.length,
        parallelGroups: parallelBatches.length
      };
    } catch (error) {
      console.error('Force indexing failed:', error.message);
      return { success: false, message: error.message };
    }
  }

  /**
   * Clear all caches (for debugging/testing)
   */
  clearAllCaches() {
    this.embeddingCache.clear();
    this.queryCache.clear();
    this.clusterCache.clear();
    this.summaryCache.clear();
    this.personalDataCache.clear();
    this.lastClusterUpdate.clear();
    this.clusteringInProgress.clear();
    
    return {
      success: true,
      message: 'All caches cleared'
    };
  }
}

// ============================================================================
// EXPORT SINGLETON INSTANCE
// ============================================================================

export const memorySystem = new MemorySystem();
