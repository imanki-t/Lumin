/**
 * @fileoverview Database index creation. Runs once in the background after
 *               connection is established. Safe to call multiple times —
 *               duplicate-key errors (codes 85/86) are silently ignored.
 * @module database/indexManager
 */

import { Logger }                              from '../core/Logger.js';
import { COLLECTIONS, getCollection,
         indexesCreated, setIndexesCreated, getDB }   from './connection.js';

const logger = Logger.get('IndexManager');

/**
 * Create all required indexes in parallel. Called automatically by connectDB.
 * @returns {Promise<void>}
 */
export async function createIndexes() {
  if (indexesCreated) return;

  try {
    logger.info('Creating database indexes…');

    const ops = [
      // ── Core ──────────────────────────────────────────────────────────────
      { col: COLLECTIONS.USER_SETTINGS,       idx: { userId: 1 },                      opts: { unique: true } },
      { col: COLLECTIONS.SERVER_SETTINGS,     idx: { guildId: 1 },                     opts: { unique: true } },
      { col: COLLECTIONS.CHAT_HISTORIES,      idx: { id: 1 },                          opts: { unique: true } },
      { col: COLLECTIONS.CUSTOM_INSTRUCTIONS, idx: { id: 1 },                          opts: { unique: true } },
      { col: COLLECTIONS.BLACKLISTED_USERS,   idx: { guildId: 1 },                     opts: { unique: true } },
      { col: COLLECTIONS.CHANNEL_SETTINGS,    idx: { channelId: 1 },                   opts: { unique: true } },

      // ── Memory / RAG ──────────────────────────────────────────────────────
      { col: COLLECTIONS.MEMORY_ENTRIES,      idx: { 'metadata.historyId': 1, timestamp: -1 } },
      { col: COLLECTIONS.MEMORY_ENTRIES,      idx: { 'metadata.userId': 1 }            },
      { col: COLLECTIONS.MEMORY_ENTRIES,      idx: { 'metadata.guildId': 1 }           },

      // ── Features ──────────────────────────────────────────────────────────
      { col: COLLECTIONS.IMAGE_USAGE,         idx: { userId: 1 },                      opts: { unique: true } },
      { col: COLLECTIONS.BIRTHDAYS,           idx: { userId: 1 },                      opts: { unique: true } },
      { col: COLLECTIONS.REMINDERS,           idx: { userId: 1, id: 1 }               },
      { col: COLLECTIONS.DAILY_QUOTES,        idx: { userId: 1 },                      opts: { unique: true } },
      { col: COLLECTIONS.ROULETTE,            idx: { channelId: 1 },                   opts: { unique: true } },
      { col: COLLECTIONS.COMPLIMENTS,         idx: { userId: 1 },                      opts: { unique: true } },
      { col: COLLECTIONS.USER_TIMEZONES,      idx: { userId: 1 },                      opts: { unique: true } },
      { col: COLLECTIONS.SERVER_DIGESTS,      idx: { guildId: 1 },                     opts: { unique: true } },
      { col: COLLECTIONS.REALIVE,             idx: { guildId: 1 },                     opts: { unique: true } },
      { col: COLLECTIONS.SUMMARY_USAGE,       idx: { userId: 1 },                      opts: { unique: true } },
      { col: COLLECTIONS.QUOTE_USAGE,         idx: { userId: 1 },                      opts: { unique: true } },

      // ── User facts ────────────────────────────────────────────────────────
      { col: COLLECTIONS.USER_FACTS,          idx: { userId: 1, createdAt: -1 }       },

      // ── Weekly summaries ──────────────────────────────────────────────────
      { col: COLLECTIONS.WEEKLY_SUMMARIES,    idx: { userId: 1 },                      opts: { unique: true } },
      { col: COLLECTIONS.WEEKLY_SUMMARIES,    idx: { generatedAt: -1 }                },

      // ── Session summaries ─────────────────────────────────────────────────
      { col: COLLECTIONS.SESSION_SUMMARIES,   idx: { userId: 1, timestamp: -1 }       },
      { col: COLLECTIONS.SESSION_SUMMARIES,   idx: { userId: 1, isDailyDigest: 1 }    },
      { col: COLLECTIONS.SESSION_SUMMARIES,   idx: { historyId: 1, timestamp: -1 }    },

      // ── Daily message usage ───────────────────────────────────────────────
      { col: COLLECTIONS.DAILY_MSG_USAGE,     idx: { date: 1 },                        opts: { unique: true } },

      // ── Background indexing state ─────────────────────────────────────────
      { col: COLLECTIONS.INDEXED_COUNTS,      idx: { historyId: 1 },                   opts: { unique: true } },
    ];

    await Promise.all(
      ops.map(async ({ col, idx, opts = {} }) => {
        try {
          await getCollection(col).createIndex(idx, opts);
        } catch (err) {
          // Ignore "index already exists" (85) and "index name collision" (86)
          if (err.code !== 85 && err.code !== 86) {
            logger.warn(`Failed to create index on ${col}: ${err.message}`);
          }
        }
      })
    );

    setIndexesCreated(true);
    logger.info('Database indexes created successfully');

    // ── Atlas Vector Search index for sessionSummaries ────────────────────
    // This is a Search index (not a regular index) and must be created via
    // the Atlas $createSearchIndexes command — cannot use createIndex().
    // Safe to call repeatedly; Atlas ignores duplicates.
    _ensureSessionVectorIndex().catch(err =>
      logger.warn('sessionSummaries vector index creation skipped (will fall back to scan):', err.message)
    );

  } catch (error) {
    logger.error('Critical error during index creation', error);
  }
}

// ============================================================================
// ATLAS VECTOR INDEX — sessionSummaries
// ============================================================================

/**
 * Create (or confirm existence of) the Atlas Search vector index used by
 * vectorSearchOldSessions() in SessionSummaryJob.
 *
 * Atlas $vectorSearch requires a Search index, not a regular B-tree index.
 * The command is idempotent — Atlas returns an error if the name already
 * exists, which we swallow silently.
 *
 * Dimensions must match your embedding model output (768 for text-embedding-004,
 * 1536 for text-embedding-3-small, etc.).  The value here reads from the same
 * VECTOR_SEARCH_CONFIG used by the existing memoryEntries index so you only
 * need to change it in one place.
 *
 * @returns {Promise<void>}
 */
async function _ensureSessionVectorIndex() {
  try {
    const { EMBEDDING_DIM } = await import('../modules/config.js');
    const db = getDB();
    if (!db) return;

    await db.command({
      createSearchIndexes: COLLECTIONS.SESSION_SUMMARIES,
      indexes: [
        {
          name:       'sessionSummaries_vector',
          type:       'vectorSearch',
          definition: {
            fields: [
              {
                type:          'vector',
                path:          'embedding',
                numDimensions: EMBEDDING_DIM ?? 768,
                similarity:    'cosine'
              },
              // Pre-filter fields — Atlas requires these listed so the
              // $vectorSearch filter: { userId: ... } works efficiently.
              {
                type: 'filter',
                path: 'userId'
              },
              {
                type: 'filter',
                path: 'timestamp'
              }
            ]
          }
        }
      ]
    });

    logger.info('sessionSummaries vector index created (or already exists)');
  } catch (err) {
    // Code 68 = IndexAlreadyExists — perfectly fine, index is already there.
    if (err.code === 68 || err.message?.includes('already exists')) {
      logger.debug('sessionSummaries vector index already exists — skipping');
      return;
    }
    throw err;  // re-throw anything unexpected so the outer .catch() logs it
  }
}
