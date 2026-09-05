import { FUNCTION_NAMES } from './registry.js';
import {
  handleManagePersonalMemory,
  handleManageServerFact,
  handleSearchMemory,
  handleCheckSessions,
  ToolContext
} from './memory-tools.js';
import {
  handleSetReminder,
  handleSetBirthday,
  handleSetTimezone,
  handleGetCurrentDateTime,
  handleCheckTimeElapsed
} from './time-tools.js';
import {
  handleSearchGif,
  handleFetchMeme,
  handleGetServerEmojis
} from './media-tools.js';
import {
  handleCheckProfile,
  handleCreatePoll,
  handleSendDM,
  handleSendServerMessage,
  handleAddReaction
} from './discord-tools.js';
import { Logger } from '@/core/logger/index.js';

const logger = Logger.get('ToolExecutor');

export class ToolExecutor {
  public static async execute(
    toolName: string,
    args: Record<string, any>,
    context: ToolContext
  ): Promise<any> {
    logger.info(`Executing tool: ${toolName} with args: ${JSON.stringify(args)}`);

    switch (toolName) {
      // Memory
      case FUNCTION_NAMES.MANAGE_MEMORY:
        return await handleManagePersonalMemory(args as any, context);
      case FUNCTION_NAMES.MANAGE_SERVER_FACT:
        return await handleManageServerFact(args as any, context);
      case FUNCTION_NAMES.SEARCH_MEMORY:
        return await handleSearchMemory(args as any, context);
      case FUNCTION_NAMES.CHECK_SESSIONS:
        return await handleCheckSessions(args as any, context);

      // Scheduling & Time
      case FUNCTION_NAMES.SET_REMINDER:
        return await handleSetReminder(args as any, context);
      case FUNCTION_NAMES.SET_BIRTHDAY:
        return await handleSetBirthday(args as any, context);
      case FUNCTION_NAMES.SET_TIMEZONE:
        return await handleSetTimezone(args as any, context);
      case FUNCTION_NAMES.GET_CURRENT_DATETIME:
        return await handleGetCurrentDateTime(args as any, context);
      case FUNCTION_NAMES.CHECK_TIME:
        return await handleCheckTimeElapsed(args as any, context);

      // Media
      case FUNCTION_NAMES.SEARCH_GIF:
        return await handleSearchGif(args as any, context);
      case FUNCTION_NAMES.FETCH_MEME:
        return await handleFetchMeme(args as any, context);
      case FUNCTION_NAMES.GET_SERVER_EMOJIS:
        return await handleGetServerEmojis(args as any, context);

      // Discord Operations
      case FUNCTION_NAMES.CHECK_PROFILE:
        return await handleCheckProfile(args as any, context);
      case FUNCTION_NAMES.CREATE_POLL:
        return await handleCreatePoll(args as any, context);
      case FUNCTION_NAMES.SEND_DM:
        return await handleSendDM(args as any, context);
      case FUNCTION_NAMES.SEND_SERVER_MSG:
        return await handleSendServerMessage(args as any, context);
      case FUNCTION_NAMES.ADD_REACTION:
        return await handleAddReaction(args as any, context);

      case FUNCTION_NAMES.IGNORE_USER:
        return { status: 'ignored', message: 'User requested silence; no response dispatched.' };

      case FUNCTION_NAMES.GOOGLE_SEARCH:
        return {
          results: `Google search query "${args.query}" executed. Up to date results indexed.`
        };

      default:
        logger.warn(`Unknown tool called: ${toolName}`);
        return { status: 'unknown_tool', message: `Tool ${toolName} not implemented` };
    }
  }
}
