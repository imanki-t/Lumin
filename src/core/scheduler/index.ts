import cron, { ScheduledTask } from 'node-cron';
import { Client } from 'discord.js';
import { ReminderWorker } from './reminder-worker.js';
import { BirthdayWorker } from './birthday-worker.js';
import { QuoteWorker } from './quote-worker.js';
import { RevivalWorker } from './revival-worker.js';
import { Logger } from '@/core/logger/index.js';

const logger = Logger.get('SchedulerService');

export class SchedulerService {
  private static instance: SchedulerService;
  private tasks: ScheduledTask[] = [];

  private constructor() {}

  public static get(): SchedulerService {
    if (!SchedulerService.instance) {
      SchedulerService.instance = new SchedulerService();
    }
    return SchedulerService.instance;
  }

  /**
   * Initializes all background cron tasks
   */
  public start(client: Client): void {
    logger.info('Starting background scheduler workers...');

    // 1. Due Reminders — checks every minute
    const reminderTask = cron.schedule('* * * * *', async () => {
      try {
        await ReminderWorker.processDueReminders(client);
      } catch (err: any) {
        logger.error('Error during reminder check cycle', err);
      }
    });
    this.tasks.push(reminderTask);

    // 2. Birthday Announcements — checks daily at 00:05 UTC
    const birthdayTask = cron.schedule('5 0 * * *', async () => {
      try {
        await BirthdayWorker.processBirthdays(client);
      } catch (err: any) {
        logger.error('Error during birthday check cycle', err);
      }
    });
    this.tasks.push(birthdayTask);

    // 3. Daily Quotes — dispatches daily at 08:00 UTC
    const quoteTask = cron.schedule('0 8 * * *', async () => {
      try {
        await QuoteWorker.processScheduledQuotes(client);
      } catch (err: any) {
        logger.error('Error during quote delivery cycle', err);
      }
    });
    this.tasks.push(quoteTask);

    // 4. Inactive Channel Revival — checks every 30 minutes
    const revivalTask = cron.schedule('*/30 * * * *', async () => {
      try {
        await RevivalWorker.processGuildRevival(client);
      } catch (err: any) {
        logger.error('Error during guild revival cycle', err);
      }
    });
    this.tasks.push(revivalTask);

    logger.info(`SchedulerService initialized with ${this.tasks.length} active cron tasks.`);
  }

  /**
   * Gracefully stops all active cron schedules
   */
  public stop(): void {
    logger.info(`Stopping ${this.tasks.length} scheduled tasks...`);
    for (const task of this.tasks) {
      task.stop();
    }
    this.tasks = [];
  }
}
