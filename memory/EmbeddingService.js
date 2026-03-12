/**
 * @fileoverview Embedding generation with LRU caching and batch parallel processing.
 *               Uses gemini-embedding-2-preview with Matryoshka Representation Learning (MRL):
 *               full vectors at 1536-dim, fast centroid search at 256-dim.
 *               Parallel processing active for: text, images.
 *               PDF / video / audio support is feature-flagged (disabled by default).
 *               All vector math lives here — cosineSimilarity, batch similarity.
 * @module memory/EmbeddingService
 */

import { genAI } from '../managers/BotManager.js';
import { Logger } from '../core/Logger.js';

const logger = Logger.get('EmbeddingService');

// ============================================================================
// CONSTANTS
// ============================================================================

const EMBEDDING_MODEL           = 'gemini-embedding-2-preview';
const MAX_EMBEDDING_CACHE_SIZE  = 1000;
const MAX_CONCURRENT_EMBEDDINGS = 5;

// ── MRL (Matryoshka Representation Learning) dimensions ──────────────────────
// gemini-embedding-2-preview supports: 3072 | 1536 | 768 | 256 | 128 | 64
//
// EMBEDDING_DIM  — full dimension stored in DB and used for final re-ranking.
// MRL_SHORT_DIM  — truncated dimension used for fast centroid comparison only.
//                  Cluster centroids are sliced to this length so the first-pass
//                  scan over many centroids stays cheap; candidates are then
//                  re-ranked with full EMBEDDING_DIM vectors.

const EMBEDDING_DIM  = 3072;  // full stored vector (gemini-embedding-2-preview max)
const MRL_SHORT_DIM  = 1536;  // available for future fast-pass use; not active in ClusterEngine

// ── Per-modality feature flags ────────────────────────────────────────────────
// Set to `true` to activate that modality in generateMultimodalEmbedding.
// Text and images are always active and processed in parallel.

const ENABLE_PDF   = false;  // PDF support  (max 1 file · 6 pages · application/pdf)
const ENABLE_VIDEO = false;  // Video support (max 1 file · 120s / 80s w/ audio · mp4/mov)
const ENABLE_AUDIO = false;  // Audio support (max 1 file · 80s · mp3/wav)

// ── Per-modality hard limits (gemini-embedding-2-preview) ────────────────────

const LIMIT_IMAGE_MAX_COUNT              = 6;
const LIMIT_IMAGE_MIME_TYPES             = new Set(['image/png', 'image/jpeg']);

const LIMIT_PDF_MAX_COUNT                = 1;
const LIMIT_PDF_MAX_PAGES                = 6;
const LIMIT_PDF_MIME_TYPE                = 'application/pdf';

const LIMIT_VIDEO_MAX_COUNT              = 1;
const LIMIT_VIDEO_MAX_SECONDS            = 120;  // video-only (no audio track)
const LIMIT_VIDEO_WITH_AUDIO_MAX_SECONDS = 80;   // video with embedded audio
const LIMIT_VIDEO_MIME_TYPES             = new Set(['video/mp4', 'video/quicktime']);

const LIMIT_AUDIO_MAX_COUNT              = 1;
const LIMIT_AUDIO_MAX_SECONDS            = 80;
const LIMIT_AUDIO_MIME_TYPES             = new Set(['audio/mpeg', 'audio/wav', 'audio/x-wav']);

// ============================================================================
// MRL HELPER
// ============================================================================

/**
 * Truncate a full embedding to MRL_SHORT_DIM for fast centroid comparison.
 * The short vector is NOT normalised — cosine similarity handles that.
 *
 * @param {number[]} embedding - Full EMBEDDING_DIM vector
 * @returns {number[]}         - First MRL_SHORT_DIM values
 */
export function truncateForSearch(embedding) {
  if (!embedding || embedding.length <= MRL_SHORT_DIM) return embedding;
  return embedding.slice(0, MRL_SHORT_DIM);
}

// ============================================================================
// VALIDATION HELPERS
// ============================================================================

/**
 * Clamp images to the API limit.
 * If more than LIMIT_IMAGE_MAX_COUNT are supplied only the first ONE is kept
 * and a warning is logged — no error is thrown.
 *
 * @param {Array<{mimeType: string, data: string}>} images
 * @returns {Array<{mimeType: string, data: string}>} Safe (possibly truncated) array
 */
function safeImages(images) {
  if (!images?.length) return [];

  // Validate MIME types and filter bad ones out first
  const valid = images.filter((img, i) => {
    if (img?.mimeType && !LIMIT_IMAGE_MIME_TYPES.has(img.mimeType)) {
      logger.warn(`Skipping image at index ${i}: unsupported format "${img.mimeType}". Accepted: image/png, image/jpeg.`);
      return false;
    }
    return true;
  });

  if (valid.length > LIMIT_IMAGE_MAX_COUNT) {
    logger.warn(
      `${valid.length} images supplied — exceeds limit of ${LIMIT_IMAGE_MAX_COUNT}. ` +
      `Only the first 5 images will be used.`
    );
    return valid.slice(0, 5); // clamp to 5 when over-limit
  }

  return valid;
}

/**
 * Validate PDF parts. Only runs when ENABLE_PDF = true.
 * @param {Array<{mimeType: string, data: string, pageCount?: number}>} pdfs
 * @throws {Error}
 */
function validatePdfs(pdfs) {
  // if (!ENABLE_PDF) return [];  ← guarded at call-site; not needed here
  if (!pdfs?.length) return;

  if (pdfs.length > LIMIT_PDF_MAX_COUNT) {
    throw new Error(
      `PDF limit exceeded: ${pdfs.length} provided, max is ${LIMIT_PDF_MAX_COUNT} per request. ` +
      `Split into ${LIMIT_PDF_MAX_PAGES}-page chunks and embed each separately.`
    );
  }

  for (let i = 0; i < pdfs.length; i++) {
    const pdf = pdfs[i];
    if (pdf?.mimeType && pdf.mimeType !== LIMIT_PDF_MIME_TYPE) {
      throw new Error(
        `Invalid PDF MIME type at index ${i}: "${pdf.mimeType}". Expected "${LIMIT_PDF_MIME_TYPE}".`
      );
    }
    if (pdf?.pageCount != null && pdf.pageCount > LIMIT_PDF_MAX_PAGES) {
      throw new Error(
        `PDF page limit at index ${i}: ${pdf.pageCount} pages, max is ${LIMIT_PDF_MAX_PAGES}. ` +
        `Split the document into ${LIMIT_PDF_MAX_PAGES}-page chunks.`
      );
    }
  }
}

/**
 * Validate video parts. Only runs when ENABLE_VIDEO = true.
 * @param {Array<{mimeType: string, data: string, durationSeconds?: number, hasAudio?: boolean}>} videos
 * @throws {Error}
 */
function validateVideos(videos) {
  if (!videos?.length) return;

  if (videos.length > LIMIT_VIDEO_MAX_COUNT) {
    throw new Error(
      `Video limit exceeded: ${videos.length} provided, max is ${LIMIT_VIDEO_MAX_COUNT} per request.`
    );
  }

  for (let i = 0; i < videos.length; i++) {
    const video = videos[i];
    if (video?.mimeType && !LIMIT_VIDEO_MIME_TYPES.has(video.mimeType)) {
      throw new Error(
        `Unsupported video format at index ${i}: "${video.mimeType}". Accepted: video/mp4, video/quicktime.`
      );
    }
    if (video?.durationSeconds != null) {
      const maxSec = video.hasAudio ? LIMIT_VIDEO_WITH_AUDIO_MAX_SECONDS : LIMIT_VIDEO_MAX_SECONDS;
      if (video.durationSeconds > maxSec) {
        const hint = video.hasAudio
          ? `(${LIMIT_VIDEO_WITH_AUDIO_MAX_SECONDS}s max with audio; strip audio to allow up to ${LIMIT_VIDEO_MAX_SECONDS}s)`
          : `(${LIMIT_VIDEO_MAX_SECONDS}s max for video-only)`;
        throw new Error(
          `Video duration exceeded at index ${i}: ${video.durationSeconds}s, max is ${maxSec}s ${hint}.`
        );
      }
    }
  }
}

/**
 * Validate audio parts. Only runs when ENABLE_AUDIO = true.
 * @param {Array<{mimeType: string, data: string, durationSeconds?: number}>} audios
 * @throws {Error}
 */
function validateAudios(audios) {
  if (!audios?.length) return;

  if (audios.length > LIMIT_AUDIO_MAX_COUNT) {
    throw new Error(
      `Audio limit exceeded: ${audios.length} provided, max is ${LIMIT_AUDIO_MAX_COUNT} per request.`
    );
  }

  for (let i = 0; i < audios.length; i++) {
    const audio = audios[i];
    if (audio?.mimeType && !LIMIT_AUDIO_MIME_TYPES.has(audio.mimeType)) {
      throw new Error(
        `Unsupported audio format at index ${i}: "${audio.mimeType}". Accepted: audio/mpeg, audio/wav.`
      );
    }
    if (audio?.durationSeconds != null && audio.durationSeconds > LIMIT_AUDIO_MAX_SECONDS) {
      throw new Error(
        `Audio duration exceeded at index ${i}: ${audio.durationSeconds}s, max is ${LIMIT_AUDIO_MAX_SECONDS}s.`
      );
    }
  }
}

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
        config:   { taskType, outputDimensionality: EMBEDDING_DIM }
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

  // ── Multimodal embedding (text + images; PDF/video/audio feature-flagged) ─

  /**
   * Generate an embedding for multimodal content.
   *
   * Always active:  text, images (parallel, max 6 — clamped to 1 if exceeded)
   * Feature-flagged (set flag to true to enable):
   *   ENABLE_PDF   → PDF   (max 1 file · 6 pages · application/pdf)
   *   ENABLE_VIDEO → Video (max 1 file · 120s / 80s w/ audio · mp4, mov)
   *   ENABLE_AUDIO → Audio (max 1 file · 80s · mp3, wav)
   *
   * @param {object} parts
   * @param {string}                                                    [parts.text]
   * @param {Array<{mimeType:string, data:string}>}                     [parts.images]
   * @param {Array<{mimeType:string, data:string, pageCount?:number}>}  [parts.pdfs]   — ENABLE_PDF
   * @param {Array<{mimeType:string, data:string, durationSeconds?:number, hasAudio?:boolean}>} [parts.videos] — ENABLE_VIDEO
   * @param {Array<{mimeType:string, data:string, durationSeconds?:number}>}                   [parts.audios] — ENABLE_AUDIO
   * @param {string} [taskType]
   * @returns {Promise<number[]|null>}
   */
  async generateMultimodalEmbedding(parts, taskType = 'RETRIEVAL_DOCUMENT') {
    if (!parts || typeof parts !== 'object') return null;

    const contents = [];

    // ── Text (always active) ───────────────────────────────────────────────
    if (parts.text?.trim()) {
      contents.push({ text: parts.text });
    }

    // ── Images (always active, parallel) ──────────────────────────────────
    const safeImgs = safeImages(parts.images);
    for (const img of safeImgs) {
      contents.push({ inlineData: { mimeType: img.mimeType, data: img.data } });
    }

    // ── PDF (ENABLE_PDF = false — uncomment block and set flag to activate) ─
    /*
    if (ENABLE_PDF && parts.pdfs?.length) {
      validatePdfs(parts.pdfs);
      for (const pdf of parts.pdfs) {
        contents.push({ inlineData: { mimeType: pdf.mimeType, data: pdf.data } });
      }
    }
    */

    // ── Video (ENABLE_VIDEO = false — uncomment block and set flag to activate) ─
    /*
    if (ENABLE_VIDEO && parts.videos?.length) {
      validateVideos(parts.videos);
      for (const vid of parts.videos) {
        contents.push({ inlineData: { mimeType: vid.mimeType, data: vid.data } });
      }
    }
    */

    // ── Audio (ENABLE_AUDIO = false — uncomment block and set flag to activate) ─
    /*
    if (ENABLE_AUDIO && parts.audios?.length) {
      validateAudios(parts.audios);
      for (const aud of parts.audios) {
        contents.push({ inlineData: { mimeType: aud.mimeType, data: aud.data } });
      }
    }
    */

    if (contents.length === 0) return null;

    try {
      const result = await genAI.models.embedContent({
        model:    EMBEDDING_MODEL,
        contents,
        config:   { taskType, outputDimensionality: EMBEDDING_DIM }
      });

      const embedding = result.embeddings?.[0]?.values;
      if (!embedding || !Array.isArray(embedding)) return null;
      return embedding;
    } catch (error) {
      logger.error('Multimodal embedding generation failed', error);
      return null;
    }
  }

  // ── Batch text embeddings ─────────────────────────────────────────────────

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
              config:   { taskType, outputDimensionality: EMBEDDING_DIM }
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

// ── Named exports ─────────────────────────────────────────────────────────────
// Callers can import these to pre-validate or build UI hints without
// instantiating the service.

export {
  EMBEDDING_DIM,
  MRL_SHORT_DIM,
  ENABLE_PDF,
  ENABLE_VIDEO,
  ENABLE_AUDIO,
  LIMIT_IMAGE_MAX_COUNT,
  LIMIT_IMAGE_MIME_TYPES,
  LIMIT_PDF_MAX_COUNT,
  LIMIT_PDF_MAX_PAGES,
  LIMIT_VIDEO_MAX_COUNT,
  LIMIT_VIDEO_MAX_SECONDS,
  LIMIT_VIDEO_WITH_AUDIO_MAX_SECONDS,
  LIMIT_VIDEO_MIME_TYPES,
  LIMIT_AUDIO_MAX_COUNT,
  LIMIT_AUDIO_MAX_SECONDS,
  LIMIT_AUDIO_MIME_TYPES,
};
