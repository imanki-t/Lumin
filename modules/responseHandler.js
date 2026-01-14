import { EmbedBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder, ComponentType, ChannelType } from 'discord.js';
import path from 'path';
import fs from 'fs/promises';
import axios from 'axios';
import { TEMP_DIR, client, BOT_CONFIG } from '../botManager.js';
import config from '../config.js';
const DEFAULT_EMBED_COLOR = BOT_CONFIG.HEX_COLOUR;

const EMBED_LIMITS = {
  DESCRIPTION_MAX: 4096,
  FIELD_NAME_MAX: 256,
  FIELD_VALUE_MAX: 1024
};

const METADATA_CONFIG = {
  MAX_QUERIES: 3,
  MAX_SOURCES: 5,
  MAX_URLS: 3
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

const FILE_CONFIG = {
  RESPONSE_PREFIX: 'response-',
  FILE_EXTENSION: '.txt'
};

const BUTTON_CONFIG = {
  DOWNLOAD: {
    CUSTOM_ID: 'download_message',
    LABEL: 'Save',
    EMOJI: '💾',
    STYLE: ButtonStyle.Secondary
  },
  DELETE: {
    CUSTOM_ID_PREFIX: 'delete_message-',
    LABEL: 'Delete',
    EMOJI: '🗑️',
    STYLE: ButtonStyle.Danger
  }
};

const ACTION_ROW_LIMITS = {
  MAX_COMPONENTS: 5
};

const MESSAGE_PREFIXES = {
  INTERACTION: 'Here is the response:',
  MESSAGE: 'Here is the response:'
};

function createBaseEmbed(color, description) {
  return new EmbedBuilder()
    .setColor(color)
    .setDescription(description.slice(0, EMBED_LIMITS.DESCRIPTION_MAX))
    .setTimestamp();
}

function addAuthorToEmbed(embed, user, prefix = '') {
  const name = prefix ? `${prefix} ${user.displayName}` : user.displayName;
  embed.setAuthor({
    name: name,
    iconURL: user.displayAvatarURL()
  });
  return embed;
}

function addFooterToEmbed(embed, guild) {
  if (guild) {
    embed.setFooter({
      text: guild.name,
      iconURL: guild.iconURL() || DEFAULT_ICONS.GOOGLE_AI
    });
  }
  return embed;
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

function addGroundingMetadataToEmbed(embed, groundingMetadata) {
  try {
    if (groundingMetadata.webSearchQueries && groundingMetadata.webSearchQueries.length > 0) {
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

    if (groundingMetadata.groundingChunks && groundingMetadata.groundingChunks.length > 0) {
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
  } catch (error) {
    console.error('Error adding grounding metadata:', error);
  }
}

function addUrlContextMetadataToEmbed(embed, urlContextMetadata) {
  try {
    if (urlContextMetadata.url_metadata && urlContextMetadata.url_metadata.length > 0) {
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
  } catch (error) {
    console.error('Error adding URL context metadata:', error);
  }
}

function shouldShowMetadata(effectiveSettings) {
  return effectiveSettings.responseFormat === 'Embedded';
}

export function updateEmbed(botMessage, finalResponse, message, groundingMetadata = null, urlContextMetadata = null, effectiveSettings) {
  try {
    const isGuild = message.guild !== null;
    const embedColor = effectiveSettings.embedColor || DEFAULT_EMBED_COLOR;
    const continuousReply = effectiveSettings.continuousReply || false;

    const embed = createBaseEmbed(embedColor, finalResponse);

    if (!continuousReply) {
      addAuthorToEmbed(embed, message.author, 'To');
    }

    if (groundingMetadata && shouldShowMetadata(effectiveSettings)) {
      addGroundingMetadataToEmbed(embed, groundingMetadata);
    }

    if (urlContextMetadata && shouldShowMetadata(effectiveSettings)) {
      addUrlContextMetadataToEmbed(embed, urlContextMetadata);
    }

    if (isGuild) {
      addFooterToEmbed(embed, message.guild);
    }

    botMessage.edit({
      content: ' ',
      embeds: [embed],
      components: []
    }).catch(() => {});
  } catch (error) {
    console.error("Error updating embed:", error.message);
  }
}

export function updateEmbedForInteraction(interaction, botMessage, finalResponse, groundingMetadata, urlContextMetadata, effectiveSettings) {
  try {
    const isGuild = interaction.guild !== null;
    const embedColor = effectiveSettings.embedColor || DEFAULT_EMBED_COLOR;

    const embed = createBaseEmbed(embedColor, finalResponse);
    addAuthorToEmbed(embed, interaction.user, 'To');

    if (groundingMetadata && shouldShowMetadata(effectiveSettings)) {
      addGroundingMetadataToEmbed(embed, groundingMetadata);
    }

    if (urlContextMetadata && shouldShowMetadata(effectiveSettings)) {
      addUrlContextMetadataToEmbed(embed, urlContextMetadata);
    }

    if (isGuild) {
      addFooterToEmbed(embed, interaction.guild);
    }

    interaction.editReply({
      content: ' ',
      embeds: [embed]
    }).catch(() => {});
  } catch (error) {
    console.error("Error updating interaction embed:", error.message);
  }
}

function generateFileName() {
  return `${FILE_CONFIG.RESPONSE_PREFIX}${Date.now()}${FILE_CONFIG.FILE_EXTENSION}`;
}

function getFilePath(filename) {
  return path.join(TEMP_DIR, filename);
}

function extractUserIdFromMessageOrInteraction(messageOrInteraction) {
  return messageOrInteraction.user?.id || messageOrInteraction.author?.id;
}

function buildMentionPrefix(userId, isInteraction, continuousReply) {
  if (isInteraction) {
    return `<@${userId}>, `;
  }
  return continuousReply ? '' : `<@${userId}>, `;
}

function buildFileContent(userId, isInteraction, continuousReply) {
  const mention = buildMentionPrefix(userId, isInteraction, continuousReply);
  return `${mention}${MESSAGE_PREFIXES.MESSAGE}`;
}

async function editMessageWithFile(message, content, filePath) {
  return await message.edit({
    content: content,
    files: [filePath],
    embeds: [],
    components: []
  });
}

async function sendMessageWithFile(channel, content, filePath) {
  return await channel.send({
    content: content,
    files: [filePath]
  });
}

export async function sendAsTextFile(text, messageOrInteraction, orgId, continuousReply = false) {
  const filename = generateFileName();
  const tempFilePath = getFilePath(filename);

  try {
    await fs.writeFile(tempFilePath, text);

    const userId = extractUserIdFromMessageOrInteraction(messageOrInteraction);
    const channel = messageOrInteraction.channel;

    if (!userId || !channel) {
      throw new Error("Could not determine user or channel.");
    }

    const isInteraction = !!messageOrInteraction.isInteraction;
    const content = buildFileContent(userId, isInteraction, continuousReply);

    let botMessage;

    if (isInteraction) {
      botMessage = await messageOrInteraction.editReply({
        content: content,
        files: [tempFilePath],
        embeds: [],
        components: []
      });
    } else {
      const messageToEdit = await channel.messages.fetch(orgId).catch(() => null);
      
      if (messageToEdit) {
        botMessage = await editMessageWithFile(messageToEdit, content, tempFilePath);
      } else {
        botMessage = await sendMessageWithFile(channel, content, tempFilePath);
      }
    }

    await fs.unlink(tempFilePath).catch(() => {});
    return botMessage;
  } catch (error) {
    console.error('Error sending as text file:', error);
    await fs.unlink(tempFilePath).catch(() => {});
    return null;
  }
}

function createDownloadButton() {
  return new ButtonBuilder()
    .setCustomId(BUTTON_CONFIG.DOWNLOAD.CUSTOM_ID)
    .setLabel(BUTTON_CONFIG.DOWNLOAD.LABEL)
    .setEmoji(BUTTON_CONFIG.DOWNLOAD.EMOJI)
    .setStyle(BUTTON_CONFIG.DOWNLOAD.STYLE);
}

function createDeleteButton(msgId) {
  return new ButtonBuilder()
    .setCustomId(`${BUTTON_CONFIG.DELETE.CUSTOM_ID_PREFIX}${msgId}`)
    .setLabel(BUTTON_CONFIG.DELETE.LABEL)
    .setEmoji(BUTTON_CONFIG.DELETE.EMOJI)
    .setStyle(BUTTON_CONFIG.DELETE.STYLE);
}

function getOrCreateActionRow(messageComponents) {
  if (messageComponents.length > 0 && messageComponents[0].type === ComponentType.ActionRow) {
    return ActionRowBuilder.from(messageComponents[0]);
  }
  return new ActionRowBuilder();
}

function hasSpaceForButton(components) {
  return components.length < ACTION_ROW_LIMITS.MAX_COMPONENTS;
}

function createButtonRows(existingComponents, newButton) {
  const primaryRow = new ActionRowBuilder();
  const existingButtons = existingComponents.map(c => ButtonBuilder.from(c));
  primaryRow.addComponents(existingButtons);
  
  const secondaryRow = new ActionRowBuilder().addComponents(newButton);
  return [primaryRow, secondaryRow];
}

export async function addDownloadButton(botMessage) {
  try {
    const messageComponents = botMessage.components || [];
    const downloadButton = createDownloadButton();
    const actionRow = getOrCreateActionRow(messageComponents);

    actionRow.addComponents(downloadButton);
    
    return await botMessage.edit({
      components: [actionRow]
    });
  } catch (error) {
    console.error('Error adding download button:', error.message);
    return botMessage;
  }
}

export async function addDeleteButton(botMessage, msgId) {
  try {
    const messageComponents = botMessage.components || [];
    const deleteButton = createDeleteButton(msgId);

    if (messageComponents.length > 0 && 
        messageComponents[0].type === ComponentType.ActionRow && 
        hasSpaceForButton(messageComponents[0].components)) {
      const actionRow = ActionRowBuilder.from(messageComponents[0]);
      actionRow.addComponents(deleteButton);
      
      return await botMessage.edit({
        components: [actionRow]
      });
    }

    if (messageComponents.length > 0) {
      const rows = createButtonRows(messageComponents[0].components, deleteButton);
      return await botMessage.edit({
        components: rows
      });
    }

    const actionRow = new ActionRowBuilder().addComponents(deleteButton);
    return await botMessage.edit({
      components: [actionRow]
    });
    
  } catch (error) {
    console.error('Error adding delete button:', error.message);
    return botMessage;
  }
}
