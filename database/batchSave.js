/**
 * @fileoverview Batch save helper. Runs multiple DB upserts in parallel and
 *               returns a results summary. Used during bot state persistence.
 * @module database/batchSave
 */

import { Logger }              from '../core/Logger.js';
import { saveUserSettings,
         saveServerSettings }  from './collections/settingsRepo.js';
import { saveChatHistory }     from './collections/historyRepo.js';

const logger = Logger.get('BatchSave');

/**
 * Save multiple entity groups in parallel.
 *
 * @param {Object}  [options={}]
 * @param {Object}  [options.userSettings]   - Map of userId → settings
 * @param {Object}  [options.serverSettings] - Map of guildId → settings
 * @param {Object}  [options.chatHistories]  - Map of id → history
 * @returns {Promise<{ saved: number, failed: number, errors: Array }>}
 */
export async function batchSave(options = {}) {
  const operations = [];
  const results = { saved: 0, failed: 0, errors: [] };

  if (options.userSettings) {
    for (const [userId, settings] of Object.entries(options.userSettings)) {
      operations.push(
        saveUserSettings(userId, settings)
          .then(() => results.saved++)
          .catch(err => {
            results.failed++;
            results.errors.push({ type: 'userSettings', id: userId, error: err.message });
          })
      );
    }
  }

  if (options.serverSettings) {
    for (const [guildId, settings] of Object.entries(options.serverSettings)) {
      operations.push(
        saveServerSettings(guildId, settings)
          .then(() => results.saved++)
          .catch(err => {
            results.failed++;
            results.errors.push({ type: 'serverSettings', id: guildId, error: err.message });
          })
      );
    }
  }

  if (options.chatHistories) {
    for (const [id, history] of Object.entries(options.chatHistories)) {
      operations.push(
        saveChatHistory(id, history)
          .then(() => results.saved++)
          .catch(err => {
            results.failed++;
            results.errors.push({ type: 'chatHistory', id, error: err.message });
          })
      );
    }
  }

  try {
    await Promise.all(operations);
    return results;
  } catch (error) {
    logger.error('Batch save critical error', error);
    throw error;
  }
}
