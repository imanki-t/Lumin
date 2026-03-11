/**
 * @fileoverview Discord message action-button factories — Save and Delete.
 *               Single source of truth replacing the duplicate implementations
 *               that existed in both the old root responseHandler.js and
 *               buttonHandlers.js.
 *
 * BUG FIXES vs original buttonHandlers.js:
 *   1. `createButtonRows` was called but the function was named `createSecondaryRow`
 *      → ReferenceError crash on every second-row scenario.
 *   2. `hasRoomForButton` received a components *array* but the old version did
 *      `actionRow.components.length` (double-dereference) → TypeError crash.
 *
 * The canonical delete button includes `userId` in the custom ID
 * (`delete_message-{msgId}-{userId}`) so the interaction handler can verify
 * that only the original requester can delete the message.
 *
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
 * Check whether a components *array* has room for one more button.
 *
 * BUG FIX: the original did `actionRow.components.length` after being passed an
 * array — i.e. `array.components.length` = `undefined.length` = TypeError crash.
 * This version receives the array directly and calls `.length` on it.
 *
 * @param {readonly import('discord.js').ButtonComponent[]} componentsArray
 * @returns {boolean}
 */
function hasRoomForButton(componentsArray) {
  return componentsArray.length < BUTTON.MAX_ROW_COMPONENTS;
}

/**
 * Build two ActionRows when the existing row is already full:
 *   Row 0 — all previous buttons (rebuilt)
 *   Row 1 — the new button alone
 *
 * BUG FIX: original called `createButtonRows` which was never defined
 * (the function was actually named `createSecondaryRow`) → ReferenceError crash.
 *
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
      hasRoomForButton(components[0].components)   // BUG FIX: pass .components array, not ActionRow
    ) {
      const actionRow = ActionRowBuilder.from(components[0]);
      actionRow.addComponents(deleteButton);
      return await botMessage.edit({ components: [actionRow] });
    }

    // Case 2: existing ActionRow that is full → spill into second row
    if (components.length > 0) {
      const rows = createButtonRows(components, deleteButton); // BUG FIX: was calling undefined fn
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
