/**
 * @fileoverview Discord message action-button factories — Save and Delete.
 * Delete button encodes userId in its custom ID so only the requester can trigger it.
 * @module modules/shared/buttonHandlers
 */

import {
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
  ComponentType
} from 'discord.js';
import { Logger } from '../../core/Logger.js';

const logger = Logger.get('ButtonHandlers');

// ============================================================================
// CONSTANTS
// ============================================================================

const BUTTON = Object.freeze({
  DOWNLOAD_ID:       'download_message',
  DOWNLOAD_LABEL:    'Save',
  DOWNLOAD_EMOJI:    '💾',
  DOWNLOAD_STYLE:    ButtonStyle.Secondary,

  DELETE_ID_PREFIX:  'delete_message-',
  DELETE_LABEL:      'Delete',
  DELETE_EMOJI:      '🗑️',
  DELETE_STYLE:      ButtonStyle.Danger,

  MAX_ROW_COMPONENTS: 5
});

// ============================================================================
// PRIVATE HELPERS
// ============================================================================

/** @returns {ButtonBuilder} */
function createDownloadButton() {
  return new ButtonBuilder()
    .setCustomId(BUTTON.DOWNLOAD_ID)
    .setLabel(BUTTON.DOWNLOAD_LABEL)
    .setEmoji(BUTTON.DOWNLOAD_EMOJI)
    .setStyle(BUTTON.DOWNLOAD_STYLE);
}

/**
 * @param {string} msgId
 * @param {string} userId
 * @returns {ButtonBuilder}
 */
function createDeleteButton(msgId, userId) {
  return new ButtonBuilder()
    .setCustomId(`${BUTTON.DELETE_ID_PREFIX}${msgId}-${userId}`)
    .setLabel(BUTTON.DELETE_LABEL)
    .setEmoji(BUTTON.DELETE_EMOJI)
    .setStyle(BUTTON.DELETE_STYLE);
}

/**
 * Return an ActionRowBuilder either cloned from the first existing row or fresh.
 * @param {readonly import('discord.js').ActionRow[]} messageComponents
 * @returns {ActionRowBuilder}
 */
function getOrCreateActionRow(messageComponents) {
  if (messageComponents.length > 0 && messageComponents[0].type === ComponentType.ActionRow) {
    return ActionRowBuilder.from(messageComponents[0]);
  }
  return new ActionRowBuilder();
}

/**
 * Check whether a components array has room for one more button.
 * Receives the `.components` array directly, not the ActionRow wrapper.
 * @param {readonly import('discord.js').ButtonComponent[]} componentsArray
 * @returns {boolean}
 */
function hasRoomForButton(componentsArray) {
  return componentsArray.length < BUTTON.MAX_ROW_COMPONENTS;
}

/**
 * Build two ActionRows when the existing row is full:
 *   Row 0 — all previous buttons (rebuilt)
 *   Row 1 — the new button alone
 * @param {readonly import('discord.js').ActionRow[]} messageComponents
 * @param {ButtonBuilder} newButton
 * @returns {ActionRowBuilder[]}
 */
function createButtonRows(messageComponents, newButton) {
  const primaryRow   = new ActionRowBuilder();
  const existing     = messageComponents[0].components.map(c => ButtonBuilder.from(c));
  primaryRow.addComponents(existing);

  const secondaryRow = new ActionRowBuilder().addComponents(newButton);
  return [primaryRow, secondaryRow];
}

// ============================================================================
// PUBLIC EXPORTS
// ============================================================================

/**
 * Add a 💾 Save/Download button to a bot message.
 * Adds to the first ActionRow or creates one if none exists.
 *
 * @param {import('discord.js').Message} botMessage
 * @returns {Promise<import('discord.js').Message>} Updated message
 *
 * @example
 * botMessage = await addDownloadButton(botMessage);
 */
export async function addDownloadButton(botMessage) {
  try {
    const components    = botMessage.components || [];
    const downloadButton = createDownloadButton();
    const actionRow      = getOrCreateActionRow(components);
    actionRow.addComponents(downloadButton);
    return await botMessage.edit({ components: [actionRow] });
  } catch (error) {
    logger.error('Error adding download button', error);
    return botMessage;
  }
}

/**
 * Add a 🗑️ Delete button to a bot message.
 * Respects the 5-component ActionRow limit:
 *   - If the existing row has room → appends to it
 *   - If the row is full           → creates a second row
 *   - If there are no rows         → creates a new row with just the delete button
 *
 * The custom ID encodes both `msgId` and `userId` so the interaction handler
 * can enforce that only the original requester can delete the message.
 *
 * @param {import('discord.js').Message} botMessage
 * @param {string} msgId   - ID of the message to delete
 * @param {string} userId  - ID of the user who triggered the response
 * @returns {Promise<import('discord.js').Message>} Updated message
 *
 * @example
 * botMessage = await addDeleteButton(botMessage, botMessage.id, userId);
 */
export async function addDeleteButton(botMessage, msgId, userId) {
  try {
    const components = botMessage.components || [];
    const deleteButton = createDeleteButton(msgId, userId);

    // Case 1: existing ActionRow with room → append to it
    if (
      components.length > 0 &&
      components[0].type === ComponentType.ActionRow &&
      hasRoomForButton(components[0].components)
    ) {
      const actionRow = ActionRowBuilder.from(components[0]);
      actionRow.addComponents(deleteButton);
      return await botMessage.edit({ components: [actionRow] });
    }

    // Case 2: existing ActionRow that is full → spill into second row
    if (components.length > 0) {
      const rows = createButtonRows(components, deleteButton);
      return await botMessage.edit({ components: rows });
    }

    // Case 3: no existing rows → new row
    const actionRow = new ActionRowBuilder().addComponents(deleteButton);
    return await botMessage.edit({ components: [actionRow] });

  } catch (error) {
    logger.error('Error adding delete button', error);
    return botMessage;
  }
}
