/**
 * @fileoverview K-means++ clustering engine for hierarchical memory search.
 *               Manages cluster building (sync + background), caching, and
 *               both clustered and fallback standard vector searches.
 * @module memory/ClusterEngine
 */

import * as db from '../database/index.js';
import { Logger } from '../core/Logger.js';
import { embeddingService } from './EmbeddingService.js';

const logger = Logger.get('ClusterEngine');

// ============================================================================
// CONSTANTS
// ============================================================================

const NUM_CLUSTERS               = 8;
const MIN_MEMORIES_FOR_CLUSTERING = 240;
const TOP_CLUSTERS_TO_SEARCH     = 3;
const MIN_CLUSTER_SIMILARITY     = 0.45;
const RECLUSTERING_INTERVAL      = 20;   // new memories before background rebuild
const MAX_KMEANS_ITERATIONS      = 15;
const KMEANS_CONVERGENCE_THRESHOLD = 0.001;
/** Primary TTL — serve stale beyond this, trigger background rebuild */
const CLUSTER_CACHE_TTL_MS       = 10 * 60 * 1000;
const MAX_MEMORIES_PER_CLUSTER   = 10;
const MAX_RAG_RESULTS            = 3;
const MIN_SIMILARITY_THRESHOLD   = 0.65;

// ============================================================================
// CLUSTER ENGINE
// ============================================================================

class ClusterEngine {
  constructor() {
    /** @type {Map<string, object>} historyId → { centroids, clusters, lastUpdate, memoryCount, iterations } */
    this.clusterCache         = new Map();
    /** @type {Map<string, number>} historyId → memoryCount at last clustering */
    this.lastClusterUpdate    = new Map();
    /** @type {Map<string, boolean>} historyId → background rebuild in progress */
    this.clusteringInProgress = new Map();
  }

  // ==========================================================================
  // K-MEANS ALGORITHMS
  // ==========================================================================

  /**
   * K-means++ centroid initialisation — better spread than random.
   *
   * @param {number[][]} embeddings
   * @param {number}     k
   * @returns {number[][]}
   */
  initializeCentroids(embeddings, k) {
    const centroids = [];
    const n         = embeddings.length;

    // First centroid: uniform random
    centroids.push([...embeddings[Math.floor(Math.random() * n)]]);

    // Subsequent centroids: probability proportional to squared distance
    for (let i = 1; i < k; i++) {
      const distances = embeddings.map(emb => {
        const minDist = Math.min(
          ...centroids.map(c => 1 - embeddingService.cosineSimilarity(emb, c))
        );
        return minDist * minDist;
      });

      const totalDist = distances.reduce((s, d) => s + d, 0);
      let   threshold = Math.random() * totalDist;

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
   * Assign each memory to its nearest centroid by cosine similarity.
   *
   * @param {object[]}   memories  - must have `.embedding` property
   * @param {number[][]} centroids
   * @returns {number[][]} clusters[k] = array of memory indices
   */
  assignToClusters(memories, centroids) {
    const clusters = Array.from({ length: centroids.length }, () => []);

    for (let i = 0; i < memories.length; i++) {
      const emb = memories[i].embedding;
      let maxSim = -1;
      let best   = 0;

      for (let j = 0; j < centroids.length; j++) {
        const sim = embeddingService.cosineSimilarity(emb, centroids[j]);
        if (sim > maxSim) { maxSim = sim; best = j; }
      }

      clusters[best].push(i);
    }

    return clusters;
  }

  /**
   * Recalculate centroids as the vectorized mean of assigned embeddings.
   * Re-seeds empty clusters with a random memory to prevent degeneration.
   *
   * @param {object[]}   memories
   * @param {number[][]} clusters
   * @param {number}     embeddingDim
   * @returns {number[][]}
   */
  updateCentroids(memories, clusters, embeddingDim) {
    return clusters.map(cluster => {
      if (cluster.length === 0) {
        // Re-seed: pick a random memory
        return [...memories[Math.floor(Math.random() * memories.length)].embedding];
      }

      const centroid = new Array(embeddingDim).fill(0);
      for (const idx of cluster) {
        const emb = memories[idx].embedding;
        for (let i = 0; i < embeddingDim; i++) centroid[i] += emb[i];
      }
      for (let i = 0; i < embeddingDim; i++) centroid[i] /= cluster.length;
      return centroid;
    });
  }

  /**
   * Check if centroids have converged (max movement below threshold).
   *
   * @param {number[][]} oldCentroids
   * @param {number[][]} newCentroids
   * @returns {boolean}
   */
  hasConverged(oldCentroids, newCentroids) {
    let maxMovement = 0;
    for (let i = 0; i < oldCentroids.length; i++) {
      const movement = 1 - embeddingService.cosineSimilarity(oldCentroids[i], newCentroids[i]);
      if (movement > maxMovement) maxMovement = movement;
    }
    return maxMovement < KMEANS_CONVERGENCE_THRESHOLD;
  }

  /**
   * Run k-means clustering with k-means++ initialisation and early stopping.
   *
   * @param {object[]} memories - must have `.embedding`
   * @param {number}   k
   * @returns {{ centroids: number[][], clusters: number[][], iterations: number }}
   */
  performKMeansClustering(memories, k) {
    if (memories.length < k) k = Math.max(2, Math.floor(memories.length / 3));

    const embeddingDim = memories[0].embedding.length;
    let centroids = this.initializeCentroids(memories.map(m => m.embedding), k);

    let iteration = 0;
    let converged = false;

    while (iteration < MAX_KMEANS_ITERATIONS && !converged) {
      const clusters     = this.assignToClusters(memories, centroids);
      const newCentroids = this.updateCentroids(memories, clusters, embeddingDim);
      converged  = this.hasConverged(centroids, newCentroids);
      centroids  = newCentroids;
      iteration++;
    }

    logger.debug(`K-means converged in ${iteration} iterations for k=${k}`);
    return {
      centroids,
      clusters:   this.assignToClusters(memories, centroids),
      iterations: iteration
    };
  }

  // ==========================================================================
  // CLUSTER BUILDING
  // ==========================================================================

  /**
   * Build and cache clusters for a history from scratch.
   * Returns null if there aren't enough memories yet.
   *
   * @param {string} historyId
   * @returns {Promise<object|null>}
   */
  async buildClusters(historyId) {
    try {
      const memories = await db.getMemoryEntries(historyId, 1000);

      if (!memories || memories.length < MIN_MEMORIES_FOR_CLUSTERING) {
        logger.debug(
          `Not enough memories for clustering (${memories?.length ?? 0}/${MIN_MEMORIES_FOR_CLUSTERING})`
        );
        return null;
      }

      const validMemories = memories.filter(
        m => m.embedding && Array.isArray(m.embedding) && m.embedding.length > 0
      );

      if (validMemories.length < MIN_MEMORIES_FOR_CLUSTERING) {
        logger.debug('Not enough valid embeddings for clustering');
        return null;
      }

      logger.debug(`Building clusters for ${historyId} (${validMemories.length} memories)`);

      const k             = Math.min(NUM_CLUSTERS, Math.floor(validMemories.length / 3));
      const clusterResult = this.performKMeansClustering(validMemories, k);

      const clusterData = {
        centroids:   clusterResult.centroids,
        // Store original DB IDs (or fallback to position index)
        clusters:    clusterResult.clusters.map(cluster =>
          cluster.map(idx => validMemories[idx]._id || idx)
        ),
        lastUpdate:  Date.now(),
        memoryCount: validMemories.length,
        iterations:  clusterResult.iterations
      };

      this.clusterCache.set(historyId, clusterData);
      this.lastClusterUpdate.set(historyId, validMemories.length);

      return clusterData;
    } catch (error) {
      logger.error(`Clustering failed for ${historyId}`, error);
      return null;
    }
  }

  /**
   * Non-blocking background cluster rebuild.
   * Guards against concurrent rebuilds with `clusteringInProgress`.
   *
   * @param {string} historyId
   * @returns {Promise<void>}
   */
  async buildClustersInBackground(historyId) {
    if (this.clusteringInProgress.get(historyId)) {
      logger.debug(`Clustering already in progress for ${historyId}`);
      return;
    }

    this.clusteringInProgress.set(historyId, true);
    try {
      logger.debug(`Starting background clustering for ${historyId}`);
      await this.buildClusters(historyId);
      logger.debug(`Background clustering completed for ${historyId}`);
    } catch (error) {
      logger.error(`Background clustering failed for ${historyId}`, error);
    } finally {
      this.clusteringInProgress.set(historyId, false);
    }
  }

  /**
   * Get clusters for a history, using cache where possible.
   *
   * Strategy (non-blocking by design):
   * 1. Cache fresh (< TTL)       → return immediately
   * 2. Cache stale (< 2×TTL)     → return immediately + trigger background rebuild
   * 3. Cache too old / missing   → build synchronously (first-time only)
   *
   * BUG FIX (original): the original fetched `db.getMemoryEntries(historyId, 1)`
   * and used `memories.length` (always 1!) as `currentCount`. The TTL-based
   * staleness check used here avoids that incorrect DB call entirely.
   *
   * @param {string} historyId
   * @returns {Promise<object|null>}
   */
  async getClusters(historyId) {
    const cached = this.clusterCache.get(historyId);
    const now    = Date.now();

    if (cached) {
      const cacheAge = now - cached.lastUpdate;

      if (cacheAge < CLUSTER_CACHE_TTL_MS) {
        // Fresh — serve immediately
        return cached;
      }

      if (cacheAge < CLUSTER_CACHE_TTL_MS * 2) {
        // Stale but usable — serve immediately, rebuild in background
        if (!this.clusteringInProgress.get(historyId)) {
          logger.debug(`Stale cluster cache for ${historyId} — triggering background rebuild`);
          this.buildClustersInBackground(historyId).catch(err =>
            logger.error('Background clustering error', err)
          );
        }
        return cached;
      }
    }

    // No cache or too old — build synchronously
    logger.debug(cached
      ? `Cache too old for ${historyId}, rebuilding synchronously`
      : `No cache for ${historyId}, building clusters`
    );
    return await this.buildClusters(historyId);
  }

  // ==========================================================================
  // SEARCH
  // ==========================================================================

  /**
   * Score cluster centroids against a query and return the top-N most similar.
   *
   * @param {number[]}   queryEmbedding
   * @param {number[][]} centroids
   * @returns {Array<{ clusterId: number, similarity: number }>}
   */
  findRelevantClusters(queryEmbedding, centroids) {
    return embeddingService
      .calculateSimilaritiesBatch(queryEmbedding, centroids)
      .map((similarity, idx) => ({ clusterId: idx, similarity }))
      .filter(c => c.similarity >= MIN_CLUSTER_SIMILARITY)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, TOP_CLUSTERS_TO_SEARCH);
  }

  /**
   * Search all relevant clusters in parallel and return the top scored memories.
   *
   * @param {number[]}   queryEmbedding
   * @param {Array<{ clusterId: number, similarity: number, memoryIndices: number[] }>} relevantClusters
   * @param {object[]}   allMemories
   * @returns {Promise<object[]>}
   */
  async searchWithinClustersParallel(queryEmbedding, relevantClusters, allMemories) {
    const clusterResults = await Promise.all(
      relevantClusters.map(async cluster => {
        const clusterMemories = allMemories.filter((_, idx) =>
          cluster.memoryIndices.includes(idx)
        );
        if (clusterMemories.length === 0) return [];

        const embeddings   = clusterMemories.map(m => m.embedding);
        const similarities = embeddingService.calculateSimilaritiesBatch(queryEmbedding, embeddings);

        return clusterMemories
          .map((memory, idx) => ({
            ...memory,
            similarity: similarities[idx],
            clusterId:  cluster.clusterId
          }))
          .filter(m => m.similarity >= MIN_SIMILARITY_THRESHOLD)
          .sort((a, b) => b.similarity - a.similarity)
          .slice(0, MAX_MEMORIES_PER_CLUSTER);
      })
    );

    return clusterResults
      .flat()
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, MAX_RAG_RESULTS)
      .map(r => ({
        messages:  r.messages,
        score:     r.similarity,
        source:    'conversation-history',
        timestamp: r.timestamp,
        clusterId: r.clusterId
      }));
  }

  /**
   * Hierarchical clustered search with automatic fallback to standard search.
   *
   * @param {string}  historyId
   * @param {number[]} queryEmbedding
   * @param {number}  cutoffTimestamp  - exclude memories newer than this
   * @returns {Promise<object[]>}
   */
  async clusterSearch(historyId, queryEmbedding, cutoffTimestamp) {
    try {
      const [clusterData, allMemories] = await Promise.all([
        this.getClusters(historyId),
        db.getMemoryEntries(historyId, 1000)
      ]);

      if (!clusterData) {
        return await this.standardVectorSearch(historyId, queryEmbedding, cutoffTimestamp);
      }

      const relevantClusters = this.findRelevantClusters(queryEmbedding, clusterData.centroids);
      if (relevantClusters.length === 0) return [];

      const validMemories = allMemories.filter(m =>
        m.embedding &&
        Array.isArray(m.embedding) &&
        (m.timestamp || 0) < cutoffTimestamp
      );

      const clustersWithIndices = relevantClusters.map(c => ({
        clusterId:     c.clusterId,
        similarity:    c.similarity,
        memoryIndices: clusterData.clusters[c.clusterId] || []
      }));

      return await this.searchWithinClustersParallel(queryEmbedding, clustersWithIndices, validMemories);
    } catch (error) {
      logger.error('Cluster search failed', error);
      return await this.standardVectorSearch(historyId, queryEmbedding, cutoffTimestamp);
    }
  }

  /**
   * Standard vector search — tries DB-native vector search first, falls back
   * to in-process vectorized similarity computation.
   *
   * @param {string}  historyId
   * @param {number[]} queryEmbedding
   * @param {number}  cutoffTimestamp
   * @returns {Promise<object[]>}
   */
  async standardVectorSearch(historyId, queryEmbedding, cutoffTimestamp) {
    try {
      // Attempt DB-native vector search (indexed, fast)
      const dbResults = await db.findSimilarMemories(historyId, queryEmbedding, MAX_RAG_RESULTS * 2);

      if (dbResults?.length > 0) {
        return dbResults
          .filter(e => (e.timestamp || 0) < cutoffTimestamp && e.score >= MIN_SIMILARITY_THRESHOLD)
          .slice(0, MAX_RAG_RESULTS)
          .map(e => ({
            messages:  e.messages,
            score:     e.score,
            source:    'conversation-history',
            timestamp: e.timestamp
          }));
      }

      // Fallback: in-process vectorized search
      const memoryEntries = await db.getMemoryEntries(historyId);
      if (!memoryEntries?.length) return [];

      const validEntries = memoryEntries.filter(e =>
        e.embedding && Array.isArray(e.embedding) && (e.timestamp || 0) < cutoffTimestamp
      );
      if (validEntries.length === 0) return [];

      const similarities = embeddingService.calculateSimilaritiesBatch(
        queryEmbedding,
        validEntries.map(e => e.embedding)
      );

      return validEntries
        .map((entry, idx) => ({ ...entry, similarity: similarities[idx] }))
        .filter(e => e.similarity >= MIN_SIMILARITY_THRESHOLD)
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, MAX_RAG_RESULTS)
        .map(e => ({
          messages:  e.messages,
          score:     e.similarity,
          source:    'conversation-history',
          timestamp: e.timestamp
        }));
    } catch (error) {
      logger.error('Standard vector search failed', error);
      return [];
    }
  }

  // ==========================================================================
  // DEBUG / ADMIN
  // ==========================================================================

  /**
   * Force a synchronous cluster rebuild (admin/debug only).
   *
   * @param {string} historyId
   * @returns {Promise<object>}
   */
  async forceRebuildClusters(historyId) {
    try {
      this.clusterCache.delete(historyId);
      this.lastClusterUpdate.delete(historyId);

      const result = await this.buildClusters(historyId);
      if (result) {
        return {
          success:    true,
          message:    `Rebuilt ${result.centroids.length} clusters`,
          numClusters: result.centroids.length,
          memoryCount: result.memoryCount,
          iterations:  result.iterations
        };
      }
      return { success: false, message: 'Not enough memories for clustering' };
    } catch (error) {
      logger.error('Force cluster rebuild failed', error);
      return { success: false, message: error.message };
    }
  }

  /**
   * Return serialisable status info for all cached cluster sets.
   *
   * @returns {object[]}
   */
  getStatus() {
    return Array.from(this.clusterCache.entries()).map(([historyId, data]) => ({
      historyId,
      numClusters:             data.centroids.length,
      memoryCount:             data.memoryCount,
      lastUpdate:              new Date(data.lastUpdate).toISOString(),
      cacheAge:                Math.floor((Date.now() - data.lastUpdate) / 1000) + 's',
      iterations:              data.iterations,
      rebuildingInBackground:  this.clusteringInProgress.get(historyId) || false
    }));
  }

  /** Clear all cluster caches. */
  clearCache() {
    this.clusterCache.clear();
    this.lastClusterUpdate.clear();
    this.clusteringInProgress.clear();
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

export const clusterEngine = new ClusterEngine();
