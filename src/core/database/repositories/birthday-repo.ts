import { database } from '@/core/database/connection.js';
import { BirthdayEntity } from '@/core/database/schema.js';

export class BirthdayRepository {
  private memoryBirthdays = new Map<string, BirthdayEntity>();

  public async setBirthday(birthday: Omit<BirthdayEntity, 'id' | 'createdAt'>): Promise<BirthdayEntity> {
    const id = `bday_${birthday.userId}`;
    const entity: BirthdayEntity = {
      ...birthday,
      id,
      createdAt: new Date()
    };

    const db = database.getDb();
    if (db) {
      await db.collection<BirthdayEntity>('birthdays').updateOne(
        { userId: birthday.userId },
        { $set: entity },
        { upsert: true }
      );
    }
    this.memoryBirthdays.set(birthday.userId, entity);
    return entity;
  }

  public async getBirthday(userId: string): Promise<BirthdayEntity | null> {
    const db = database.getDb();
    if (db) {
      return await db.collection<BirthdayEntity>('birthdays').findOne({ userId });
    }
    return this.memoryBirthdays.get(userId) || null;
  }

  public async getBirthdaysForDate(month: number, day: number): Promise<BirthdayEntity[]> {
    const db = database.getDb();
    if (db) {
      return await db.collection<BirthdayEntity>('birthdays').find({ month, day }).toArray();
    }
    return Array.from(this.memoryBirthdays.values()).filter((b) => b.month === month && b.day === day);
  }

  public async getAllBirthdaysInGuild(guildMemberIds: string[]): Promise<BirthdayEntity[]> {
    const db = database.getDb();
    if (db) {
      return await db.collection<BirthdayEntity>('birthdays').find({ userId: { $in: guildMemberIds } }).toArray();
    }
    return Array.from(this.memoryBirthdays.values()).filter((b) => guildMemberIds.includes(b.userId));
  }

  public async deleteBirthday(userId: string): Promise<boolean> {
    const db = database.getDb();
    if (db) {
      const res = await db.collection<BirthdayEntity>('birthdays').deleteOne({ userId });
      return (res.deletedCount ?? 0) > 0;
    }
    return this.memoryBirthdays.delete(userId);
  }

  public async markNotified(userId: string, year: number): Promise<void> {
    const db = database.getDb();
    if (db) {
      await db.collection<BirthdayEntity>('birthdays').updateOne({ userId }, { $set: { lastNotifiedYear: year } });
    }
    const mem = this.memoryBirthdays.get(userId);
    if (mem) {
      mem.lastNotifiedYear = year;
    }
  }

  public async findBirthdaysByDate(month: number, day: number): Promise<BirthdayEntity[]> {
    return this.getBirthdaysForDate(month, day);
  }

  public async getGuildBirthdays(guildId: string): Promise<BirthdayEntity[]> {
    const db = database.getDb();
    if (db) {
      return await db.collection<BirthdayEntity>('birthdays').find({ guildId }).toArray();
    }
    return Array.from(this.memoryBirthdays.values()).filter((b) => b.guildId === guildId);
  }
}

export const birthdayRepo = new BirthdayRepository();
