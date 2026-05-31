/**
 * @fileoverview Prompt assembly — mention replacement, reply/forwarded context,
 *               text-file extraction, and full message content preparation.
 * @module modules/message/PromptBuilder
 */

import path   from 'path';
import fs     from 'fs/promises';
import { getTextExtractor } from 'office-text-extractor';

import { client, genAI, TEMP_DIR } from '../../managers/BotManager.js';
import { Logger }                  from '../../core/Logger.js';
import { Embeds }                  from '../shared/embedBuilder.js';
import {
  TENOR_GIPHY_REGEX,
  GIF_EMBED_DELAY_MS,
  MIME_TYPES,
  extractCustomEmojis,
  processStickerAsAttachment,
  processEmojiAsAttachment,
  processGifLinks
} from './MediaHandler.js';

const logger = Logger.get('PromptBuilder');

// ============================================================================
// CONSTANTS
// ============================================================================

const FILE_CONTENT_LIMITS = Object.freeze({ INLINE_MAX: 1_000_000, DISPLAY_MAX: 50_000 });
const ATTACHMENT_LIMITS   = Object.freeze({ MAX_ATTACHMENTS: 5, MAX_EMOJIS: 5 });

const MESSAGE_FETCH_LIMITS = Object.freeze({
  DEFAULT_COUNT:  10,
  MAX_COUNT:      100,
  SINGLE_MESSAGE: 1
});

const TEXT_FILE_EXTENSIONS   = ['.html', '.js', '.css', '.json', '.xml', '.csv', '.py', '.java', '.sql', '.log', '.md', '.txt', '.rtf'];
const OFFICE_FILE_EXTENSIONS = ['.pptx', '.docx'];

const SUMMARY_PATTERNS = [
  /(?:summarize|summarise|summary).*?(?:around|next|following|from)\s+(\d+)\s+messages?/i,
  /(?:around|next|following|from)\s+(\d+)\s+messages?/i,
  /(\d+)\s+messages?.*?(?:around|after|from)/i,
  /(?:get|fetch|show|read)\s+(\d+)\s+messages?/i
];

const DISCORD_LINK_REGEX = /https?:\/\/(?:www\.)?discord\.com\/channels\/\d+\/\d+\/\d+/g;

// M-1 fix: cache the bot mention regex at module level, computed once after client is ready.
// Avoids recompiling on every single message.
let _botMentionRegex = null;
function getBotMentionRegex() {
  if (!_botMentionRegex && client?.user?.id) {
    _botMentionRegex = new RegExp(`<@!?${client.user.id}>`, 'g');
  }
  return _botMentionRegex || /<@!?\d+>/g; // fallback before ready
}

// ============================================================================
// MENTION REPLACEMENT
// ============================================================================

/**
 * Replace user mentions <@uid> / <@!uid> with full display name + username + ID.
 * Returns { text, mentions[] } so replaceAllMentions can build a combined guide.
 *
 * M-2 fix: collect all IDs first, then fetch in parallel instead of sequentially.
 * M-3 fix: prefer GuildMember (has server display name) over bare User.
 */
async function replaceUserMentions(content, message) {
  const matches = [...content.matchAll(/<@!?(\d+)>/g)];
  if (matches.length === 0) return { text: content, mentions: [] };

  const uniqueIds = [...new Set(matches.map(m => m[1]))];

  // Try to fetch as GuildMember first (richer info), fall back to User
  const fetched = await Promise.allSettled(
    uniqueIds.map(id => {
      if (message.guild) {
        return message.guild.members.fetch(id)
          .catch(() => client.users.fetch(id).catch(() => null));
      }
      return client.users.fetch(id).catch(() => null);
    })
  );

  const replacements = new Map();
  const mentions     = [];

  uniqueIds.forEach((uid, i) => {
    const entity = fetched[i].status === 'fulfilled' ? fetched[i].value : null;
    if (!entity) { replacements.set(uid, `<@${uid}>`); return; }

    // GuildMember exposes .user; plain User does not
    const isGuildMember = !!entity.user;
    const user          = isGuildMember ? entity.user : entity;
    const displayName   = isGuildMember ? entity.displayName : (user.globalName || user.username);
    const username      = user.username;

    // Format: DisplayName (@username) [ID: uid]
    replacements.set(uid, `${displayName} (@${username}) [ID: ${uid}]`);
    mentions.push({ type: 'user', id: uid, displayName, username });
  });

  let text = content;
  for (const [uid, label] of replacements) {
    text = text.replace(new RegExp(`<@!?${uid}>`, 'g'), label);
  }

  return { text, mentions };
}

/**
 * Replace channel mentions <#cid> with name + ID.
 * Returns { text, mentions[] }.
 */
async function replaceChannelMentions(content, message) {
  const matches = [...content.matchAll(/<#(\d+)>/g)];
  if (matches.length === 0) return { text: content, mentions: [] };

  const uniqueIds = [...new Set(matches.map(m => m[1]))];

  const fetched = await Promise.allSettled(
    uniqueIds.map(id => client.channels.fetch(id).catch(() => null))
  );

  const replacements = new Map();
  const mentions     = [];

  uniqueIds.forEach((cid, i) => {
    const channel = fetched[i].status === 'fulfilled' ? fetched[i].value : null;
    if (channel?.name) {
      // Format: #channelname [ID: cid]
      replacements.set(cid, `#${channel.name} [ID: ${cid}]`);
      mentions.push({ type: 'channel', id: cid, name: channel.name });
    } else {
      replacements.set(cid, `<#${cid}>`);
    }
  });

  let text = content;
  for (const [cid, label] of replacements) {
    text = text.replace(new RegExp(`<#${cid}>`, 'g'), label);
  }

  return { text, mentions };
}

/**
 * Replace role mentions <@&rid> with name + ID.
 * Returns { text, mentions[] }.
 */
async function replaceRoleMentions(content, message) {
  const matches = [...content.matchAll(/<@&(\d+)>/g)];
  if (matches.length === 0) return { text: content, mentions: [] };

  const uniqueIds = [...new Set(matches.map(m => m[1]))];

  const replacements = new Map();
  const mentions     = [];

  if (message.guild) {
    const fetched = await Promise.allSettled(
      uniqueIds.map(id => message.guild.roles.fetch(id).catch(() => null))
    );
    uniqueIds.forEach((rid, i) => {
      const role = fetched[i].status === 'fulfilled' ? fetched[i].value : null;
      if (role?.name) {
        // Format: @rolename [ID: rid]
        replacements.set(rid, `@${role.name} [ID: ${rid}]`);
        mentions.push({ type: 'role', id: rid, name: role.name });
      } else {
        replacements.set(rid, `<@&${rid}>`);
      }
    });
  } else {
    uniqueIds.forEach(rid => replacements.set(rid, `<@&${rid}>`));
  }

  let text = content;
  for (const [rid, label] of replacements) {
    text = text.replace(new RegExp(`<@&${rid}>`, 'g'), label);
  }

  return { text, mentions };
}

/**
 * Replace all Discord mention formats (<@uid>, <#cid>, <@&rid>) with readable names
 * that include both the human-readable label AND the underlying ID. Appends a
 * consolidated "Discord Mention Reference" block so the model always knows the exact
 * format to use when it needs to mention/reference a user, channel, or role in its reply.
 *
 * @param {string} content
 * @param {import('discord.js').Message} message
 * @returns {Promise<string>}
 */
export async function replaceAllMentions(content, message) {
  if (!content) return content ?? '';

  const userResult    = await replaceUserMentions(content, message);
  const channelResult = await replaceChannelMentions(userResult.text, message);
  const roleResult    = await replaceRoleMentions(channelResult.text, message);

  const allMentions = [...userResult.mentions, ...channelResult.mentions, ...roleResult.mentions];
  if (allMentions.length === 0) return roleResult.text;

  // Build a consolidated reference block for the model
  const lines = ['\n\n[Discord Mention Reference — use these exact formats in your reply:]'];

  const users    = allMentions.filter(m => m.type === 'user');
  const channels = allMentions.filter(m => m.type === 'channel');
  const roles    = allMentions.filter(m => m.type === 'role');

  if (users.length > 0) {
    lines.push('Users (mention with <@ID>):');
    for (const u of users) {
      lines.push(`  • ${u.displayName} (@${u.username}) — ID: ${u.id} → use <@${u.id}> to ping them`);
    }
  }
  if (channels.length > 0) {
    lines.push('Channels (reference with <#ID>):');
    for (const c of channels) {
      lines.push(`  • #${c.name} — ID: ${c.id} → use <#${c.id}> to link the channel`);
    }
  }
  if (roles.length > 0) {
    lines.push('Roles (mention with <@&ID>):');
    for (const r of roles) {
      lines.push(`  • @${r.name} — ID: ${r.id} → use <@&${r.id}> to ping the role`);
    }
  }

  lines.push(']');
  return roleResult.text + lines.join('\n');
}

// ============================================================================
// FORWARDED MESSAGE CONTENT
// ============================================================================

/**
 * Extract text, attachments, and stickers from a forwarded-message snapshot.
 * @param {import('discord.js').Message} message
 * @returns {Promise<{ forwardedText: string, forwardedAttachments: object[], forwardedStickers: object[] }>}
 */
export async function extractForwardedContent(message) {
  if (!message.messageSnapshots?.size) {
    return { forwardedText: '', forwardedAttachments: [], forwardedStickers: [] };
  }

  // L-4 fix: first() can return undefined if the collection is empty despite size > 0
  const snapshot = message.messageSnapshots.first();
  if (!snapshot) {
    return { forwardedText: '', forwardedAttachments: [], forwardedStickers: [] };
  }

  let forwardedText = '';

  if (snapshot.content) {
    forwardedText = await replaceAllMentions(snapshot.content, message);
  }

  if (snapshot.embeds?.length) {
    const texts = await Promise.all(
      snapshot.embeds.map(async (embed) => {
        let t = '';
        if (embed.title)       t += `**${await replaceAllMentions(embed.title, message)}**\n`;
        if (embed.description) t += await replaceAllMentions(embed.description, message);
        return t;
      })
    );
    const filtered = texts.filter(Boolean).join('\n\n');
    if (filtered) forwardedText += '\n\n' + filtered;
  }

  const forwardedAttachments = snapshot.attachments?.size
    ? Array.from(snapshot.attachments.values())
    : [];

  const forwardedStickers = snapshot.stickers?.size
    ? Array.from(snapshot.stickers.values())
    : [];

  return { forwardedText, forwardedAttachments, forwardedStickers };
}

// ============================================================================
// TEXT FILE HANDLING
// ============================================================================

async function downloadAndReadFile(url, fileType) {
  if (OFFICE_FILE_EXTENSIONS.includes(fileType)) {
    const extractor = getTextExtractor();
    return await extractor.extractText({ input: url, type: 'url' });
  }
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to download: ${response.statusText}`);
  return await response.text();
}

async function processTextFiles(attachments, messageContent, prefix = '') {
  for (const attachment of attachments) {
    const fileType = path.extname(attachment.name).toLowerCase();
    if (!TEXT_FILE_EXTENSIONS.includes(fileType)) continue;
    try {
      const fileContent = await downloadAndReadFile(attachment.url, fileType);
      if (fileContent.length <= FILE_CONTENT_LIMITS.INLINE_MAX) {
        messageContent += `\n\n${prefix}[\`${attachment.name}\` Content]:\n\`\`\`\n${fileContent.slice(0, FILE_CONTENT_LIMITS.DISPLAY_MAX)}\n\`\`\``;
      }
    } catch (error) {
      logger.error(`Error reading file ${attachment.name}`, error);
    }
  }
  return messageContent;
}

function parseMessageCount(prompt) {
  for (const pattern of SUMMARY_PATTERNS) {
    const match = prompt.match(pattern);
    if (match?.[1]) {
      const requested = parseInt(match[1]);
      return { requested, actual: Math.min(requested, MESSAGE_FETCH_LIMITS.MAX_COUNT) };
    }
  }
  if (/messages/i.test(prompt) && !/\b1\s+message/i.test(prompt)) {
    return { requested: MESSAGE_FETCH_LIMITS.DEFAULT_COUNT, actual: MESSAGE_FETCH_LIMITS.DEFAULT_COUNT };
  }
  return { requested: MESSAGE_FETCH_LIMITS.SINGLE_MESSAGE, actual: MESSAGE_FETCH_LIMITS.SINGLE_MESSAGE };
}

/**
 * Extract text content from Discord message links and text-file attachments.
 * Large context is uploaded to the Gemini Files API.
 *
 * @param {import('discord.js').Message} message
 * @param {string} messageContent
 * @returns {Promise<{ finalPrompt: string, summaryParts: object[] }>}
 */
export async function extractFileText(message, messageContent) {
  let finalPrompt  = messageContent;
  const summaryParts = [];

  const messageLinks = finalPrompt.match(DISCORD_LINK_REGEX);

  if (messageLinks?.length) {
    const { requested, actual } = parseMessageCount(finalPrompt);

    if (requested > MESSAGE_FETCH_LIMITS.MAX_COUNT) {
      try {
        await message.reply({
          embeds: [Embeds.warning(
            '⚠️ Message Limit Exceeded',
            `You requested ${requested} messages, but the maximum is ${MESSAGE_FETCH_LIMITS.MAX_COUNT}.\n\nI'll summarize available messages around the linked message.`
          )]
        });
      } catch { /* non-fatal warning */ }
    }

    const { fetchMessagesForSummary } = await import('../../utils.js');
    const result = await fetchMessagesForSummary(message, messageLinks[0], actual);

    if (result.error) {
      finalPrompt += `\n\n[Error: ${result.error}]`;
    } else if (result.success) {
      try {
        const fileName   = `discord_summary_${Date.now()}.txt`;
        const filePath   = path.join(TEMP_DIR, fileName);
        const fileContent = `Discord Messages Summary Context\nChannel: #${result.channelName}\nServer: ${result.guildName}\nMessages Fetched: ${result.messageCount}\n\n${result.content}`;

        await fs.writeFile(filePath, fileContent);

        const uploadResult = await genAI.files.upload({
          file:   filePath,
          config: { mimeType: MIME_TYPES.TEXT_PLAIN, displayName: 'Discord Summary Data' }
        });

        await fs.unlink(filePath).catch(() => {});

        summaryParts.push({
          text: `[Context: Attached file contains ${result.messageCount} Discord messages to summarize from #${result.channelName} in ${result.guildName}]`
        });
        summaryParts.push({
          fileData: { fileUri: uploadResult.uri, mimeType: uploadResult.mimeType }
        });

        finalPrompt = finalPrompt.replace(messageLinks[0], `[Link Processed: ${messageLinks[0]}]`);
      } catch (fileError) {
        logger.error('Failed to upload Discord summary file', fileError);
        finalPrompt += `\n\n[Discord Messages to Summarize]:\n${result.content}`;
      }
    }
  }

  if (message.attachments.size > 0) {
    finalPrompt = await processTextFiles(Array.from(message.attachments.values()), finalPrompt, '');
  }

  if (message.messageSnapshots?.size > 0) {
    const snapshot = message.messageSnapshots.first();
    if (snapshot.attachments?.size > 0) {
      finalPrompt = await processTextFiles(Array.from(snapshot.attachments.values()), finalPrompt, '[Forwarded] ');
    }
  }

  return { finalPrompt, summaryParts };
}

// ============================================================================
// FULL CONTENT PREPARATION
// ============================================================================

/**
 * Process a single Discord message into a structured object ready for the AI.
 * Handles bot mention stripping, reply context, forwarded content, GIFs,
 * stickers, custom emojis, and text-file extraction.
 *
 * @param {import('discord.js').Message} message
 * @returns {Promise<{
 *   message:         import('discord.js').Message,
 *   messageContent:  string,
 *   allAttachments:  object[],
 *   summaryParts:    object[],
 *   timestamp:       number
 * }>}
 */
export async function prepareMessageContent(message) {
  // M-1 fix: use module-level cached regex instead of rebuilding on every message
  const botMentionRe = getBotMentionRegex();

  let messageContent = message.content.replace(botMentionRe, '').trim();
  messageContent = await replaceAllMentions(messageContent, message);

  // Wait for Tenor/Giphy embeds to load if the link is bare in the message
  const gifRegex = new RegExp(TENOR_GIPHY_REGEX.source, TENOR_GIPHY_REGEX.flags);
  if (gifRegex.test(messageContent) && !message.embeds?.length) {
    await new Promise(resolve => setTimeout(resolve, GIF_EMBED_DELAY_MS));
    try {
      message = await message.channel.messages.fetch(message.id);
      messageContent = message.content.replace(botMentionRe, '').trim();
      messageContent = await replaceAllMentions(messageContent, message);
    } catch { /* best-effort refetch */ }
  }

  // ── Reply context ──────────────────────────────────────────────────────────
  let repliedMessageText = '';
  let repliedAttachments = [];

  if (message.reference?.messageId) {
    try {
      const repliedMsg = await message.channel.messages.fetch(message.reference.messageId).catch(() => null);

      if (repliedMsg) {
        let ctx = `[Context - Replying to ${repliedMsg.author.username}]:\n`;

        if (repliedMsg.content) {
          ctx += `${await replaceAllMentions(repliedMsg.content, message)}\n`;
        }

        for (const [i, embed] of repliedMsg.embeds.entries()) {
          ctx += `[Embed ${i + 1} Content]:\n`;
          if (embed.title)       ctx += `Title: ${await replaceAllMentions(embed.title, message)}\n`;
          if (embed.description) ctx += `Description: ${await replaceAllMentions(embed.description, message)}\n`;
          if (embed.fields?.length) {
            for (const field of embed.fields) {
              ctx += `${await replaceAllMentions(field.name, message)}: ${await replaceAllMentions(field.value, message)}\n`;
            }
          }
        }

        if (repliedMsg.attachments.size > 0) {
          repliedAttachments = Array.from(repliedMsg.attachments.values())
            .map(a => ({ ...a, sourceContext: 'replied_message' }));
          ctx += `[Contains ${repliedMsg.attachments.size} attachment(s)]\n`;
        }

        repliedMsg.stickers.forEach(s => { ctx += `[Sticker: ${s.name}]\n`; });

        const { forwardedText: rft, forwardedAttachments: rfa } = await extractForwardedContent(repliedMsg);
        if (rft) {
          ctx += `[Forwarded message]:\n${rft}\n`;
          if (rfa.length) ctx += `[Contains ${rfa.length} forwarded attachment(s)]\n`;
        }
        if (rfa.length) {
          repliedAttachments = [
            ...repliedAttachments,
            ...rfa.map(a => ({ ...a, sourceContext: 'replied_message_forwarded' }))
          ];
        }

        repliedMessageText = ctx + '\n' + '-'.repeat(20) + '\n';
      }
    } catch (error) {
      logger.error('Error processing reply context', error);
    }
  }

  if (repliedMessageText) {
    const userText = messageContent || '[No text provided in reply, only attachments/interaction]';
    messageContent = `${repliedMessageText}[User's Response]:\n${userText}`;
  }

  // ── GIF links ──────────────────────────────────────────────────────────────
  const gifResult = await processGifLinks(messageContent, message, replaceAllMentions);
  messageContent  = gifResult.messageContent;
  const gifLinkAttachments = gifResult.gifLinkAttachments;

  // ── Forwarded content (current message) ───────────────────────────────────
  const { forwardedText, forwardedAttachments, forwardedStickers } = await extractForwardedContent(message);

  if (forwardedText) {
    const sep  = messageContent ? `${messageContent}\n\n` : '';
    messageContent = `${sep}[Forwarded message]:\n${forwardedText}`;
    if (forwardedAttachments.length) {
      messageContent += `\n[Contains ${forwardedAttachments.length} forwarded attachment(s)]`;
    }
  }

  const taggedForwardedAttachments = forwardedAttachments.map(a => ({
    ...a, sourceContext: 'current_message_forwarded'
  }));

  // ── Stickers ───────────────────────────────────────────────────────────────
  const currentStickers = message.stickers ? Array.from(message.stickers.values()) : [];
  const allStickers     = [...currentStickers, ...forwardedStickers];
  const stickerAttachments = [];

  for (const sticker of allStickers) {
    const sa = await processStickerAsAttachment(sticker);
    if (!sa) continue;
    stickerAttachments.push(sa);
    const type = sa.isAnimated ? 'Animated Sticker' : 'Sticker';
    if (!messageContent.includes(sticker.name)) {
      messageContent += `\n[${type}: ${sticker.name}]`;
    }
  }

  // ── Custom emojis ──────────────────────────────────────────────────────────
  const customEmojis  = extractCustomEmojis(messageContent);
  const limitedEmojis = customEmojis.slice(0, ATTACHMENT_LIMITS.MAX_EMOJIS);
  const exceededEmojis = customEmojis.slice(ATTACHMENT_LIMITS.MAX_EMOJIS);

  const emojiAttachments = [];
  for (const emoji of limitedEmojis) {
    const ea = await processEmojiAsAttachment(emoji);
    if (ea) emojiAttachments.push(ea);
  }
  for (const emoji of exceededEmojis) {
    messageContent = messageContent.replace(emoji.fullMatch, `:${emoji.name}:`);
  }

  // ── Assemble final attachment list ─────────────────────────────────────────
  const regularAttachments = Array.from(message.attachments.values())
    .map(a => ({ ...a, sourceContext: 'current_message' }));

  const allAttachments = [
    ...repliedAttachments,
    ...regularAttachments,
    ...taggedForwardedAttachments,
    ...stickerAttachments,
    ...emojiAttachments,
    ...gifLinkAttachments
  ];

  const { finalPrompt, summaryParts } = await extractFileText(message, messageContent);

  return {
    message,
    messageContent: finalPrompt,
    allAttachments,
    summaryParts:   summaryParts || [],
    timestamp:      message.createdTimestamp
  };
}
