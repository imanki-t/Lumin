import { EmbedBuilder, MessageFlags, ButtonBuilder, ButtonStyle, ActionRowBuilder, AttachmentBuilder } from 'discord.js';
import path from 'path';
import fs from 'fs/promises';
import { genAI, state, TEMP_DIR, BOT_CONFIG } from '../botManager.js';
import config from '../config.js';
import { MODELS, safetySettings, getGenerationConfig, RATE_LIMIT_ERRORS, DEFAULT_MODEL } from './config.js';
import { initializeBlacklistForGuild } from './utils.js';

const MAX_QUEUE_SIZE = 5;

const CHARACTER_LIMITS = {
  EMBEDDED: 3900,
  NORMAL: 1900,
  DISCORD_MAX: 2000,
  EMBED_DESCRIPTION: 4096
};

const RETRY_CONFIG = {
  MAX_ATTEMPTS: 3,
  BASE_DELAY_MS: 1000,
  MAX_DELAY_MS: 8000,
  DELAY_MULTIPLIER: 2
};

const METADATA_CONFIG = {
  MAX_QUERIES: 3,
  MAX_SOURCES: 5,
  MAX_URLS: 3
};

const EMBED_COLORS = {
  ERROR: 0xFF0000,
  WARNING: 0xFF5555,
  SUCCESS: 0x00FF00,
  INFO: 0x5865F2
};

const ERROR_MESSAGES = {
  NO_INPUT: 'Please provide either a text prompt or a file attachment.',
  INVALID_INPUT: 'Invalid Input',
  BLACKLISTED: 'You are blacklisted and cannot use this command.',
  BLACKLIST_TITLE: '🚫 Blacklisted',
  CHANNEL_RESTRICTED: 'This bot can only be used in specific channels set by server admins.',
  CHANNEL_RESTRICTED_TITLE: '❌ Channel Restricted',
  PROCESSING_ERROR: 'Processing Error',
  PROCESSING_FAILED: 'Failed to process the attachment',
  SEARCH_FAILED: 'Search Failed',
  SEARCH_ERROR: 'Search Error',
  UNEXPECTED_ERROR: 'An unexpected error occurred during the search.',
  QUEUE_FULL: 'Queue Full',
  QUEUE_FULL_MESSAGE: 'You have too many requests processing. Please wait.',
  REQUEST_ERROR: 'An error occurred while processing your search request.',
  INVALID_REQUEST: 'Could not process your request. Please try again.',
  FAILED_AFTER_RETRIES: 'Failed to complete search after multiple attempts.',
  FILE_SEND_FAILED: 'Failed to send search results file.'
};

const FIELD_NAMES = {
  SEARCH_QUERIES: '🔍 Search Queries',
  SOURCES: '📚 Sources',
  URL_CONTEXT: '🔗 URL Context'
};

const FIELD_PREFIXES = {
  BULLET: '• ',
  SOURCE_FALLBACK: 'Source'
};

const URL_RETRIEVAL_STATUS = {
  SUCCESS: 'URL_RETRIEVAL_STATUS_SUCCESS',
  SUCCESS_EMOJI: '✅',
  FAILURE_EMOJI: '❌'
};

const DEFAULT_ICONS = {
  GOOGLE_AI: 'https://ai.google.dev/static/site-assets/images/share.png'
};

const BUTTON_CONFIG = {
  DOWNLOAD: {
    CUSTOM_ID: 'download_message',
    LABEL: 'Save',
    EMOJI: '💾',
    STYLE: ButtonStyle.Secondary
  },
  DELETE: {
    CUSTOM_ID: 'delete_search_message',
    LABEL: 'Delete',
    EMOJI: '🗑️',
    STYLE: ButtonStyle.Danger
  }
};

const FILE_CONFIG = {
  PREFIX: 'search-results-',
  EXTENSION: '.txt'
};

const SEARCH_PROMPT_PREFIX = 'Search the web for current information about: ';
const SEARCH_RESULTS_PREFIX = 'your search results:';

function getCurrentDate() {
  return new Date().toLocaleDateString('en-US', { 
    weekday: 'long', 
    year: 'numeric', 
    month: 'long', 
    day: 'numeric' 
  });
}

const SEARCH_SYSTEM_PROMPT = `${config.coreSystemRules}

You are performing a web search to find current information.

SEARCH INSTRUCTIONS:
- You MUST use the googleSearch tool for every query
- Provide accurate, well-sourced information from search results
- Cite your sources when relevant
- Be concise and informative
- Current date: ${getCurrentDate()}`;

function createErrorEmbed(color, title, description) {
  return new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .setDescription(description);
}

function buildSearchTools(hasMedia) {
  const tools = [
    { googleSearch: {} },
    { urlContext: {} }
  ];

  if (!hasMedia) {
    tools.push({ codeExecution: {} });
  }

  return tools;
}

function formatSearchQuery(query) {
  return `${FIELD_PREFIXES.BULLET}${query}`;
}

function formatSource(chunk, index) {
  if (chunk.web) {
    const title = chunk.web.title || FIELD_PREFIXES.SOURCE_FALLBACK;
    return `${FIELD_PREFIXES.BULLET}[${title}](${chunk.web.uri})`;
  }
  return `${FIELD_PREFIXES.BULLET}${FIELD_PREFIXES.SOURCE_FALLBACK} ${index + 1}`;
}

function formatUrlMetadata(urlData) {
  const emoji = urlData.url_retrieval_status === URL_RETRIEVAL_STATUS.SUCCESS ? 
    URL_RETRIEVAL_STATUS.SUCCESS_EMOJI : 
    URL_RETRIEVAL_STATUS.FAILURE_EMOJI;
  return `${emoji} ${urlData.retrieved_url}`;
}

function createSearchEmbed(responseText, groundingMetadata, urlContextMetadata, embedColor, interaction) {
  const embed = new EmbedBuilder()
    .setColor(embedColor)
    .setDescription(responseText.slice(0, CHARACTER_LIMITS.EMBED_DESCRIPTION))
    .setTimestamp()
    .setAuthor({
      name: `Search Results for ${interaction.user.displayName}`,
      iconURL: interaction.user.displayAvatarURL()
    });

  if (groundingMetadata?.webSearchQueries?.length > 0) {
    const queries = groundingMetadata.webSearchQueries
      .slice(0, METADATA_CONFIG.MAX_QUERIES)
      .map(formatSearchQuery)
      .join('\n');

    embed.addFields({
      name: FIELD_NAMES.SEARCH_QUERIES,
      value: queries,
      inline: false
    });
  }

  if (groundingMetadata?.groundingChunks?.length > 0) {
    const chunks = groundingMetadata.groundingChunks
      .slice(0, METADATA_CONFIG.MAX_SOURCES)
      .map(formatSource)
      .join('\n');

    embed.addFields({
      name: FIELD_NAMES.SOURCES,
      value: chunks,
      inline: false
    });
  }

  if (urlContextMetadata?.url_metadata?.length > 0) {
    const urlList = urlContextMetadata.url_metadata
      .slice(0, METADATA_CONFIG.MAX_URLS)
      .map(formatUrlMetadata)
      .join('\n');

    embed.addFields({
      name: FIELD_NAMES.URL_CONTEXT,
      value: urlList,
      inline: false
    });
  }

  if (interaction.guild) {
    embed.setFooter({
      text: interaction.guild.name,
      iconURL: interaction.guild.iconURL() || DEFAULT_ICONS.GOOGLE_AI
    });
  }

  return embed;
}

function createActionButtons() {
  const downloadButton = new ButtonBuilder()
    .setCustomId(BUTTON_CONFIG.DOWNLOAD.CUSTOM_ID)
    .setLabel(BUTTON_CONFIG.DOWNLOAD.LABEL)
    .setEmoji(BUTTON_CONFIG.DOWNLOAD.EMOJI)
    .setStyle(BUTTON_CONFIG.DOWNLOAD.STYLE);

  const deleteButton = new ButtonBuilder()
    .setCustomId(BUTTON_CONFIG.DELETE.CUSTOM_ID)
    .setLabel(BUTTON_CONFIG.DELETE.LABEL)
    .setEmoji(BUTTON_CONFIG.DELETE.EMOJI)
    .setStyle(BUTTON_CONFIG.DELETE.STYLE);

  return [new ActionRowBuilder().addComponents(downloadButton, deleteButton)];
}

function calculateRetryDelay(attempt) {
  return Math.min(
    RETRY_CONFIG.BASE_DELAY_MS * Math.pow(RETRY_CONFIG.DELAY_MULTIPLIER, attempt),
    RETRY_CONFIG.MAX_DELAY_MS
  );
}

function isRateLimitError(error) {
  return RATE_LIMIT_ERRORS.some(code => 
    error.message?.includes(code) || 
    error.status === code || 
    error.code?.includes(code)
  );
}

async function generateFileName() {
  return `${FILE_CONFIG.PREFIX}${Date.now()}${FILE_CONFIG.EXTENSION}`;
}

async function sendAsTextFile(interaction, text) {
  try {
    const filename = await generateFileName();
    const tempFilePath = path.join(TEMP_DIR, filename);
    await fs.writeFile(tempFilePath, text);

    const content = `<@${interaction.user.id}>, ${SEARCH_RESULTS_PREFIX}`;

    await interaction.editReply({
      content,
      files: [tempFilePath],
      embeds: [],
      components: []
    });

    await fs.unlink(tempFilePath).catch(() => {});
  } catch (error) {
    console.error('Error sending as text file:', error);
    await interaction.editReply({
      content: `❌ ${ERROR_MESSAGES.FILE_SEND_FAILED}`,
      embeds: [],
      components: []
    }).catch(() => {});
  }
}

async function sendSearchResponse(
  interaction,
  responseText,
  groundingMetadata,
  urlContextMetadata,
  responseFormat,
  embedColor,
  showActionButtons
) {
  const maxCharLimit = responseFormat === 'Embedded' ? CHARACTER_LIMITS.EMBEDDED : CHARACTER_LIMITS.NORMAL;
  const isLargeResponse = responseText.length > maxCharLimit;

  if (isLargeResponse) {
    await sendAsTextFile(interaction, responseText);
  } else if (responseFormat === 'Embedded') {
    const embed = createSearchEmbed(
      responseText,
      groundingMetadata,
      urlContextMetadata,
      embedColor,
      interaction
    );
    
    const payload = { embeds: [embed] };
    
    if (showActionButtons) {
      payload.components = createActionButtons();
    }
    
    await interaction.editReply(payload);
  } else {
    const payload = { content: responseText.slice(0, CHARACTER_LIMITS.DISCORD_MAX) };
    
    if (showActionButtons) {
      payload.components = createActionButtons();
    }
    
    await interaction.editReply(payload);
  }
}

async function executeSearchWithRetry(
  modelName,
  systemInstruction,
  generationConfig,
  safetySettings,
  tools,
  parts,
  responseFormat,
  embedColor
) {
  let attempts = 0;

  while (attempts < RETRY_CONFIG.MAX_ATTEMPTS) {
    try {
      let fullResponse = '';
      let groundingMetadata = null;
      let urlContextMetadata = null;

      const request = {
        model: modelName,
        contents: [{ role: 'user', parts }],
        config: {
          systemInstruction,
          ...generationConfig,
          tools
        },
        safetySettings
      };

      const result = await genAI.models.generateContentStream(request);

      for await (const chunk of result) {
        const chunkText = chunk.text || '';
        
        let codeOutput = '';
        if (chunk.codeExecutionResult?.output) {
          const outcome = chunk.codeExecutionResult.outcome || 'UNKNOWN';
          codeOutput = `\n**Code Execution (${outcome}):**\n\`\`\`\n${chunk.codeExecutionResult.output}\n\`\`\`\n`;
        }
        
        let executableCode = '';
        if (chunk.executableCode?.code) {
          const language = chunk.executableCode.language || 'python';
          executableCode = `\n**Generated Code (${language}):**\n\`\`\`${language.toLowerCase()}\n${chunk.executableCode.code}\n\`\`\`\n`;
        }
        
        fullResponse += chunkText + executableCode + codeOutput;

        if (chunk.candidates?.[0]?.groundingMetadata) {
          groundingMetadata = chunk.candidates[0].groundingMetadata;
        }
        if (chunk.candidates?.[0]?.url_context_metadata) {
          urlContextMetadata = chunk.candidates[0].url_context_metadata;
        }
      }

      return {
        success: true,
        response: fullResponse,
        groundingMetadata,
        urlContextMetadata
      };

    } catch (error) {
      attempts++;
      console.error(`Search attempt ${attempts} failed:`, error.message);

      if (isRateLimitError(error) && attempts < RETRY_CONFIG.MAX_ATTEMPTS) {
        const delay = calculateRetryDelay(attempts);
        console.log(`Rate limit hit, waiting ${delay}ms before retry...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }

      if (attempts >= RETRY_CONFIG.MAX_ATTEMPTS) {
        return {
          success: false,
          error: `Search failed after ${RETRY_CONFIG.MAX_ATTEMPTS} attempts: ${error.message}`
        };
      }

      await new Promise(resolve => setTimeout(resolve, RETRY_CONFIG.BASE_DELAY_MS));
    }
  }

  return {
    success: false,
    error: ERROR_MESSAGES.FAILED_AFTER_RETRIES
  };
}

export async function handleSearchCommand(interaction) {
  try {
    const prompt = interaction.options.getString('prompt');
    const attachment = interaction.options.getAttachment('file');

    if (!prompt && !attachment) {
      return interaction.reply({
        content: `❌ ${ERROR_MESSAGES.NO_INPUT}`,
        flags: MessageFlags.Ephemeral
      });
    }

    await interaction.deferReply();

    const userId = interaction.user.id;

    if (!state.requestQueues.has(userId)) {
      state.requestQueues.set(userId, { queue: [], isProcessing: false });
    }

    const userQueueData = state.requestQueues.get(userId);

    if (userQueueData.queue.length >= MAX_QUEUE_SIZE) {
      return interaction.editReply({
        content: `⏳ **${ERROR_MESSAGES.QUEUE_FULL}:** ${ERROR_MESSAGES.QUEUE_FULL_MESSAGE}`
      });
    }

    userQueueData.queue.push(interaction);

    if (!userQueueData.isProcessing) {
      const { processUserQueue } = await import('./messageProcessor.js');
      processUserQueue(userId);
    }

  } catch (error) {
    console.error('Error queuing search:', error);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: `❌ ${ERROR_MESSAGES.REQUEST_ERROR}`,
        flags: MessageFlags.Ephemeral
      }).catch(() => {});
    }
  }
}

export async function executeSearchInteraction(interaction) {
  try {
    const prompt = interaction.options.getString('prompt') || '';
    const attachment = interaction.options.getAttachment('file');

    if (!prompt && !attachment) {
      const embed = createErrorEmbed(
        EMBED_COLORS.WARNING,
        ERROR_MESSAGES.INVALID_INPUT,
        ERROR_MESSAGES.NO_INPUT
      );
      return interaction.editReply({ embeds: [embed] });
    }

    const userId = interaction.user.id;
    const guildId = interaction.guild?.id;
    const channelId = interaction.channelId;

    if (guildId) {
      initializeBlacklistForGuild(guildId);
      
      if (state.blacklistedUsers[guildId]?.includes(userId)) {
        const embed = createErrorEmbed(
          EMBED_COLORS.ERROR,
          ERROR_MESSAGES.BLACKLIST_TITLE,
          ERROR_MESSAGES.BLACKLISTED
        );
        return interaction.editReply({ embeds: [embed] });
      }

      const allowedChannels = state.serverSettings[guildId]?.allowedChannels;
      if (allowedChannels && allowedChannels.length > 0 && !allowedChannels.includes(channelId)) {
        const embed = createErrorEmbed(
          EMBED_COLORS.WARNING,
          ERROR_MESSAGES.CHANNEL_RESTRICTED_TITLE,
          ERROR_MESSAGES.CHANNEL_RESTRICTED
        );
        return interaction.editReply({ embeds: [embed] });
      }
    }

    let parts = [];
    let hasMedia = false;
    
    if (prompt) {
      const searchPrompt = `${SEARCH_PROMPT_PREFIX}${prompt}`;
      parts.push({ text: searchPrompt });
    }

    if (attachment) {
      try {
        const { processAttachment } = await import('./attachmentProcessor.js');
        const processedPart = await processAttachment(attachment, userId, interaction.id);
        
        if (processedPart) {
          const partsToAdd = Array.isArray(processedPart) ? processedPart : [processedPart];
          
          for (const part of partsToAdd) {
            if (part.fileUri || part.fileData || part.inlineData) {
              parts.push(part);
              hasMedia = true;
            }
          }
        }
      } catch (error) {
        console.error('Error processing attachment:', error);
        const embed = createErrorEmbed(
          EMBED_COLORS.ERROR,
          ERROR_MESSAGES.PROCESSING_ERROR,
          `${ERROR_MESSAGES.PROCESSING_FAILED}: ${error.message}`
        );
        return interaction.editReply({ embeds: [embed] });
      }
    }

    if (parts.length === 0) {
      const embed = createErrorEmbed(
        EMBED_COLORS.WARNING,
        ERROR_MESSAGES.INVALID_INPUT,
        ERROR_MESSAGES.INVALID_REQUEST
      );
      return interaction.editReply({ embeds: [embed] });
    }

    const userSettings = state.userSettings[userId] || {};
    const serverSettings = guildId ? (state.serverSettings[guildId] || {}) : {};
    const effectiveSettings = serverSettings.overrideUserSettings ? serverSettings : userSettings;

    const selectedModel = effectiveSettings.selectedModel || DEFAULT_MODEL;
    const modelName = MODELS[selectedModel];
    const responseFormat = effectiveSettings.responseFormat || BOT_CONFIG.DEFAULT_RESPONSE_FORMAT;
    const embedColor = effectiveSettings.embedColor || BOT_CONFIG.HEX_COLOUR;

    const tools = buildSearchTools(hasMedia);
    const generationConfig = getGenerationConfig(modelName);

    const result = await executeSearchWithRetry(
      modelName,
      SEARCH_SYSTEM_PROMPT,
      generationConfig,
      safetySettings,
      tools,
      parts,
      responseFormat,
      embedColor
    );

    if (!result.success) {
      const embed = createErrorEmbed(
        EMBED_COLORS.ERROR,
        ERROR_MESSAGES.SEARCH_FAILED,
        result.error || ERROR_MESSAGES.FAILED_AFTER_RETRIES
      );
      return interaction.editReply({ embeds: [embed] });
    }

    await sendSearchResponse(
      interaction,
      result.response,
      result.groundingMetadata,
      result.urlContextMetadata,
      responseFormat,
      embedColor,
      effectiveSettings.showActionButtons
    );

  } catch (error) {
    console.error('Error in search execution:', error);
    const embed = createErrorEmbed(
      EMBED_COLORS.ERROR,
      ERROR_MESSAGES.SEARCH_ERROR,
      ERROR_MESSAGES.UNEXPECTED_ERROR
    );
    
    try {
      await interaction.editReply({ embeds: [embed] });
    } catch (replyError) {
      console.error('Failed to send error message:', replyError);
    }
  }
}
