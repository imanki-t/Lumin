import { ButtonBuilder, ButtonStyle, ActionRowBuilder, ComponentType } from 'discord.js';

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

function hasSpaceForButton(actionRow) {
  return actionRow.components.length < ACTION_ROW_LIMITS.MAX_COMPONENTS;
}

function createSecondaryRow(existingComponents, newButton) {
  const primaryRow = new ActionRowBuilder();
  const existingButtons = existingComponents[0].components.map(c => ButtonBuilder.from(c));
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

    let actionRow;
    
    if (messageComponents.length > 0 && 
        messageComponents[0].type === ComponentType.ActionRow && 
        hasSpaceForButton(messageComponents[0])) {
      actionRow = ActionRowBuilder.from(messageComponents[0]);
      actionRow.addComponents(deleteButton);
      
      return await botMessage.edit({
        components: [actionRow]
      });
    }

    if (messageComponents.length > 0) {
      const rows = createSecondaryRow(messageComponents, deleteButton);
      return await botMessage.edit({
        components: rows
      });
    }

    actionRow = new ActionRowBuilder().addComponents(deleteButton);
    return await botMessage.edit({
      components: [actionRow]
    });
    
  } catch (error) {
    console.error('Error adding delete button:', error.message);
    return botMessage;
  }
}
