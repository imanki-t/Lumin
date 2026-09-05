import { Redis } from 'ioredis';
import { env } from '@/config/env.js';
import { Logger } from '@/core/logger/index.js';

const logger = Logger.get('RedisCache');

export class RedisService {
  private static instance: RedisService;
  private client: Redis | null = null;
  private memoryFallback = new Map<string, { value: string; expiresAt?: number }>();
  private memoryLists = new Map<string, string[]>();
  private isConnected = false;

  private constructor() {
    this.init();
  }

  public static get(): RedisService {
    if (!RedisService.instance) {
      RedisService.instance = new RedisService();
    }
    return RedisService.instance;
  }

  private init(): void {
    try {
      this.client = new Redis(env.REDIS_URL, {
        password: env.REDIS_PASSWORD || undefined,
        keyPrefix: env.REDIS_KEY_PREFIX,
        retryStrategy: (times: number) => {
          const delay = Math.min(times * 100, 3000);
          logger.warn(`Redis disconnected. Reconnecting in ${delay}ms (attempt ${times})...`);
          return delay;
        },
        maxRetriesPerRequest: 3,
        enableReadyCheck: true,
        lazyConnect: true
      });

      this.client.on('connect', () => {
        this.isConnected = true;
        logger.info('Connected to Redis server');
      });

      this.client.on('error', (err: any) => {
        this.isConnected = false;
        logger.warn('Redis error occurred, falling back to fast in-memory store', err?.message);
      });
    } catch (err: any) {
      logger.error('Failed to initialize Redis client', err);
      this.isConnected = false;
    }
  }

  public async connect(): Promise<void> {
    if (this.client && !this.isConnected) {
      try {
        await this.client.connect();
      } catch (err) {
        logger.warn('Failed initial Redis connect, continuing with memory fallback', err);
      }
    }
  }

  public async get<T = string>(key: string): Promise<T | null> {
    if (this.isConnected && this.client) {
      try {
        const val = await this.client.get(key);
        if (!val) return null;
        try {
          return JSON.parse(val) as T;
        } catch {
          return val as unknown as T;
        }
      } catch (err) {
        logger.warn(`Redis GET failed for key: ${key}`, err);
      }
    }

    // Memory Fallback
    const cached = this.memoryFallback.get(key);
    if (!cached) return null;
    if (cached.expiresAt && Date.now() > cached.expiresAt) {
      this.memoryFallback.delete(key);
      return null;
    }
    try {
      return JSON.parse(cached.value) as T;
    } catch {
      return cached.value as unknown as T;
    }
  }

  public async set(key: string, value: any, ttlSeconds?: number): Promise<void> {
    const serialized = typeof value === 'string' ? value : JSON.stringify(value);

    if (this.isConnected && this.client) {
      try {
        if (ttlSeconds) {
          await this.client.set(key, serialized, 'EX', ttlSeconds);
        } else {
          await this.client.set(key, serialized);
        }
        return;
      } catch (err) {
        logger.warn(`Redis SET failed for key: ${key}`, err);
      }
    }

    // Memory Fallback
    this.memoryFallback.set(key, {
      value: serialized,
      expiresAt: ttlSeconds ? Date.now() + ttlSeconds * 1000 : undefined
    });
  }

  public async del(key: string): Promise<void> {
    if (this.isConnected && this.client) {
      try {
        await this.client.del(key);
      } catch (err) {
        logger.warn(`Redis DEL failed for key: ${key}`, err);
      }
    }
    this.memoryFallback.delete(key);
    this.memoryLists.delete(key);
  }

  public async lpush(key: string, ...values: string[]): Promise<number> {
    if (this.isConnected && this.client) {
      try {
        return await this.client.lpush(key, ...values);
      } catch (err) {
        logger.warn(`Redis LPUSH failed for key: ${key}`, err);
      }
    }
    // In-memory list fallback
    let list = this.memoryLists.get(key);
    if (!list) {
      list = [];
      this.memoryLists.set(key, list);
    }
    for (const val of values) {
      list.unshift(val);
    }
    return list.length;
  }

  public async lrange(key: string, start: number, stop: number): Promise<string[]> {
    if (this.isConnected && this.client) {
      try {
        return await this.client.lrange(key, start, stop);
      } catch (err) {
        logger.warn(`Redis LRANGE failed for key: ${key}`, err);
      }
    }
    // In-memory list fallback
    const list = this.memoryLists.get(key) || [];
    const end = stop < 0 ? list.length + stop + 1 : stop + 1;
    return list.slice(start, end);
  }

  public async ltrim(key: string, start: number, stop: number): Promise<'OK' | null> {
    if (this.isConnected && this.client) {
      try {
        return await this.client.ltrim(key, start, stop);
      } catch (err) {
        logger.warn(`Redis LTRIM failed for key: ${key}`, err);
      }
    }
    // In-memory list fallback
    const list = this.memoryLists.get(key);
    if (list) {
      const end = stop < 0 ? list.length + stop + 1 : stop + 1;
      this.memoryLists.set(key, list.slice(start, end));
    }
    return 'OK';
  }

  public async expire(key: string, seconds: number): Promise<number> {
    if (this.isConnected && this.client) {
      try {
        return await this.client.expire(key, seconds);
      } catch (err) {
        logger.warn(`Redis EXPIRE failed for key: ${key}`, err);
      }
    }
    return 1;
  }

  public isReady(): boolean {
    return this.isConnected;
  }

  public async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.quit().catch(() => {});
      this.isConnected = false;
    }
  }
}

export const redis = RedisService.get();

export function cryptoRandomId(length = 8): string {
  return Math.random().toString(36).substring(2, 2 + length);
}
