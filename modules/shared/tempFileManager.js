/**
 * @fileoverview Shared Temporary File Manager
 * @module modules/shared/tempFileManager
 * @version 2.0.0
 *
 * Single source of truth for all temp file operations across Lumin v2.
 * Replaces the two near-identical functions in index.js:
 *   - cleanupTempFiles()   (periodic cleanup)
 *   - startupCleanup()     (startup cleanup)
 * ...and any ad-hoc fs.unlink() calls scattered across commands.
 *
 * Features:
 *   - Unified cleanTemp(maxAgeMs?) for both startup and periodic use
 *   - Safe single-file delete with error suppression (already-deleted is fine)
 *   - Tracked temp file registry so we can clean up known files on shutdown
 *   - Atomic write pattern (write to .tmp, rename to final)
 *   - Full structured logging
 *
 * @requires fs/promises
 * @requires path
 * @requires core/Logger
 */

import fs   from 'fs/promises';
import path from 'path';
import { Logger } from '../../core/Logger.js';

const log = Logger.get('TempFileManager');

// ============================================================================
// CONFIGURATION
// ============================================================================

/** Default max age for temp files before they are cleaned up (1 hour). */
const DEFAULT_MAX_AGE_MS = 60 * 60 * 1_000;

/** Files newer than this are always kept even if maxAge says otherwise. */
const MIN_SAFE_AGE_MS = 5 * 60 * 1_000; // 5 minutes

// ============================================================================
// TEMP DIRECTORY RESOLUTION
// ============================================================================

/**
 * Resolve the absolute path to the temp directory.
 * Uses TEMP_DIR env var when set, otherwise defaults to <cwd>/temp.
 *
 * @returns {string} Absolute path
 */
function resolveTempDir() {
  if (process.env.TEMP_DIR) return path.resolve(process.env.TEMP_DIR);
  // Fallback: same directory structure as original botManager.js
  return path.join(process.cwd(), 'temp');
}

/** Resolved temp directory path (computed once at module load). */
export const TEMP_DIR = resolveTempDir();

// ============================================================================
// INTERNAL REGISTRY
// ============================================================================

/**
 * Set of absolute file paths created by this process during its lifetime.
 * Allows targeted cleanup on shutdown without scanning the whole directory.
 * @type {Set<string>}
 */
const _registry = new Set();

// ============================================================================
// CORE API
// ============================================================================

/**
 * Ensure the temp directory exists.
 * Called lazily — safe to call multiple times.
 *
 * @returns {Promise<void>}
 */
export async function ensureTempDir() {
  await fs.mkdir(TEMP_DIR, { recursive: true });
}

/**
 * Scan the temp directory and remove files older than `maxAgeMs`.
 * Safe to call at startup and on a periodic interval.
 *
 * @param {number} [maxAgeMs=DEFAULT_MAX_AGE_MS] - Max file age in milliseconds
 * @returns {Promise<number>} Number of files removed
 *
 * @example
 * // Startup cleanup (remove files > 1 hour old)
 * await cleanTemp();
 *
 * // Periodic cleanup (same default)
 * setInterval(() => cleanTemp(), 60 * 60 * 1000);
 *
 * // Custom age (remove files > 30 minutes old)
 * await cleanTemp(30 * 60 * 1000);
 */
export async function cleanTemp(maxAgeMs = DEFAULT_MAX_AGE_MS) {
  let cleaned = 0;

  try {
    await ensureTempDir();
    const files = await fs.readdir(TEMP_DIR);
    const now   = Date.now();

    await Promise.all(
      files.map(async (file) => {
        const filePath = path.join(TEMP_DIR, file);
        try {
          const stats = await fs.stat(filePath);
          const age   = now - stats.mtimeMs;

          // Never delete files that are too fresh — might still be in use
          if (age < MIN_SAFE_AGE_MS) return;

          if (age > maxAgeMs) {
            await fs.unlink(filePath);
            _registry.delete(filePath);
            cleaned++;
          }
        } catch {
          // File already deleted or unreadable — silently skip
        }
      }),
    );

    if (cleaned > 0) {
      log.info(`Cleaned ${cleaned} old temp file(s)`, { maxAgeMs });
    } else {
      log.debug('Temp cleanup ran — no files to remove');
    }
  } catch (error) {
    if (error.code !== 'ENOENT') {
      log.error('Temp cleanup failed', error);
    }
  }

  return cleaned;
}

/**
 * Safely delete a single file, suppressing "file not found" errors.
 * Use this everywhere instead of bare `fs.unlink()`.
 *
 * @param {string} filePath - Absolute path to the file
 * @returns {Promise<boolean>} True if the file was deleted, false if not found
 *
 * @example
 * await safeUnlink(path.join(TEMP_DIR, `upload_${id}.mp4`));
 */
export async function safeUnlink(filePath) {
  try {
    await fs.unlink(filePath);
    _registry.delete(filePath);
    log.debug('Deleted temp file', { filePath });
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false; // already gone — that's fine
    log.warn('Could not delete temp file', { filePath, error: error.message });
    return false;
  }
}

/**
 * Write data to a temp file and register it for cleanup.
 * Returns the absolute path.
 *
 * @param {string}          filename - Base filename (e.g. 'summary_abc123.txt')
 * @param {string|Buffer}   data     - Content to write
 * @param {BufferEncoding}  [encoding='utf8']
 * @returns {Promise<string>} Absolute path of the written file
 *
 * @example
 * const filePath = await writeTempFile('conv_123.txt', formattedMessages);
 * // ... use filePath ...
 * await safeUnlink(filePath);
 */
export async function writeTempFile(filename, data, encoding = 'utf8') {
  await ensureTempDir();
  const filePath = path.join(TEMP_DIR, filename);
  await fs.writeFile(filePath, data, encoding);
  _registry.add(filePath);
  log.debug('Wrote temp file', { filePath, size: data.length });
  return filePath;
}

/**
 * Clean up all files that were registered via writeTempFile() during this
 * process's lifetime.  Call this during graceful shutdown.
 *
 * @returns {Promise<number>} Number of files removed
 */
export async function cleanRegistered() {
  let cleaned = 0;
  const paths = [..._registry];

  await Promise.all(
    paths.map(async (filePath) => {
      const deleted = await safeUnlink(filePath);
      if (deleted) cleaned++;
    }),
  );

  if (cleaned > 0) {
    log.info(`Shutdown cleanup: removed ${cleaned} registered temp file(s)`);
  }

  return cleaned;
}

/**
 * Start the periodic temp cleanup interval.
 * Call once during bot startup. Returns the interval ID so it can be cleared.
 *
 * @param {number} [intervalMs=3600000]  - How often to run cleanup (default 1 hour)
 * @param {number} [maxAgeMs]            - Max file age passed to cleanTemp()
 * @returns {NodeJS.Timeout} Interval handle
 *
 * @example
 * // In index.js startup:
 * const cleanupInterval = startPeriodicCleanup();
 */
export function startPeriodicCleanup(intervalMs = 60 * 60 * 1_000, maxAgeMs) {
  log.info('Periodic temp cleanup scheduled', { intervalMs });
  return setInterval(() => cleanTemp(maxAgeMs), intervalMs);
}
