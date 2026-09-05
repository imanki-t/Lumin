import { userRepo, reminderRepo, birthdayRepo } from '@/core/database/repositories/index.js';
import { ToolContext } from './memory-tools.js';
import { Logger } from '@/core/logger/index.js';

const logger = Logger.get('TimeTools');

export async function handleSetReminder(
  args: { message: string; time_relative: string },
  context: ToolContext
): Promise<{ status: string; reminderId?: string; remindAt?: string; message: string }> {
  try {
    const parseRelativeTime = (str: string): number => {
      const s = str.toLowerCase();
      let totalMs = 0;

      const minMatch = s.match(/(\d+)\s*(?:min|minute)/);
      if (minMatch && minMatch[1]) totalMs += parseInt(minMatch[1]) * 60 * 1000;

      const hrMatch = s.match(/(\d+)\s*(?:hour|hr)/);
      if (hrMatch && hrMatch[1]) totalMs += parseInt(hrMatch[1]) * 60 * 60 * 1000;

      const dayMatch = s.match(/(\d+)\s*(?:day)/);
      if (dayMatch && dayMatch[1]) totalMs += parseInt(dayMatch[1]) * 24 * 60 * 60 * 1000;

      const secMatch = s.match(/(\d+)\s*(?:sec|second)/);
      if (secMatch && secMatch[1]) totalMs += parseInt(secMatch[1]) * 1000;

      return totalMs > 0 ? totalMs : 10 * 60 * 1000; // Default 10 min if unparsed
    };

    const delayMs = parseRelativeTime(args.time_relative);
    const remindAt = new Date(Date.now() + delayMs);

    const entity = await reminderRepo.createReminder({
      userId: context.userId,
      channelId: context.channelId,
      guildId: context.guildId,
      message: args.message,
      remindAt
    });

    return {
      status: 'success',
      reminderId: entity.id,
      remindAt: remindAt.toISOString(),
      message: `Reminder set for ${remindAt.toUTCString()}: "${args.message}"`
    };
  } catch (err: any) {
    logger.error('Error in handleSetReminder', err);
    return { status: 'error', message: 'Failed to set reminder' };
  }
}

export async function handleSetBirthday(
  args: { day: number; month: number },
  context: ToolContext
): Promise<{ status: string; message: string }> {
  try {
    const userSettings = await userRepo.getSettings(context.userId);
    await birthdayRepo.setBirthday({
      userId: context.userId,
      guildId: context.guildId,
      day: args.day,
      month: args.month,
      timezone: userSettings.timezone || 'UTC'
    });

    return {
      status: 'success',
      message: `Saved birthday for ${args.month}/${args.day} in timezone ${userSettings.timezone || 'UTC'}`
    };
  } catch (err: any) {
    logger.error('Error in handleSetBirthday', err);
    return { status: 'error', message: 'Failed to store birthday' };
  }
}

export async function handleSetTimezone(
  args: { timezone: string },
  context: ToolContext
): Promise<{ status: string; message: string }> {
  try {
    // Validate timezone string
    new Intl.DateTimeFormat('en-US', { timeZone: args.timezone });
    await userRepo.updateSettings(context.userId, { timezone: args.timezone });
    return { status: 'success', message: `Timezone updated to ${args.timezone}` };
  } catch {
    return { status: 'error', message: `Invalid IANA timezone format: "${args.timezone}"` };
  }
}

export async function handleGetCurrentDateTime(
  _args: Record<string, never>,
  context: ToolContext
): Promise<{ iso: string; formatted: string; timezone: string }> {
  const userSettings = await userRepo.getSettings(context.userId);
  const tz = userSettings.timezone || 'UTC';
  const now = new Date();

  try {
    const formatted = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      dateStyle: 'full',
      timeStyle: 'long'
    }).format(now);

    return {
      iso: now.toISOString(),
      formatted,
      timezone: tz
    };
  } catch {
    return {
      iso: now.toISOString(),
      formatted: now.toUTCString(),
      timezone: 'UTC'
    };
  }
}

export async function handleCheckTimeElapsed(
  args: { reason?: string },
  _context: ToolContext
): Promise<{ elapsedFormatted: string }> {
  return {
    elapsedFormatted: 'Last message received recently'
  };
}
