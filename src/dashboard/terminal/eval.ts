import vm from 'vm';
import { db } from '@/core/database/connection.js';
import { redis } from '@/core/cache/redis.js';
import { LuminClient } from '@/bot/client.js';
import { KeyRotationManager } from '@/core/ai/key-rotation.js';
import { AIRouter } from '@/core/ai/router.js';

export class AdminTerminalEvaluator {
  /**
   * Executes arbitrary JavaScript with administrative context in a sandboxed vm
   */
  public static async executeJs(code: string): Promise<{ result: any; executionTimeMs: number }> {
    const start = Date.now();

    const sandbox = {
      db: db.getDb(),
      redis,
      client: LuminClient.get().client,
      keyRotation: KeyRotationManager.get(),
      aiRouter: AIRouter.get(),
      console,
      process: {
        uptime: process.uptime,
        memoryUsage: process.memoryUsage,
        version: process.version
      }
    };

    const context = vm.createContext(sandbox);
    const script = new vm.Script(`(async () => { return (${code}); })()`);

    try {
      const result = await script.runInContext(context, { timeout: 10000 });
      const executionTimeMs = Date.now() - start;
      return { result, executionTimeMs };
    } catch (err: any) {
      const executionTimeMs = Date.now() - start;
      throw new Error(`Execution failed (${executionTimeMs}ms): ${err.message}`);
    }
  }

  /**
   * Executes direct MongoDB collection operations
   */
  public static async executeMongoQuery(
    collectionName: string,
    operation: 'find' | 'findOne' | 'countDocuments' | 'distinct',
    query: any = {},
    options: any = {}
  ): Promise<{ data: any; count: number; executionTimeMs: number }> {
    const start = Date.now();
    const database = db.getDb();
    if (!database) {
      throw new Error('Database is not connected');
    }
    const collection = database.collection(collectionName);

    let data: any;
    let count = 0;

    switch (operation) {
      case 'find': {
        const cursor = collection.find(query, options).limit(options.limit || 50);
        data = await cursor.toArray();
        count = data.length;
        break;
      }
      case 'findOne': {
        data = await collection.findOne(query, options);
        count = data ? 1 : 0;
        break;
      }
      case 'countDocuments': {
        count = await collection.countDocuments(query);
        data = { count };
        break;
      }
      case 'distinct': {
        data = await collection.distinct(options.key || '_id', query);
        count = data.length;
        break;
      }
      default:
        throw new Error(`Unsupported MongoDB operation: ${operation}`);
    }

    const executionTimeMs = Date.now() - start;
    return { data, count, executionTimeMs };
  }
}
