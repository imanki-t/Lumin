/**
 * @fileoverview Shared Message & Text Formatting Utilities
 * @module modules/shared/messageFormatter
 * @version 2.0.0
 *
 * Pure formatting functions with no Discord.js or side-effect dependencies.
 * All functions are synchronous and stateless — easy to unit test.
 *
 * Centralises formatting logic previously scattered across:
 *   - modules/utils.js  (formatMessageContent, formatMessages)
 *   - modules/messageProcessor.js  (inline timestamp / label formatting)
 *   - commands/summary.js  (message block formatting)
 *   - commands/reminder.js  (time formatting)
 *
 * @requires Nothing (pure JS utilities)
 */

// ============================================================================
// TIME FORMATTING
// ============================================================================

/**
 * Format a duration in milliseconds to a human-readable string.
 *
 * @param {number} ms - Duration in milliseconds
 * @returns {string}  e.g. '2h 30m', '45s', '3d 2h'
 *
 * @example
 * formatDuration(5400000)  // → '1h 30m'
 * formatDuration(90000)    // → '1m 30s'
 * formatDuration(500)      // → '< 1s'
 */
export function formatDuration(ms) {
  if (ms < 1_000) return '< 1s';

  const seconds = Math.floor(ms / 1_000);
  const minutes = Math.floor(seconds / 60);
  const hours   = Math.floor(minutes / 60);
  const days    = Math.floor(hours / 24);

  const parts = [];
  if (days    > 0) parts.push(`${days}d`);
  if (hours   % 24 > 0) parts.push(`${hours % 24}h`);
  if (minutes % 60 > 0) parts.push(`${minutes % 60}m`);
  if (seconds % 60 > 0 && days === 0) parts.push(`${seconds % 60}s`);

  return parts.slice(0, 2).join(' ') || '< 1s';
}

/**
 * Format a Date or Unix timestamp to a short Discord-style timestamp string.
 *
 * @param {Date|number} date - Date object or Unix ms timestamp
 * @param {'short'|'long'|'relative'|'date'|'time'} [style='short']
 * @returns {string} Discord <t:unix:style> timestamp string
 *
 * @example
 * formatTimestamp(new Date(), 'relative')  // → '<t:1700000000:R>'
 */
export function formatTimestamp(date, style = 'short') {
  const unix = Math.floor((date instanceof Date ? date.getTime() : date) / 1_000);
  const styleMap = {
    short:    't',  // 9:00 PM
    long:     'T',  // 9:00:00 PM
    date:     'd',  // 11/01/2023
    longdate: 'D',  // November 1, 2023
    full:     'f',  // November 1, 2023 9:00 PM
    day:      'F',  // Wednesday, November 1, 2023 9:00 PM
    relative: 'R',  // 2 hours ago
  };
  return `<t:${unix}:${styleMap[style] ?? 'f'}>`;
}

/**
 * Format a reminder time object into a human-readable string.
 * Covers once / daily / weekly / monthly reminder types.
 *
 * @param {'once'|'daily'|'weekly'|'monthly'} type
 * @param {{ timestamp?: number, hour?: number, minute?: number, day?: number }} time
 * @returns {string}
 *
 * @example
 * formatReminderTime('daily', { hour: 9, minute: 0 }) // → 'Every day at 09:00'
 */
export function formatReminderTime(type, time) {
  const pad = (n) => String(n).padStart(2, '0');

  switch (type) {
    case 'once':
      return time.timestamp
        ? formatTimestamp(time.timestamp, 'full')
        : 'One-time';

    case 'daily':
      return `Every day at ${pad(time.hour)}:${pad(time.minute)}`;

    case 'weekly': {
      const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      return `Every ${days[time.day] ?? 'week'} at ${pad(time.hour)}:${pad(time.minute)}`;
    }

    case 'monthly':
      return `${time.day}${ordinal(time.day)} of every month at ${pad(time.hour)}:${pad(time.minute)}`;

    default:
      return 'Unknown schedule';
  }
}

/**
 * Get the ordinal suffix for a number (1st, 2nd, 3rd, …).
 *
 * @param {number} n
 * @returns {string} e.g. 'st', 'nd', 'rd', 'th'
 */
export function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return s[(v - 20) % 10] ?? s[v] ?? s[0];
}

// ============================================================================
// TEXT UTILITIES
// ============================================================================

/**
 * Capitalise the first letter of a string.
 *
 * @param {string} str
 * @returns {string}
 *
 * @example
 * capitalise('hello world') // → 'Hello world'
 */
export function capitalise(str) {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * Convert a camelCase or snake_case identifier to a Title Case label.
 *
 * @param {string} str
 * @returns {string}
 *
 * @example
 * toLabel('continuousReply')  // → 'Continuous Reply'
 * toLabel('show_action_buttons') // → 'Show Action Buttons'
 */
export function toLabel(str) {
  return str
    .replace(/_/g, ' ')
    .replace(/([A-Z])/g, ' $1')
    .split(' ')
    .filter(Boolean)
    .map(capitalise)
    .join(' ');
}

/**
 * Truncate text to a maximum length with an optional suffix.
 * Respects word boundaries when possible.
 *
 * @param {string} text
 * @param {number} maxLength
 * @param {string} [suffix='…']
 * @returns {string}
 *
 * @example
 * smartTruncate('Hello World this is long', 12) // → 'Hello World…'
 */
export function smartTruncate(text, maxLength, suffix = '…') {
  if (!text || text.length <= maxLength) return text ?? '';

  const cutoff = maxLength - suffix.length;
  const lastSpace = text.lastIndexOf(' ', cutoff);
  const sliceAt   = lastSpace > cutoff * 0.8 ? lastSpace : cutoff;

  return text.slice(0, sliceAt) + suffix;
}

/**
 * Escape Discord markdown characters in a string.
 * Useful when interpolating user input into message content.
 *
 * @param {string} text
 * @returns {string}
 *
 * @example
 * escapeMarkdown('**bold**') // → '\\*\\*bold\\*\\*'
 */
export function escapeMarkdown(text) {
  if (!text) return '';
  return text.replace(/([*_`~|\\<>])/g, '\\$1');
}

// ============================================================================
// QUEUE / BATCH MESSAGE FORMATTING
// ============================================================================

/**
 * Format a batch of queued messages into a single combined prompt string.
 * Each message gets a numbered label with its relative timestamp.
 *
 * Used by MessageProcessor when multiple messages arrive quickly.
 *
 * @param {Array<{ content: string, timestamp: number, position: number }>} messages
 * @returns {string}
 *
 * @example
 * formatBatchPrompt([
 *   { content: 'Hello', timestamp: 1000, position: 1 },
 *   { content: 'How are you?', timestamp: 3000, position: 2 },
 * ]);
 * // → '[Message 1 — just now]\nHello\n\n[Message 2 — 2s later]\nHow are you?'
 */
export function formatBatchPrompt(messages) {
  if (!messages?.length) return '';

  const firstTs = messages[0].timestamp;

  return messages.map(({ content, timestamp, position }) => {
    const deltaMs  = timestamp - firstTs;
    const timeLabel = deltaMs < 1_000
      ? 'just now'
      : `${Math.round(deltaMs / 1_000)}s later`;

    return `[Message ${position} — ${timeLabel}]\n${content}`;
  }).join('\n\n');
}

// ============================================================================
// DISCORD MESSAGE CONTENT SUMMARISATION
// ============================================================================

/**
 * Format a single Discord message object into a plain-text summary line.
 * Used when building conversation summaries and chat history previews.
 *
 * @param {{ author: { username: string }, content: string, createdTimestamp: number }} msg
 * @param {number} index - Position in the message list
 * @returns {string}
 */
export function formatMessageLine(msg, index) {
  const ts   = new Date(msg.createdTimestamp).toLocaleTimeString('en-US', {
    hour:   '2-digit',
    minute: '2-digit',
  });
  const name = msg.author?.username ?? 'Unknown';
  const body = (msg.content ?? '').slice(0, 500) || '[no text content]';
  return `[${index + 1}] ${ts} ${name}: ${body}`;
}

/**
 * Format a Date into a readable label for chat history context.
 *
 * @param {Date|number} date
 * @returns {string}  e.g. 'Today', 'Yesterday', 'Mon Jan 01 2024'
 */
export function formatDateLabel(date) {
  const d     = new Date(date);
  const now   = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const day   = new Date(d.getFullYear(), d.getMonth(), d.getDate());

  const diffDays = Math.round((today - day) / 86_400_000);

  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7)   return d.toLocaleDateString('en-US', { weekday: 'long' });
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// ============================================================================
// NUMBER / STAT FORMATTING
// ============================================================================

/**
 * Format a large number with locale commas.
 *
 * @param {number} n
 * @returns {string}
 *
 * @example
 * formatNumber(1234567) // → '1,234,567'
 */
export function formatNumber(n) {
  return n.toLocaleString('en-US');
}

/**
 * Format bytes into a human-readable file size string.
 *
 * @param {number} bytes
 * @param {number} [decimals=1]
 * @returns {string}
 *
 * @example
 * formatBytes(1536)        // → '1.5 KB'
 * formatBytes(1073741824)  // → '1.0 GB'
 */
export function formatBytes(bytes, decimals = 1) {
  if (bytes === 0) return '0 B';
  const k     = 1024;
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i     = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(decimals)} ${units[i]}`;
}
