import {
  Client,
  GatewayIntentBits,
  Partials,
  Events,
  ActivityType
} from 'discord.js';
import { env } from '@/config/env.js';
import { CommandRegistry } from './commands/registry.js';
import { MessageCreateHandler } from './handlers/message-create.js';
import { InteractionCreateHandler } from './handlers/interaction-create.js';
import { GuildEventsHandler } from './handlers/guild-events.js';
import { SchedulerService } from '@/core/scheduler/index.js';
import { Logger } from '@/core/logger/index.js';

const logger = Logger.get('DiscordClient');

export class LuminClient {
  private static instance: LuminClient;
  public client: Client;

  private constructor() {
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.GuildMembers
      ],
      partials: [
        Partials.Channel,
        Partials.Message,
        Partials.Reaction,
        Partials.User
      ],
      allowedMentions: {
        parse: ['users', 'roles'],
        repliedUser: true
      }
    });

    this.registerEventListeners();
  }

  public static get(): LuminClient {
    if (!LuminClient.instance) {
      LuminClient.instance = new LuminClient();
    }
    return LuminClient.instance;
  }

  private registerEventListeners(): void {
    this.client.once(Events.ClientReady, async (readyClient) => {
      logger.info(`Lumin Discord Client is ONLINE as ${readyClient.user.tag} (${readyClient.user.id})`);

      // Set dynamic presence
      readyClient.user.setPresence({
        activities: [
          {
            name: 'conversations | /settings',
            type: ActivityType.Watching
          }
        ],
        status: 'online'
      });

      // Synchronize application slash commands globally
      try {
        await CommandRegistry.get().deployGlobalCommands(readyClient);
      } catch (err: any) {
        logger.error('Failed registering slash commands during startup', err);
      }

      // Start background cron schedulers
      SchedulerService.get().start(readyClient);
    });

    // Message creation
    this.client.on(Events.MessageCreate, async (message) => {
      try {
        await MessageCreateHandler.handle(message);
      } catch (err: any) {
        logger.error('Unhandled exception in MessageCreate handler', err);
      }
    });

    // Slash command and component interactions
    this.client.on(Events.InteractionCreate, async (interaction) => {
      try {
        await InteractionCreateHandler.handle(interaction);
      } catch (err: any) {
        logger.error('Unhandled exception in InteractionCreate handler', err);
      }
    });

    // Guild lifecycle events
    this.client.on(Events.GuildCreate, async (guild) => {
      try {
        await GuildEventsHandler.onGuildCreate(guild);
      } catch (err: any) {
        logger.error('Unhandled exception in GuildCreate handler', err);
      }
    });

    this.client.on(Events.GuildDelete, async (guild) => {
      try {
        await GuildEventsHandler.onGuildDelete(guild);
      } catch (err: any) {
        logger.error('Unhandled exception in GuildDelete handler', err);
      }
    });

    this.client.on(Events.Error, (err) => {
      logger.error('Discord gateway error event encountered', err);
    });

    this.client.on(Events.Warn, (info) => {
      logger.warn(`Discord gateway warning: ${info}`);
    });
  }

  /**
   * Connects the bot to Discord Gateway
   */
  public async start(): Promise<void> {
    logger.info('Authenticating and connecting to Discord Gateway...');
    await this.client.login(env.DISCORD_TOKEN);
  }

  /**
   * Graceful disconnection
   */
  public async stop(): Promise<void> {
    logger.info('Disconnecting Discord client...');
    SchedulerService.get().stop();
    await this.client.destroy();
    logger.info('Discord client disconnected gracefully.');
  }
}
