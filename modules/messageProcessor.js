import { EmbedBuilder, MessageFlags, ButtonBuilder, ButtonStyle, ActionRowBuilder, AttachmentBuilder, ChannelType } from 'discord.js';
import path from 'path';
import fs from 'fs/promises';
import axios from 'axios';
import { getTextExtractor } from 'office-text-extractor';
import ffmpeg from 'fluent-ffmpeg';
import { delay } from '../tools/others.js';
import { functionTools, executeFunctionCalls } from './functionTools.js';
import { genAI, state, chatHistoryLock, updateChatHistory, saveStateToFile, TEMP_DIR, client, switchToNextKey, BOT_CONFIG, DEFAULT_SERVER_SETTINGS, DEFAULT_USER_SETTINGS } from '../botManager.js';
import { memorySystem } from '../memorySystem.js';
import config from '../config.js';
import * as db from '../database.js';
import { MODELS, safetySettings, getGenerationConfig, RATE_LIMIT_ERRORS, MODEL_FALLBACK_CHAIN, DEFAULT_MODEL } from './config.js';
import { updateEmbed, sendAsTextFile } from './responseHandler.js';

const TYPING_INTERVAL_MS = 4000;
const TYPING_TIMEOUT_MS = 120000;
const MAX_USER_QUEUE_SIZE = 5;
const WORD_THRESHOLD_FOR_INITIAL_MESSAGE = 150;
const MESSAGE_UPDATE_DEBOUNCE_MS = 800;

const RETRY_DELAYS = {
  DEFAULT: 1500,
  RATE_LIMIT: 2000,
  FILE_ERROR: 1000
};

const CHARACTER_LIMITS = {
  EMBEDDED: 3900,
  NORMAL: 1900,
  DISCORD_MAX: 2000
};

const FILE_CONTENT_LIMITS = {
  INLINE_MAX: 1000000,
  DISPLAY_MAX: 50000
};

const ATTACHMENT_LIMITS = {
  MAX_ATTACHMENTS: 5,
  MAX_EMOJIS: 5
};

const MESSAGE_FETCH_LIMITS = {
  DEFAULT_COUNT: 10,
  MAX_COUNT: 100,
  SINGLE_MESSAGE: 1
};

const GIF_EMBED_DELAY_MS = 1500;
const MAX_MODEL_FALLBACK_ATTEMPTS = 3;
const MAX_RETRY_ATTEMPTS = 3;
const MAX_FUNCTION_CALLING_TURNS = 3;

const DISCORD_MESSAGE_LINK_REGEX = /https?:\/\/(?:www\.)?discord\.com\/channels\/\d+\/\d+\/\d+/g;
const TENOR_GIPHY_REGEX = /https?:\/\/(?:www\.)?(tenor\.com\/view\/[^\s]+|giphy\.com\/gifs\/[^\s]+|media\.tenor\.com\/[^\s]+\.gif|media\.giphy\.com\/media\/[^\s]+\/giphy\.gif)/gi;
const CUSTOM_EMOJI_REGEX = /<a?:(\w+):(\d+)>/g;

const GIF_PROVIDERS = {
  TENOR: 'tenor',
  GIPHY: 'giphy'
};

const GIF_DOMAINS = {
  TENOR_VIEW: 'tenor.com/view/',
  TENOR_MEDIA: 'media.tenor.com',
  GIPHY_GIFS: 'giphy.com/gifs/',
  GIPHY_MEDIA: 'media.giphy.com'
};

const STICKER_FORMATS = {
  PNG: 2,
  APNG: 3,
  LOTTIE: 3,
  GIF: 4
};

const TEXT_FILE_EXTENSIONS = [
  '.html', '.js', '.css', '.json', '.xml', '.csv', 
  '.py', '.java', '.sql', '.log', '.md', '.txt', '.rtf'
];

const OFFICE_FILE_EXTENSIONS = ['.pptx', '.docx'];

const SUMMARY_PATTERNS = [
  /(?:summarize|summarise|summary).*?(?:around|next|following|from)\s+(\d+)\s+messages?/i,
  /(?:around|next|following|from)\s+(\d+)\s+messages?/i,
  /(\d+)\s+messages?.*?(?:around|after|from)/i,
  /(?:get|fetch|show|read)\s+(\d+)\s+messages?/i
];

const SUPPORTED_CONTENT_TYPES = {
  IMAGE: 'image/',
  AUDIO: 'audio/',
  VIDEO: 'video/',
  PDF: 'application/pdf'
};

const SUPPORTED_EXTENSIONS = {
  AUDIO: ['.mp3', '.wav', '.aiff', '.aac', '.ogg', '.flac', '.m4a'],
  VIDEO: ['.mp4', '.mov', '.mpeg', '.mpg', '.webm', '.avi', '.wmv', '.3gpp', '.flv'],
  IMAGE: ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.tiff', '.bmp'],
  DOCUMENT: ['.pdf', '.txt', '.doc', '.docx', '.xls', '.xlsx', '.csv', '.tsv', '.pptx', '.rtf', '.html', '.py', '.java', '.js', '.css', '.json', '.xml', '.sql', '.log', '.md']
};

const ERROR_CODES = {
  PERMISSION_DENIED: 403,
  RATE_LIMIT: 429
};

const ERROR_MESSAGES = {
  EMPTY_MESSAGE: "You didn't provide any content. What would you like to talk about?",
  GENERATION_FAILED: 'Generation Failed',
  CRITICAL_ERROR: 'Critical Error',
  UNEXPECTED_ERROR: 'An unexpected error occurred while processing your message. Please try again.',
  QUEUE_FULL: 'Queue Full',
  LARGE_RESPONSE: 'Large Response',
  LIMIT_EXCEEDED: 'Message Limit Exceeded',
  COMMAND_FAILED: 'Command failed to execute.',
  ALL_MODELS_FAILED: 'All models failed.',
  LARGE_RESPONSE_DESC: 'The response is too large. It will be sent as a text file once completed.',
  FUNCTION_LIMIT_REACHED: '[Function calling limit reached]'
};

const EMBED_TITLES = {
  EMPTY_MESSAGE: '💬 Empty Message',
  LARGE_RESPONSE: '📄 Large Response',
  QUEUE_FULL: '⏳ Queue Full',
  LIMIT_EXCEEDED: '⚠️ Message Limit Exceeded'
};

const COLORS = {
  INFO: 0x5865F2,
  WARNING: 0xFFAA00,
  ERROR: 0xFF0000
};

const CONTEXT_MARKERS = {
  REPLY_PREFIX: '[Context - Replying to',
  USER_RESPONSE: '[User\'s Response]',
  SEPARATOR: '-'.repeat(20),
  NO_TEXT: '[No text provided in reply, only attachments/interaction]',
  FORWARDED: '[Forwarded message]',
  STICKER_ANIMATED: 'Animated Sticker',
  STICKER_STATIC: 'Sticker',
  EMOJI_PREFIX: ':',
  EMOJI_SUFFIX: ':',
  GIF_SENT: '[User sent a',
  ATTACHMENT_PREFIX: '[Attachment:',
  EMBED_PREFIX: '[Embed',
  CONTENT_SUFFIX: 'Content]',
  ATTACHMENT_UNAVAILABLE: '[Previous file attachment - content no longer available]',
  INLINE_IMAGE: '[Previous inline image]',
  FILE_ERROR: '[Error processing file:',
  LINK_PROCESSED: '[Link Processed:',
  CONTEXT_FILE: '[Context: Attached file contains',
  DISCORD_MESSAGES: 'Discord messages to summarize from',
  FILE_REMOVAL: '[Previous file attachments were removed due to API key limitations. Please re-upload files if needed, or continue the conversation without them.]'
};

const FILE_NAMES = {
  DISCORD_SUMMARY_PREFIX: 'discord_summary_',
  FILE_EXTENSION: '.txt',
  TENOR_GIF: 'tenor_gif.gif',
  GIPHY_GIF: 'giphy_gif.gif'
};

const MIME_TYPES = {
  TEXT_PLAIN: 'text/plain',
  PNG: 'image/png',
  GIF: 'image/gif',
  JSON: 'application/json'
};

const DISPLAY_NAMES = {
  DISCORD_SUMMARY: 'Discord Summary Data'
};

const HTTP_TIMEOUT_MS = 5000;
const HTTP_HEAD_TIMEOUT_MS = 3000;

class TypingManager {
  constructor() {
    this.activeIntervals = new Map();
    this.cleanupTimers = new Map();
  }

  start(channel) {
    if (!channel || this.activeIntervals.has(channel.id)) {
      return;
    }

    this._clearExistingCleanup(channel.id);

    channel.sendTyping().catch(() => {});
    
    const intervalId = setInterval(() => {
      channel.sendTyping().catch(() => {});
    }, TYPING_INTERVAL_MS);
    
    this.activeIntervals.set(channel.id, intervalId);
    
    const cleanupTimer = setTimeout(() => {
      this.stop(channel.id);
    }, TYPING_TIMEOUT_MS);
    
    this.cleanupTimers.set(channel.id, cleanupTimer);
  }

  stop(channelId) {
    const intervalId = this.activeIntervals.get(channelId);
    if (intervalId) {
      clearInterval(intervalId);
      this.activeIntervals.delete(channelId);
    }

    this._clearExistingCleanup(channelId);
  }

  _clearExistingCleanup(channelId) {
    const cleanupTimer = this.cleanupTimers.get(channelId);
    if (cleanupTimer) {
      clearTimeout(cleanupTimer);
      this.cleanupTimers.delete(channelId);
    }
  }

  stopAll() {
    for (const [channelId, intervalId] of this.activeIntervals.entries()) {
      clearInterval(intervalId);
    }
    this.activeIntervals.clear();

    for (const [channelId, timer] of this.cleanupTimers.entries()) {
      clearTimeout(timer);
    }
    this.cleanupTimers.clear();
  }
}

const typingManager = new TypingManager();

function cleanHistoryFiles(history) {
  return history.map(entry => ({
    role: entry.role,
    parts: entry.parts.map(part => {
      if (part.fileUri || part.fileData) {
        return {
          text: CONTEXT_MARKERS.ATTACHMENT_UNAVAILABLE
        };
      }
      return part;
    }).filter(part => part.text)
  })).filter(entry => entry.parts.length > 0);
}

function isFileError(error) {
  const hasFileErrorCode = error?.status === ERROR_CODES.PERMISSION_DENIED || 
                           error?.code === ERROR_CODES.PERMISSION_DENIED || 
                           error?.message?.includes(String(ERROR_CODES.PERMISSION_DENIED));
  
  const hasFileKeywords = error?.message?.includes('File') || 
                          error?.message?.includes('file') || 
                          error?.message?.includes('PERMISSION_DENIED');
  
  return hasFileErrorCode && hasFileKeywords;
}

function isRateLimitError(error) {
  return RATE_LIMIT_ERRORS.some(code => 
    error?.message?.includes(code) || 
    error?.status === code || 
    error?.code?.includes(code)
  );
}

function extractCustomEmojis(content) {
  const emojis = [];
  let match;
  const regex = new RegExp(CUSTOM_EMOJI_REGEX);

  while ((match = regex.exec(content)) !== null) {
    const animated = match[0].startsWith('<a:');
    emojis.push({
      name: match[1],
      id: match[2],
      animated: animated,
      fullMatch: match[0]
    });
  }

  return emojis;
}

async function replaceUserMentionsWithUsernames(content, message) {
  const userMentionRegex = /<@!?(\d+)>/g;
  let match;
  const replacements = new Map();
  const userIds = [];

  while ((match = userMentionRegex.exec(content)) !== null) {
    const userId = match[1];
    const mentionText = match[0];
    
    if (!replacements.has(userId)) {
      try {
        const user = await client.users.fetch(userId).catch(() => null);
        if (user) {
          replacements.set(userId, `@${user.username} (ID: ${userId})`);
          userIds.push({ username: user.username, id: userId });
        } else {
          replacements.set(userId, mentionText);
        }
      } catch (error) {
        console.error(`Error fetching user ${userId}:`, error);
        replacements.set(userId, mentionText);
      }
    }
  }

  let result = content;
  for (const [userId, username] of replacements.entries()) {
    const mentionRegex = new RegExp(`<@!?${userId}>`, 'g');
    result = result.replace(mentionRegex, username);
  }

  // Add mention guide if there were any user mentions
  if (userIds.length > 0) {
    result += '\n\n[Mention Guide: To tag/mention users, use the format: <@USER_ID>]';
    result += '\nExample: To mention the user(s) above, use:';
    userIds.forEach(user => {
      result += `\n  • <@${user.id}> for @${user.username}`;
    });
  }

  return result;
}

async function replaceChannelMentionsWithNames(content, message) {
  const channelMentionRegex = /<#(\d+)>/g;
  let match;
  const replacements = new Map();

  while ((match = channelMentionRegex.exec(content)) !== null) {
    const channelId = match[1];
    const mentionText = match[0];
    
    if (!replacements.has(channelId)) {
      try {
        const channel = await client.channels.fetch(channelId).catch(() => null);
        if (channel && channel.name) {
          replacements.set(channelId, `#${channel.name}`);
        } else {
          replacements.set(channelId, mentionText);
        }
      } catch (error) {
        console.error(`Error fetching channel ${channelId}:`, error);
        replacements.set(channelId, mentionText);
      }
    }
  }

  let result = content;
  for (const [channelId, channelName] of replacements.entries()) {
    const mentionRegex = new RegExp(`<#${channelId}>`, 'g');
    result = result.replace(mentionRegex, channelName);
  }

  return result;
}

async function replaceRoleMentionsWithNames(content, message) {
  const roleMentionRegex = /<@&(\d+)>/g;
  let match;
  const replacements = new Map();

  while ((match = roleMentionRegex.exec(content)) !== null) {
    const roleId = match[1];
    const mentionText = match[0];
    
    if (!replacements.has(roleId)) {
      try {
        if (message.guild) {
          const role = await message.guild.roles.fetch(roleId).catch(() => null);
          if (role && role.name) {
            replacements.set(roleId, `@${role.name}`);
          } else {
            replacements.set(roleId, mentionText);
          }
        } else {
          replacements.set(roleId, mentionText);
        }
      } catch (error) {
        console.error(`Error fetching role ${roleId}:`, error);
        replacements.set(roleId, mentionText);
      }
    }
  }

  let result = content;
  for (const [roleId, roleName] of replacements.entries()) {
    const mentionRegex = new RegExp(`<@&${roleId}>`, 'g');
    result = result.replace(mentionRegex, roleName);
  }

  return result;
}

async function replaceAllMentions(content, message) {
  if (!content) return content;
  
  let result = content;
  result = await replaceUserMentionsWithUsernames(result, message);
  result = await replaceChannelMentionsWithNames(result, message);
  result = await replaceRoleMentionsWithNames(result, message);
  
  return result;
}

async function processStickerAsAttachment(sticker) {
  try {
    const isAnimated = sticker.format === STICKER_FORMATS.APNG || 
                       sticker.format === STICKER_FORMATS.LOTTIE || 
                       sticker.format === STICKER_FORMATS.GIF;
    
    let contentType = MIME_TYPES.PNG;
    let fileExtension = '.png';
    let url = sticker.url;

    if (sticker.format === STICKER_FORMATS.PNG) {
      contentType = MIME_TYPES.PNG;
      fileExtension = '.png';
    } else if (sticker.format === STICKER_FORMATS.LOTTIE) {
      contentType = MIME_TYPES.JSON;
      fileExtension = '.json';
    } else if (sticker.format === STICKER_FORMATS.GIF) {
      contentType = MIME_TYPES.GIF;
      fileExtension = '.gif';
      url = `https://media.discordapp.net/stickers/${sticker.id}.gif`;
    }
    
    const name = sticker.name.endsWith(fileExtension) ? sticker.name : `${sticker.name}${fileExtension}`;

    return {
      name: name,
      url: url,
      contentType: contentType,
      isAnimated: isAnimated,
      isSticker: true
    };
  } catch (error) {
    console.error('Error processing sticker:', error);
    return null;
  }
}

async function processEmojiAsAttachment(emoji) {
  try {
    const extension = emoji.animated ? 'gif' : 'png';
    const url = `https://cdn.discordapp.com/emojis/${emoji.id}.${extension}`;
    
    return {
      name: `${emoji.name}.${extension}`,
      url: url,
      contentType: emoji.animated ? MIME_TYPES.GIF : MIME_TYPES.PNG,
      isAnimated: emoji.animated,
      isEmoji: true,
      emojiName: emoji.name
    };
  } catch (error) {
    console.error('Error processing emoji:', error);
    return null;
  }
}

async function extractForwardedContent(message) {
  let forwardedText = '';
  let forwardedAttachments = [];
  let forwardedStickers = [];

  if (message.messageSnapshots && message.messageSnapshots.size > 0) {
    const snapshot = message.messageSnapshots.first();
    
    if (snapshot.content) {
      // Replace all mentions in forwarded content
      forwardedText = await replaceAllMentions(snapshot.content, message);
    }
    
    if (snapshot.embeds && snapshot.embeds.length > 0) {
      const embedTexts = await Promise.all(
        snapshot.embeds.map(async (embed) => {
          let text = '';
          if (embed.title) {
            const cleanTitle = await replaceAllMentions(embed.title, message);
            text += `**${cleanTitle}**\n`;
          }
          if (embed.description) {
            const cleanDescription = await replaceAllMentions(embed.description, message);
            text += cleanDescription;
          }
          return text;
        })
      );
      
      const filteredTexts = embedTexts.filter(t => t).join('\n\n');
      
      if (filteredTexts) {
        forwardedText += '\n\n' + filteredTexts;
      }
    }
    
    if (snapshot.attachments && snapshot.attachments.size > 0) {
      forwardedAttachments = Array.from(snapshot.attachments.values());
    }
    
    if (snapshot.stickers && snapshot.stickers.size > 0) {
      forwardedStickers = Array.from(snapshot.stickers.values());
    }
  }

  return { forwardedText, forwardedAttachments, forwardedStickers };
}

async function downloadAndReadFile(url, fileType) {
  if (OFFICE_FILE_EXTENSIONS.includes(fileType)) {
    const extractor = getTextExtractor();
    return await extractor.extractText({
      input: url,
      type: 'url'
    });
  }
  
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download ${response.statusText}`);
  }
  return await response.text();
}

async function processTextFiles(attachments, messageContent, prefix = '') {
  for (const attachment of attachments) {
    const fileType = path.extname(attachment.name).toLowerCase();

    if (TEXT_FILE_EXTENSIONS.includes(fileType)) {
      try {
        const fileContent = await downloadAndReadFile(attachment.url, fileType);

        if (fileContent.length <= FILE_CONTENT_LIMITS.INLINE_MAX) {
          messageContent += `\n\n${prefix}[\`${attachment.name}\` ${CONTEXT_MARKERS.CONTENT_SUFFIX}:\n\`\`\`\n${fileContent.slice(0, FILE_CONTENT_LIMITS.DISPLAY_MAX)}\n\`\`\``;
        }
      } catch (error) {
        console.error(`Error reading file ${attachment.name}: ${error.message}`);
      }
    }
  }
  return messageContent;
}

function parseMessageCount(prompt) {
  for (const pattern of SUMMARY_PATTERNS) {
    const match = prompt.match(pattern);
    if (match && match[1]) {
      const requestedCount = parseInt(match[1]);
      return {
        requested: requestedCount,
        actual: Math.min(requestedCount, MESSAGE_FETCH_LIMITS.MAX_COUNT)
      };
    }
  }
  
  if (/messages/i.test(prompt) && !/\b1\s+message/i.test(prompt)) {
    return {
      requested: MESSAGE_FETCH_LIMITS.DEFAULT_COUNT,
      actual: MESSAGE_FETCH_LIMITS.DEFAULT_COUNT
    };
  }
  
  return {
    requested: MESSAGE_FETCH_LIMITS.SINGLE_MESSAGE,
    actual: MESSAGE_FETCH_LIMITS.SINGLE_MESSAGE
  };
}

async function extractFileText(message, messageContent) {
  let finalPrompt = messageContent;
  const summaryParts = [];

  const messageLinks = finalPrompt.match(DISCORD_MESSAGE_LINK_REGEX);

  if (messageLinks && messageLinks.length > 0) {
    const { requested, actual } = parseMessageCount(finalPrompt);
    
    if (requested > MESSAGE_FETCH_LIMITS.MAX_COUNT) {
      try {
        const warningEmbed = new EmbedBuilder()
          .setColor(COLORS.WARNING)
          .setTitle(EMBED_TITLES.LIMIT_EXCEEDED)
          .setDescription(`You requested ${requested} messages, but the maximum limit is ${MESSAGE_FETCH_LIMITS.MAX_COUNT} messages.\n\nI will summarize the available messages around the linked message.`);
        
        await message.reply({ embeds: [warningEmbed] });
      } catch (error) {
        console.error('Error sending limit warning:', error);
      }
    }
    
    const { fetchMessagesForSummary } = await import('./utils.js');
    const result = await fetchMessagesForSummary(message, messageLinks[0], actual);
    
    if (result.error) {
      finalPrompt += `\n\n[Error: ${result.error}]`;
    } else if (result.success) {
      try {
        const fileName = `${FILE_NAMES.DISCORD_SUMMARY_PREFIX}${Date.now()}${FILE_NAMES.FILE_EXTENSION}`;
        const filePath = path.join(TEMP_DIR, fileName);
        const fileContent = `Discord Messages Summary Context\nChannel: #${result.channelName}\nServer: ${result.guildName}\nMessages Fetched: ${result.messageCount}\n\n${result.content}`;
        
        await fs.writeFile(filePath, fileContent);
        
        const uploadResult = await genAI.files.upload({
          file: filePath,
          config: {
            mimeType: MIME_TYPES.TEXT_PLAIN,
            displayName: DISPLAY_NAMES.DISCORD_SUMMARY
          }
        });

        await fs.unlink(filePath).catch(() => {});

        summaryParts.push({
          text: `${CONTEXT_MARKERS.CONTEXT_FILE} ${result.messageCount} ${CONTEXT_MARKERS.DISCORD_MESSAGES} #${result.channelName} in ${result.guildName}]`
        });
        summaryParts.push({
          fileData: {
            fileUri: uploadResult.uri,
            mimeType: uploadResult.mimeType
          }
        });

        finalPrompt = finalPrompt.replace(messageLinks[0], `${CONTEXT_MARKERS.LINK_PROCESSED} ${messageLinks[0]}]`);
      } catch (fileError) {
        console.error('Failed to create summary file:', fileError);
        finalPrompt += `\n\n[Discord Messages to Summarize]:\n${result.content}`;
      }
    }
  }

  if (message.attachments.size > 0) {
    const attachments = Array.from(message.attachments.values());
    finalPrompt = await processTextFiles(attachments, finalPrompt, '');
  }

  if (message.messageSnapshots && message.messageSnapshots.size > 0) {
    const snapshot = message.messageSnapshots.first();
    if (snapshot.attachments && snapshot.attachments.size > 0) {
      const forwardedAttachments = Array.from(snapshot.attachments.values());
      finalPrompt = await processTextFiles(forwardedAttachments, finalPrompt, '[Forwarded] ');
    }
  }

  return { finalPrompt, summaryParts };
}

async function processPromptAndMediaAttachments(prompt, message, attachments = null) {
  const allAttachments = attachments || Array.from(message.attachments.values());
  const limitedAttachments = allAttachments.slice(0, ATTACHMENT_LIMITS.MAX_ATTACHMENTS);

  const parts = [{ text: prompt }];

  if (limitedAttachments.length > 0) {
    const attachmentPromises = limitedAttachments.map(async (attachment) => {
      try {
        const { processAttachment } = await import('./attachmentProcessor.js');
        return await processAttachment(attachment, message.author.id, message.id);
      } catch (error) {
        console.error(`Error processing attachment ${attachment.name}:`, error);
        return { text: `\n\n${CONTEXT_MARKERS.FILE_ERROR} ${attachment.name}]` };
      }
    });

    const processedAttachments = await Promise.all(attachmentPromises);

    for (const processedPart of processedAttachments) {
      if (processedPart) {
        if (Array.isArray(processedPart)) {
          for (const part of processedPart) {
            if (part.fileUri || part.fileData || part.inlineData) {
              parts.push(part);
            }
          }
        } else if (processedPart.fileUri || processedPart.fileData || processedPart.inlineData) {
          parts.push(processedPart);
        }
      }
    }
  }

  return parts;
}

async function processGifLinks(messageContent, message) {
  const gifLinks = [];
  const regex = new RegExp(TENOR_GIPHY_REGEX);
  let gifMatch;

  while ((gifMatch = regex.exec(messageContent)) !== null) {
    gifLinks.push(gifMatch[0]);
  }

  if (message.embeds && message.embeds.length > 0) {
    for (const embed of message.embeds) {
      const providerName = embed.provider?.name?.toLowerCase();
      const isTenor = providerName === GIF_PROVIDERS.TENOR;
      const isGiphy = providerName === GIF_PROVIDERS.GIPHY;

      if (isTenor || isGiphy) {
        const mediaUrl = embed.video?.url || embed.video?.proxyURL ||
          embed.image?.url || embed.image?.proxyURL ||
          embed.thumbnail?.url || embed.thumbnail?.proxyURL;

        if (mediaUrl) {
          gifLinks.push(mediaUrl);
          let gifDescription = embed.description || embed.title || embed.url || 'GIF';
          // Replace mentions in GIF description
          gifDescription = await replaceAllMentions(gifDescription, message);
          const contextText = `${CONTEXT_MARKERS.GIF_SENT} ${embed.provider?.name || 'GIF'}${gifDescription !== 'GIF' ? ': ' + gifDescription : ''}]`;
          if (!messageContent.includes(contextText)) {
            messageContent += `\n${contextText}`;
          }
        }
      }
    }
  }

  const gifLinkAttachments = [];
  for (const gifUrl of gifLinks) {
    try {
      let gifName = FILE_NAMES.TENOR_GIF;
      
      if (gifUrl.includes(GIF_PROVIDERS.TENOR)) {
        const nameMatch = gifUrl.match(/\/view\/([^\/\-]+)/);
        gifName = nameMatch ? `${nameMatch[1]}.gif` : FILE_NAMES.TENOR_GIF;
      } else if (gifUrl.includes(GIF_PROVIDERS.GIPHY)) {
        const nameMatch = gifUrl.match(/\/gifs\/([^\/\-]+)/);
        gifName = nameMatch ? `${nameMatch[1]}.gif` : FILE_NAMES.GIPHY_GIF;
      }

      let directGifUrl = gifUrl;

      if (gifUrl.includes(GIF_DOMAINS.TENOR_MEDIA) || gifUrl.includes(GIF_DOMAINS.GIPHY_MEDIA)) {
        directGifUrl = gifUrl;
      } else if (gifUrl.includes(GIF_DOMAINS.TENOR_VIEW)) {
        try {
          if (!gifUrl.endsWith('.gif')) {
            directGifUrl = gifUrl + '.gif';
          }
          const testResponse = await axios.head(directGifUrl, { timeout: HTTP_HEAD_TIMEOUT_MS }).catch(() => null);
          if (!testResponse || testResponse.status !== 200) {
            const response = await axios.get(gifUrl, { timeout: HTTP_TIMEOUT_MS });
            const htmlContent = response.data;
            const mp4Match = htmlContent.match(/"url":"(https:\/\/media\.tenor\.com\/[^"]+\.mp4)"/);
            const gifMatch = htmlContent.match(/"url":"(https:\/\/media\.tenor\.com\/[^"]+\.gif)"/);

            if (mp4Match) {
              directGifUrl = mp4Match[1].replace(/\\u002F/g, '/');
            } else if (gifMatch) {
              directGifUrl = gifMatch[1].replace(/\\u002F/g, '/');
            }
          }
        } catch (error) {
          continue;
        }
      } else if (gifUrl.includes(GIF_DOMAINS.GIPHY_GIFS)) {
        try {
          const response = await axios.get(gifUrl, { timeout: HTTP_TIMEOUT_MS });
          const htmlContent = response.data;
          const gifMatch = htmlContent.match(/"url":"(https:\/\/media\.giphy\.com\/media\/[^"]+\/giphy\.gif)"/);
          if (gifMatch) {
            directGifUrl = gifMatch[1];
          } else {
            directGifUrl = gifUrl + (gifUrl.endsWith('.gif') ? '' : '.gif');
          }
        } catch (error) {
          continue;
        }
      }

      gifLinkAttachments.push({
        id: `gif-link-${Date.now()}-${Math.random()}`,
        name: gifName,
        url: directGifUrl,
        contentType: MIME_TYPES.GIF,
        size: 0,
        isGifLink: true
      });

      messageContent = messageContent.replace(gifUrl, '').trim();
    } catch (error) {
      console.error('Error processing GIF link:', error);
    }
  }

  return { messageContent, gifLinkAttachments };
}

async function handleTextMessage(message) {
  const botId = client.user.id;
  const userId = message.author.id;
  const guildId = message.guild?.id;
  const channelId = message.channel.id;

  typingManager.start(message.channel);

  try {
    if (guildId && state.realive && state.realive[guildId]) {
      const realiveConfig = state.realive[guildId];
      if (realiveConfig.enabled && realiveConfig.lastChannelId !== channelId) {
        realiveConfig.lastChannelId = channelId;
        db.saveRealiveConfig(guildId, realiveConfig).catch(e => console.error("Realive update failed", e));
      }
    }

    let messageContent = message.content.replace(new RegExp(`<@!?${botId}>`), '').trim();
    
    // Replace all mentions (users, channels, roles) with actual names
    messageContent = await replaceAllMentions(messageContent, message);

    const gifRegex = new RegExp(TENOR_GIPHY_REGEX);
    if (gifRegex.test(messageContent) && (!message.embeds || message.embeds.length === 0)) {
      await delay(GIF_EMBED_DELAY_MS);
      try {
        message = await message.channel.messages.fetch(message.id);
        messageContent = message.content.replace(new RegExp(`<@!?${botId}>`), '').trim();
        // Replace all mentions again after refetching message
        messageContent = await replaceAllMentions(messageContent, message);
      } catch (e) {}
    }

    let repliedMessageText = '';
    let repliedAttachments = [];

    if (message.reference && message.reference.messageId) {
      try {
        const repliedMsg = await message.channel.messages.fetch(message.reference.messageId).catch(() => null);

        if (repliedMsg) {
          let contextBuffer = `${CONTEXT_MARKERS.REPLY_PREFIX} ${repliedMsg.author.username}]:\n`;

          if (repliedMsg.content) {
            // Replace all mentions in replied message content
            const repliedContent = await replaceAllMentions(repliedMsg.content, message);
            contextBuffer += `${repliedContent}\n`;
          }

          if (repliedMsg.embeds.length > 0) {
            for (const [index, embed] of repliedMsg.embeds.entries()) {
              contextBuffer += `${CONTEXT_MARKERS.EMBED_PREFIX} ${index + 1} ${CONTEXT_MARKERS.CONTENT_SUFFIX}:\n`;
              
              if (embed.title) {
                const cleanTitle = await replaceAllMentions(embed.title, message);
                contextBuffer += `Title: ${cleanTitle}\n`;
              }
              
              if (embed.description) {
                const cleanDescription = await replaceAllMentions(embed.description, message);
                contextBuffer += `Description: ${cleanDescription}\n`;
              }
              
              if (embed.fields && embed.fields.length > 0) {
                for (const field of embed.fields) {
                  const cleanFieldName = await replaceAllMentions(field.name, message);
                  const cleanFieldValue = await replaceAllMentions(field.value, message);
                  contextBuffer += `${cleanFieldName}: ${cleanFieldValue}\n`;
                }
              }
            }
          }

          if (repliedMsg.attachments.size > 0) {
            repliedAttachments = Array.from(repliedMsg.attachments.values()).map(att => ({
              ...att,
              sourceContext: 'replied_message'
            }));
            contextBuffer += `[Contains ${repliedMsg.attachments.size} attachment(s)]\n`;
          }

          if (repliedMsg.stickers.size > 0) {
            repliedMsg.stickers.forEach(sticker => {
              contextBuffer += `[Sticker: ${sticker.name}]\n`;
            });
          }

          // Extract forwarded content from the replied message
          const { forwardedText: repliedForwardedText, forwardedAttachments: repliedForwardedAttachments, forwardedStickers: repliedForwardedStickers } = await extractForwardedContent(repliedMsg);
          
          if (repliedForwardedText) {
            contextBuffer += `${CONTEXT_MARKERS.FORWARDED}:\n${repliedForwardedText}\n`;
            
            if (repliedForwardedAttachments.length > 0) {
              contextBuffer += `[Contains ${repliedForwardedAttachments.length} forwarded attachment(s)]\n`;
            }
          }
          
          if (repliedForwardedAttachments.length > 0) {
            const taggedForwardedAttachments = repliedForwardedAttachments.map(att => ({
              ...att,
              sourceContext: 'replied_message_forwarded'
            }));
            repliedAttachments = [...repliedAttachments, ...taggedForwardedAttachments];
          }

          repliedMessageText = contextBuffer + "\n" + CONTEXT_MARKERS.SEPARATOR + "\n";
        }
      } catch (error) {
        console.error("Error processing reply context:", error);
      }
    }

    if (repliedMessageText) {
      const userText = messageContent ? messageContent : CONTEXT_MARKERS.NO_TEXT;
      messageContent = `${repliedMessageText}${CONTEXT_MARKERS.USER_RESPONSE}:\n${userText}`;
    }

    const gifResult = await processGifLinks(messageContent, message);
    messageContent = gifResult.messageContent;
    const gifLinkAttachments = gifResult.gifLinkAttachments;

    const { forwardedText, forwardedAttachments, forwardedStickers } = await extractForwardedContent(message);

    if (forwardedText) {
      if (messageContent === '') {
        messageContent = `${CONTEXT_MARKERS.FORWARDED}:\n${forwardedText}`;
      } else {
        messageContent = `${messageContent}\n\n${CONTEXT_MARKERS.FORWARDED}:\n${forwardedText}`;
      }
      
      if (forwardedAttachments.length > 0) {
        messageContent += `\n[Contains ${forwardedAttachments.length} forwarded attachment(s)]`;
      }
    }
    
    // Tag forwarded attachments from current message
    const taggedForwardedAttachments = forwardedAttachments.map(att => ({
      ...att,
      sourceContext: 'current_message_forwarded'
    }));

    const currentStickers = message.stickers ? Array.from(message.stickers.values()) : [];
    const allStickers = [...currentStickers, ...forwardedStickers];

    const stickerAttachments = [];
    for (const sticker of allStickers) {
      const stickerAttachment = await processStickerAsAttachment(sticker);
      if (stickerAttachment) {
        stickerAttachments.push(stickerAttachment);
        const stickerType = stickerAttachment.isAnimated ? CONTEXT_MARKERS.STICKER_ANIMATED : CONTEXT_MARKERS.STICKER_STATIC;
        if (!messageContent.includes(sticker.name)) {
          messageContent += `\n[${stickerType}: ${sticker.name}]`;
        }
      }
    }

    const customEmojis = extractCustomEmojis(messageContent);
    const limitedEmojis = customEmojis.slice(0, ATTACHMENT_LIMITS.MAX_EMOJIS);
    const exceededEmojis = customEmojis.slice(ATTACHMENT_LIMITS.MAX_EMOJIS);

    const emojiAttachments = [];
    if (limitedEmojis.length > 0) {
      for (const emoji of limitedEmojis) {
        const emojiAttachment = await processEmojiAsAttachment(emoji);
        if (emojiAttachment) {
          emojiAttachments.push(emojiAttachment);
        }
      }
    }

    if (exceededEmojis.length > 0) {
      for (const emoji of exceededEmojis) {
        messageContent = messageContent.replace(emoji.fullMatch, `${CONTEXT_MARKERS.EMOJI_PREFIX}${emoji.name}${CONTEXT_MARKERS.EMOJI_SUFFIX}`);
      }
    }

    const regularAttachments = Array.from(message.attachments.values()).map(att => ({
      ...att,
      sourceContext: 'current_message'
    }));

    const allAttachments = [
      ...repliedAttachments,
      ...regularAttachments,
      ...taggedForwardedAttachments,
      ...stickerAttachments,
      ...emojiAttachments,
      ...gifLinkAttachments
    ];

    if (message.poll || message.type === 46) {
      typingManager.stop(channelId);
      return;
    }

    const hasAnyContent = messageContent.trim() !== '' ||
      (allAttachments.length > 0 && allAttachments.some(att => {
        const contentType = (att.contentType || "").toLowerCase();
        const fileExtension = path.extname(att.name).toLowerCase();
        const supportedTypes = [
          contentType.startsWith(SUPPORTED_CONTENT_TYPES.IMAGE),
          contentType.startsWith(SUPPORTED_CONTENT_TYPES.AUDIO),
          contentType.startsWith(SUPPORTED_CONTENT_TYPES.VIDEO),
          contentType.startsWith(SUPPORTED_CONTENT_TYPES.PDF),
          SUPPORTED_EXTENSIONS.AUDIO.includes(fileExtension),
          SUPPORTED_EXTENSIONS.VIDEO.includes(fileExtension),
          SUPPORTED_EXTENSIONS.IMAGE.includes(fileExtension),
          SUPPORTED_EXTENSIONS.DOCUMENT.includes(fileExtension)
        ];
        return supportedTypes.some(t => t);
      }));

    if (!hasAnyContent) {
      typingManager.stop(channelId);
      const embed = new EmbedBuilder()
        .setColor(COLORS.INFO)
        .setTitle(EMBED_TITLES.EMPTY_MESSAGE)
        .setDescription(ERROR_MESSAGES.EMPTY_MESSAGE);
      await message.reply({ embeds: [embed] });
      return;
    }

    let botMessage = null;
    let parts;
    let hasMedia = false;
    let finalPromptForHistory = messageContent;

    try {
      const [fileExtractResult, initialParts] = await Promise.all([
        extractFileText(message, messageContent),
        processPromptAndMediaAttachments(messageContent, message, allAttachments)
      ]);

      const { finalPrompt, summaryParts } = fileExtractResult;
      finalPromptForHistory = finalPrompt;
      parts = initialParts;
      
      if (summaryParts && summaryParts.length > 0) {
        parts.push(...summaryParts);
      }
      
      hasMedia = parts.some(part => part.fileUri || part.fileData || part.inlineData);
    } catch (error) {
      console.error('Error initializing message:', error);
      typingManager.stop(channelId);
      return;
    }

    const userSettings = state.userSettings[userId] || {};
    const serverSettings = guildId ? (state.serverSettings[guildId] || {}) : {};
    const effectiveSettings = serverSettings.overrideUserSettings ? serverSettings : userSettings;

    let finalInstructions = config.coreSystemRules;

    let customInstructions;
    if (guildId) {
      if (state.channelWideChatHistory[channelId]) {
        customInstructions = state.customInstructions[channelId];
      } else if (serverSettings.customPersonality) {
        customInstructions = serverSettings.customPersonality;
      } else if (effectiveSettings.customPersonality) {
        customInstructions = effectiveSettings.customPersonality;
      } else {
        customInstructions = state.customInstructions[userId];
      }
    } else {
      customInstructions = effectiveSettings.customPersonality || state.customInstructions[userId];
    }

    if (customInstructions) {
      finalInstructions += `\n\nADDITIONAL PERSONALITY:\n${customInstructions}`;
    } else {
      finalInstructions += `\n\n${config.defaultPersonality}`;
    }

    let infoStr = '';
    if (guildId) {
      const userInfo = {
        username: message.author.username,
        displayName: message.author.displayName
      };
      infoStr = `\nYou are currently engaging with users in the ${message.guild.name} Discord server.\n\n## Current User Information\nUsername: \`${userInfo.username}\`\nDisplay Name: \`${userInfo.displayName}\``;
    } else {
      const userInfo = {
        username: message.author.username,
        displayName: message.author.displayName
      };
      infoStr = `\n## Current User Information\nUsername: \`${userInfo.username}\`\nDisplay Name: \`${userInfo.displayName}\``;
    }

    finalInstructions += infoStr;

    const isServerChatHistoryEnabled = guildId ? (serverSettings.serverChatHistory ?? DEFAULT_SERVER_SETTINGS.serverChatHistory) : false;
    const isChannelChatHistoryEnabled = guildId ? state.channelWideChatHistory[channelId] : false;
    const historyId = isServerChatHistoryEnabled ? guildId : (isChannelChatHistoryEnabled ? channelId : userId);

    const selectedModel = effectiveSettings.selectedModel || DEFAULT_MODEL;
    const modelName = MODELS[selectedModel];

    // Enable all tools - let the model decide what to use
const allTools = [
  { googleSearch: {} },
  { urlContext: {} },
  { codeExecution: {} },
  ...functionTools  // Add function calling capabilities
];

    const history = await memorySystem.getOptimizedHistory(
      historyId,
      finalPromptForHistory,
      modelName,
      userId,
      guildId
    );

    await handleModelResponse(
      botMessage,
      modelName,
      finalInstructions,
      null,
      safetySettings,
      allTools,
      history,
      parts,
      message,
      channelId,
      historyId,
      effectiveSettings,
      finalPromptForHistory,
      allAttachments
    );
    
  } catch (error) {
    console.error('Unhandled error in handleTextMessage:', error);
    typingManager.stop(channelId);
    
    try {
      const embed = new EmbedBuilder()
        .setColor(COLORS.ERROR)
        .setTitle(ERROR_MESSAGES.CRITICAL_ERROR)
        .setDescription(ERROR_MESSAGES.UNEXPECTED_ERROR);
      await message.reply({ embeds: [embed] });
    } catch (replyError) {
      console.error('Failed to send error message:', replyError);
    }
  }
}

async function executeFunctionCalls(functionCalls, userId, guildId) {
  const responses = [];
  
  for (const call of functionCalls) {
    try {
      const functionName = call.name;
      const args = call.args || {};
      
      let result;
      
      if (functionName === 'remember_fact') {
        const fact = args.fact;
        if (fact && userId) {
          const success = await memorySystem.addPersonalData(userId, fact);
          result = success ? 
            `Successfully remembered: ${fact}` : 
            'Failed to save the information';
        } else {
          result = 'Missing fact or user context';
        }
      } else if (functionName === 'forget_fact') {
        const keyword = args.keyword;
        if (keyword && userId) {
          const success = await memorySystem.removePersonalData(userId, keyword);
          result = success ? 
            `Successfully removed information related to: ${keyword}` : 
            `No information found related to: ${keyword}`;
        } else {
          result = 'Missing keyword or user context';
        }
      } else if (functionName === 'search_memory') {
        const query = args.query;
        if (query && userId) {
          const memories = await memorySystem.searchMemory(userId, guildId, query);
          result = memories.length > 0 ? 
            memories.join('\n') : 
            'No relevant memories found';
        } else {
          result = 'Missing query or user context';
        }
      } else {
        result = `Unknown function: ${functionName}`;
      }
      
      responses.push({
        functionResponse: {
          name: functionName,
          response: { result }
        }
      });
    } catch (error) {
      console.error(`Error executing function ${call.name}:`, error);
      responses.push({
        functionResponse: {
          name: call.name,
          response: { error: error.message }
        }
      });
    }
  }
  
  return responses;
}

async function handleModelResponse(
  initialBotMessage,
  modelName,
  systemInstruction,
  baseGenerationConfig,
  safetySettings,
  tools,
  history,
  parts,
  originalMessage,
  channelId,
  historyId,
  effectiveSettings,
  originalPrompt = '',
  allAttachments = []
) {
  const userId = originalMessage.author.id;
  const guildId = originalMessage.guild?.id;
  const responseFormat = effectiveSettings.responseFormat || BOT_CONFIG.DEFAULT_RESPONSE_FORMAT;
  
  // FIX: Use DEFAULT_USER_SETTINGS for fallback, as BOT_CONFIG doesn't have these specific keys
  const showActionButtons = effectiveSettings.showActionButtons ?? DEFAULT_USER_SETTINGS.showActionButtons;
  const continuousReply = effectiveSettings.continuousReply ?? DEFAULT_USER_SETTINGS.continuousReply;
  
  const maxCharacterLimit = responseFormat === 'Embedded' ? CHARACTER_LIMITS.EMBEDDED : CHARACTER_LIMITS.NORMAL;

  let currentModelIndex = MODEL_FALLBACK_CHAIN.indexOf(modelName);
  
  if (currentModelIndex === -1) {
    currentModelIndex = 0;
    modelName = MODEL_FALLBACK_CHAIN[0];
  }

  let attempts = MAX_RETRY_ATTEMPTS;
  let modelAttempts = 0;
  const maxModelAttempts = MODEL_FALLBACK_CHAIN.length;

  let updateTimeout = null;
  let tempResponse = '';
  let groundingMetadata = null;
  let urlContextMetadata = null;

  let botMessage = initialBotMessage;

  const shouldForceReply = () => {
    if (!continuousReply) return true;
    if (guildId && originalMessage.channel.lastMessageId !== originalMessage.id) {
      return true;
    }
    return false;
  };

  const updateMessage = async () => {
    if (!botMessage || !tempResponse.trim()) return;

    try {
      if (responseFormat === 'Embedded') {
        updateEmbed(botMessage, tempResponse, originalMessage, groundingMetadata, urlContextMetadata, effectiveSettings);
      } else {
        await botMessage.edit({
          content: tempResponse,
          embeds: []
        }).catch(() => {});
      }
    } catch (e) {}
    
    if (updateTimeout) {
      clearTimeout(updateTimeout);
      updateTimeout = null;
    }
  };

  const cleanup = () => {
    typingManager.stop(channelId);
    if (updateTimeout) {
      clearTimeout(updateTimeout);
      updateTimeout = null;
    }
  };

  try {
    while (modelAttempts < maxModelAttempts && attempts > 0) {
      try {
        let finalResponse = '';
        let isLargeResponse = false;
        const newHistory = [];
        newHistory.push({
          role: 'user',
          content: parts
        });

        const generationConfig = getGenerationConfig(modelName);
        
        console.log(`🤖 Using model: ${modelName} (attempt ${modelAttempts + 1}/${maxModelAttempts})`);

        const request = {
          model: modelName,
          contents: [...history, { role: 'user', parts }], 
          config: {
            systemInstruction: systemInstruction,
            ...generationConfig,
            tools: tools
          },
          safetySettings
        };

        let result = await genAI.models.generateContentStream(request);

        if (!result) {
          throw new Error('API returned undefined - check API keys');
        }

        typingManager.stop(channelId);

        let functionCallParts = [];
        
        for await (const chunk of result) {
          if (chunk.functionCalls && chunk.functionCalls.length > 0) {
            functionCallParts.push(...chunk.functionCalls);
          }
          
          const chunkText = chunk.text || '';
          
          let codeOutput = "";
          if (chunk.codeExecutionResult) {
            const outcome = chunk.codeExecutionResult.outcome || 'UNKNOWN';
            const output = chunk.codeExecutionResult.output || '';
            if (output) {
              codeOutput = `\n**Code Execution (${outcome}):**\n\`\`\`\n${output}\n\`\`\`\n`;
            }
          }
          
          let executableCode = "";
          if (chunk.executableCode) {
            const language = chunk.executableCode.language || 'python';
            const code = chunk.executableCode.code || '';
            if (code) {
              executableCode = `\n**Generated Code (${language}):**\n\`\`\`${language.toLowerCase()}\n${code}\n\`\`\`\n`;
            }
          }
              
          const combinedText = chunkText + executableCode + codeOutput;
          if (combinedText) {
            finalResponse += combinedText;
            tempResponse += combinedText;

            const currentWordCount = tempResponse.trim().split(/\s+/).length;

            if (!botMessage && currentWordCount > WORD_THRESHOLD_FOR_INITIAL_MESSAGE) {
              try {
                if (shouldForceReply()) {
                  botMessage = await originalMessage.reply({ content: tempResponse });
                } else {
                  botMessage = await originalMessage.channel.send({ content: tempResponse });
                }
              } catch (createErr) {
                console.error("Error creating initial message:", createErr);
                throw createErr;
              }
            }

            if (botMessage) {
              if (finalResponse.length > maxCharacterLimit) {
                if (!isLargeResponse) {
                  isLargeResponse = true;
                  const embed = new EmbedBuilder()
                    .setColor(COLORS.WARNING)
                    .setTitle(EMBED_TITLES.LARGE_RESPONSE)
                    .setDescription(ERROR_MESSAGES.LARGE_RESPONSE_DESC);

                  botMessage.edit({ content: ' ', embeds: [embed], components: [] }).catch(() => {});
                }
              } else if (!updateTimeout) {
                updateTimeout = setTimeout(updateMessage, MESSAGE_UPDATE_DEBOUNCE_MS);
              }
            }
          }

          if (chunk.candidates && chunk.candidates[0]?.groundingMetadata) {
            groundingMetadata = chunk.candidates[0].groundingMetadata;
          }
          if (chunk.candidates && chunk.candidates[0]?.url_context_metadata) {
            urlContextMetadata = chunk.candidates[0].url_context_metadata;
          }
        }

        if (functionCallParts.length > 0) {
          console.log(`🛠️ Executing ${functionCallParts.length} function call(s)...`);
          
          let functionTurnCount = 0;
          
          while (functionCallParts.length > 0 && functionTurnCount < MAX_FUNCTION_CALLING_TURNS) {
            functionTurnCount++;
            console.log(`🔄 Function turn ${functionTurnCount}/${MAX_FUNCTION_CALLING_TURNS}`);
            
            const functionResponses = await executeFunctionCalls(functionCallParts, userId, guildId);
            
            const functionTurnParts = [
              ...parts,
              ...functionCallParts.map(call => ({
                functionCall: call
              })),
              ...functionResponses
            ];

            const nextRequest = {
              model: modelName,
              contents: [...history, { role: 'user', parts: functionTurnParts }],
              config: { 
                systemInstruction: systemInstruction, 
                ...generationConfig, 
                tools: tools 
              },
              safetySettings
            };

            const nextResult = await genAI.models.generateContentStream(nextRequest);
            
            finalResponse = ''; 
            tempResponse = '';
            functionCallParts = [];

            for await (const chunk of nextResult) {
              if (chunk.functionCalls && chunk.functionCalls.length > 0) {
                functionCallParts.push(...chunk.functionCalls);
              }
              
              const chunkText = chunk.text || '';
              
              let codeOutput = "";
              if (chunk.codeExecutionResult) {
                const outcome = chunk.codeExecutionResult.outcome || 'UNKNOWN';
                const output = chunk.codeExecutionResult.output || '';
                if (output) {
                  codeOutput = `\n**Code Execution (${outcome}):**\n\`\`\`\n${output}\n\`\`\`\n`;
                }
              }
              
              let executableCode = "";
              if (chunk.executableCode) {
                const language = chunk.executableCode.language || 'python';
                const code = chunk.executableCode.code || '';
                if (code) {
                  executableCode = `\n**Generated Code (${language}):**\n\`\`\`${language.toLowerCase()}\n${code}\n\`\`\`\n`;
                }
              }
                  
              const combinedText = chunkText + executableCode + codeOutput;
              if (combinedText) {
                finalResponse += combinedText;
                tempResponse += combinedText;

                const currentWordCount = tempResponse.trim().split(/\s+/).length;

                if (!botMessage && currentWordCount > WORD_THRESHOLD_FOR_INITIAL_MESSAGE) {
                  try {
                    if (shouldForceReply()) {
                      botMessage = await originalMessage.reply({ content: tempResponse });
                    } else {
                      botMessage = await originalMessage.channel.send({ content: tempResponse });
                    }
                  } catch (createErr) {
                    console.error("Error creating initial message:", createErr);
                    throw createErr;
                  }
                }

                if (botMessage) {
                  if (finalResponse.length > maxCharacterLimit) {
                    if (!isLargeResponse) {
                      isLargeResponse = true;
                      const embed = new EmbedBuilder()
                        .setColor(COLORS.WARNING)
                        .setTitle(EMBED_TITLES.LARGE_RESPONSE)
                        .setDescription(ERROR_MESSAGES.LARGE_RESPONSE_DESC);

                      botMessage.edit({ content: ' ', embeds: [embed], components: [] }).catch(() => {});
                    }
                  } else if (!updateTimeout) {
                    updateTimeout = setTimeout(updateMessage, MESSAGE_UPDATE_DEBOUNCE_MS);
                  }
                }
              }

              if (chunk.candidates && chunk.candidates[0]?.groundingMetadata) {
                groundingMetadata = chunk.candidates[0].groundingMetadata;
              }
              if (chunk.candidates && chunk.candidates[0]?.url_context_metadata) {
                urlContextMetadata = chunk.candidates[0].url_context_metadata;
              }
            }
            
            if (functionCallParts.length === 0) {
              break;
            }
          }
          
          if (functionTurnCount >= MAX_FUNCTION_CALLING_TURNS && functionCallParts.length > 0) {
            console.warn(`⚠️ Function calling limit reached (${MAX_FUNCTION_CALLING_TURNS} turns), stopping recursion`);
            finalResponse += `\n\n${ERROR_MESSAGES.FUNCTION_LIMIT_REACHED}`;
          }
        }

        if (updateTimeout) {
          clearTimeout(updateTimeout);
          updateTimeout = null;
        }

        let wasShortResponse = false;
        
        if (!botMessage && finalResponse) {
          wasShortResponse = true;
          if (shouldForceReply()) {
            botMessage = await originalMessage.reply({ content: finalResponse });
          } else {
            botMessage = await originalMessage.channel.send({ content: finalResponse });
          }
        }

        newHistory.push({
          role: 'assistant',
          content: [{ text: finalResponse }]
        });

        if (botMessage) {
          if (!isLargeResponse && responseFormat === 'Embedded') {
            updateEmbed(botMessage, finalResponse, originalMessage, groundingMetadata, urlContextMetadata, effectiveSettings);
          } else if (!isLargeResponse && !wasShortResponse) {
            await botMessage.edit({
              content: finalResponse.slice(0, CHARACTER_LIMITS.DISCORD_MAX),
              embeds: []
            }).catch(() => {});
          }
        }

        if (isLargeResponse && botMessage) {
          botMessage = await sendAsTextFile(finalResponse, originalMessage, botMessage.id, continuousReply);
        }

        if (showActionButtons && botMessage && !isLargeResponse) {
  const { addDownloadButton, addDeleteButton } = await import('./buttonHandlers.js');
  botMessage = await addDownloadButton(botMessage);
  botMessage = await addDeleteButton(botMessage, botMessage.id, userId);
        }

        if (newHistory.length > 1 && botMessage) {
          chatHistoryLock.runExclusive(async () => {
            const username = originalMessage.author.username;
            const displayName = originalMessage.author.displayName;
            updateChatHistory(historyId, newHistory, botMessage.id, username, displayName);
            
            memorySystem.storeMemoryWithEmbedding(
              historyId,
              newHistory,
              userId,
              guildId
            ).catch(err => console.error('Background memory save failed:', err));
            
            await saveStateToFile();
          }).catch(err => console.error('Background history save failed:', err));
        }
        
        cleanup();
        break;

      } catch (error) {
        attempts--;

        if (isFileError(error)) {
          console.warn(`📁 File permission error detected - cleaning history and retrying on same key`);
          console.warn(`📁 Error details: ${error?.message || 'Unknown file error'}`);
          
          history = cleanHistoryFiles(history);
          parts = parts.filter(part => !part.fileUri && !part.fileData);
          
          const hasTextContent = parts.some(p => p.text && p.text.trim().length > 0);
          if (!hasTextContent) {
            parts.unshift({ 
              text: CONTEXT_MARKERS.FILE_REMOVAL
            });
          }
          
          if (attempts > 0) {
            typingManager.start(originalMessage.channel);
            await delay(RETRY_DELAYS.FILE_ERROR);
            continue;
          }
        }

        const rotated = switchToNextKey(error);

        if (rotated && attempts > 0) {
          typingManager.start(originalMessage.channel);

          try {
            const [cleanedHistory, reprocessedResult] = await Promise.all([
              Promise.resolve(cleanHistoryFiles(history)),
              (async () => {
                const { finalPrompt, summaryParts } = await extractFileText(originalMessage, originalPrompt);
                let updatedParts = await processPromptAndMediaAttachments(
                  finalPrompt,
                  originalMessage,
                  allAttachments
                );
                if (summaryParts && summaryParts.length > 0) {
                  updatedParts.push(...summaryParts);
                }
                return updatedParts;
              })()
            ]);

            history = cleanedHistory;
            parts = reprocessedResult;
            continue; 
          } catch (reProcessErr) {
            console.error("Failed to re-prepare context after rotation:", reProcessErr);
          }
        }
  
        if (isRateLimitError(error)) {
          console.log(`⚠️ Rate limit hit on ${modelName}, attempting fallback...`);
          typingManager.start(originalMessage.channel);
          
          currentModelIndex++;
          if (currentModelIndex < MODEL_FALLBACK_CHAIN.length) {
            modelName = MODEL_FALLBACK_CHAIN[currentModelIndex];
            modelAttempts++;
            attempts = MAX_RETRY_ATTEMPTS; 
            console.log(`🔄 Falling back to ${modelName}`);
            await delay(RETRY_DELAYS.RATE_LIMIT);
            continue; 
          }
        }
        
        if (attempts === 0 && modelAttempts >= maxModelAttempts - 1) {
          cleanup();
          const embed = new EmbedBuilder()
            .setColor(COLORS.ERROR)
            .setTitle(`❌ ${ERROR_MESSAGES.GENERATION_FAILED}`)
            .setDescription(`${ERROR_MESSAGES.ALL_MODELS_FAILED} Last error: ${error.message || 'Unknown error'}\n\nTried: ${MODEL_FALLBACK_CHAIN.slice(0, modelAttempts + 1).join(', ')}`);
          try {
            if (shouldForceReply()) {
              await originalMessage.reply({ embeds: [embed] });
            } else {
              await originalMessage.channel.send({ embeds: [embed] });
            }
          } catch (e) {}
          break;
        } else {
          await delay(RETRY_DELAYS.DEFAULT);
        }
      }
    }
  } catch (outerError) {
    console.error('Critical error in handleModelResponse:', outerError);
    cleanup();
    
    try {
      const embed = new EmbedBuilder()
        .setColor(COLORS.ERROR)
        .setTitle(`❌ ${ERROR_MESSAGES.CRITICAL_ERROR}`)
        .setDescription(ERROR_MESSAGES.UNEXPECTED_ERROR);
      await originalMessage.reply({ embeds: [embed] });
    } catch (e) {}
  } finally {
    cleanup();
  }
}

export async function processUserQueue(userId) {
  const userQueueData = state.requestQueues.get(userId);
  if (!userQueueData) return;

  if (userQueueData.isProcessing) {
    console.log(`⚠️ Queue for ${userId} is already processing, skipping duplicate call`);
    return;
  }

  userQueueData.isProcessing = true;

  while (userQueueData.queue.length > 0) {
    const currentItem = userQueueData.queue[0];

    try {
      if (currentItem.isChatInputCommand && currentItem.isChatInputCommand()) {
        const { executeSearchInteraction } = await import('./searchCommand.js');
        await executeSearchInteraction(currentItem);
      } else {
        await handleTextMessage(currentItem);
      }
    } catch (error) {
      console.error(`Error processing queued item for ${userId}:`, error);
      if (currentItem.channel) {
        typingManager.stop(currentItem.channel.id);
      }
    } finally {
      userQueueData.queue.shift();
    }
  }

  userQueueData.isProcessing = false;
  state.requestQueues.delete(userId);
}
