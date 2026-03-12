/**
 * @fileoverview Queue Manager — request queue, mutex primitives, and feature-level
 * rate limiters (image generation, summary generation).
 *
 * Responsibilities (and ONLY these):
 *  - `Mutex` class for critical-section protection
 *  - `chatHistoryLock` singleton — prevents concurrent history corruption
 *  - `requestQueues` map — per-user FIFO processing queues
 *  - Image-generation rate limiting (per-minute + daily)
 *  - Summary-generation rate limiting (daily)
 *
 * @module managers/QueueManager
 */

import config from '../config.js';
import { Logger } from '../core/Logger.js';

const logger = Logger.get('QueueManager');

// ============================================================================
// MUTEX
// ============================================================================

/**
 * Simple async mutex for protecting critical sections.
 *
 * Usage:
 * ```js
 * const lock = new Mutex();
 * await lock.runExclusive(async () => { ... });
 * ```
 */
export class Mutex {
  constructor() {
    this._locked = false;
    /** @type {Array<() => void>} */
    this._queue  = [];
  }

  /**
   * Acquire the lock.  Resolves immediately if unlocked; otherwise queues.
   * @returns {Promise<void>}
   */
  acquire() {
    return new Promise(resolve => {
      if (!this._locked) {
        this._locked = true;
        resolve();
      } else {
        this._queue.push(resolve);
      }
    });
  }

  /**
   * Release the lock and unblock the next waiter (if any).
   */
  release() {
    if (this._queue.length > 0) {
      const next = this._queue.shift();
      next();
    } else {
      this._locked = false;
    }
  }

  /**
   * Execute `callback` with exclusive access, always releasing the lock.
   * @template T
   * @param {() => Promise<T>} callback
   * @returns {Promise<T>}
   */
  async runExclusive(callback) {
    await this.acquire();
    try {
      return await callback();
    } finally {
      this.release();
    }
  }
}

// ============================================================================
// SINGLETONS
// ============================================================================

/**
 * Shared lock for all chat-history mutations.
 * Import and use in any module that reads OR writes `state.chatHistories`.
 * @type {Mutex}
 */
export const chatHistoryLock = new Mutex();

/**
 * Per-user request queues — prevents two requests from the same user being
 * processed concurrently.
 *
 * Structure: `Map<userId, { queue: Array<Function>, isProcessing: boolean }>`
 * @type {Map<string, {queue: Function[], isProcessing: boolean}>}
 */
export const requestQueues = new Map();

// ============================================================================
// IMAGE GENERATION RATE LIMITER
// ============================================================================

const IMAGE_RATE_LIMIT = Object.freeze({
  PER_MINUTE_COOLDOWN_MS: 60_000,
  DAILY_RESET_MS:         24 * 60 * 60 * 1000
});

/**
 * In-memory image-usage store.
 * Populated from `state.imageUsage` by `StateManager.loadStateFromDB()`.
 * Exported so `StateManager` can hydrate it after DB load.
 *
 * Structure: `{ [userId]: { count: number, lastReset: number, lastRequest: number } }`
 * @type {Record<string, {count:number, lastReset:number, lastRequest:number}>}
 */
export let imageUsageStore = {};

/**
 * Inject/replace the image-usage store (called by StateManager after DB load).
 * @param {Record<string, any>} data
 */
export function setImageUsageStore(data) {
  imageUsageStore = data ?? {};
}

/**
 * Check whether `userId` is allowed to generate an image right now.
 * Enforces:
 *  - 1 request per minute (cooldown)
 *  - `config.imageConfig.maxPerDay` requests per day
 *
 * @param {string} userId
 * @returns {{ allowed: boolean, message?: string }}
 */
export function checkImageRateLimit(userId) {
  const now = Date.now();

  if (!imageUsageStore[userId]) {
    imageUsageStore[userId] = { count: 0, lastReset: now, lastRequest: 0 };
  }

  const usage = imageUsageStore[userId];

  // Reset daily counter when window has expired.
  if (now - usage.lastReset > IMAGE_RATE_LIMIT.DAILY_RESET_MS) {
    usage.count     = 0;
    usage.lastReset = now;
  }

  // Per-minute cooldown.
  if (now - usage.lastRequest < IMAGE_RATE_LIMIT.PER_MINUTE_COOLDOWN_MS) {
    const waitSec = Math.ceil((IMAGE_RATE_LIMIT.PER_MINUTE_COOLDOWN_MS - (now - usage.lastRequest)) / 1000);
    return { allowed: false, message: `⏳ Please wait ${waitSec}s before generating another image.` };
  }

  // Daily cap.
  const limit = config.imageConfig?.maxPerDay || 10;
  if (usage.count >= limit) {
    return { allowed: false, message: `🛑 You've reached your daily limit of ${limit} images. Limits reset daily.` };
  }

  return { allowed: true };
}

/**
 * Increment the image-usage counter for `userId` (call after a successful generation).
 * @param {string} userId
 */
export function incrementImageUsage(userId) {
  const now = Date.now();

  if (!imageUsageStore[userId]) {
    imageUsageStore[userId] = { count: 0, lastReset: now, lastRequest: 0 };
  }

  const usage = imageUsageStore[userId];

  // Reset if daily window expired.
  if (now - usage.lastReset > IMAGE_RATE_LIMIT.DAILY_RESET_MS) {
    usage.count     = 0;
    usage.lastReset = now;
  }

  usage.count++;
  usage.lastRequest = now;
}

/**
 * Reset all image-usage counters (called by daily scheduler).
 */
export function resetImageUsage() {
  const now = Date.now();
  for (const userId in imageUsageStore) {
    imageUsageStore[userId].count     = 0;
    imageUsageStore[userId].lastReset = now;
  }
  logger.info('Image usage counters reset');
}

// ============================================================================
// SUMMARY GENERATION RATE LIMITER
// ============================================================================

const SUMMARY_RATE_LIMIT = Object.freeze({
  DAILY_LIMIT:    10,
  DAILY_RESET_MS: 24 * 60 * 60 * 1000
});

/**
 * In-memory summary-usage store.
 * Populated from `state.summaryUsage` by `StateManager.loadStateFromDB()`.
 *
 * Structure: `{ [userId]: { count: number, lastReset: number } }`
 * @type {Record<string, {count:number, lastReset:number}>}
 */
export let summaryUsageStore = {};

/**
 * Inject/replace the summary-usage store (called by StateManager after DB load).
 * @param {Record<string, any>} data
 */
export function setSummaryUsageStore(data) {
  summaryUsageStore = data ?? {};
}

/**
 * Check whether `userId` is allowed to generate a summary right now.
 * Enforces a daily cap of `SUMMARY_RATE_LIMIT.DAILY_LIMIT`.
 *
 * @param {string} userId
 * @returns {{ allowed: boolean, message?: string }}
 */
export function checkSummaryRateLimit(userId) {
  const now = Date.now();

  if (!summaryUsageStore[userId]) {
    summaryUsageStore[userId] = { count: 0, lastReset: now };
  }

  const usage = summaryUsageStore[userId];

  if (now - usage.lastReset > SUMMARY_RATE_LIMIT.DAILY_RESET_MS) {
    usage.count     = 0;
    usage.lastReset = now;
  }

  if (usage.count >= SUMMARY_RATE_LIMIT.DAILY_LIMIT) {
    return {
      allowed: false,
      message: `🛑 You've reached your daily limit of ${SUMMARY_RATE_LIMIT.DAILY_LIMIT} summaries. Limits reset daily.`
    };
  }

  return { allowed: true };
}

/**
 * Increment the summary-usage counter for `userId`.
 * @param {string} userId
 */
export function incrementSummaryUsage(userId) {
  const now = Date.now();

  if (!summaryUsageStore[userId]) {
    summaryUsageStore[userId] = { count: 0, lastReset: now };
  }

  const usage = summaryUsageStore[userId];

  if (now - usage.lastReset > SUMMARY_RATE_LIMIT.DAILY_RESET_MS) {
    usage.count     = 0;
    usage.lastReset = now;
  }

  usage.count++;
}

/**
 * Reset all summary-usage counters (called by daily scheduler).
 */
export function resetSummaryUsage() {
  const now = Date.now();
  for (const userId in summaryUsageStore) {
    summaryUsageStore[userId].count     = 0;
    summaryUsageStore[userId].lastReset = now;
  }
  logger.info('Summary usage counters reset');
}

// ============================================================================
// ORPHAN QUEUE SWEEP
// ============================================================================

/**
 * Periodically remove any requestQueue entries that are idle with an empty
 * queue. These are zombie entries left behind by crashes or edge-case code
 * paths that bypass the normal delete in processUserQueue's finally block.
 *
 * Runs every 10 minutes — cheap (Map iteration) and purely defensive.
 */
setInterval(() => {
  let swept = 0;
  for (const [userId, data] of requestQueues.entries()) {
    if (!data.isProcessing && data.queue.length === 0) {
      requestQueues.delete(userId);
      swept++;
    }
  }
  if (swept > 0) logger.info(`Orphan sweep removed ${swept} idle queue entry(s)`);
}, 10 * 60 * 1_000);
