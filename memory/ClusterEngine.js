/**
 * @fileoverview K-means++ clustering engine for hierarchical memory search.
 *               Manages cluster building (sync + background), caching, and
 *               both clustered and fallback standard vector searches.
 * @module memory/ClusterEngine
 */

import { LRUCache } from 'lru-cache';
import * as db from '../database/index.js';
import { Logger } from '../core/Logger.js';
import { embeddingService, truncateForCentroid } from './EmbeddingService.js';

const logger = Logger.get('ClusterEngine');

// ============================================================================
// CONSTANTS
// ============================================================================

const MAX_CLUSTERS                = 20;  // was 50 — fewer centroids, less RAM per cluster set
const NUM_CLUSTERS                = 5;   // was 8  — baseline minimum
const MIN_MEMORIES_FOR_CLUSTERING = 150; // was 240 — cluster sooner, search better earlier
const TOP_CLUSTERS_TO_SEARCH      = 2;   // was 3
const MIN_CLUSTER_SIMILARITY      = 0.45;
const RECLUSTERING_INTERVAL       = 150; // was 100 — rebuild less frequently
const MAX_KMEANS_ITERATIONS       = 10;  // was 15 — faster convergence check
const KMEANS_CONVERGENCE_THRESHOLD = 0.001;
const CLUSTER_CACHE_TTL_MS       = 15 * 60 * 1000; // was 10 min — keep longer, rebuild less
const MAX_MEMORIES_PER_CLUSTER   = 8;   // was 10
const MAX_RAG_RESULTS            = 3;
const MIN_SIMILARITY_THRESHOLD   = 0.65;

/** How long lean embeddings stay cached before a background DB refresh.
 *  Kept short so new memories appear within ~2 min without waiting for invalidation. */
const EMBEDDINGS_CACHE_TTL_MS    = 2 * 60 * 1000;  // 2 minutes

/**
 * Embedding load strategy constants.
 *
 * Two completely separate code paths — different DB queries, different cache keys:
 *
 *   'cluster' mode  — uses getMemoryEmbeddingsSampled():
 *     Stratified time-bucket sampling. Divides the full history into
 *     CLUSTER_TIME_BUCKETS equal eras and draws CLUSTER_SAMPLE / CLUSTER_TIME_BUCKETS
 *     entries from each. Old memories are guaranteed representation — centroid
 *     quality does not degrade as history grows. (HCAT/Grootendorst 2022 pattern)
 *
 *   'fallback' mode — uses getMemoryEmbeddings() (recent-first):
 *     Only runs when $vectorSearch is unavailable (MongoDB vector index down).
 *     Recent-only is acceptable here — it is an emergency path, not the main
 *     retrieval path. 50 entries is more than enough to surface top-3 results.
 */
const EMBEDDING_LIMITS = Object.freeze({
  // ⚠️ RAM BUDGET: each embedding ≈ 12 KB (1536 floats × 8 bytes)
  // CLUSTER_SAMPLE × 12 KB × embeddingsCache.max = total RAM for embeddings
  // 300 × 12 KB × 15 users ≈ 54 MB — safe for 512 MB deployments
  // Old values (2000 × 200 users) caused ~4.9 GB OOM crashes — do not raise.
  CLUSTER_SAMPLE:       300,   // was 2_000
  CLUSTER_TIME_BUCKETS: 6,     // was 20 (proportional: 6 strata × 50 entries = 300)
  FALLBACK_SEARCH:      30,    // was 50
});

// ============================================================================
// CLUSTER ENGINE
// ============================================================================

class ClusterEngine {
  constructor() {
    /** @type {LRUCache<string, object>} historyId → { centroids, clusters, lastUpdate, memoryCount, iterations }
     *  max: 50 — centroids are small (~50 × 256-dim truncated = ~100 KB/user), 50 users ≈ 5 MB */
    this.clusterCache         = new LRUCache({ max: 50 });
    /** @type {Map<string, number>} historyId → memoryCount at last clustering */
    this.lastClusterUpdate    = new Map();
    /** @type {Map<string, boolean>} historyId → background rebuild in progress */
    this.clusteringInProgress = new Map();
    /** @type {LRUCache<string, { entries: Array, fetchedAt: number }>} historyId → lean embedding docs
     *  max: 15 — each entry ≈ 3.7 MB (300 embeddings × 12 KB). 15 users ≈ 55 MB total.
     *  ⚠️ DO NOT raise this without understanding the RAM budget. Old value of 200 caused OOM. */
    this.embeddingsCache      = new LRUCache({ max: 15 });
  }

  // ==========================================================================
  // K-MEANS ALGORITHMS
  // ==========================================================================

  /**
   * K-means++ centroid initialisation — better spread than random.
   * Uses calculateSimilaritiesBatch for the distance computation so all
   * centroid comparisons per memory happen in a single vectorised pass.
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
      // Batch all centroid similarities for every embedding at once
      const distances = embeddings.map(emb => {
        const sims   = embeddingService.calculateSimilaritiesBatch(emb, centroids);
        const minDist = 1 - Math.max(...sims);   // cosine distance = 1 - max_similarity
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
   * Uses calculateSimilaritiesBatch per memory so all centroid comparisons
   * happen in a single vectorised pass — eliminates the inner centroid loop.
   *
   * @param {object[]}   memories  - must have `.embedding` property
   * @param {number[][]} centroids
   * @returns {number[][]} clusters[k] = array of memory indices
   */
  assignToClusters(memories, centroids) {
    const clusters = Array.from({ length: centroids.length }, () => []);

    for (let i = 0; i < memories.length; i++) {
      // Single batch call replaces the inner per-centroid cosineSimilarity loop
      const sims = embeddingService.calculateSimilaritiesBatch(memories[i].embedding, centroids);
      let best   = 0;
      let maxSim = -1;
      for (let j = 0; j < sims.length; j++) {
        if (sims[j] > maxSim) { maxSim = sims[j]; best = j; }
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
      // Stratified time-bucket sample — every era of the conversation is represented.
      const memories = await this.getMemoryEmbeddingsCached(historyId, 'cluster');

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

      // Auto-scale: 1 cluster per 50 memories, between NUM_CLUSTERS and MAX_CLUSTERS.
      // Smaller clusters mean fewer members scanned per query while keeping all
      // memories reachable regardless of age — similarity finds old memories fine.
      // Examples: 240→8, 1000→20, 2500→50 (capped), 10000→50 (capped)
      const k = Math.min(MAX_CLUSTERS, Math.max(NUM_CLUSTERS, Math.floor(validMemories.length / 50)));

      logger.debug(`Building clusters for ${historyId} (${validMemories.length} memories, k=${k})`);

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
  // EMBEDDINGS CACHE
  // ==========================================================================

  /**
   * Return lean embedding docs for a history, served from in-memory LRU cache when fresh.
   *
   * Two modes — completely separate DB queries and cache entries:
   *
   *   'cluster'  → db.getMemoryEmbeddingsSampled()
   *     Stratified time-bucket sample. Every era of conversation contributes equally
   *     to clustering. Old memories are never silently excluded from centroids.
   *     Cache key: `${historyId}:cluster`
   *
   *   'fallback' → db.getMemoryEmbeddings() (recent-first, small window)
   *     Used only when $vectorSearch is unavailable. Recent-only is acceptable
   *     for this emergency path.
   *     Cache key: `${historyId}:fallback`
   *
   * Cache is invalidated by invalidateEmbeddingsCache() immediately after any
   * new memory write — both mode variants are evicted together.
   *
   * @param {string} historyId
   * @param {'cluster'|'fallback'} [mode='cluster']
   * @returns {Promise<Array<{ _id, embedding: number[], timestamp: number }>>}
   */
  async getMemoryEmbeddingsCached(historyId, mode = 'cluster') {
    const cacheKey = `${historyId}:${mode}`;
    const cached   = this.embeddingsCache.get(cacheKey);

    if (cached && (Date.now() - cached.fetchedAt) < EMBEDDINGS_CACHE_TTL_MS) {
      return cached.entries;
    }

    const entries = mode === 'cluster'
      ? await db.getMemoryEmbeddingsSampled(
          historyId,
          EMBEDDING_LIMITS.CLUSTER_SAMPLE,
          EMBEDDING_LIMITS.CLUSTER_TIME_BUCKETS
        )
      : await db.getMemoryEmbeddings(historyId, EMBEDDING_LIMITS.FALLBACK_SEARCH);

    this.embeddingsCache.set(cacheKey, { entries, fetchedAt: Date.now() });
    return entries;
  }

  /**
   * Bust ALL cached embedding variants for a history (both 'cluster' and 'fallback').
   * Called by MemoryStore immediately after saving a new memory entry.
   *
   * @param {string} historyId
   */
  invalidateEmbeddingsCache(historyId) {
    this.embeddingsCache.delete(`${historyId}:cluster`);
    this.embeddingsCache.delete(`${historyId}:fallback`);
  }

  // ==========================================================================
  // SEARCH
  // ==========================================================================

  /**
   * Score cluster centroids against a query and return the top-N most similar.
   * Full-dimension comparison — truncation was negligible at ≤20 centroids and
   * has been removed to avoid quality loss at 3072-dim embeddings.
   * TOP_CLUSTERS_TO_SEARCH scales with total cluster count so larger histories
   * still get proportional coverage.
   *
   * @param {number[]}   queryEmbedding
   * @param {number[][]} centroids
   * @returns {Array<{ clusterId: number, similarity: number }>}
   */
  findRelevantClusters(queryEmbedding, centroids) {
    // Search ~20% of clusters — scales from 3 (at 8 clusters) to 10 (at 50 clusters).
    const topN = Math.max(TOP_CLUSTERS_TO_SEARCH, Math.ceil(centroids.length * 0.20));

    // MRL first-pass: truncate both query and centroids to 256-dim for coarse ranking.
    // 12× faster than full 3072-dim comparison. Precision loss is acceptable here —
    // this pass only identifies candidate clusters; searchWithinClustersParallel
    // re-ranks with full vectors for accurate final scoring.
    const shortQuery    = truncateForCentroid(queryEmbedding);
    const shortCentroids = centroids.map(c => truncateForCentroid(c));

    return embeddingService
      .calculateSimilaritiesBatch(shortQuery, shortCentroids)
      .map((similarity, idx) => ({ clusterId: idx, similarity }))
      .filter(c => c.similarity >= MIN_CLUSTER_SIMILARITY)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, topN);
  }

  /**
   * Search all relevant clusters in parallel and return ranked stubs.
   * Uses full 1536-dim vectors for accurate final re-ranking (MRL second pass).
   * Returns lightweight stubs { _id, similarity, clusterId } — full document
   * hydration is deferred to clusterSearch via getMemoryEntriesByIds.
   *
   * @param {number[]}   queryEmbedding - Full 1536-dim query vector
   * @param {Array<{ clusterId: number, similarity: number, memoryIndices: number[] }>} relevantClusters
   * @param {Array<{ _id, embedding: number[], timestamp: number }>} allEmbeddings - Lean docs
   * @returns {Promise<Array<{ _id, similarity: number, clusterId: number }>>}
   */
  async searchWithinClustersParallel(queryEmbedding, relevantClusters, allEmbeddings) {
    const clusterResults = await Promise.all(
      relevantClusters.map(async cluster => {
        // O(1) Set lookup instead of O(m) Array.includes per entry
        const indexSet       = new Set(cluster.memoryIndices);
        const clusterEntries = allEmbeddings.filter((_, idx) => indexSet.has(idx));
        if (clusterEntries.length === 0) return [];

        // Full 1536-dim vectors for accurate final scoring
        const embeddings   = clusterEntries.map(m => m.embedding);
        const similarities = embeddingService.calculateSimilaritiesBatch(queryEmbedding, embeddings);

        return clusterEntries
          .map((entry, idx) => ({
            _id:       entry._id,
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
      .slice(0, MAX_RAG_RESULTS);
  }

  /**
   * Hierarchical clustered search with automatic fallback to standard search.
   *
   * Two-phase DB strategy (avoids loading 1000 full documents per query):
   *   Phase 1 — getMemoryEmbeddings: fetch only _id + embedding + timestamp (~10-20× smaller payload)
   *   Phase 2 — getMemoryEntriesByIds: hydrate only the final MAX_RAG_RESULTS winners with full docs
   *
   * @param {string}  historyId
   * @param {number[]} queryEmbedding
   * @param {number}  cutoffTimestamp  - exclude memories newer than this
   * @returns {Promise<object[]>}
   */
  async clusterSearch(historyId, queryEmbedding, cutoffTimestamp) {
    try {
      const [clusterData, allEmbeddings] = await Promise.all([
        this.getClusters(historyId),
        this.getMemoryEmbeddingsCached(historyId, 'cluster')
      ]);

      if (!clusterData) {
        return await this.standardVectorSearch(historyId, queryEmbedding, cutoffTimestamp);
      }

      const relevantClusters = this.findRelevantClusters(queryEmbedding, clusterData.centroids);
      if (relevantClusters.length === 0) return [];

      // Filter to valid, non-recent entries using the lean embedding docs
      const validEmbeddings = allEmbeddings.filter(m =>
        m.embedding &&
        Array.isArray(m.embedding) &&
        (m.timestamp || 0) < cutoffTimestamp
      );

      const clustersWithIndices = relevantClusters.map(c => ({
        clusterId:     c.clusterId,
        similarity:    c.similarity,
        memoryIndices: clusterData.clusters[c.clusterId] || []
      }));

      // searchWithinClustersParallel now returns { _id, similarity, clusterId } stubs
      const rankedStubs = await this.searchWithinClustersParallel(
        queryEmbedding, clustersWithIndices, validEmbeddings
      );

      if (rankedStubs.length === 0) return [];

      // Phase 2: hydrate only the winners — fetch full docs for MAX_RAG_RESULTS entries
      const winnerIds  = rankedStubs.map(r => r._id).filter(Boolean);
      const fullDocs   = await db.getMemoryEntriesByIds(winnerIds);
      const docById    = new Map(fullDocs.map(d => [String(d._id), d]));

      return rankedStubs
        .map(stub => {
          const doc = docById.get(String(stub._id));
          if (!doc) return null;
          return {
            messages:  doc.messages,
            score:     stub.similarity,
            source:    'conversation-history',
            timestamp: doc.timestamp,
            clusterId: stub.clusterId
          };
        })
        .filter(Boolean);

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

      // Fallback: in-process similarity search.
      // Uses a small recent window — $vectorSearch handles real queries server-side.
      const leanEntries = await this.getMemoryEmbeddingsCached(historyId, 'fallback');
      if (!leanEntries?.length) return [];

      const validEntries = leanEntries.filter(e =>
        e.embedding && Array.isArray(e.embedding) && (e.timestamp || 0) < cutoffTimestamp
      );
      if (validEntries.length === 0) return [];

      const similarities = embeddingService.calculateSimilaritiesBatch(
        queryEmbedding,
        validEntries.map(e => e.embedding)
      );

      const winnerIds = validEntries
        .map((entry, idx) => ({ _id: entry._id, similarity: similarities[idx] }))
        .filter(e => e.similarity >= MIN_SIMILARITY_THRESHOLD)
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, MAX_RAG_RESULTS);

      if (winnerIds.length === 0) return [];

      // Hydrate only the winners
      const fullDocs = await db.getMemoryEntriesByIds(winnerIds.map(w => w._id));
      const docById  = new Map(fullDocs.map(d => [String(d._id), d]));

      return winnerIds
        .map(w => {
          const doc = docById.get(String(w._id));
          if (!doc) return null;
          return {
            messages:  doc.messages,
            score:     w.similarity,
            source:    'conversation-history',
            timestamp: doc.timestamp
          };
        })
        .filter(Boolean);

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

  /** Clear all cluster and embeddings caches. */
  clearCache() {
    this.clusterCache.clear();
    this.lastClusterUpdate.clear();
    this.clusteringInProgress.clear();
    this.embeddingsCache.clear();
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

export const clusterEngine = new ClusterEngine();
