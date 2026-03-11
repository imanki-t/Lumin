/**
 * @fileoverview Reusable Discord Embed Factories
 * @module modules/shared/embedBuilder
 * @version 2.0.0
 *
 * Single source of truth for every embed style used across Lumin v2.
 * Replaces 50+ scattered `new EmbedBuilder()` blocks that duplicate
 * the same colour/title patterns with no consistency.
 *
 * Usage:
 *   import { Embeds } from '../shared/embedBuilder.js';
 *
 *   await interaction.reply({ embeds: [Embeds.error('Oops', 'Something broke')] });
 *   await message.reply({ embeds: [Embeds.success('Done!', 'File uploaded.')] });
 *   await interaction.editReply({ embeds: [Embeds.loading('Processing your request…')] });
 *
 * @requires discord.js
 */

import { EmbedBuilder } from 'discord.js';

// ============================================================================
// COLOUR PALETTE
// ============================================================================

/**
 * Centralised colour palette for all embeds.
 * Change a colour here and it updates everywhere.
 * @readonly
 */
export const COLOURS = Object.freeze({
  ERROR:   0xFF5555,   // red
  SUCCESS: 0x57F287,   // green
  INFO:    0x00D9FF,   // cyan-blue
  WARNING: 0xFFAA00,   // amber
  LOADING: 0x5865F2,   // Discord blurple (processing / waiting)
  NEUTRAL: 0x99AAB5,   // grey (informational, no strong sentiment)
  PRIMARY: 0x5865F2,   // Discord blurple (main brand colour)
});

// ============================================================================
// TITLE EMOJI PREFIX HELPERS
// ============================================================================

/**
 * Standard emoji prefixes to prepend to embed titles.
 * @readonly
 */
const EMOJI = Object.freeze({
  ERROR:   '❌',
  SUCCESS: '✅',
  INFO:    'ℹ️',
  WARNING: '⚠️',
  LOADING: '⏳',
  SEARCH:  '🔍',
  MEMORY:  '🧠',
  STAR:    '⭐',
  CHAT:    '💬',
  SETTINGS:'⚙️',
  BIRTHDAY:'🎂',
  REMINDER:'⏰',
  QUOTE:   '📜',
});

// ============================================================================
// FACTORY HELPERS
// ============================================================================

/**
 * Base embed factory — all other factories call this.
 *
 * @param {object} opts
 * @param {number}  opts.colour
 * @param {string}  opts.title
 * @param {string}  [opts.description]
 * @param {Array}   [opts.fields]
 * @param {string}  [opts.footer]
 * @param {string}  [opts.url]
 * @param {boolean} [opts.timestamp=false]
 * @returns {EmbedBuilder}
 */
function base({ colour, title, description, fields, footer, url, timestamp = false }) {
  const embed = new EmbedBuilder()
    .setColor(colour)
    .setTitle(title);

  if (description) embed.setDescription(description);
  if (fields?.length) embed.addFields(...fields);
  if (footer)        embed.setFooter({ text: footer });
  if (url)           embed.setURL(url);
  if (timestamp)     embed.setTimestamp();

  return embed;
}

// ============================================================================
// PUBLIC EMBED FACTORIES
// ============================================================================

/**
 * Collection of embed factory functions.
 * Every function returns a ready-to-send EmbedBuilder instance.
 *
 * @namespace Embeds
 */
export const Embeds = Object.freeze({

  // ──────────────────────────────────────────────────────────────────────────
  // SEMANTIC STATES
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Red error embed.
   *
   * @param {string} title       - Short error title (emoji prepended automatically)
   * @param {string} description - Human-readable error detail
   * @returns {EmbedBuilder}
   *
   * @example
   * Embeds.error('Rate Limited', 'Please wait a moment and try again.')
   */
  error(title, description) {
    return base({
      colour:      COLOURS.ERROR,
      title:       `${EMOJI.ERROR} ${title}`,
      description,
    });
  },

  /**
   * Green success embed.
   *
   * @param {string} title
   * @param {string} [description]
   * @returns {EmbedBuilder}
   */
  success(title, description) {
    return base({
      colour:      COLOURS.SUCCESS,
      title:       `${EMOJI.SUCCESS} ${title}`,
      description,
    });
  },

  /**
   * Cyan informational embed.
   *
   * @param {string} title
   * @param {string} [description]
   * @returns {EmbedBuilder}
   */
  info(title, description) {
    return base({
      colour:      COLOURS.INFO,
      title:       `${EMOJI.INFO} ${title}`,
      description,
    });
  },

  /**
   * Amber warning embed.
   *
   * @param {string} title
   * @param {string} [description]
   * @returns {EmbedBuilder}
   */
  warning(title, description) {
    return base({
      colour:      COLOURS.WARNING,
      title:       `${EMOJI.WARNING} ${title}`,
      description,
    });
  },

  /**
   * Blurple "in progress" embed shown while an operation is running.
   *
   * @param {string} [description='Please wait…']
   * @returns {EmbedBuilder}
   */
  loading(description = 'Please wait…') {
    return base({
      colour:      COLOURS.LOADING,
      title:       `${EMOJI.LOADING} Processing`,
      description,
    });
  },

  /**
   * Neutral grey embed for plain informational output.
   *
   * @param {string} title
   * @param {string} [description]
   * @returns {EmbedBuilder}
   */
  neutral(title, description) {
    return base({
      colour:      COLOURS.NEUTRAL,
      title,
      description,
    });
  },

  // ──────────────────────────────────────────────────────────────────────────
  // DOMAIN-SPECIFIC CONVENIENCE FACTORIES
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Standardised permission-denied embed.
   * Used everywhere a user lacks a required Discord permission.
   *
   * @param {string} [permissionName='Manage Server']
   * @returns {EmbedBuilder}
   */
  permissionDenied(permissionName = 'Manage Server') {
    return base({
      colour:      COLOURS.ERROR,
      title:       '🚫 Permission Denied',
      description: `You need the **${permissionName}** permission to do that.`,
    });
  },

  /**
   * Rate-limit / busy embed shown when the AI API is throttling.
   *
   * @param {string} [extra] - Optional extra context line
   * @returns {EmbedBuilder}
   */
  rateLimited(extra) {
    return base({
      colour:      COLOURS.WARNING,
      title:       `${EMOJI.WARNING} I'm a bit busy right now`,
      description: `Switching gears — please wait a moment! 🔄${extra ? `\n\n${extra}` : ''}`,
    });
  },

  /**
   * Circuit open / AI unavailable embed.
   *
   * @param {number} [retryAfterMs] - Ms until retry is possible
   * @returns {EmbedBuilder}
   */
  circuitOpen(retryAfterMs) {
    const retryText = retryAfterMs
      ? `\n\nI'll be back in ~${Math.ceil(retryAfterMs / 1000)}s ⚡`
      : '';
    return base({
      colour:      COLOURS.WARNING,
      title:       `${EMOJI.WARNING} AI Temporarily Unavailable`,
      description: `The AI service is taking a breather.${retryText}`,
    });
  },

  /**
   * DM-disabled error embed.
   *
   * @returns {EmbedBuilder}
   */
  dmDisabled() {
    return base({
      colour:      COLOURS.ERROR,
      title:       `${EMOJI.ERROR} DM Failed`,
      description: 'I couldn\'t send you a DM — please check your privacy settings!',
    });
  },

  /**
   * Empty / no-content message embed.
   *
   * @returns {EmbedBuilder}
   */
  emptyMessage() {
    return base({
      colour:      COLOURS.INFO,
      title:       `${EMOJI.INFO} Empty Message`,
      description: 'Please send me some text, or attach a supported file!',
    });
  },

  /**
   * Queue full embed shown when a user's request queue is at capacity.
   *
   * @param {number} maxSize
   * @returns {EmbedBuilder}
   */
  queueFull(maxSize) {
    return base({
      colour:      COLOURS.WARNING,
      title:       `${EMOJI.WARNING} Queue Full`,
      description: `You already have **${maxSize}** messages in the queue. Please wait for them to finish first!`,
    });
  },

  // ──────────────────────────────────────────────────────────────────────────
  // BUILDER PATTERN — for complex embeds that need field-by-field construction
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Create a raw EmbedBuilder pre-set with a colour.
   * Use this when the factory shortcuts above don't fit your needs.
   *
   * @param {'error'|'success'|'info'|'warning'|'loading'|'neutral'|'primary'} type
   * @returns {EmbedBuilder}
   *
   * @example
   * const embed = Embeds.custom('info')
   *   .setTitle('Birthday List')
   *   .addFields({ name: '🎂 Alice', value: 'January 1st', inline: true });
   */
  custom(type = 'neutral') {
    const colourMap = {
      error:   COLOURS.ERROR,
      success: COLOURS.SUCCESS,
      info:    COLOURS.INFO,
      warning: COLOURS.WARNING,
      loading: COLOURS.LOADING,
      neutral: COLOURS.NEUTRAL,
      primary: COLOURS.PRIMARY,
    };
    return new EmbedBuilder().setColor(colourMap[type] ?? COLOURS.NEUTRAL);
  },

  /**
   * Wrap any raw error (LuminError or Error) into a user-safe error embed.
   * Picks the userMessage field if available, otherwise falls back to generic.
   *
   * @param {unknown} error
   * @param {string}  [fallbackTitle='Something went wrong']
   * @returns {EmbedBuilder}
   *
   * @example
   * catch (err) {
   *   await message.reply({ embeds: [Embeds.fromError(err)] });
   * }
   */
  fromError(error, fallbackTitle = 'Something went wrong') {
    const description = error?.userMessage
      ?? error?.message
      ?? 'An unexpected error occurred. Please try again.';

    return base({
      colour:      COLOURS.ERROR,
      title:       `${EMOJI.ERROR} ${fallbackTitle}`,
      description,
    });
  },
});

// ============================================================================
// GROUNDING / URL-CONTEXT METADATA HELPERS
// (Single source of truth — was duplicated in responseHandler.js + searchCommand.js)
// ============================================================================

/**
 * Google AI icon URL used as a fallback footer icon.
 * @type {string}
 */
export const GOOGLE_AI_ICON = 'https://ai.google.dev/static/site-assets/images/share.png';

/** @private */
const GROUNDING = Object.freeze({
  MAX_QUERIES:    3,
  MAX_SOURCES:    5,
  MAX_URLS:       3,

  SUCCESS_STATUS: 'URL_RETRIEVAL_STATUS_SUCCESS',

  FIELD_QUERIES:  '🔍 Search Queries',
  FIELD_SOURCES:  '📚 Sources',
  FIELD_URL_CTX:  '🔗 URL Context',

  BULLET:         '• ',
  SOURCE_LABEL:   'Source'
});

/**
 * Mutate `embed` by adding web-search grounding metadata fields.
 * Safe to call with `null` / missing metadata — silently no-ops.
 * Errors are swallowed so a metadata failure never breaks the response send.
 *
 * @param {EmbedBuilder}  embed
 * @param {object|null}   groundingMetadata   - Gemini candidates[0].groundingMetadata
 * @returns {EmbedBuilder} The same embed (for chaining)
 *
 * @example
 * const embed = new EmbedBuilder().setDescription(response);
 * addGroundingFields(embed, groundingMetadata);
 * addUrlContextFields(embed, urlContextMetadata);
 */
export function addGroundingFields(embed, groundingMetadata) {
  if (!groundingMetadata) return embed;
  try {
    if (groundingMetadata.webSearchQueries?.length > 0) {
      const queries = groundingMetadata.webSearchQueries
        .slice(0, GROUNDING.MAX_QUERIES)
        .map(q => `${GROUNDING.BULLET}${q}`)
        .join('\n');
      embed.addFields({ name: GROUNDING.FIELD_QUERIES, value: queries, inline: false });
    }

    if (groundingMetadata.groundingChunks?.length > 0) {
      const chunks = groundingMetadata.groundingChunks
        .slice(0, GROUNDING.MAX_SOURCES)
        .map((c, i) =>
          c.web
            ? `${GROUNDING.BULLET}[${c.web.title || GROUNDING.SOURCE_LABEL}](${c.web.uri})`
            : `${GROUNDING.BULLET}${GROUNDING.SOURCE_LABEL} ${i + 1}`
        )
        .join('\n');
      embed.addFields({ name: GROUNDING.FIELD_SOURCES, value: chunks, inline: false });
    }
  } catch {
    // Swallow — metadata display is non-critical
  }
  return embed;
}

/**
 * Mutate `embed` by adding URL-context retrieval status fields.
 * Safe to call with `null` / missing metadata — silently no-ops.
 *
 * @param {EmbedBuilder}  embed
 * @param {object|null}   urlContextMetadata  - Gemini candidates[0].url_context_metadata
 * @returns {EmbedBuilder} The same embed (for chaining)
 */
export function addUrlContextFields(embed, urlContextMetadata) {
  if (!urlContextMetadata?.url_metadata?.length) return embed;
  try {
    const urlList = urlContextMetadata.url_metadata
      .slice(0, GROUNDING.MAX_URLS)
      .map(u => {
        const emoji = u.url_retrieval_status === GROUNDING.SUCCESS_STATUS ? '✅' : '❌';
        return `${emoji} ${u.retrieved_url}`;
      })
      .join('\n');
    embed.addFields({ name: GROUNDING.FIELD_URL_CTX, value: urlList, inline: false });
  } catch {
    // Swallow — metadata display is non-critical
  }
  return embed;
}
