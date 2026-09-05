import { Client, TextChannel } from 'discord.js';
import { reminderRepo } from '@/core/database/repositories/index.js';
import { LuminEmbedBuilder } from '@/bot/embeds/builder.js';
import { Logger } from '@/core/logger/index.js';

const logger = Logger.get('ReminderWorker');

export class ReminderWorker {
  public static async processDueReminders(client: Client): Promise<number> {
    const dueList = await reminderRepo.findDueReminders();
    if (dueList.length === 0) return 0;

    logger.info(`Processing ${dueList.length} due reminders...`);
    let processed = 0;

    for (const reminder of dueList) {
      try {
        const embed = LuminEmbedBuilder.info(
          `⏰ **Reminder Alert:**\n${reminder.message}`,
          'Your Scheduled Reminder'
        );

        let sent = false;
        // Attempt to send in channel first if channelId is specified
        if (reminder.channelId) {
          try {
            const channel = await client.channels.fetch(reminder.channelId);
            if (channel && channel.isTextBased()) {
              await (channel as TextChannel).send({
                content: `<@${reminder.userId}>`,
                embeds: [embed]
              });
              sent = true;
            }
          } catch (err: any) {
            logger.warn(`Could not send reminder in channel ${reminder.channelId}, falling back to DM`, err);
          }
        }

        // Fallback to DM if channel failed or was not specified
        if (!sent) {
          try {
            const user = await client.users.fetch(reminder.userId);
            if (user) {
              await user.send({ embeds: [embed] });
              sent = true;
            }
          } catch (err: any) {
            logger.error(`Failed sending reminder DM to user ${reminder.userId}`, err);
          }
        }

        await reminderRepo.markCompleted(reminder.id);
        processed += 1;
      } catch (err: any) {
        logger.error(`Error executing reminder ${reminder.id}`, err);
      }
    }

    return processed;
  }
}
