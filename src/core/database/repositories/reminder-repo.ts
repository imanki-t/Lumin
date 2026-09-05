import { database } from '@/core/database/connection.js';
import { ReminderEntity } from '@/core/database/schema.js';

export class ReminderRepository {
  private memoryReminders = new Map<string, ReminderEntity>();

  public async createReminder(reminder: Omit<ReminderEntity, 'id' | 'createdAt' | 'isDelivered'>): Promise<ReminderEntity> {
    const id = `rem_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const entity: ReminderEntity = {
      ...reminder,
      id,
      isDelivered: false,
      createdAt: new Date()
    };

    const db = database.getDb();
    if (db) {
      await db.collection<ReminderEntity>('reminders').insertOne(entity);
    }
    this.memoryReminders.set(id, entity);
    return entity;
  }

  public async getDueReminders(now = new Date()): Promise<ReminderEntity[]> {
    const db = database.getDb();
    if (db) {
      return await db.collection<ReminderEntity>('reminders').find({
        remindAt: { $lte: now },
        isDelivered: false
      }).toArray();
    }

    return Array.from(this.memoryReminders.values()).filter(
      (r) => !r.isDelivered && r.remindAt.getTime() <= now.getTime()
    );
  }

  public async markDelivered(id: string): Promise<void> {
    const db = database.getDb();
    if (db) {
      await db.collection<ReminderEntity>('reminders').updateOne({ id }, { $set: { isDelivered: true } });
    }
    const mem = this.memoryReminders.get(id);
    if (mem) {
      mem.isDelivered = true;
    }
  }

  public async getUserReminders(userId: string): Promise<ReminderEntity[]> {
    const db = database.getDb();
    if (db) {
      return await db.collection<ReminderEntity>('reminders').find({ userId, isDelivered: false }).toArray();
    }
    return Array.from(this.memoryReminders.values()).filter(
      (r) => r.userId === userId && !r.isDelivered
    );
  }

  public async deleteReminder(id: string, userId: string): Promise<boolean> {
    const db = database.getDb();
    if (db) {
      const res = await db.collection<ReminderEntity>('reminders').deleteOne({ id, userId });
      return (res.deletedCount ?? 0) > 0;
    }
    const mem = this.memoryReminders.get(id);
    if (mem && mem.userId === userId) {
      this.memoryReminders.delete(id);
      return true;
    }
    return false;
  }

  public async findDueReminders(): Promise<ReminderEntity[]> {
    return this.getDueReminders();
  }

  public async markCompleted(id: string): Promise<void> {
    return this.markDelivered(id);
  }

  public async updateNextOccurrence(id: string, dueAt: Date): Promise<void> {
    const db = database.getDb();
    if (db) {
      await db.collection<ReminderEntity>('reminders').updateOne({ id }, { $set: { remindAt: dueAt } });
    }
    const mem = this.memoryReminders.get(id);
    if (mem) {
      mem.remindAt = dueAt;
    }
  }
}

export const reminderRepo = new ReminderRepository();
