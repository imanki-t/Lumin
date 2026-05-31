/**
 * @fileoverview Ephemeral per-request store for pending stickers and GIFs.
 *
 * Stickers: when the model calls `get_server_stickers` with a `sticker_id`,
 * the ID is parked here.  ResponseHandler calls `consumePendingSticker` right
 * before sending the final Discord message, then sends a follow-up sticker
 * message if one was queued.
 *
 * GIFs: when `search_gif` fires, the resolved URL is stored here instead of
 * being embedded in the model's text.  ResponseHandler sends it as a clean
 * image embed (no raw URL text) after the main text message.
 *
 * BotMessages: tracks the last bot message ID per historyId so edit/delete
 * tools can target the most recent bot message without the model needing to
 * know the ID explicitly.
 *
 * @module modules/functions/pendingMedia
 */

// ── Stickers ──────────────────────────────────────────────────────────────────

/** @type {Map<string, string>} historyId → stickerId */
const _stickerStore = new Map();

export function setPendingSticker(historyId, stickerId) {
  _stickerStore.set(historyId, stickerId);
}

export function consumePendingSticker(historyId) {
  const id = _stickerStore.get(historyId) ?? null;
  _stickerStore.delete(historyId);
  return id;
}

export function clearPendingSticker(historyId) {
  _stickerStore.delete(historyId);
}

// ── GIFs ──────────────────────────────────────────────────────────────────────

/** @type {Map<string, string>} historyId → gifUrl */
const _gifStore = new Map();

/**
 * Park a GIF URL to be sent as a clean image embed after the text reply.
 * @param {string} historyId
 * @param {string} gifUrl  - Direct image URL (Tenor / Giphy CDN)
 */
export function setPendingGif(historyId, gifUrl) {
  _gifStore.set(historyId, gifUrl);
}

/**
 * Return and clear the queued GIF URL for this history context.
 * @param {string} historyId
 * @returns {string|null}
 */
export function consumePendingGif(historyId) {
  const url = _gifStore.get(historyId) ?? null;
  _gifStore.delete(historyId);
  return url;
}

/** Discard without sending (error paths). */
export function clearPendingGif(historyId) {
  _gifStore.delete(historyId);
}

// ── Bot message tracking (for edit / delete tools) ───────────────────────────

/** @type {Map<string, { messageId: string, channelId: string }>} historyId → last bot msg */
const _botMessageStore = new Map();

/**
 * Record the most recently sent bot message for a given history context.
 * Called by ResponseHandler immediately after a successful message send.
 * @param {string} historyId
 * @param {string} messageId
 * @param {string} channelId
 */
export function setLastBotMessage(historyId, messageId, channelId) {
  _botMessageStore.set(historyId, { messageId, channelId });
}

/**
 * Look up the last bot message for a history context without clearing it.
 * @param {string} historyId
 * @returns {{ messageId: string, channelId: string } | null}
 */
export function getLastBotMessage(historyId) {
  return _botMessageStore.get(historyId) ?? null;
}

/** Remove the tracked message (called on context reset / cleanup). */
export function clearLastBotMessage(historyId) {
  _botMessageStore.delete(historyId);
}
