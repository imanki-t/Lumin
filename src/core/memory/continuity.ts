import { redis } from '@/core/cache/redis.js';
import { MEMORY_CONFIG } from '@/config/constants.js';
import { ConversationTurn } from '@/core/ai/router.js';
import { Logger } from '@/core/logger/index.js';

const logger = Logger.get('MemoryContinuity');

export interface StoredTurn {
  role: 'user' | 'model';
  text: string;
  senderId?: string;
  senderName?: string;
  timestamp: number;
}

export class MemoryContinuityPipeline {
  private static instance: MemoryContinuityPipeline;

  private constructor() {}

  public static get(): MemoryContinuityPipeline {
    if (!MemoryContinuityPipeline.instance) {
      MemoryContinuityPipeline.instance = new MemoryContinuityPipeline();
    }
    return MemoryContinuityPipeline.instance;
  }

  private getKey(contextId: string): string {
    return `turns:${contextId}`;
  }

  /**
   * Retrieves the fast active sliding window of recent conversation turns (sub-50ms)
   */
  public async getSlidingWindow(contextId: string): Promise<ConversationTurn[]> {
    const key = this.getKey(contextId);
    try {
      const rawList = await redis.lrange(key, 0, MEMORY_CONFIG.SLIDING_WINDOW_TURNS - 1);
      if (!rawList || rawList.length === 0) return [];

      // Parse and reverse since LPUSH pushes newest to index 0
      const turns: StoredTurn[] = rawList
        .map((str) => {
          try {
            return JSON.parse(str) as StoredTurn;
          } catch {
            return null;
          }
        })
        .filter((t): t is StoredTurn => t !== null)
        .reverse();

      return turns.map((t) => ({
        role: t.role,
        parts: [{ text: t.text }]
      }));
    } catch (err: any) {
      logger.warn(`Failed retrieving sliding window for ${contextId}`, err);
      return [];
    }
  }

  /**
   * Appends new turns to the fast active sliding window and sets TTL
   */
  public async appendTurn(
    contextId: string,
    role: 'user' | 'model',
    text: string,
    metadata?: { senderId?: string; senderName?: string }
  ): Promise<number> {
    const key = this.getKey(contextId);
    const stored: StoredTurn = {
      role,
      text,
      senderId: metadata?.senderId,
      senderName: metadata?.senderName,
      timestamp: Date.now()
    };

    try {
      const len = await redis.lpush(key, JSON.stringify(stored));
      // Trim to avoid unbounded growth
      await redis.ltrim(key, 0, MEMORY_CONFIG.SLIDING_WINDOW_TURNS * 2);
      await redis.expire(key, MEMORY_CONFIG.WINDOW_TTL_SECONDS);
      return len;
    } catch (err: any) {
      logger.warn(`Failed appending turn to ${contextId}`, err);
      return 0;
    }
  }

  /**
   * Clears the sliding window for a conversation context
   */
  public async clearWindow(contextId: string): Promise<void> {
    const key = this.getKey(contextId);
    await redis.del(key);
  }

  public async clearSlidingWindow(contextId: string): Promise<void> {
    return this.clearWindow(contextId);
  }

  public async getRollingSummary(contextId: string): Promise<string | null> {
    const summaryKey = `summary:${contextId}`;
    try {
      const cached = await redis.get(summaryKey);
      if (cached) return cached;
    } catch {
      // Fallback
    }
    return null;
  }
}

export const continuityPipeline = MemoryContinuityPipeline.get();
