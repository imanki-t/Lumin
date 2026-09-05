import { database } from '@/core/database/connection.js';
import { QuoteEntity } from '@/core/database/schema.js';

export class QuoteRepository {
  private memoryQuotes = new Map<string, QuoteEntity>();

  public async setQuoteSubscription(quote: Omit<QuoteEntity, 'id' | 'createdAt'>): Promise<QuoteEntity> {
    const id = quote.guildId ? `quote_g_${quote.guildId}` : `quote_u_${quote.userId}`;
    const entity: QuoteEntity = {
      ...quote,
      id,
      createdAt: new Date()
    };

    const db = database.getDb();
    if (db) {
      await db.collection<QuoteEntity>('quotes').updateOne(
        { id },
        { $set: entity },
        { upsert: true }
      );
    }
    this.memoryQuotes.set(id, entity);
    return entity;
  }

  public async getQuoteSubscription(targetId: string, isGuild = false): Promise<QuoteEntity | null> {
    const id = isGuild ? `quote_g_${targetId}` : `quote_u_${targetId}`;
    const db = database.getDb();
    if (db) {
      return await db.collection<QuoteEntity>('quotes').findOne({ id });
    }
    return this.memoryQuotes.get(id) || null;
  }

  public async getAllActiveSubscriptions(): Promise<QuoteEntity[]> {
    const db = database.getDb();
    if (db) {
      return await db.collection<QuoteEntity>('quotes').find({ isEnabled: true }).toArray();
    }
    return Array.from(this.memoryQuotes.values()).filter((q) => q.isEnabled);
  }

  public async updateLastSent(id: string, dateStr: string): Promise<void> {
    const db = database.getDb();
    if (db) {
      await db.collection<QuoteEntity>('quotes').updateOne({ id }, { $set: { lastSentDate: dateStr } });
    }
    const mem = this.memoryQuotes.get(id);
    if (mem) {
      mem.lastSentDate = dateStr;
    }
  }

  public async removeSubscription(targetId: string, isGuild = false): Promise<boolean> {
    const id = isGuild ? `quote_g_${targetId}` : `quote_u_${targetId}`;
    const db = database.getDb();
    if (db) {
      const res = await db.collection<QuoteEntity>('quotes').deleteOne({ id });
      return (res.deletedCount ?? 0) > 0;
    }
    return this.memoryQuotes.delete(id);
  }

  public async findActiveSchedules(): Promise<QuoteEntity[]> {
    return this.getAllActiveSubscriptions();
  }

  public async setSchedule(options: { guildId: string; channelId: string; hourUtc: number; active: boolean }): Promise<void> {
    await this.setQuoteSubscription({
      guildId: options.guildId,
      channelId: options.channelId,
      category: 'inspirational',
      scheduledTime: `${options.hourUtc.toString().padStart(2, '0')}:00`,
      isEnabled: options.active
    });
  }

  public async deleteSchedule(guildId: string): Promise<boolean> {
    return this.removeSubscription(guildId, true);
  }
}

export const quoteRepo = new QuoteRepository();
