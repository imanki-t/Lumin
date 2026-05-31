/**
 * @fileoverview Ephemeral per-request store for pending sticker IDs.
 *
 * When the model calls `get_server_stickers` with a `sticker_id`, the ID is
 * parked here (keyed by historyId).  ResponseHandler calls `consumePendingSticker`
 * right before sending the final Discord message, then sends a follow-up
 * sticker message if one was queued.
 *
 * GIFs do NOT go through this store — the model appends the Tenor page URL
 * directly to its response text and Discord auto-embeds it.
 *
 * @module modules/functions/pendingMedia
 */

// Map<historyId, stickerId>
const _stickerStore = new Map();

/**
 * Queue a sticker to be sent after the current response turn.
 * @param {string} historyId
 * @param {string} stickerId  - Discord sticker ID to send
 */
export function setPendingSticker(historyId, stickerId) {
  _stickerStore.set(historyId, stickerId);
}

/**
 * Return and clear the queued sticker for this history context.
 * Returns null if nothing is queued.
 * @param {string} historyId
 * @returns {string|null}
 */
export function consumePendingSticker(historyId) {
  const id = _stickerStore.get(historyId) ?? null;
  _stickerStore.delete(historyId);
  return id;
}

/**
 * Discard any pending sticker without sending it (used on error paths).
 * @param {string} historyId
 */
export function clearPendingSticker(historyId) {
  _stickerStore.delete(historyId);
}
