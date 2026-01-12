import { PermissionsBitField } from 'discord.js';
import axios from 'axios';
import { getTextExtractor } from 'office-text-extractor';
import { state, client } from '../botManager.js';
import config from '../config.js';

const DEFAULT_SERVER_SETTINGS = {
  SELECTED_MODEL: 'gemini-2.5-flash',
  RESPONSE_FORMAT: 'Normal',
  SHOW_ACTION_BUTTONS: false,
  CONTINUOUS_REPLY: true,
  CUSTOM_PERSONALITY: null,
  EMBED_COLOR: config.hexColour,
  OVERRIDE_USER_SETTINGS: true,
  SERVER_CHAT_HISTORY: false,
  ALLOWED_CHANNELS: []
};

const UPLOAD_CONFIG = {
  SITE_URL: 'https://bin.mudfish.net',
  ENDPOINT: '/api/text',
  TTL_MINUTES: 10080,
  TIMEOUT_MS: 3000
};

const DISCORD_LINK_REGEX = /https?:\/\/(?:www\.)?discord\.com\/channels\/(\d+)\/(\d+)\/(\d+)/;

const MESSAGE_FETCH_CONFIG = {
  MAX_ADDITIONAL_MESSAGES: 99,
  DEFAULT_MESSAGE_COUNT: 1
};

const PERMISSIONS_REQUIRED = {
  VIEW_CHANNEL: PermissionsBitField.Flags.ViewChannel,
  READ_HISTORY: PermissionsBitField.Flags.ReadMessageHistory
};

const ERROR_MESSAGES = {
  NO_SERVER_ACCESS: "I don't have access to that server.",
  NO_CHANNEL_ACCESS: "I don't have access to that channel.",
  NO_PERMISSIONS: "I don't have permission to read messages in that channel.",
  MESSAGE_NOT_FOUND: "Could not find that message. It may have been deleted.",
  FETCH_ERROR: "An error occurred while fetching the messages.",
  UPLOAD_FAILED: 'URL generation failed',
  DOWNLOAD_FAILED: 'Failed to download'
};

const SUCCESS_INDICATORS = {
  UPLOAD_URL_PREFIX: '\n🔗 URL: ',
  UPLOAD_FAILURE_PREFIX: '\n❌ '
};

const MESSAGE_FORMATTING = {
  SEPARATOR: '---',
  MESSAGE_PREFIX: '**Message',
  AUTHOR_PREFIX: '** - **',
  AUTHOR_SUFFIX: '** (',
  TIMESTAMP_SUFFIX: '):\n',
  ATTACHMENT_PREFIX: '[Attachment: ',
  ATTACHMENT_SUFFIX: ']',
  EMBED_PREFIX: '[Contains ',
  EMBED_SUFFIX: ' embed(s)]'
};

const OFFICE_FILE_TYPES = ['.pptx', '.docx'];

function createDefaultServerSettings() {
  return { ...DEFAULT_SERVER_SETTINGS };
}

function ensureServerSettingsComplete(settings) {
  if (!settings.allowedChannels) {
    settings.allowedChannels = [];
  }
  if (settings.showActionButtons === undefined) {
    settings.showActionButtons = DEFAULT_SERVER_SETTINGS.SHOW_ACTION_BUTTONS;
  }
  if (settings.continuousReply === undefined) {
    settings.continuousReply = DEFAULT_SERVER_SETTINGS.CONTINUOUS_REPLY;
  }
  return settings;
}

function initializeBlacklistArray(guildId) {
  if (!state.blacklistedUsers[guildId]) {
    state.blacklistedUsers[guildId] = [];
  }
}

function initializeServerSettings(guildId) {
  if (!state.serverSettings[guildId]) {
    state.serverSettings[guildId] = createDefaultServerSettings();
  } else {
    state.serverSettings[guildId] = ensureServerSettingsComplete(state.serverSettings[guildId]);
  }
}

export function initializeBlacklistForGuild(guildId) {
  try {
    initializeBlacklistArray(guildId);
    initializeServerSettings(guildId);
  } catch (error) {
    console.error('Error initializing blacklist for guild:', error);
  }
}

function buildUploadUrl(key) {
  return `${UPLOAD_CONFIG.SITE_URL}/t/${key}`;
}

function formatUploadSuccess(url) {
  return `${SUCCESS_INDICATORS.UPLOAD_URL_PREFIX}${url}`;
}

function formatUploadFailure() {
  return `${SUCCESS_INDICATORS.UPLOAD_FAILURE_PREFIX}${ERROR_MESSAGES.UPLOAD_FAILED}`;
}

export async function uploadText(text) {
  try {
    const response = await axios.post(
      `${UPLOAD_CONFIG.SITE_URL}${UPLOAD_CONFIG.ENDPOINT}`,
      {
        text: text,
        ttl: UPLOAD_CONFIG.TTL_MINUTES
      },
      {
        timeout: UPLOAD_CONFIG.TIMEOUT_MS
      }
    );

    const key = response.data.tid;
    const url = buildUploadUrl(key);
    return formatUploadSuccess(url);
  } catch (error) {
    console.error('Upload text error:', error);
    return formatUploadFailure();
  }
}

function parseMessageLinkComponents(url) {
  const match = url.match(DISCORD_LINK_REGEX);
  
  if (match) {
    return {
      guildId: match[1],
      channelId: match[2],
      messageId: match[3]
    };
  }
  return null;
}

export function parseDiscordMessageLink(url) {
  return parseMessageLinkComponents(url);
}

function validateGuildAccess(guildId) {
  const guild = client.guilds.cache.get(guildId);
  if (!guild) {
    return { valid: false, error: ERROR_MESSAGES.NO_SERVER_ACCESS };
  }
  return { valid: true, guild };
}

function validateChannelAccess(guild, channelId) {
  const channel = guild.channels.cache.get(channelId);
  if (!channel) {
    return { valid: false, error: ERROR_MESSAGES.NO_CHANNEL_ACCESS };
  }
  return { valid: true, channel };
}

function validateChannelPermissions(channel) {
  const permissions = channel.permissionsFor(client.user);
  
  if (!permissions.has(PERMISSIONS_REQUIRED.VIEW_CHANNEL) || 
      !permissions.has(PERMISSIONS_REQUIRED.READ_HISTORY)) {
    return { valid: false, error: ERROR_MESSAGES.NO_PERMISSIONS };
  }
  
  return { valid: true };
}

async function fetchStartMessage(channel, messageId) {
  const startMessage = await channel.messages.fetch(messageId).catch(() => null);
  
  if (!startMessage) {
    return { success: false, error: ERROR_MESSAGES.MESSAGE_NOT_FOUND };
  }
  
  return { success: true, message: startMessage };
}

function calculateMessageFetchCounts(requestedCount) {
  const messagesToFetch = Math.min(requestedCount - 1, MESSAGE_FETCH_CONFIG.MAX_ADDITIONAL_MESSAGES);
  const halfCount = Math.floor(messagesToFetch / 2);
  
  return {
    older: halfCount,
    newer: messagesToFetch - halfCount
  };
}

async function fetchSurroundingMessages(channel, messageId, count) {
  if (count <= MESSAGE_FETCH_CONFIG.DEFAULT_MESSAGE_COUNT) {
    return [];
  }

  const fetchCounts = calculateMessageFetchCounts(count);

  try {
    const [olderMessages, newerMessages] = await Promise.all([
      channel.messages.fetch({
        before: messageId,
        limit: fetchCounts.older
      }).catch(() => null),
      channel.messages.fetch({
        after: messageId,
        limit: fetchCounts.newer
      }).catch(() => null)
    ]);

    const sortedOlder = olderMessages ? 
      Array.from(olderMessages.values()).sort((a, b) => a.createdTimestamp - b.createdTimestamp) : [];
    
    const sortedNewer = newerMessages ? 
      Array.from(newerMessages.values()).sort((a, b) => a.createdTimestamp - b.createdTimestamp) : [];
    
    return { older: sortedOlder, newer: sortedNewer };
  } catch (fetchError) {
    console.error('Error fetching additional messages:', fetchError);
    return { older: [], newer: [] };
  }
}

function formatMessageContent(msg, index) {
  let content = `${MESSAGE_FORMATTING.MESSAGE_PREFIX} ${index + 1}${MESSAGE_FORMATTING.AUTHOR_PREFIX}${msg.author.username}${MESSAGE_FORMATTING.AUTHOR_SUFFIX}${msg.createdAt.toLocaleString()}${MESSAGE_FORMATTING.TIMESTAMP_SUFFIX}`;
  
  if (msg.content) {
    content += msg.content;
  }
  
  if (msg.attachments.size > 0) {
    const attachmentList = Array.from(msg.attachments.values())
      .map(att => `${MESSAGE_FORMATTING.ATTACHMENT_PREFIX}${att.name}${MESSAGE_FORMATTING.ATTACHMENT_SUFFIX}`)
      .join(', ');
    content += `\n${attachmentList}`;
  }
  
  if (msg.embeds.length > 0) {
    content += `\n${MESSAGE_FORMATTING.EMBED_PREFIX}${msg.embeds.length}${MESSAGE_FORMATTING.EMBED_SUFFIX}`;
  }
  
  return content;
}

function formatMessages(messages) {
  return messages
    .map(formatMessageContent)
    .join(`\n\n${MESSAGE_FORMATTING.SEPARATOR}\n\n`);
}

export async function fetchMessagesForSummary(message, messageLink, count = MESSAGE_FETCH_CONFIG.DEFAULT_MESSAGE_COUNT) {
  try {
    const parsed = parseMessageLinkComponents(messageLink);
    if (!parsed) {
      return null;
    }

    const { guildId, channelId, messageId } = parsed;

    const guildValidation = validateGuildAccess(guildId);
    if (!guildValidation.valid) {
      return { error: guildValidation.error };
    }

    const channelValidation = validateChannelAccess(guildValidation.guild, channelId);
    if (!channelValidation.valid) {
      return { error: channelValidation.error };
    }

    const permissionValidation = validateChannelPermissions(channelValidation.channel);
    if (!permissionValidation.valid) {
      return { error: permissionValidation.error };
    }

    const startMessageResult = await fetchStartMessage(channelValidation.channel, messageId);
    if (!startMessageResult.success) {
      return { error: startMessageResult.error };
    }

    let messagesToSummarize = [startMessageResult.message];

    if (count > MESSAGE_FETCH_CONFIG.DEFAULT_MESSAGE_COUNT) {
      const surrounding = await fetchSurroundingMessages(channelValidation.channel, messageId, count);
      messagesToSummarize = [...surrounding.older, startMessageResult.message, ...surrounding.newer];
    }

    const formattedMessages = formatMessages(messagesToSummarize);

    return {
      success: true,
      content: formattedMessages,
      messageCount: messagesToSummarize.length,
      channelName: channelValidation.channel.name,
      guildName: guildValidation.guild.name
    };

  } catch (error) {
    console.error('Error fetching messages for summary:', error);
    return { error: ERROR_MESSAGES.FETCH_ERROR };
  }
}

function isOfficeFile(fileType) {
  return OFFICE_FILE_TYPES.includes(fileType);
}

async function extractOfficeFileText(url) {
  const extractor = getTextExtractor();
  return await extractor.extractText({
    input: url,
    type: 'url'
  });
}

async function downloadTextFile(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${ERROR_MESSAGES.DOWNLOAD_FAILED} ${response.statusText}`);
  }
  return await response.text();
}

export async function downloadAndReadFile(url, fileType) {
  if (isOfficeFile(fileType)) {
    return await extractOfficeFileText(url);
  }
  return await downloadTextFile(url);
}

function parseTimeValue(value) {
  return parseInt(value) || 0;
}

function getTimeUnit(unit) {
  const normalized = unit.toLowerCase();
  const units = {
    minute: 60 * 1000,
    minutes: 60 * 1000,
    hour: 60 * 60 * 1000,
    hours: 60 * 60 * 1000,
    day: 24 * 60 * 60 * 1000,
    days: 24 * 60 * 60 * 1000,
    week: 7 * 24 * 60 * 60 * 1000,
    weeks: 7 * 24 * 60 * 60 * 1000
  };
  return units[normalized] || 60 * 1000;
}

export function parseRelativeTime(relativeTimeStr) {
  const now = new Date();
  
  const simplePattern = /(\d+)\s*(minute|minutes|hour|hours|day|days|week|weeks)/i;
  const match = relativeTimeStr.match(simplePattern);
  
  if (match) {
    const value = parseTimeValue(match[1]);
    const unit = getTimeUnit(match[2]);
    return new Date(now.getTime() + (value * unit));
  }
  
  return new Date(now.getTime() + (60 * 60 * 1000));
}
