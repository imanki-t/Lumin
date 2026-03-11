/**
 * @fileoverview Discord Bot Entry Point — event routing and lifecycle management.
 * @version 4.0.0
 * @module index
 */

import {
  MessageFlags,
  ChannelType,
  PermissionsBitField,
  ActivityType,
  REST,
  Routes
} from 'discord.js';
import express from 'express';

import config from './config.js';
import {
  client,
  token,
  initialize,
  saveStateToFile,
  state,
  TEMP_DIR,
  initializeBlacklistForGuild,
  BOT_CONFIG,
  DEFAULT_USER_SETTINGS,
  requestQueues   // ← direct import; avoids going through state getter
} from './managers/BotManager.js';

import { Logger }       from './core/Logger.js';
import { Embeds }       from './modules/shared/embedBuilder.js';
import { cleanTemp, startPeriodicCleanup } from './modules/shared/tempFileManager.js';

import { processUserQueue }               from './modules/messageProcessor.js';
import {
  handleButtonInteraction,
  handleSelectMenuInteraction,
  handleModalSubmit
} from './modules/settingsHandler.js';
import { handleSearchCommand }            from './modules/searchCommand.js';
import { commands }                       from './commands.js';
import {
  initializeScheduledTasks,
  handleCommandInteraction   as handleNewCommands,
  handleSelectMenuInteraction as handleNewSelectMenus,
  handleModalSubmission      as handleNewModals,
  handleButtonInteraction    as handleNewButtons,
  processMessageRoulette
} from './commands/index.js';

const logger = Logger.get('Index');

// ============================================================================
// CONSTANTS
// ============================================================================

/** System message type IDs — bot should never respond to these. */
const IGNORED_MESSAGE_TYPES = Object.freeze(new Set([
  1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 15, 18, 20, 21, 22, 23, 24, 25,
  26, 27, 28, 29, 30, 31, 36, 37, 38, 39, 46
]));

const MAX_USER_QUEUE_SIZE = 5;

const EXPRESS_CONFIG = Object.freeze({
  PORT:               process.env.PORT || 3000,
  HEALTH_CHECK_PATH:  '/health',
  STATUS_PATH:        '/'
});

// ============================================================================
// INITIALIZATION
// ============================================================================

initialize().catch(error => {
  logger.critical('Critical initialization error', error);
  process.exit(1);
});

// ============================================================================
// EXPRESS HEALTH SERVER
// ============================================================================

const app = express();

app.get(EXPRESS_CONFIG.STATUS_PATH, (_req, res) => {
  res.json({
    status:    'online',
    bot:       client.user?.tag || 'Starting…',
    uptime:    process.uptime(),
    timestamp: new Date().toISOString()
  });
});

app.get(EXPRESS_CONFIG.HEALTH_CHECK_PATH, (_req, res) => {
  const healthy = client.isReady() && client.ws.status === 0;
  res.status(healthy ? 200 : 503).json({
    status:    healthy ? 'healthy' : 'degraded',
    ready:     client.isReady(),
    wsStatus:  client.ws.status,
    timestamp: new Date().toISOString()
  });
});

app.listen(EXPRESS_CONFIG.PORT, () => {
  logger.info(`Express server running on port ${EXPRESS_CONFIG.PORT}`);
});

// ============================================================================
// TEMP FILE CLEANUP
// ============================================================================

// BUG FIX: original had two identical functions (cleanupTempFiles + startupCleanup).
// Both are replaced by the shared tempFileManager utility.
cleanTemp().catch(() => {});                        // immediate startup clean
startPeriodicCleanup(3_600_000, 3_600_000);         // hourly thereafter

// ============================================================================
// ACTIVITY ROTATION
// ============================================================================

const activities = config.activities.map(activity => ({
  name: activity.name,
  type: ActivityType[activity.type]
}));

let activityIndex = 0;

function updateActivity() {
  if (!client.user) return;
  try {
    client.user.setPresence({
      activities: [activities[activityIndex]],
      status:     'idle'
    });
    logger.debug(`Activity set to: ${activities[activityIndex].name}`);
  } catch (error) {
    logger.error('Error updating activity', error);
  }
}

function rotateActivity() {
  activityIndex = (activityIndex + 1) % activities.length;
  updateActivity();
}

// ============================================================================
// BOT EVENTS
// ============================================================================

/**
 * BUG FIX: was `client.once('clientReady', ...)` — 'clientReady' does not exist
 * in Discord.js v14.  The correct event is 'ready'.
 */
client.once('ready', async () => {
  logger.info(`Logged in as ${client.user.tag}`);

  // Register global slash commands.
  const rest = new REST().setToken(token);
  try {
    logger.info('Refreshing application (/) commands…');
    await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
    logger.info('Slash commands refreshed successfully');
  } catch (error) {
    logger.error('Error refreshing commands', error);
  }

  updateActivity();
  setInterval(rotateActivity, 86_400_000);

  try {
    initializeScheduledTasks(client);
    logger.info('Scheduled tasks initialized');
  } catch (error) {
    logger.error('Error initializing scheduled tasks', error);
  }
});

/** Fires when the bot joins a new server. */
client.on('guildCreate', async (guild) => {
  try {
    logger.info(`Joined new guild: ${guild.name} (${guild.id})`);

    const channel = guild.channels.cache.find(
      ch =>
        ch.type === ChannelType.GuildText &&
        ch.permissionsFor(guild.members.me)?.has(PermissionsBitField.Flags.SendMessages)
    );

    if (channel) {
      await channel.send(`🎉 Thanks for adding me to **${guild.name}**! Use \`/settings\` to configure me.`);
    }
  } catch (error) {
    logger.error('Error sending welcome message', error);
  }
});

/** Main message handler. */
client.on('messageCreate', async (message) => {
  try {
    if (message.author.bot)                          return;
    if (message.content.startsWith('!'))             return;
    if (IGNORED_MESSAGE_TYPES.has(message.type))     return;

    const isDM       = message.channel.type === ChannelType.DM;
    const guildId    = message.guild?.id;
    const channelId  = message.channelId;
    const userId     = message.author.id;

    if (guildId) {
      initializeBlacklistForGuild(guildId);

      if (state.blacklistedUsers[guildId]?.includes(userId)) return;

      const allowedChannels = state.serverSettings[guildId]?.allowedChannels;
      if (allowedChannels?.length > 0 && !allowedChannels.includes(channelId)) return;
    }

    const userSettings      = state.userSettings[userId]    || {};
    const serverSettings    = guildId ? (state.serverSettings[guildId] || {}) : {};
    const effectiveSettings = serverSettings.overrideUserSettings ? serverSettings : userSettings;
    const continuousReply   = effectiveSettings.continuousReply ?? DEFAULT_USER_SETTINGS.continuousReply;
    const channelContinuous = state.continuousReplyChannels?.[channelId] || false;

    const shouldRespond = (
      (isDM   && BOT_CONFIG.WORK_IN_DMS && (continuousReply || message.mentions.users.has(client.user.id))) ||
      (guildId && message.mentions.users.has(client.user.id))                                               ||
      (guildId && (channelContinuous || continuousReply))                                                   ||
      state.alwaysRespondChannels[channelId]                                                                ||
      state.activeUsersInChannels[channelId]?.[userId]
    );

    if (!shouldRespond) {
      processMessageRoulette(message);
      return;
    }

    // BUG FIX: original used state.requestQueues — now uses the direct import
    if (!requestQueues.has(userId)) {
      requestQueues.set(userId, { queue: [], isProcessing: false });
    }

    const userQueueData = requestQueues.get(userId);

    if (userQueueData.queue.length >= MAX_USER_QUEUE_SIZE) {
      await message.reply({
        embeds: [Embeds.queueFull(MAX_USER_QUEUE_SIZE)],
        flags:  MessageFlags.Ephemeral
      });
      return;
    }

    userQueueData.queue.push(message);

    if (!userQueueData.isProcessing) {
      processUserQueue(userId);
    }

    processMessageRoulette(message);

  } catch (error) {
    logger.error('Error processing message', error);
  }
});

/** Routes all interaction types to the correct handler. */
client.on('interactionCreate', async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      await handleCommandInteraction(interaction);

    } else if (interaction.isButton()) {
      await handleNewButtons(interaction);
      if (!interaction.replied && !interaction.deferred) {
        await handleButtonInteraction(interaction);
      }

    } else if (interaction.isModalSubmit()) {
      await handleNewModals(interaction);
      if (!interaction.replied && !interaction.deferred) {
        await handleModalSubmit(interaction);
      }

    } else if (interaction.isStringSelectMenu() || interaction.isChannelSelectMenu()) {
      await handleNewSelectMenus(interaction);
      if (!interaction.replied && !interaction.deferred) {
        await handleSelectMenuInteraction(interaction);
      }
    }
  } catch (error) {
    logger.error('Critical interaction error', error);

    try {
      if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
        await interaction.reply({
          embeds: [Embeds.error('Unexpected Error', 'An unexpected error occurred.')],
          flags:  MessageFlags.Ephemeral
        });
      }
    } catch { /* unknown interaction — swallow */ }
  }
});

client.on('error', (error) => logger.error('Discord client error', error));
client.on('warn',  (warn)  => logger.warn(`Discord client warning: ${warn}`));

// BUG FIX: 'disconnect' and 'reconnecting' do NOT exist in Discord.js v14.
// The v14 equivalents are handled internally by the library.
// Removed:  client.on('disconnect', ...)
// Removed:  client.on('reconnecting', ...)

// ============================================================================
// COMMAND ROUTER
// ============================================================================

/**
 * Route slash commands to their handlers.
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 */
async function handleCommandInteraction(interaction) {
  if (!interaction.isChatInputCommand()) return;

  const commandHandlers = {
    settings: async (i) => {
      const { showMainSettings } = await import('./modules/settingsHandler.js');
      await showMainSettings(i, false);
    },
    search:      handleSearchCommand,
    birthday:    handleNewCommands,
    reminder:    handleNewCommands,
    quote:       handleNewCommands,
    roulette:    handleNewCommands,
    anniversary: handleNewCommands,
    digest:      handleNewCommands,
    starter:     handleNewCommands,
    compliment:  handleNewCommands,
    game:        handleNewCommands,
    timezone:    handleNewCommands,
    summary:     handleNewCommands,
    realive:     handleNewCommands
  };

  const handler = commandHandlers[interaction.commandName];

  if (!handler) {
    logger.warn(`Unknown command: ${interaction.commandName}`);
    return;
  }

  try {
    await handler(interaction);
  } catch (error) {
    logger.error(`Error in command /${interaction.commandName}`, error);

    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        embeds: [Embeds.error('Command Failed', 'Failed to execute this command.')],
        flags:  MessageFlags.Ephemeral
      }).catch(() => {});
    }
  }
}

// ============================================================================
// GRACEFUL SHUTDOWN
// ============================================================================

/**
 * BUG FIX: SIGINT/SIGTERM were registered in BOTH botManager.js AND here,
 * creating a double-shutdown race.  They are now registered ONLY here.
 * BotManager.js registers NONE (see managers/BotManager.js).
 *
 * This shutdown additionally destroys the Discord client, which the
 * BotManager version did not.
 *
 * @param {string} signal
 */
async function gracefulShutdown(signal) {
  logger.info(`Received ${signal} — graceful shutdown…`);

  try {
    logger.info('Saving final state…');
    await saveStateToFile();

    logger.info('Closing Discord connection…');
    client.destroy();

    logger.info('Graceful shutdown complete ✅');
    process.exit(0);
  } catch (error) {
    logger.error('Error during graceful shutdown', error);
    process.exit(1);
  }
}

process.on('SIGINT',  () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception', error);
  const fatal = ['ENOMEM', 'ENOSPC', 'MODULE_NOT_FOUND'];
  const isFatal = fatal.some(p => error.message?.includes(p) || error.code?.includes?.(p));
  if (isFatal) gracefulShutdown('uncaughtException');
  // Otherwise log and continue — the event loop is not corrupted.
});

process.on('unhandledRejection', (reason) => {
  const message   = reason?.message || String(reason);
  const isDiscord = reason?.code && typeof reason.code === 'number';

  if (isDiscord) {
    logger.warn(`Unhandled Discord error [${reason.code}]: ${message}`);
  } else {
    logger.error(`Unhandled Rejection: ${message}`, reason);
  }
  // Never shut down here — would kill the bot on any stray rejected promise.
});

// ============================================================================
// LOGIN
// ============================================================================

client.login(token).catch(error => {
  logger.critical('Failed to login to Discord', error);
  process.exit(1);
});
