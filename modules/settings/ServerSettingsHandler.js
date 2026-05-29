/**
 * @fileoverview Server settings pages (1–5), channel management, and server
 *               data actions (clear/download memory). All handlers require
 *               ManageGuild permission — checked once at the top of each fn.
 * @module modules/settings/ServerSettingsHandler
 */

import {
  EmbedBuilder, MessageFlags, ButtonBuilder, ButtonStyle,
  ActionRowBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder,
  ChannelSelectMenuBuilder, ChannelType, AttachmentBuilder,
  ModalBuilder, TextInputBuilder, TextInputStyle, PermissionsBitField
} from 'discord.js';
import path from 'path';
import fs   from 'fs/promises';

import {
  state, TEMP_DIR, BOT_CONFIG,
  DEFAULT_SERVER_SETTINGS
} from '../../managers/BotManager.js';
import * as db    from '../../database.js';
import { Logger } from '../../core/Logger.js';

const logger = Logger.get('ServerSettings');
const THEME_COLOR = '#09090B'; // Matte black brand fallback

// ============================================================================
// HELPERS
// ============================================================================

function requireManageGuild(interaction) {
  if (!interaction.member?.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
    interaction.reply({
      embeds: [new EmbedBuilder()
        .setColor('#09090B')
        .setTitle('Permission Denied')
        .setDescription('You require the "Manage Server" permission to view or modify server settings.')
      ],
      flags: MessageFlags.Ephemeral
    }).catch(() => {});
    return false;
  }
  return true;
}

async function persistServer(guildId) {
  try {
    await db.saveServerSettings(guildId, state.serverSettings[guildId]);
  } catch (err) {
    logger.error(`Failed to persist server settings for ${guildId}`, err);
  }
}

async function persistInstructions(id, instructions) {
  try {
    await db.saveCustomInstructions(id, instructions ?? null);
  } catch (err) {
    logger.error(`Failed to persist custom instructions for ${id}`, err);
  }
}

async function persistChannelSetting(channelId, type, value) {
  try {
    await db.saveChannelSetting(channelId, type, value);
  } catch (err) {
    logger.error(`Failed to persist channel setting for ${channelId}`, err);
  }
}

async function persistChatHistory(id) {
  try {
    await db.saveChatHistory(id, state.chatHistories[id] ?? {});
  } catch (err) {
    logger.error(`Failed to persist chat history for ${id}`, err);
  }
}

// ============================================================================
// PAGE 1 — Core Preferences
// ============================================================================

export async function showServerSettings(interaction, isUpdate = false) {
  if (!requireManageGuild(interaction)) return;

  const guildId        = interaction.guild.id;
  const ss             = state.serverSettings[guildId] || {};
  const selectedModel  = ss.selectedModel     || DEFAULT_SERVER_SETTINGS.selectedModel;
  const responseFormat = ss.responseFormat    || DEFAULT_SERVER_SETTINGS.responseFormat;
  const showButtons    = ss.showActionButtons ?? DEFAULT_SERVER_SETTINGS.showActionButtons;
  const embedColor     = ss.embedColor        || THEME_COLOR;

  const responseFormatSelect = new StringSelectMenuBuilder()
    .setCustomId('server_response_format')
    .setPlaceholder('Response Format')
    .addOptions(
      new StringSelectMenuOptionBuilder()
        .setLabel('Normal')
        .setDescription('Plain text responses')
        .setValue('Normal')
        .setDefault(responseFormat === 'Normal'),
      new StringSelectMenuOptionBuilder()
        .setLabel('Embedded')
        .setDescription('Rich embed responses')
        .setValue('Embedded')
        .setDefault(responseFormat === 'Embedded')
    );

  const actionButtonsSelect = new StringSelectMenuBuilder()
    .setCustomId('server_action_buttons')
    .setPlaceholder('Action Buttons')
    .addOptions(
      new StringSelectMenuOptionBuilder()
        .setLabel('Show Buttons')
        .setDescription('Display Stop/Save/Delete options')
        .setValue('show')
        .setDefault(showButtons),
      new StringSelectMenuOptionBuilder()
        .setLabel('Hide Buttons')
        .setDescription('Hide action buttons')
        .setValue('hide')
        .setDefault(!showButtons)
    );

  const backBtn = new ButtonBuilder()
    .setCustomId('back_to_main')
    .setLabel('← Menu')
    .setStyle(ButtonStyle.Secondary);

  const nextBtn = new ButtonBuilder()
    .setCustomId('server_settings_page2')
    .setLabel('Next Page →')
    .setStyle(ButtonStyle.Primary);

  const embed = new EmbedBuilder()
    .setColor(embedColor)
    .setTitle('Server Settings')
    .setDescription('Configure server-wide AI model and response preferences.')
    .addFields(
      { name: 'AI Model',        value: `\`${selectedModel}\``,                    inline: true },
      { name: 'Response Format', value: `\`${responseFormat}\``,                   inline: true },
      { name: 'Action Buttons',  value: `\`${showButtons ? 'Visible' : 'Hidden'}\``, inline: true }
    )
    .setFooter({ text: 'Page 1 of 5' })
    .setTimestamp();

  const payload = {
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(responseFormatSelect),
      new ActionRowBuilder().addComponents(actionButtonsSelect),
      new ActionRowBuilder().addComponents(backBtn, nextBtn)
    ],
    flags: MessageFlags.Ephemeral
  };

  if (isUpdate) await interaction.update(payload);
  else           await interaction.reply(payload);
}

// ============================================================================
// PAGE 2 — Logic & Overrides
// ============================================================================

export async function showServerSettingsPage2(interaction, isUpdate = false) {
  if (!requireManageGuild(interaction)) return;

  const guildId              = interaction.guild.id;
  const ss                   = state.serverSettings[guildId] || {};
  const embedColor           = ss.embedColor            || THEME_COLOR;
  const overrideUserSettings  = ss.overrideUserSettings  || false;
  const continuousReply      = ss.continuousReply       || false;
  const serverChatHistory    = ss.serverChatHistory     || false;

  const overrideSelect = new StringSelectMenuBuilder()
    .setCustomId('server_override')
    .setPlaceholder('Override User Settings')
    .addOptions(
      new StringSelectMenuOptionBuilder()
        .setLabel('Enabled')
        .setDescription('Server settings override user preferences')
        .setValue('enabled')
        .setDefault(overrideUserSettings),
      new StringSelectMenuOptionBuilder()
        .setLabel('Disabled')
        .setDescription('Users may define their own preferences')
        .setValue('disabled')
        .setDefault(!overrideUserSettings)
    );

  const continuousReplySelect = new StringSelectMenuBuilder()
    .setCustomId('server_continuous_reply')
    .setPlaceholder('Continuous Reply')
    .addOptions(
      new StringSelectMenuOptionBuilder()
        .setLabel('Enabled')
        .setDescription('Respond to messages without explicit mentions')
        .setValue('enabled')
        .setDefault(continuousReply),
      new StringSelectMenuOptionBuilder()
        .setLabel('Disabled')
        .setDescription('Require explicit mentions to respond')
        .setValue('disabled')
        .setDefault(!continuousReply)
    );

  const chatHistorySelect = new StringSelectMenuBuilder()
    .setCustomId('server_chat_history')
    .setPlaceholder('Server-Wide Chat History')
    .addOptions(
      new StringSelectMenuOptionBuilder()
        .setLabel('Enabled')
        .setDescription('Share conversation history across server')
        .setValue('enabled')
        .setDefault(serverChatHistory),
      new StringSelectMenuOptionBuilder()
        .setLabel('Disabled')
        .setDescription('Maintain individual user chat history')
        .setValue('disabled')
        .setDefault(!serverChatHistory)
    );

  const backBtn = new ButtonBuilder()
    .setCustomId('back_to_server')
    .setLabel('← Back')
    .setStyle(ButtonStyle.Secondary);

  const nextBtn = new ButtonBuilder()
    .setCustomId('server_settings_page3')
    .setLabel('Next Page →')
    .setStyle(ButtonStyle.Primary);

  const embed = new EmbedBuilder()
    .setColor(embedColor)
    .setTitle('Server Settings')
    .setDescription('Configure server behavior and override controls.')
    .addFields(
      { name: 'Override User Settings', value: `\`${overrideUserSettings ? 'Enabled' : 'Disabled'}\``, inline: true },
      { name: 'Continuous Reply',       value: `\`${continuousReply ? 'Enabled' : 'Disabled'}\``,     inline: true },
      { name: 'Server-Wide History',    value: `\`${serverChatHistory ? 'Enabled' : 'Disabled'}\``,   inline: true }
    )
    .setFooter({ text: 'Page 2 of 5' })
    .setTimestamp();

  const payload = {
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(overrideSelect),
      new ActionRowBuilder().addComponents(continuousReplySelect),
      new ActionRowBuilder().addComponents(chatHistorySelect),
      new ActionRowBuilder().addComponents(backBtn, nextBtn)
    ],
    flags: MessageFlags.Ephemeral
  };

  if (isUpdate) await interaction.update(payload);
  else           await interaction.reply(payload);
}

// ============================================================================
// PAGE 3 — Appearance & Personality
// ============================================================================

export async function showServerSettingsPage3(interaction, isUpdate = false) {
  if (!requireManageGuild(interaction)) return;

  const guildId      = interaction.guild.id;
  const ss           = state.serverSettings[guildId] || {};
  const embedColor   = ss.embedColor        || THEME_COLOR;
  const hasPersonality = !!ss.customPersonality;

  const colorBtn = new ButtonBuilder()
    .setCustomId('server_embed_color')
    .setLabel('Set Color')
    .setStyle(ButtonStyle.Secondary);

  const personalityBtn = new ButtonBuilder()
    .setCustomId('server_custom_personality')
    .setLabel('Set Personality')
    .setStyle(ButtonStyle.Primary);

  const removePersonalityBtn = new ButtonBuilder()
    .setCustomId('server_remove_personality')
    .setLabel('Reset')
    .setStyle(ButtonStyle.Danger)
    .setDisabled(!hasPersonality);

  const backBtn = new ButtonBuilder()
    .setCustomId('back_to_server_p2')
    .setLabel('← Back')
    .setStyle(ButtonStyle.Secondary);

  const nextBtn = new ButtonBuilder()
    .setCustomId('server_settings_page4')
    .setLabel('Next Page →')
    .setStyle(ButtonStyle.Primary);

  const embed = new EmbedBuilder()
    .setColor(embedColor)
    .setTitle('Server Settings')
    .setDescription("Customize the server's visual theme and custom bot instructions.")
    .addFields(
      { name: 'Embed Color',        value: `\`${embedColor}\``,                             inline: true },
      { name: 'Custom Personality', value: `\`${hasPersonality ? 'Active' : 'Default'}\``,  inline: true }
    )
    .setFooter({ text: 'Page 3 of 5' })
    .setTimestamp();

  const payload = {
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(colorBtn, personalityBtn, removePersonalityBtn),
      new ActionRowBuilder().addComponents(backBtn, nextBtn)
    ],
    flags: MessageFlags.Ephemeral
  };

  if (isUpdate) await interaction.update(payload);
  else           await interaction.reply(payload);
}

// ============================================================================
// PAGE 4 — Channel Management
// ============================================================================

export async function showServerSettingsPage4(interaction, isUpdate = false) {
  if (!requireManageGuild(interaction)) return;

  const guildId        = interaction.guild.id;
  const ss             = state.serverSettings[guildId] || {};
  const embedColor     = ss.embedColor      || THEME_COLOR;
  const allowedChannels = ss.allowedChannels || [];

  const manageBtn = new ButtonBuilder()
    .setCustomId('manage_allowed_channels')
    .setLabel('Manage Channels')
    .setStyle(ButtonStyle.Primary);

  const toggleBtn = new ButtonBuilder()
    .setCustomId('toggle_continuous_reply')
    .setLabel('Toggle Channel Mode')
    .setStyle(ButtonStyle.Secondary);

  const backBtn = new ButtonBuilder()
    .setCustomId('back_to_server_p3')
    .setLabel('← Back')
    .setStyle(ButtonStyle.Secondary);

  const nextBtn = new ButtonBuilder()
    .setCustomId('server_settings_page5')
    .setLabel('Next Page →')
    .setStyle(ButtonStyle.Primary);

  const channelList = allowedChannels.length > 0
    ? allowedChannels.slice(0, 5).map(id => `<#${id}>`).join(', ') +
      (allowedChannels.length > 5 ? ` +${allowedChannels.length - 5} more` : '')
    : 'All channels allowed';

  const embed = new EmbedBuilder()
    .setColor(embedColor)
    .setTitle('Server Settings')
    .setDescription('Control which channels the bot is authorized to operate in.')
    .addFields(
      { name: 'Allowed Channels',       value: channelList,                                              inline: false },
      { name: 'Channel-Specific Mode',  value: 'Enable or disable continuous mode in the active channel', inline: false }
    )
    .setFooter({ text: 'Page 4 of 5' })
    .setTimestamp();

  const payload = {
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(manageBtn, toggleBtn),
      new ActionRowBuilder().addComponents(backBtn, nextBtn)
    ],
    flags: MessageFlags.Ephemeral
  };

  if (isUpdate) await interaction.update(payload);
  else           await interaction.reply(payload);
}

// ============================================================================
// PAGE 5 — Data Management
// ============================================================================

export async function showServerSettingsPage5(interaction, isUpdate = false) {
  if (!requireManageGuild(interaction)) return;

  const guildId    = interaction.guild.id;
  const ss         = state.serverSettings[guildId] || {};
  const embedColor = ss.embedColor || THEME_COLOR;

  const clearBtn = new ButtonBuilder()
    .setCustomId('clear_server_memory')
    .setLabel('Clear Memory')
    .setStyle(ButtonStyle.Danger);

  const downloadBtn = new ButtonBuilder()
    .setCustomId('download_server_conversation')
    .setLabel('Export History')
    .setStyle(ButtonStyle.Success);

  const backBtn = new ButtonBuilder()
    .setCustomId('back_to_server_p4')
    .setLabel('← Back')
    .setStyle(ButtonStyle.Secondary);

  const mainBtn = new ButtonBuilder()
    .setCustomId('back_to_main')
    .setLabel('← Main Menu')
    .setStyle(ButtonStyle.Primary);

  const embed = new EmbedBuilder()
    .setColor(embedColor)
    .setTitle('Server Settings')
    .setDescription('Manage server-wide conversation storage and data exports.')
    .addFields(
      { name: 'Clear Server Memory',   value: 'Erase all stored memory logs for this server.', inline: false },
      { name: 'Export Server History', value: 'Download the complete conversation archive.',   inline: false }
    )
    .setFooter({ text: 'Page 5 of 5' })
    .setTimestamp();

  const payload = {
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(clearBtn, downloadBtn),
      new ActionRowBuilder().addComponents(backBtn, mainBtn)
    ],
    flags: MessageFlags.Ephemeral
  };

  if (isUpdate) await interaction.update(payload);
  else           await interaction.reply(payload);
}

// ============================================================================
// CHANNEL MANAGEMENT MENU
// ============================================================================

export async function showChannelManagementMenu(interaction, isUpdate = false) {
  if (!requireManageGuild(interaction)) return;

  const guildId        = interaction.guild.id;
  const ss             = state.serverSettings[guildId] || {};
  const allowedChannels = ss.allowedChannels || [];
  const embedColor     = ss.embedColor || THEME_COLOR;

  const channelSelect = new ChannelSelectMenuBuilder()
    .setCustomId('channel_manage_select')
    .setPlaceholder('Select authorized channels')
    .setMinValues(0).setMaxValues(25)
    .setChannelTypes([ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildForum]);

  if (allowedChannels.length > 0) {
    const valid = allowedChannels.filter(id => interaction.guild.channels.cache.has(id)).slice(0, 25);
    if (valid.length > 0) channelSelect.setDefaultChannels(valid);
  }

  const setAllBtn = new ButtonBuilder()
    .setCustomId('set_all_channels')
    .setLabel('Allow All')
    .setStyle(ButtonStyle.Success);

  const backBtn = new ButtonBuilder()
    .setCustomId('back_to_server_p4')
    .setLabel('← Back')
    .setStyle(ButtonStyle.Secondary);

  const currentValue = allowedChannels.length > 0
    ? allowedChannels.map(id => `<#${id}>`).join(', ')
    : 'All Channels';

  const embed = new EmbedBuilder()
    .setColor(embedColor)
    .setTitle('Channel Management')
    .setDescription('Define which channels the bot is permitted to respond in.')
    .addFields({ name: 'Authorized Channels', value: currentValue })
    .setFooter({ text: 'Leave empty to authorize all server channels.' });

  const payload = {
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(channelSelect),
      new ActionRowBuilder().addComponents(backBtn, setAllBtn)
    ],
    flags: MessageFlags.Ephemeral
  };

  if (isUpdate) await interaction.update(payload);
  else           await interaction.reply(payload);
}

// ============================================================================
// SELECT MENU HANDLERS (called from SettingsRouter)
// ============================================================================

export async function handleServerResponseFormat(interaction) {
  if (!requireManageGuild(interaction)) return;
  const guildId = interaction.guild.id;
  if (!state.serverSettings[guildId]) state.serverSettings[guildId] = {};
  state.serverSettings[guildId].responseFormat = interaction.values[0];
  await persistServer(guildId);
  await showServerSettings(interaction, true);
}

export async function handleServerActionButtons(interaction) {
  if (!requireManageGuild(interaction)) return;
  const guildId = interaction.guild.id;
  if (!state.serverSettings[guildId]) state.serverSettings[guildId] = {};
  state.serverSettings[guildId].showActionButtons = interaction.values[0] === 'show';
  await persistServer(guildId);
  await showServerSettings(interaction, true);
}

export async function handleServerContinuousReply(interaction) {
  if (!requireManageGuild(interaction)) return;
  const guildId = interaction.guild.id;
  if (!state.serverSettings[guildId]) state.serverSettings[guildId] = {};
  state.serverSettings[guildId].continuousReply = interaction.values[0] === 'enabled';
  await persistServer(guildId);
  await showServerSettingsPage2(interaction, true);
}

export async function handleServerOverride(interaction) {
  if (!requireManageGuild(interaction)) return;
  const guildId = interaction.guild.id;
  if (!state.serverSettings[guildId]) state.serverSettings[guildId] = {};
  state.serverSettings[guildId].overrideUserSettings = interaction.values[0] === 'enabled';
  await persistServer(guildId);
  await showServerSettingsPage2(interaction, true);
}

export async function handleServerChatHistory(interaction) {
  if (!requireManageGuild(interaction)) return;
  const guildId = interaction.guild.id;
  if (!state.serverSettings[guildId]) state.serverSettings[guildId] = {};
  state.serverSettings[guildId].serverChatHistory = interaction.values[0] === 'enabled';
  await persistServer(guildId);
  await showServerSettingsPage2(interaction, true);
}

export async function handleChannelManageSelect(interaction) {
  if (!requireManageGuild(interaction)) return;
  const guildId = interaction.guild.id;
  if (!state.serverSettings[guildId]) state.serverSettings[guildId] = {};
  state.serverSettings[guildId].allowedChannels = interaction.values;
  await persistServer(guildId);
  await showChannelManagementMenu(interaction, true);
}

export async function handleSetAllChannels(interaction) {
  if (!requireManageGuild(interaction)) return;
  const guildId = interaction.guild.id;
  if (!state.serverSettings[guildId]) state.serverSettings[guildId] = {};
  state.serverSettings[guildId].allowedChannels = [];
  await persistServer(guildId);
  await showChannelManagementMenu(interaction, true);
}

export async function toggleContinuousReplyChannel(interaction) {
  if (!requireManageGuild(interaction)) return;

  const channelId = interaction.channelId;
  if (!state.continuousReplyChannels) state.continuousReplyChannels = {};

  const newValue = !state.continuousReplyChannels[channelId];
  if (newValue) state.continuousReplyChannels[channelId] = true;
  else          delete state.continuousReplyChannels[channelId];

  await persistChannelSetting(channelId, 'continuousReply', newValue || null);

  const embed = newValue
    ? new EmbedBuilder().setColor('#09090B').setTitle('Continuous Reply Enabled')
        .setDescription(`Mentions are no longer required in <#${channelId}>.`)
    : new EmbedBuilder().setColor('#09090B').setTitle('Continuous Reply Disabled')
        .setDescription(`Explicit mentions are now required in <#${channelId}>.`);

  await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

// ============================================================================
// DATA ACTIONS
// ============================================================================

export async function clearServerMemory(interaction) {
  if (!requireManageGuild(interaction)) return;
  const guildId = interaction.guild.id;
  state.chatHistories[guildId] = {};
  await persistChatHistory(guildId);
  await interaction.reply({
    embeds: [new EmbedBuilder()
      .setColor('#09090B')
      .setTitle('Memory Cleared')
      .setDescription('Server-wide chat history has been cleared.')
    ],
    flags: MessageFlags.Ephemeral
  });
}

export async function downloadServerConversation(interaction) {
  if (!requireManageGuild(interaction)) return;

  const guildId = interaction.guild.id;
  const ss      = state.serverSettings[guildId] || {};

  if (!ss.serverChatHistory) {
    return interaction.reply({
      embeds: [new EmbedBuilder()
        .setColor('#09090B')
        .setTitle('Feature Disabled')
        .setDescription('Server-wide chat history is currently disabled. Please enable it in page 2.')
      ],
      flags: MessageFlags.Ephemeral
    });
  }

  const historyObject = state.chatHistories[guildId];
  if (!historyObject || !Object.keys(historyObject).length) {
    return interaction.reply({
      embeds: [new EmbedBuilder()
        .setColor('#09090B')
        .setTitle('No History Found')
        .setDescription('There is no conversation history on record for this server.')
      ],
      flags: MessageFlags.Ephemeral
    });
  }

  let conversationText = '';
  let messageCount     = 0;

  for (const messagesId of Object.keys(historyObject)) {
    for (const entry of historyObject[messagesId]) {
      const role         = entry.role === 'user' ? '[User]' : '[Assistant]';
      const contentParts = (entry.content || entry.parts || [])
        .filter(p => p.text || p.fileUri || p.fileData)
        .map(p => p.text || '[Media File Attached]');

      if (contentParts.length) {
        conversationText += `${role}:\n${contentParts.join('\n')}\n\n`;
        messageCount++;
      }
    }
  }

  if (!conversationText || messageCount === 0) {
    return interaction.reply({
      embeds: [new EmbedBuilder()
        .setColor('#09090B')
        .setTitle('No Readable History')
        .setDescription('The existing conversation logs do not contain any exportable text content.')
      ],
      flags: MessageFlags.Ephemeral
    });
  }

  const tempFile  = path.join(TEMP_DIR, `server_conversation_${interaction.id}.txt`);
  const header    = `Server Conversation History\nServer: ${interaction.guild.name}\nMessages: ${messageCount}\nExported: ${new Date().toLocaleString()}\n${'='.repeat(50)}\n\n`;
  await fs.writeFile(tempFile, header + conversationText, 'utf8');

  const { size } = await fs.stat(tempFile);
  const sizeMB   = size / (1024 * 1024);
  const safeName = interaction.guild.name.replace(/[^a-z0-9]/gi, '_');
  let fileSent   = false;
  let fallback;

  if (sizeMB <= 9.5) {
    try {
      await interaction.user.send({
        content: `📥 **Server Conversation History**\n\`Server: ${interaction.guild.name}\`\n\`Messages: ${messageCount}\``,
        files:   [new AttachmentBuilder(tempFile, { name: `${safeName}_history.txt` })]
      });
      await interaction.reply({
        embeds: [new EmbedBuilder()
          .setColor('#09090B')
          .setTitle('History Sent')
          .setDescription(`The server conversation history (${messageCount} messages) has been sent to your DMs!`)
        ],
        flags: MessageFlags.Ephemeral
      });
      fileSent = true;
    } catch (err) {
      logger.error('DM send failed for server history', err);
      fallback = new EmbedBuilder()
        .setColor('#09090B')
        .setTitle('DM Failed')
        .setDescription('Could not deliver history to DMs. Attempting direct upload.');
    }
  } else {
    fallback = new EmbedBuilder()
      .setColor('#09090B')
      .setTitle('History Too Large')
      .setDescription(`The chat history is too large (${sizeMB.toFixed(2)} MB). Transferring to a secure external link.`);
  }

  if (!fileSent) {
    const { uploadText } = await import('../../utils.js');
    const urlText = await uploadText(conversationText);
    const url     = urlText.match(/🔗 URL: (.+)/)?.[1] || 'URL generation failed.';
    const embed   = (fallback || new EmbedBuilder().setColor('#09090B').setTitle('History Exported'))
      .addFields({ name: 'Archive Link', value: `[View Saved Logs](${url})`, inline: false });
    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  }

  await fs.unlink(tempFile).catch(() => {});
}

// ============================================================================
// PERSONALITY / COLOR MODALS
// ============================================================================

export async function showServerPersonalityModal(interaction) {
  if (!requireManageGuild(interaction)) return;

  const guildId  = interaction.guild.id;
  const existing = (state.serverSettings[guildId] || {}).customPersonality || '';

  const input = new TextInputBuilder()
    .setCustomId('personality_input')
    .setLabel("Define the bot's server personality")
    .setStyle(TextInputStyle.Paragraph)
    .setPlaceholder('Enter server custom personality instructions...')
    .setMinLength(10).setMaxLength(4000);
  if (existing) input.setValue(existing);

  await interaction.showModal(
    new ModalBuilder()
      .setCustomId('server_personality_modal')
      .setTitle('Server Custom Personality')
      .addComponents(new ActionRowBuilder().addComponents(input))
  );
}

export async function removeServerPersonality(interaction) {
  if (!requireManageGuild(interaction)) return;

  const guildId = interaction.guild.id;
  if (state.serverSettings[guildId]) delete state.serverSettings[guildId].customPersonality;
  if (state.customInstructions?.[guildId]) delete state.customInstructions[guildId];
  await Promise.all([persistServer(guildId), persistInstructions(guildId, null)]);
  await interaction.reply({
    embeds: [new EmbedBuilder()
      .setColor('#09090B')
      .setTitle('Personality Removed')
      .setDescription('The server personality has been reset to default.')
    ],
    flags: MessageFlags.Ephemeral
  });
}

export async function showServerEmbedColorModal(interaction) {
  if (!requireManageGuild(interaction)) return;

  const guildId  = interaction.guild.id;
  const existing = (state.serverSettings[guildId] || {}).embedColor || BOT_CONFIG.HEX_COLOUR;

  const input = new TextInputBuilder()
    .setCustomId('color_input')
    .setLabel('Hex Color Code')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('#FF5733 or FF5733')
    .setMinLength(6).setMaxLength(7);
  if (existing) input.setValue(existing);

  await interaction.showModal(
    new ModalBuilder()
      .setCustomId('server_embed_color_modal')
      .setTitle('Server Theme Color')
      .addComponents(new ActionRowBuilder().addComponents(input))
  );
}

export { persistServer, persistInstructions };