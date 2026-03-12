/**
 * @fileoverview Embedding generation with LRU caching and batch parallel processing.
 *               All vector math lives here — cosineSimilarity, batch similarity.
 * @module memory/EmbeddingService
 */

import { genAI } from '../managers/BotManager.js';
import { Logger } from '../core/Logger.js';

const logger = Logger.get('EmbeddingService');

// ============================================================================
// CONSTANTS
// ============================================================================

const EMBEDDING_MODEL          = 'gemini-embedding-2-preview';
const MAX_EMBEDDING_CACHE_SIZE = 1000;
const MAX_CONCURRENT_EMBEDDINGS = 5;

// ============================================================================
// EMBEDDING SERVICE
// ============================================================================

class EmbeddingService {
  constructor() {
    /** @type {Map<string, number[]>} LRU cache: cacheKey → embedding vector */
    this.embeddingCache = new Map();
  }

  // ── Single embedding ──────────────────────────────────────────────────────

  /**
   * Generate an embedding for a text string, returning from cache when possible.
   *
   * @param {string} text
   * @param {string} [taskType] - 'RETRIEVAL_DOCUMENT' | 'RETRIEVAL_QUERY'
   * @returns {Promise<number[]|null>}
   */
  async generateEmbedding(text, taskType = 'RETRIEVAL_DOCUMENT') {
    if (!text || typeof text !== 'string' || text.trim().length === 0) return null;

    const cacheKey = `${text.slice(0, 100)}_${taskType}`;
    if (this.embeddingCache.has(cacheKey)) return this.embeddingCache.get(cacheKey);

    try {
      const result = await genAI.models.embedContent({
        model:    EMBEDDING_MODEL,
        contents: text,
        config:   { taskType }
      });

      const embedding = result.embeddings?.[0]?.values;
      if (!embedding || !Array.isArray(embedding)) return null;

      this._cacheSet(cacheKey, embedding);
      return embedding;
    } catch (error) {
      logger.error('Embedding generation failed', error);
      return null;
    }
  }

  // ── Batch embeddings ──────────────────────────────────────────────────────

  /**
   * Generate embeddings for multiple texts with controlled parallel concurrency.
   * Cache hits are resolved without hitting the API.
   *
   * @param {string[]} texts
   * @param {string}   [taskType]
   * @returns {Promise<Array<number[]|null>>} - same length/order as input
   */
  async generateEmbeddingsBatch(texts, taskType = 'RETRIEVAL_DOCUMENT') {
    if (!texts?.length) return [];

    const results    = new Array(texts.length).fill(null);
    const toGenerate = [];

    // Pass 1: resolve cache hits
    for (let i = 0; i < texts.length; i++) {
      const text = texts[i];
      if (!text || typeof text !== 'string' || text.trim().length === 0) continue;

      const cacheKey = `${text.slice(0, 100)}_${taskType}`;
      if (this.embeddingCache.has(cacheKey)) {
        results[i] = this.embeddingCache.get(cacheKey);
      } else {
        toGenerate.push({ index: i, text, cacheKey });
      }
    }

    if (toGenerate.length === 0) return results;

    // Pass 2: generate missing embeddings in parallel batches
    for (let i = 0; i < toGenerate.length; i += MAX_CONCURRENT_EMBEDDINGS) {
      const batch        = toGenerate.slice(i, i + MAX_CONCURRENT_EMBEDDINGS);
      const batchResults = await Promise.allSettled(
        batch.map(async ({ index, text, cacheKey }) => {
          try {
            const result = await genAI.models.embedContent({
              model:    EMBEDDING_MODEL,
              contents: text,
              config:   { taskType }
            });
            const embedding = result.embeddings?.[0]?.values;
            if (embedding && Array.isArray(embedding)) {
              this._cacheSet(cacheKey, embedding);
              return { index, embedding };
            }
            return { index, embedding: null };
          } catch (err) {
            logger.error(`Batch embedding failed for index ${index}`, err);
            return { index, embedding: null };
          }
        })
      );

      for (const res of batchResults) {
        if (res.status === 'fulfilled' && res.value) {
          results[res.value.index] = res.value.embedding;
        }
      }
    }

    return results;
  }

  // ── Vector math ───────────────────────────────────────────────────────────

  /**
   * Cosine similarity between two equal-length vectors.
   *
   * @param {number[]} a
   * @param {number[]} b
   * @returns {number} 0–1
   */
  cosineSimilarity(a, b) {
    if (!a || !b || a.length !== b.length) return 0;

    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < a.length; i++) {
      dot   += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    return denom === 0 ? 0 : dot / denom;
  }

  /**
   * Vectorized batch cosine similarity.
   * Pre-computes the query norm once for O(n·d) total work.
   *
   * @param {number[]}   queryEmbedding
   * @param {number[][]} embeddings
   * @returns {number[]} similarity score per embedding
   */
  calculateSimilaritiesBatch(queryEmbedding, embeddings) {
    if (!queryEmbedding || !embeddings?.length) return [];

    // Pre-compute query norm once
    let queryNorm = 0;
    for (let i = 0; i < queryEmbedding.length; i++) {
      queryNorm += queryEmbedding[i] * queryEmbedding[i];
    }
    queryNorm = Math.sqrt(queryNorm);

    return embeddings.map(embedding => {
      if (!embedding || embedding.length !== queryEmbedding.length) return 0;

      let dot = 0, embNorm = 0;
      for (let i = 0; i < queryEmbedding.length; i++) {
        dot     += queryEmbedding[i] * embedding[i];
        embNorm += embedding[i] * embedding[i];
      }

      embNorm = Math.sqrt(embNorm);
      const denom = queryNorm * embNorm;
      return denom === 0 ? 0 : dot / denom;
    });
  }

  // ── Cache helpers ─────────────────────────────────────────────────────────

  /** LRU insert with size cap. */
  _cacheSet(key, value) {
    this.embeddingCache.set(key, value);
    if (this.embeddingCache.size > MAX_EMBEDDING_CACHE_SIZE) {
      // Evict oldest (Map preserves insertion order)
      this.embeddingCache.delete(this.embeddingCache.keys().next().value);
    }
  }

  /** Clear the embedding cache. */
  clearCache() {
    this.embeddingCache.clear();
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

export const embeddingService = new EmbeddingService();
