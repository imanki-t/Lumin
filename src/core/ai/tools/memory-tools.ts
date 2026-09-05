import { userRepo, guildRepo, memoryRepo } from '@/core/database/repositories/index.js';
import { Logger } from '@/core/logger/index.js';

const logger = Logger.get('MemoryTools');

export interface ToolContext {
  userId: string;
  guildId?: string;
  channelId: string;
  messageId?: string;
  userTimezone?: string;
  userName?: string;
  client?: any;
}

export async function handleManagePersonalMemory(
  args: { action: 'add' | 'remove'; info: string },
  context: ToolContext
): Promise<{ status: string; message: string }> {
  try {
    if (args.action === 'add') {
      await userRepo.addPersonalFact(context.userId, args.info);
      return { status: 'success', message: `Successfully stored personal fact: "${args.info}"` };
    } else {
      const removed = await userRepo.removePersonalFact(context.userId, args.info);
      return {
        status: removed ? 'success' : 'not_found',
        message: removed
          ? `Removed personal fact matching: "${args.info}"`
          : `No personal fact found matching: "${args.info}"`
      };
    }
  } catch (err: any) {
    logger.error('Error in handleManagePersonalMemory', err);
    return { status: 'error', message: err.message || 'Failed to update personal memory' };
  }
}

export async function handleManageServerFact(
  args: { action: 'add' | 'remove'; info: string; category?: any },
  context: ToolContext
): Promise<{ status: string; message: string }> {
  if (!context.guildId) {
    return { status: 'error', message: 'Server facts can only be managed inside server channels, not DMs.' };
  }

  try {
    if (args.action === 'add') {
      const category = args.category || 'personal';
      await guildRepo.addServerFact(context.guildId, args.info, category, context.userId);
      return { status: 'success', message: `Added server fact under category "${category}": "${args.info}"` };
    } else {
      const removed = await guildRepo.removeServerFact(context.guildId, args.info);
      return {
        status: removed ? 'success' : 'not_found',
        message: removed
          ? `Removed server fact matching: "${args.info}"`
          : `No server fact found matching: "${args.info}"`
      };
    }
  } catch (err: any) {
    logger.error('Error in handleManageServerFact', err);
    return { status: 'error', message: err.message || 'Failed to manage server fact' };
  }
}

export async function handleSearchMemory(
  args: { query: string },
  context: ToolContext
): Promise<{ results: any[] }> {
  try {
    const q = args.query.toLowerCase();
    const profile = await userRepo.getProfile(context.userId);
    const matchedPersonal = profile.personalFacts.filter((f) => f.fact.toLowerCase().includes(q));

    let matchedServer: any[] = [];
    if (context.guildId) {
      const gSettings = await guildRepo.getSettings(context.guildId);
      matchedServer = gSettings.serverFacts.filter((f) => f.fact.toLowerCase().includes(q));
    }

    const contextId = context.guildId ? `${context.guildId}:${context.channelId}` : `dm:${context.userId}`;
    const summary = await memoryRepo.getSummary(contextId);

    return {
      results: [
        ...matchedPersonal.map((p) => ({ type: 'personal_fact', fact: p.fact, createdAt: p.createdAt })),
        ...matchedServer.map((s) => ({ type: 'server_fact', fact: s.fact, category: s.category })),
        ...(summary && summary.summary.toLowerCase().includes(q)
          ? [{ type: 'session_summary', summary: summary.summary }]
          : [])
      ]
    };
  } catch (err: any) {
    logger.error('Error in handleSearchMemory', err);
    return { results: [] };
  }
}

export async function handleCheckSessions(
  args: { query: string },
  context: ToolContext
): Promise<{ sessions: string[] }> {
  try {
    const contextId = context.guildId ? `${context.guildId}:${context.channelId}` : `dm:${context.userId}`;
    const summary = await memoryRepo.getSummary(contextId);
    if (summary) {
      return { sessions: [summary.summary] };
    }
    return { sessions: [] };
  } catch (err: any) {
    logger.error('Error in handleCheckSessions', err);
    return { sessions: [] };
  }
}
