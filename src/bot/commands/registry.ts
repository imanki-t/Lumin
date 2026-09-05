import { Client, REST, Routes, Collection } from 'discord.js';
import { Command } from './types.js';
import { env } from '@/config/env.js';
import { Logger } from '@/core/logger/index.js';

import { settingsCommand } from './settings.js';
import { searchCommand } from './search.js';
import { summaryCommand } from './summary.js';
import { reminderCommand } from './reminder.js';
import { birthdayCommand } from './birthday.js';
import { quoteCommand } from './quote.js';
import { digestCommand } from './digest.js';
import { complimentCommand } from './compliment.js';
import { reactionCommand } from './reaction.js';
import { detailsCommand } from './details.js';
import { starterCommand } from './starter.js';
import { timezoneCommand } from './timezone.js';
import { gameCommand } from './game.js';
import { scheduleCommand } from './schedule.js';

const logger = Logger.get('CommandRegistry');

export class CommandRegistry {
  private static instance: CommandRegistry;
  public commands = new Collection<string, Command>();

  private constructor() {
    this.registerLocalCommands();
  }

  public static get(): CommandRegistry {
    if (!CommandRegistry.instance) {
      CommandRegistry.instance = new CommandRegistry();
    }
    return CommandRegistry.instance;
  }

  private registerLocalCommands(): void {
    const list: Command[] = [
      settingsCommand,
      searchCommand,
      summaryCommand,
      reminderCommand,
      birthdayCommand,
      quoteCommand,
      digestCommand,
      complimentCommand,
      reactionCommand,
      detailsCommand,
      starterCommand,
      timezoneCommand,
      gameCommand,
      scheduleCommand
    ];

    for (const cmd of list) {
      this.commands.set(cmd.data.name, cmd);
    }
    logger.info(`Loaded ${this.commands.size} slash commands locally.`);
  }

  /**
   * Automatically registers all slash commands with Discord REST API
   */
  public async deployGlobalCommands(client: Client): Promise<void> {
    if (!client.user) {
      throw new Error('Client user not available during command registration');
    }

    const rest = new REST({ version: '10' }).setToken(env.DISCORD_TOKEN);
    const body = this.commands.map((cmd) => cmd.data.toJSON());

    try {
      logger.info(`Deploying ${body.length} application (/) commands globally...`);
      await rest.put(Routes.applicationCommands(client.user.id), { body });
      logger.info(`Successfully synchronized ${body.length} global slash commands with Discord!`);
    } catch (err: any) {
      logger.error('Failed to synchronize global slash commands with Discord', err);
    }
  }
}
