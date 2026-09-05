import { database } from '@/core/database/connection.js';
import { UsageAnalyticsEntity } from '@/core/database/schema.js';

export class UsageRepository {
  private memoryUsage = new Map<string, UsageAnalyticsEntity>();

  public async recordUsage(params: {
    promptTokens: number;
    candidateTokens: number;
    model: string;
    toolCallName?: string;
  }): Promise<void> {
    const today = new Date().toISOString().split('T')[0]!;
    const id = `usage_${today}`;

    const existing = await this.getTodayUsage(today);
    existing.totalMessages += 1;
    existing.totalTokensPrompt += params.promptTokens;
    existing.totalTokensCandidate += params.candidateTokens;
    existing.modelBreakdown[params.model] = (existing.modelBreakdown[params.model] || 0) + 1;

    if (params.toolCallName) {
      existing.toolCalls[params.toolCallName] = (existing.toolCalls[params.toolCallName] || 0) + 1;
    }

    const db = database.getDb();
    if (db) {
      await db.collection<UsageAnalyticsEntity>('usage_analytics').updateOne(
        { date: today },
        { $set: existing },
        { upsert: true }
      );
    }
    this.memoryUsage.set(today, existing);
  }

  public async getTodayUsage(dateStr?: string): Promise<UsageAnalyticsEntity> {
    const targetDate = dateStr || new Date().toISOString().split('T')[0]!;
    const db = database.getDb();
    if (db) {
      const found = await db.collection<UsageAnalyticsEntity>('usage_analytics').findOne({ date: targetDate });
      if (found) return found;
    }

    const mem = this.memoryUsage.get(targetDate);
    if (mem) return mem;

    const initial: UsageAnalyticsEntity = {
      id: `usage_${targetDate}`,
      date: targetDate,
      totalMessages: 0,
      totalTokensPrompt: 0,
      totalTokensCandidate: 0,
      modelBreakdown: {},
      toolCalls: {}
    };
    this.memoryUsage.set(targetDate, initial);
    return initial;
  }

  public async getRecentDaysUsage(days = 7): Promise<UsageAnalyticsEntity[]> {
    const db = database.getDb();
    if (db) {
      return await db
        .collection<UsageAnalyticsEntity>('usage_analytics')
        .find()
        .sort({ date: -1 })
        .limit(days)
        .toArray();
    }
    return Array.from(this.memoryUsage.values()).slice(-days);
  }
}

export const usageRepo = new UsageRepository();
