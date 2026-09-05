import { BOT_LIMITS } from '@/config/constants.js';
import { Logger } from '@/core/logger/index.js';

const logger = Logger.get('MessageQueue');

export interface QueueItem {
  id: string;
  userId: string;
  task: () => Promise<void>;
  enqueuedAt: number;
}

export class MessageQueueManager {
  private static instance: MessageQueueManager;
  private userQueues = new Map<string, { queue: QueueItem[]; isProcessing: boolean }>();

  private constructor() {}

  public static get(): MessageQueueManager {
    if (!MessageQueueManager.instance) {
      MessageQueueManager.instance = new MessageQueueManager();
    }
    return MessageQueueManager.instance;
  }

  /**
   * Enqueues a task for a user. Rejects if user queue exceeds limit.
   */
  public enqueue(userId: string, task: () => Promise<void>): boolean {
    let state = this.userQueues.get(userId);
    if (!state) {
      state = { queue: [], isProcessing: false };
      this.userQueues.set(userId, state);
    }

    if (state.queue.length >= BOT_LIMITS.MAX_USER_QUEUE_DEPTH) {
      logger.warn(`User ${userId} queue full (${state.queue.length} items). Rejecting task.`);
      return false;
    }

    const item: QueueItem = {
      id: `task_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      userId,
      task,
      enqueuedAt: Date.now()
    };

    state.queue.push(item);

    if (!state.isProcessing) {
      this.processQueue(userId);
    }

    return true;
  }

  private async processQueue(userId: string): Promise<void> {
    const state = this.userQueues.get(userId);
    if (!state || state.queue.length === 0) return;

    state.isProcessing = true;

    while (state.queue.length > 0) {
      const item = state.queue.shift()!;
      try {
        await item.task();
      } catch (err: any) {
        logger.error(`Error processing task for user ${userId}`, err);
      }
    }

    state.isProcessing = false;
    if (state.queue.length === 0) {
      this.userQueues.delete(userId);
    }
  }

  public getQueueDepth(userId: string): number {
    return this.userQueues.get(userId)?.queue.length || 0;
  }

  public getActiveQueuesCount(): number {
    return this.userQueues.size;
  }
}

export const messageQueue = MessageQueueManager.get();
export { MessageQueueManager as UserMessageQueue };
