/**
 * @fileoverview Live runtime feature-flag reader.
 *
 * Reads `dashboard/runtime-config.json` with a short TTL cache (5 s) so that
 * flags toggled in the dashboard take effect within seconds — no restart needed.
 *
 * Falls back to static defaults from modules/config.js when the file is absent
 * or unreadable.
 *
 * @module modules/shared/runtimeFlags
 */

import fs   from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  CROSS_CONTEXT_ENABLED as STATIC_CROSS_CONTEXT_ENABLED,
  CACHE_ENABLED         as STATIC_CACHE_ENABLED,
  WEEKLY_SUMMARY_ENABLED as STATIC_WEEKLY_SUMMARY_ENABLED,
} from '../config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const RUNTIME_CONFIG_PATH = path.resolve(
  __dirname, '..', '..', 'dashboard', 'runtime-config.json'
);

// Static defaults — used when the JSON file is missing or a flag is not set
const STATIC_DEFAULTS = {
  CROSS_CONTEXT_ENABLED:   STATIC_CROSS_CONTEXT_ENABLED  ?? false,
  CACHE_ENABLED:           STATIC_CACHE_ENABLED           ?? false,
  WEEKLY_SUMMARY_ENABLED:  STATIC_WEEKLY_SUMMARY_ENABLED  ?? true,
};

// ── TTL cache — avoids hammering disk on every RAG call ──────────────────────
const TTL_MS        = 5_000; // re-read at most every 5 seconds
let   _cachedFlags  = null;
let   _lastReadAt   = 0;

function _readFlags() {
  const now = Date.now();
  if (_cachedFlags && now - _lastReadAt < TTL_MS) return _cachedFlags;

  try {
    const raw  = fs.readFileSync(RUNTIME_CONFIG_PATH, 'utf8');
    const cfg  = JSON.parse(raw);
    _cachedFlags = { ...STATIC_DEFAULTS, ...(cfg.featureFlags || {}) };
  } catch {
    // File absent or malformed — silently fall back to static defaults
    _cachedFlags = { ...STATIC_DEFAULTS };
  }

  _lastReadAt = now;
  return _cachedFlags;
}

/**
 * Get the current value of a runtime feature flag.
 * Always returns the most recent value within the 5-second TTL window.
 *
 * @param {string} name - e.g. 'CROSS_CONTEXT_ENABLED'
 * @returns {boolean}
 */
export function getFlag(name) {
  const flags = _readFlags();
  return flags[name] ?? STATIC_DEFAULTS[name] ?? false;
}

/**
 * Get a snapshot of all current runtime flags.
 * @returns {object}
 */
export function getAllFlags() {
  return { ..._readFlags() };
}
