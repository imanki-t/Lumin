/**
 * @fileoverview Media processing — GIFs, stickers, custom emojis, Gemini attachment parts.
 * @module modules/message/MediaHandler
 */

import axios from 'axios';
import path from 'path';
import { Logger } from '../../core/Logger.js';
import { isGemmaModel, GEMMA_SUPPORTED_MIME_PREFIXES, GEMMA_SUPPORTED_EXTENSIONS } from '../../modules/config.js';

const logger = Logger.get('MediaHandler');

// ============================================================================
// CONSTANTS
// ============================================================================

export const TENOR_GIPHY_REGEX =
  /https?:\/\/(?:www\.)?(tenor\.com\/view\/[^\s]+|giphy\.com\/gifs\/[^\s]+|media\.tenor\.com\/[^\s]+\.gif|media\.giphy\.com\/media\/[^\s]+\/giphy\.gif)/gi;

export const CUSTOM_EMOJI_REGEX = /<a?:(\w+):(\d+)>/g;

export const GIF_EMBED_DELAY_MS = 1500;

export const MIME_TYPES = Object.freeze({
  TEXT_PLAIN: 'text/plain',
  PNG:        'image/png',
  GIF:        'image/gif',
  JSON:       'application/json'
});

const ATTACHMENT_LIMITS = Object.freeze({ MAX_ATTACHMENTS: 5, MAX_EMOJIS: 5 });
const HTTP_TIMEOUT_MS      = 5000;
const HTTP_HEAD_TIMEOUT_MS = 3000;

const STICKER_FORMATS = Object.freeze({ PNG: 2, APNG: 3, LOTTIE: 3, GIF: 4 });

const GIF_PROVIDERS = Object.freeze({ TENOR: 'tenor', GIPHY: 'giphy' });
const GIF_DOMAINS   = Object.freeze({
  TENOR_VIEW:  'tenor.com/view/',
  TENOR_MEDIA: 'media.tenor.com',
  GIPHY_GIFS:  'giphy.com/gifs/',
  GIPHY_MEDIA: 'media.giphy.com'
});
const FILE_NAMES = Object.freeze({ TENOR_GIF: 'tenor_gif.gif', GIPHY_GIF: 'giphy_gif.gif' });

// ============================================================================
// EMOJI / STICKER HELPERS
// ============================================================================

/**
 * Extract all custom Discord emojis from message content.
 * @param {string} content
 * @returns {{ name: string, id: string, animated: boolean, fullMatch: string }[]}
 */
export function extractCustomEmojis(content) {
  const emojis = [];
  const regex  = new RegExp(CUSTOM_EMOJI_REGEX.source, CUSTOM_EMOJI_REGEX.flags);
  let match;
  while ((match = regex.exec(content)) !== null) {
    emojis.push({
      name:      match[1],
      id:        match[2],
      animated:  match[0].startsWith('<a:'),
      fullMatch: match[0]
    });
  }
  return emojis;
}

/**
 * Convert a Discord sticker into a pseudo-attachment object.
 * @param {import('discord.js').Sticker} sticker
 * @returns {Promise<object|null>}
 */
export async function processStickerAsAttachment(sticker) {
  try {
    const isAnimated = sticker.format === STICKER_FORMATS.APNG ||
                       sticker.format === STICKER_FORMATS.LOTTIE ||
                       sticker.format === STICKER_FORMATS.GIF;

    let contentType  = MIME_TYPES.PNG;
    let fileExtension = '.png';
    let url = sticker.url;

    if (sticker.format === STICKER_FORMATS.LOTTIE) {
      contentType   = MIME_TYPES.JSON;
      fileExtension = '.json';
    } else if (sticker.format === STICKER_FORMATS.GIF) {
      contentType   = MIME_TYPES.GIF;
      fileExtension = '.gif';
      url = `https://media.discordapp.net/stickers/${sticker.id}.gif`;
    }

    const name = sticker.name.endsWith(fileExtension)
      ? sticker.name
      : `${sticker.name}${fileExtension}`;

    return { name, url, contentType, isAnimated, isSticker: true };
  } catch (error) {
    logger.error('Error processing sticker', error);
    return null;
  }
}

/**
 * Convert a custom emoji into a pseudo-attachment object.
 * @param {{ name: string, id: string, animated: boolean }} emoji
 * @returns {Promise<object|null>}
 */
export async function processEmojiAsAttachment(emoji) {
  try {
    const ext = emoji.animated ? 'gif' : 'png';
    return {
      name:        `${emoji.name}.${ext}`,
      url:         `https://cdn.discordapp.com/emojis/${emoji.id}.${ext}`,
      contentType: emoji.animated ? MIME_TYPES.GIF : MIME_TYPES.PNG,
      isAnimated:  emoji.animated,
      isEmoji:     true,
      emojiName:   emoji.name
    };
  } catch (error) {
    logger.error('Error processing emoji', error);
    return null;
  }
}

// ============================================================================
// GIF LINKS
// ============================================================================

/**
 * Detect Tenor / Giphy links in message content and embeds, resolve direct GIF
 * URLs, and return fake attachment objects plus cleaned messageContent.
 *
 * @param {string} messageContent
 * @param {import('discord.js').Message} message
 * @param {(c: string, m: import('discord.js').Message) => Promise<string>} replaceAllMentions
 * @returns {Promise<{ messageContent: string, gifLinkAttachments: object[] }>}
 */
export async function processGifLinks(messageContent, message, replaceAllMentions) {
  const gifLinks = [];
  const regex    = new RegExp(TENOR_GIPHY_REGEX.source, TENOR_GIPHY_REGEX.flags);
  let gifMatch;

  while ((gifMatch = regex.exec(messageContent)) !== null) {
    gifLinks.push(gifMatch[0]);
  }

  // Extract GIF URLs from Discord embeds (Tenor / Giphy providers)
  if (message.embeds?.length) {
    for (const embed of message.embeds) {
      const providerName = embed.provider?.name?.toLowerCase();
      if (providerName !== GIF_PROVIDERS.TENOR && providerName !== GIF_PROVIDERS.GIPHY) continue;

      const mediaUrl =
        embed.video?.url     || embed.video?.proxyURL     ||
        embed.image?.url     || embed.image?.proxyURL     ||
        embed.thumbnail?.url || embed.thumbnail?.proxyURL;

      if (!mediaUrl) continue;

      gifLinks.push(mediaUrl);

      let desc = embed.description || embed.title || embed.url || 'GIF';
      desc = await replaceAllMentions(desc, message);
      const ctx = `[User sent a ${embed.provider?.name || 'GIF'}${desc !== 'GIF' ? ': ' + desc : ''}]`;
      if (!messageContent.includes(ctx)) messageContent += `\n${ctx}`;
    }
  }

  const gifLinkAttachments = [];

  for (const gifUrl of gifLinks) {
    try {
      let gifName      = gifUrl.includes(GIF_PROVIDERS.TENOR) ? FILE_NAMES.TENOR_GIF : FILE_NAMES.GIPHY_GIF;
      let directGifUrl = gifUrl;

      // Resolve pretty names from URL path
      if (gifUrl.includes(GIF_PROVIDERS.TENOR)) {
        const m = gifUrl.match(/\/view\/([^/-]+)/);
        if (m) gifName = `${m[1]}.gif`;
      } else if (gifUrl.includes(GIF_PROVIDERS.GIPHY)) {
        const m = gifUrl.match(/\/gifs\/([^/-]+)/);
        if (m) gifName = `${m[1]}.gif`;
      }

      // Resolve to a direct media URL
      if (gifUrl.includes(GIF_DOMAINS.TENOR_VIEW)) {
        try {
          directGifUrl = gifUrl.endsWith('.gif') ? gifUrl : gifUrl + '.gif';
          const head = await axios.head(directGifUrl, { timeout: HTTP_HEAD_TIMEOUT_MS }).catch(() => null);
          if (!head || head.status !== 200) {
            const html = (await axios.get(gifUrl, { timeout: HTTP_TIMEOUT_MS })).data;
            const mp4m = html.match(/"url":"(https:\/\/media\.tenor\.com\/[^"]+\.mp4)"/);
            const gifm = html.match(/"url":"(https:\/\/media\.tenor\.com\/[^"]+\.gif)"/);
            if (mp4m) directGifUrl = mp4m[1].replace(/\\u002F/g, '/');
            else if (gifm) directGifUrl = gifm[1].replace(/\\u002F/g, '/');
          }
        } catch { continue; }

      } else if (gifUrl.includes(GIF_DOMAINS.GIPHY_GIFS)) {
        try {
          const html = (await axios.get(gifUrl, { timeout: HTTP_TIMEOUT_MS })).data;
          const m    = html.match(/"url":"(https:\/\/media\.giphy\.com\/media\/[^"]+\/giphy\.gif)"/);
          directGifUrl = m ? m[1] : (gifUrl.endsWith('.gif') ? gifUrl : gifUrl + '.gif');
        } catch { continue; }
      }

      gifLinkAttachments.push({
        id:          `gif-link-${Date.now()}-${Math.random()}`,
        name:        gifName,
        url:         directGifUrl,
        contentType: MIME_TYPES.GIF,
        size:        0,
        isGifLink:   true
      });

      messageContent = messageContent.replace(gifUrl, '').trim();
    } catch (error) {
      logger.error('Error processing GIF link', error);
    }
  }

  return { messageContent, gifLinkAttachments };
}

// ============================================================================
// ATTACHMENT PARTS
// ============================================================================

const GEMINI_MAX_MEDIA_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB

/**
 * Check if an attachment is supported by Gemma.
 * Gemma only accepts: images, GIFs (includes stickers and custom emojis which are image/gif).
 * @param {object} att
 * @returns {boolean}
 */
export function isGemmaSupported(att) {
  const ct  = (att.contentType || '').toLowerCase();
  const ext = path.extname(att.name || '').toLowerCase();
  return (
    GEMMA_SUPPORTED_MIME_PREFIXES.some(p => ct.startsWith(p)) ||
    GEMMA_SUPPORTED_EXTENSIONS.includes(ext)
  );
}

/**
 * Check if an attachment is supported by Gemini.
 * Gemini accepts: images, GIFs, video and audio under 5 MB.
 * @param {object} att
 * @returns {boolean}
 */
export function isGeminiSupported(att) {
  const ct   = (att.contentType || '').toLowerCase();
  const ext  = path.extname(att.name || '').toLowerCase();
  const size = att.size || 0;

  if (ct.startsWith('image/') || SUPPORTED_EXTENSIONS.IMAGE.includes(ext)) return true;

  const isVideo = ct.startsWith('video/') || SUPPORTED_EXTENSIONS.VIDEO.includes(ext);
  const isAudio = ct.startsWith('audio/') || SUPPORTED_EXTENSIONS.AUDIO.includes(ext);
  if ((isVideo || isAudio) && size <= GEMINI_MAX_MEDIA_SIZE_BYTES) return true;

  return false;
}

/**
 * Classify attachments into supported/unsupported for the given model.
 * Returns { supported, unsupported } where unsupported items include a `reason`.
 * @param {object[]} attachments
 * @param {string} modelName
 * @returns {{ supported: object[], unsupported: { name: string, reason: string }[] }}
 */
export function classifyAttachments(attachments, modelName) {
  const supported   = [];
  const unsupported = [];
  const gemma = isGemmaModel(modelName);

  for (const att of attachments) {
    const name = att.name || att.filename || 'file';
    const ct   = (att.contentType || '').toLowerCase();
    const ext  = path.extname(name).toLowerCase();
    const size = att.size || 0;

    if (gemma) {
      if (isGemmaSupported(att)) {
        supported.push(att);
      } else {
        const isVideo = ct.startsWith('video/') || SUPPORTED_EXTENSIONS.VIDEO.includes(ext);
        const isAudio = ct.startsWith('audio/') || SUPPORTED_EXTENSIONS.AUDIO.includes(ext);
        const isPdf   = ct === 'application/pdf' || ext === '.pdf';
        let reason;
        if (isVideo)      reason = 'videos are not supported by Gemma';
        else if (isAudio) reason = 'audio files are not supported by Gemma';
        else if (isPdf)   reason = 'PDFs are not supported by Gemma';
        else              reason = 'this file type is not supported by Gemma';
        unsupported.push({ name, reason });
      }
    } else {
      if (isGeminiSupported(att)) {
        supported.push(att);
      } else {
        const isVideo = ct.startsWith('video/') || SUPPORTED_EXTENSIONS.VIDEO.includes(ext);
        const isAudio = ct.startsWith('audio/') || SUPPORTED_EXTENSIONS.AUDIO.includes(ext);
        let reason;
        if ((isVideo || isAudio) && size > GEMINI_MAX_MEDIA_SIZE_BYTES) {
          reason = `file exceeds the 5 MB limit (${(size / 1024 / 1024).toFixed(1)} MB)`;
        } else {
          reason = 'this file type is not supported';
        }
        unsupported.push({ name, reason });
      }
    }
  }

  return { supported, unsupported };
}

/**
 * Build a Gemini-compatible `parts` array from a text prompt and message attachments.
 *
 * @param {string} prompt
 * @param {import('discord.js').Message} message
 * @param {object[]|null} [attachments]
 * @param {string} [modelName]
 * @returns {Promise<object[]>}
 */
export async function processPromptAndMediaAttachments(prompt, message, attachments = null, modelName = '') {
  const all = (attachments || Array.from(message.attachments.values()))
    .slice(0, ATTACHMENT_LIMITS.MAX_ATTACHMENTS);

  const parts = [{ text: prompt }];

  if (!all.length) return parts;

  const processed = await Promise.all(
    all.map(async (attachment) => {
      try {
        const { processAttachment } = await import('../attachments/FileUploader.js');
        return await processAttachment(attachment, message.author.id, message.id, modelName);
      } catch (error) {
        logger.error(`Error processing attachment ${attachment.name}`, error);
        return { text: `\n\n[Error processing file: ${attachment.name}]` };
      }
    })
  );

  for (const part of processed) {
    if (!part) continue;
    if (Array.isArray(part)) {
      for (const p of part) {
        if (p.fileUri || p.fileData || p.inlineData) parts.push(p);
      }
    } else if (part.fileUri || part.fileData || part.inlineData) {
      parts.push(part);
    }
  }

  return parts;
}

// ============================================================================
// CONTENT TYPE CHECKS  (shared by hasAnyContent guards)
// ============================================================================

export const SUPPORTED_CONTENT_TYPES = Object.freeze({
  IMAGE: 'image/',
  AUDIO: 'audio/',
  VIDEO: 'video/',
  PDF:   'application/pdf'
});

export const SUPPORTED_EXTENSIONS = Object.freeze({
  AUDIO:    ['.mp3', '.wav', '.aiff', '.aac', '.ogg', '.flac', '.m4a'],
  VIDEO:    ['.mp4', '.mov', '.mpeg', '.mpg', '.webm', '.avi', '.wmv', '.3gpp', '.flv'],
  IMAGE:    ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.tiff', '.bmp'],
  DOCUMENT: ['.pdf', '.txt', '.doc', '.docx', '.xls', '.xlsx', '.csv', '.tsv', '.pptx',
             '.rtf', '.html', '.py', '.java', '.js', '.css', '.json', '.xml', '.sql', '.log', '.md']
});

/**
 * Return true if an attachment has a type the bot can actually process.
 * @param {object} att - Attachment-like object with contentType and name fields.
 */
export function isSupportedAttachment(att) {
  const ct  = (att.contentType || '').toLowerCase();
  const ext = path.extname(att.name || '').toLowerCase();
  return (
    ct.startsWith(SUPPORTED_CONTENT_TYPES.IMAGE) ||
    ct.startsWith(SUPPORTED_CONTENT_TYPES.AUDIO) ||
    ct.startsWith(SUPPORTED_CONTENT_TYPES.VIDEO) ||
    ct.startsWith(SUPPORTED_CONTENT_TYPES.PDF)   ||
    SUPPORTED_EXTENSIONS.AUDIO.includes(ext)     ||
    SUPPORTED_EXTENSIONS.VIDEO.includes(ext)     ||
    SUPPORTED_EXTENSIONS.IMAGE.includes(ext)     ||
    SUPPORTED_EXTENSIONS.DOCUMENT.includes(ext)
  );
}
