/**
 * @fileoverview /realive command — periodically sends AI-generated revival messages
 *               to quiet server channels. Server-only, requires Manage Guild permission.
 * @module commands/realive
 */

import { EmbedBuilder, PermissionsBitField, MessageFlags } from 'discord.js';

import { state, saveStateToFile, genAI } from '../managers/BotManager.js';
import * as db                            from '../database/index.js';
import { memorySystem }                   from '../memory/MemorySystem.js';
import { MODELS, DEFAULT_MODEL } from '../modules/config.js';  // ← renamed to avoid collision with local 
import { Logger }                         from '../core/Logger.js';

const logger = Logger.get('Realive');

const REVIVAL_MODEL = DEFAULT_MODEL;
const CHECK_INTERVAL_MS = 10 * 60 * 1000; // every 10 minutes

// ============================================================================
// COMMAND DEFINITION
// ============================================================================

export const reviveCommand = {
  name:        'revive',
  description: 'Periodically send AI-generated messages to re-engage quiet channels (Server Only)',
  options: [
    {
      name:        'action',
      description: 'What do you want to do?',
      type:        3,
      required:    true,
      choices: [
        { name: 'Enable',   value: 'enable'   },
        { name: 'Disable',  value: 'disable'  },
        { name: 'Interval', value: 'interval' },
        { name: 'Status',   value: 'status'   }
      ]
    },
    {
      name:        'hours',
      description: 'Interval in hours (used with action: interval)',
      type:        4,
      required:    false,
      min_value:   1,
      max_value:   168
    }
  ]
};

// ============================================================================
// COMMAND HANDLER
// ============================================================================

/**
 * @param {import('discord.js').CommandInteraction} interaction
 */
export async function handleReviveCommand(interaction) {
  const guild = interaction.guild;

  // Server-only guard
  if (!guild) {
    return interaction.reply({
      content: '❌ This command can only be used in servers.',
      flags:   MessageFlags.Ephemeral
    });
  }

  // Permission guard
  if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
    return interaction.reply({
      content: '🚫 You need **Manage Server** permission to configure chat revival.',
      flags:   MessageFlags.Ephemeral
    });
  }

  const action  = interaction.options.getString('action');
  const hours   = interaction.options.getInteger('hours');
  const guildId = guild.id;

  // Lazy-initialise state
  if (!state.realive)           state.realive           = {};
  if (!state.realive[guildId])  state.realive[guildId]  = {
    enabled:       false,
    intervalHours: 12,
    lastRun:       0,
    lastChannelId: null
  };

  // Use a distinct name to avoid shadowing the `botConfig` import above
  const guildConfig = state.realive[guildId];

  switch (action) {
    case 'enable': {
      guildConfig.enabled = true;
      if (!guildConfig.lastChannelId) guildConfig.lastChannelId = interaction.channelId;

      await persistConfig(guildId, guildConfig);
      return interaction.reply({
        content:
          `✅ **Chat Revival Enabled!**\n\n` +
          `I will attempt to revive dead chats every **${guildConfig.intervalHours} hours** ` +
          `in the last active channel (<#${guildConfig.lastChannelId}>).`
      });
    }

    case 'disable': {
      guildConfig.enabled = false;
      await persistConfig(guildId, guildConfig);
      return interaction.reply({ content: '🛑 **Chat Revival Disabled.**' });
    }

    case 'interval': {
      if (!hours) {
        return interaction.reply({
          content: '⚠️ Please specify the number of hours using the `hours` option.',
          flags:   MessageFlags.Ephemeral
        });
      }
      guildConfig.intervalHours = hours;
      await persistConfig(guildId, guildConfig);
      return interaction.reply({
        content: `⏱️ **Interval Updated!**\n\nI will now check for chat revival every **${hours} hours**.`
      });
    }

    case 'status': {
      const channelText = guildConfig.lastChannelId
        ? `<#${guildConfig.lastChannelId}>`
        : 'None (Talk to me to set one!)';

      const embed = new EmbedBuilder()
        .setColor(0x00FFFF)
        .setTitle('✨ Channel Revival Status')
        .addFields(
          { name: 'Status',         value: guildConfig.enabled ? '✅ Enabled' : '❌ Disabled', inline: true  },
          { name: 'Interval',       value: `${guildConfig.intervalHours} hours`,               inline: true  },
          { name: 'Target Channel', value: channelText,                                        inline: false },
          { name: 'Last Run',       value: guildConfig.lastRun
              ? new Date(guildConfig.lastRun).toLocaleString()
              : 'Never',                                                                        inline: false }
        );

      return interaction.reply({ embeds: [embed] });
    }

    default:
      return interaction.reply({
        content: '❌ Unknown action.',
        flags: MessageFlags.Ephemeral
      });
  }
}

// ============================================================================
// BACKGROUND TASK
// ============================================================================

/**
 * Start the Realive background loop (called once at bot startup).
 * @param {import('discord.js').Client} client
 */
export function startReviveLoop(client) {
  setInterval(() => checkAndRevive(client), CHECK_INTERVAL_MS);
  logger.info('Realive background task started');
}

/**
 * Scan all guilds and send revival messages where due.
 * @param {import('discord.js').Client} client
 */
async function checkAndRevive(client) {
  if (!state.realive) return;

  const now = Date.now();

  for (const [guildId, guildConfig] of Object.entries(state.realive ?? {})) {
    if (!guildConfig.enabled || !guildConfig.lastChannelId) continue;

    const intervalMs       = guildConfig.intervalHours * 60 * 60 * 1000;
    const timeSinceLastRun = now - (guildConfig.lastRun || 0);
    if (timeSinceLastRun < intervalMs) continue;

    try {
      const guild = client.guilds.cache.get(guildId);
      if (!guild) continue;

      const channel = guild.channels.cache.get(guildConfig.lastChannelId);
      if (!channel) continue;

      // Only revive if the channel is actually quiet
      const messages = await channel.messages.fetch({ limit: 1 }).catch(() => null);
      const lastMsg  = messages?.first();

      const shouldRevive = !lastMsg || (now - lastMsg.createdTimestamp) >= intervalMs;

      // In both cases reset lastRun so the next cycle starts from now
      guildConfig.lastRun = now;
      await persistConfig(guildId, guildConfig);

      if (shouldRevive) {
        await sendRevivalMessage(channel, guildId);
      }

    } catch (error) {
      logger.error(`Realive task failed for guild ${guildId}`, error);
    }
  }
}

// ============================================================================
// PRIVATE — AI REVIVAL MESSAGE
// ============================================================================

/**
 * Generate and send an AI revival message to the channel.
 * Falls back to a static list if generation fails.
 * @param {import('discord.js').TextChannel} channel
 * @param {string} guildId
 */
async function sendRevivalMessage(channel, guildId) {
  try {
    const history = await memorySystem.getOptimizedHistory(
      guildId,
      'generate conversation revival message',
      REVIVAL_MODEL
    );

    let contextPrompt = 'Generate a casual, natural message to revive this dead chat. ';
    contextPrompt += history?.length > 0
      ? 'Reference recent conversation topics naturally. '
      : "Since there's no recent history, create a general engaging question. ";
    contextPrompt +=
      "Keep it short, casual, and friendly — like you're genuinely wondering where everyone went. " +
      'Examples: "duhh, where are all of you?", "sooo... did everyone disappear? 👀", "it\'s quiet here... too quiet 🤔"';

    const serverSettings   = state.serverSettings?.[guildId] ?? {};
    const customPersonality = serverSettings.customPersonality || state.customInstructions?.[guildId];

    let systemInstruction = botConfig.coreSystemRules;
    systemInstruction += customPersonality
      ? `\n\nADDITIONAL PERSONALITY:\n${customPersonality}`
      : `\n\n${botConfig.defaultPersonality}`;
    systemInstruction +=
      "\n\nYou're sending a message to revive a quiet Discord server. Be natural and casual — " +
      "you're not announcing anything, just casually checking in or commenting on topics people were discussing. " +
      "Reference recent conversations if available. Don't use quotes or formal greetings.";

    const request = {
      model:    REVIVAL_MODEL,
      contents: [
        ...(history ?? []),
        { role: 'user', parts: [{ text: contextPrompt }] }
      ],
      config: {
        systemInstruction,
        temperature: 0.95,
        topP:        0.95
      }
    };

    const result = await genAI.models.generateContent(request);
    let revivalMsg = result.text ?? '';

    revivalMsg = revivalMsg
      .replace(/^["']|["']$/g, '')   // remove surrounding quotes
      .replace(/^\*\*|\*\*$/g, '')   // remove bold markers
      .trim();

    await channel.send(revivalMsg || pickFallback());

  } catch (error) {
    logger.error('Failed to generate revival message', error);
    await channel.send(pickFallback());
  }
}

/** Pick a random fallback revival message. */
function pickFallback() {
  const fallbacks = [
    'duhh, where are all of you? 👀',
    'sooo... did everyone disappear?',
    "it's quiet here... too quiet 🤔",
    'hellooo? anyone there? 🙃',
    '*checks if server is still alive*',
    "y'all ghosted the chat or what? 😭"
  ];
  return fallbacks[Math.floor(Math.random() * fallbacks.length)];
}

// ============================================================================
// PRIVATE — PERSISTENCE
// ============================================================================

/**
 * Persist the guild Realive config to DB and state file.
 * @param {string} guildId
 * @param {object} guildConfig
 */
async function persistConfig(guildId, guildConfig) {
  state.realive[guildId] = guildConfig;
  await db.saveRealiveConfig(guildId, guildConfig);
  await saveStateToFile();
}
