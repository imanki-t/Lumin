/**
 * @fileoverview Discord Bot Entry Point - Event handling and server management
 * @version 3.0.0
 * @module index
 * 
 * Features:
 * - Optimized event handling with parallel processing
 * - Automatic command registration and refresh
 * - Graceful error handling and recovery
 * - Express health check server for uptime monitoring
 * - Activity rotation and presence management
 * - Automated temp file cleanup
 * - Intelligent message routing and filtering
 * 
 * @requires discord.js ^14.16.3
 * @requires express ^4.21.2
 */

import { 
  MessageFlags, 
  EmbedBuilder, 
  ChannelType, 
  PermissionsBitField, 
  ActivityType, 
  REST, 
  Routes 
} from 'discord.js';
import fs from 'fs/promises';
import path from 'path';
import express from 'express';

import config from './config.js';
import { 
  client, 
  token, 
  initialize, 
  saveStateToFile, 
  state, 
  TEMP_DIR, 
  initializeBlacklistForGuild 
} from './botManager.js';
import { processUserQueue } from './modules/messageProcessor.js';
import { 
  handleButtonInteraction, 
  handleSelectMenuInteraction, 
  handleModalSubmit 
} from './modules/settingsHandler.js';
import { handleSearchCommand } from './modules/searchCommand.js';
import { commands } from './commands.js';
import { 
  initializeScheduledTasks,
  handleCommandInteraction as handleNewCommands,
  handleSelectMenuInteraction as handleNewSelectMenus,
  handleModalSubmission as handleNewModals,
  handleButtonInteraction as handleNewButtons,
  processMessageRoulette
} from './commands/index.js';

// ============================================================================
// CONFIGURATION CONSTANTS
// ============================================================================

/** Time intervals in milliseconds */
const TIME_INTERVALS = Object.freeze({
  HOUR: 3600000,
  DAY: 86400000,
  CLEANUP_CHECK: 3600000,
  ACTIVITY_ROTATION: 86400000
});

/** Message types to ignore (system messages) */
const IGNORED_MESSAGE_TYPES = Object.freeze(new Set([
  1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 15, 18, 20, 21, 22, 23, 24, 25,
  26, 27, 28, 29, 30, 31, 36, 37, 38, 39, 46
]));

/** Maximum queue size per user */
const MAX_USER_QUEUE_SIZE = 5;

/** Express server configuration */
const EXPRESS_CONFIG = Object.freeze({
  PORT: process.env.PORT || 3000,
  HEALTH_CHECK_PATH: '/health',
  STATUS_PATH: '/'
});

// ============================================================================
// INITIALIZATION
// ============================================================================

// Initialize bot manager and database
initialize().catch(error => {
  console.error('❌ Critical initialization error:', error);
  process.exit(1);
});

// ============================================================================
// EXPRESS SERVER FOR UPTIME MONITORING
// ============================================================================

const app = express();

/**
 * Status endpoint - provides bot information
 */
app.get(EXPRESS_CONFIG.STATUS_PATH, (req, res) => {
  res.json({
    status: 'online',
    bot: client.user?.tag || 'Starting...',
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

/**
 * Health check endpoint - for monitoring services
 */
app.get(EXPRESS_CONFIG.HEALTH_CHECK_PATH, (req, res) => {
  const isHealthy = client.isReady() && client.ws.status === 0;
  
  res.status(isHealthy ? 200 : 503).json({
    status: isHealthy ? 'healthy' : 'degraded',
    ready: client.isReady(),
    wsStatus: client.ws.status,
    timestamp: new Date().toISOString()
  });
});

app.listen(EXPRESS_CONFIG.PORT, () => {
  console.log(`✅ Express server running on port ${EXPRESS_CONFIG.PORT}`);
});

// ============================================================================
// ACTIVITY ROTATION
// ============================================================================

/** Activity list with types */
const activities = config.activities.map(activity => ({
  name: activity.name,
  type: ActivityType[activity.type]
}));

let activityIndex = 0;

/**
 * Set bot presence with current activity
 */
function updateActivity() {
  if (!client.user) return;

  try {
    client.user.setPresence({
      activities: [activities[activityIndex]],
      status: 'idle'
    });
    
    console.log(`🔄 Activity changed to: ${activities[activityIndex].name}`);
  } catch (error) {
    console.error('❌ Error updating activity:', error.message);
  }
}

/**
 * Rotate to next activity
 */
function rotateActivity() {
  activityIndex = (activityIndex + 1) % activities.length;
  updateActivity();
}

// ============================================================================
// TEMP FILE CLEANUP
// ============================================================================

/**
 * Clean up old temporary files
 * Removes files older than 1 hour
 */
async function cleanupTempFiles() {
  try {
    const files = await fs.readdir(TEMP_DIR);
    const now = Date.now();
    let cleaned = 0;
    
    await Promise.all(
      files.map(async (file) => {
        const filePath = path.join(TEMP_DIR, file);
        
        try {
          const stats = await fs.stat(filePath);
          
          if (now - stats.mtimeMs > TIME_INTERVALS.HOUR) {
            await fs.unlink(filePath);
            cleaned++;
          }
        } catch (err) {
          // File might have been deleted already, ignore
        }
      })
    );
    
    if (cleaned > 0) {
      console.log(`🧹 Cleaned ${cleaned} old temp file(s)`);
    }
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.error('❌ Cleanup error:', error.message);
    }
  }
}

/**
 * Perform startup cleanup of temp files
 */
async function startupCleanup() {
  try {
    const files = await fs.readdir(TEMP_DIR);
    const now = Date.now();
    let cleaned = 0;
    
    await Promise.all(
      files.map(async (file) => {
        const filePath = path.join(TEMP_DIR, file);
        
        try {
          const stats = await fs.stat(filePath);
          
          if (now - stats.mtimeMs > TIME_INTERVALS.HOUR) {
            await fs.unlink(filePath);
            cleaned++;
          }
        } catch (err) {
          // Ignore errors
        }
      })
    );
    
    if (cleaned > 0) {
      console.log(`🧹 Startup: Cleaned ${cleaned} old temp file(s)`);
    }
  } catch (error) {
    // Ignore errors during startup cleanup
  }
}

// Schedule periodic cleanup
setInterval(cleanupTempFiles, TIME_INTERVALS.CLEANUP_CHECK);

// Perform startup cleanup
startupCleanup();

// ============================================================================
// BOT EVENT HANDLERS
// ============================================================================

/**
 * Client ready event - fires when bot successfully connects
 */
client.once('clientReady', async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);

  // Register slash commands
  const rest = new REST().setToken(token);
  
  try {
    console.log('🔄 Started refreshing application (/) commands...');
    
    await rest.put(
      Routes.applicationCommands(client.user.id), 
      { body: commands }
    );
    
    console.log('✅ Successfully reloaded application (/) commands');
  } catch (error) {
    console.error('❌ Error refreshing commands:', error);
  }

  // Set initial activity
  updateActivity();

  // Schedule activity rotation
  setInterval(rotateActivity, TIME_INTERVALS.ACTIVITY_ROTATION);

  // Initialize scheduled tasks (birthdays, reminders, etc.)
  try {
    initializeScheduledTasks(client);
    console.log('✅ Scheduled tasks initialized');
  } catch (error) {
    console.error('❌ Error initializing scheduled tasks:', error);
  }
});

/**
 * Guild create event - fires when bot joins a new server
 */
client.on('guildCreate', async (guild) => {
  try {
    console.log(`🎉 Joined new guild: ${guild.name} (${guild.id})`);

    // Find suitable channel to send welcome message
    const channel = guild.channels.cache.find(
      channel => 
        channel.type === ChannelType.GuildText &&
        channel.permissionsFor(guild.members.me).has(PermissionsBitField.Flags.SendMessages)
    );
    
    if (channel) {
      await channel.send(`🎉 Thanks for adding me to **${guild.name}**! Use \`/settings\` to configure me.`);
    }
  } catch (error) {
    console.error('❌ Error sending welcome message:', error.message);
  }
});

/**
 * Message create event - main message processing handler
 */
client.on('messageCreate', async (message) => {
  try {
    // Early return checks for performance
    if (message.author.bot) return;
    if (message.content.startsWith('!')) return;
    if (IGNORED_MESSAGE_TYPES.has(message.type)) {
      console.log(`🔕 Ignored system message type: ${message.type}`);
      return;
    }

    const isDM = message.channel.type === ChannelType.DM;
    const guildId = message.guild?.id;
    const channelId = message.channelId;
    const userId = message.author.id;

    // Guild-specific checks
    if (guildId) {
      initializeBlacklistForGuild(guildId);
      
      // Check blacklist
      if (state.blacklistedUsers[guildId]?.includes(userId)) {
        return;
      }

      // Check allowed channels
      const allowedChannels = state.serverSettings[guildId]?.allowedChannels;
      if (allowedChannels && allowedChannels.length > 0 && !allowedChannels.includes(channelId)) {
        return;
      }
    }

    // Determine if bot should respond
    const userSettings = state.userSettings[userId] || {};
    const serverSettings = guildId ? (state.serverSettings[guildId] || {}) : {};
    const effectiveSettings = serverSettings.overrideUserSettings ? serverSettings : userSettings;
    const continuousReply = effectiveSettings.continuousReply ?? true;
    const channelContinuousReply = state.continuousReplyChannels?.[channelId] || false;

    const shouldRespond = (
      (isDM && config.workInDMs && (continuousReply || message.mentions.users.has(client.user.id))) ||
      (guildId && message.mentions.users.has(client.user.id)) ||
      (guildId && !message.mentions.users.has(client.user.id) && (channelContinuousReply || continuousReply)) ||
      state.alwaysRespondChannels[channelId] ||
      state.activeUsersInChannels[channelId]?.[userId]
    );

    if (!shouldRespond) {
      // Check for roulette even if not responding normally
      processMessageRoulette(message);
      return;
    }

    // Initialize user queue if needed
    if (!state.requestQueues.has(userId)) {
      state.requestQueues.set(userId, { queue: [], isProcessing: false });
    }

    const userQueueData = state.requestQueues.get(userId);

    // Check queue limit
    if (userQueueData.queue.length >= MAX_USER_QUEUE_SIZE) {
      const embed = new EmbedBuilder()
        .setColor(0xFFAA00)
        .setTitle('⏳ Queue Full')
        .setDescription(`You have ${MAX_USER_QUEUE_SIZE} requests pending. Please wait for them to finish.`);
      
      await message.reply({
        embeds: [embed],
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    // Add message to queue
    userQueueData.queue.push(message);

    // Start processing if not already running
    if (!userQueueData.isProcessing) {
      processUserQueue(userId);
    }

    // Process roulette in background
    processMessageRoulette(message);

  } catch (error) {
    console.error('❌ Error processing message:', error);
  }
});

/**
 * Interaction create event - handles all interaction types
 */
client.on('interactionCreate', async (interaction) => {
  try {
    // Route to appropriate handler based on interaction type
    if (interaction.isChatInputCommand()) {
      await handleCommandInteraction(interaction);
    } 
    else if (interaction.isButton()) {
      // Try new command buttons first
      await handleNewButtons(interaction);
      
      // Fallback to settings buttons if not handled
      if (!interaction.replied && !interaction.deferred) {
        await handleButtonInteraction(interaction);
      }
    } 
    else if (interaction.isModalSubmit()) {
      // Try command modals first
      await handleNewModals(interaction);
      
      // Fallback to settings modals
      if (!interaction.replied && !interaction.deferred) {
        await handleModalSubmit(interaction);
      }
    } 
    else if (interaction.isStringSelectMenu() || interaction.isChannelSelectMenu()) {
      // Try command select menus first
      await handleNewSelectMenus(interaction);
      
      // Fallback to settings select menus
      if (!interaction.replied && !interaction.deferred) {
        await handleSelectMenuInteraction(interaction);
      }
    }
  } catch (error) {
    console.error('❌ Critical interaction error:', error);
    
    // Safety net - attempt to inform user
    try {
      if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
        await interaction.reply({
          content: '❌ An unexpected error occurred while processing this request.',
          flags: MessageFlags.Ephemeral
        });
      }
    } catch (replyError) {
      // Ignore if reply fails (e.g., unknown interaction)
    }
  }
});

/**
 * Error event - handles WebSocket and general errors
 */
client.on('error', (error) => {
  console.error('❌ Discord client error:', error);
});

/**
 * Warning event - logs Discord.js warnings
 */
client.on('warn', (warning) => {
  console.warn('⚠️ Discord client warning:', warning);
});

/**
 * Disconnect event - logs when bot disconnects
 */
client.on('disconnect', () => {
  console.warn('⚠️ Bot disconnected from Discord');
});

/**
 * Reconnecting event - logs reconnection attempts
 */
client.on('reconnecting', () => {
  console.log('🔄 Bot attempting to reconnect...');
});

// ============================================================================
// COMMAND INTERACTION HANDLER
// ============================================================================

/**
 * Route slash commands to appropriate handlers
 * @param {ChatInputCommandInteraction} interaction - Command interaction
 */
async function handleCommandInteraction(interaction) {
  if (!interaction.isChatInputCommand()) return;

  const commandHandlers = {
    settings: async (interaction) => {
      const { showMainSettings } = await import('./modules/settingsHandler.js');
      await showMainSettings(interaction, false);
    },
    search: handleSearchCommand,
    birthday: handleNewCommands,
    reminder: handleNewCommands,
    quote: handleNewCommands,
    roulette: handleNewCommands,
    anniversary: handleNewCommands,
    digest: handleNewCommands,
    starter: handleNewCommands,
    compliment: handleNewCommands,
    game: handleNewCommands,
    timezone: handleNewCommands,
    summary: handleNewCommands,
    realive: handleNewCommands
  };

  const handler = commandHandlers[interaction.commandName];
  
  if (handler) {
    try {
      await handler(interaction);
    } catch (error) {
      console.error(`❌ Error in command ${interaction.commandName}:`, error);
      
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({
          content: '❌ Command failed to execute.',
          flags: MessageFlags.Ephemeral
        }).catch(() => {});
      }
    }
  } else {
    console.warn(`⚠️ Unknown command: ${interaction.commandName}`);
  }
}

// ============================================================================
// GRACEFUL SHUTDOWN
// ============================================================================

/**
 * Handle graceful shutdown
 * @param {string} signal - Signal that triggered shutdown
 */
async function gracefulShutdown(signal) {
  console.log(`\n🛑 Received ${signal}, performing graceful shutdown...`);
  
  try {
    // Save final state
    console.log('💾 Saving final state...');
    await saveStateToFile();
    console.log('✅ State saved successfully');
    
    // Destroy Discord client
    console.log('🔌 Closing Discord connection...');
    client.destroy();
    console.log('✅ Discord connection closed');
    
    console.log('✅ Graceful shutdown completed');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error during graceful shutdown:', error);
    process.exit(1);
  }
}

// Register shutdown handlers
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
  gracefulShutdown('uncaughtException');
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
  gracefulShutdown('unhandledRejection');
});

// ============================================================================
// BOT LOGIN
// ============================================================================

client.login(token).catch(error => {
  console.error('❌ Failed to login:', error);
  process.exit(1);
});
