import { database } from '@/core/database/connection.js';
import { UserSettings, UserProfileGraph } from '@/core/database/schema.js';
import { DEFAULT_USER_SETTINGS } from '@/config/constants.js';

export class UserRepository {
  private memorySettings = new Map<string, UserSettings>();
  private memoryProfiles = new Map<string, UserProfileGraph>();

  public async getSettings(userId: string): Promise<UserSettings> {
    const db = database.getDb();
    if (db) {
      const found = await db.collection<UserSettings>('user_settings').findOne({ userId });
      if (found) return found;
    }

    const cached = this.memorySettings.get(userId);
    if (cached) return cached;

    const defaultObj: UserSettings = {
      userId,
      continuousReply: DEFAULT_USER_SETTINGS.continuousReply,
      customTone: DEFAULT_USER_SETTINGS.customTone,
      timezone: DEFAULT_USER_SETTINGS.timezone,
      preferredModel: DEFAULT_USER_SETTINGS.preferredModel,
      createdAt: new Date(),
      updatedAt: new Date()
    };
    this.memorySettings.set(userId, defaultObj);
    return defaultObj;
  }

  public async updateSettings(userId: string, partial: Partial<UserSettings>): Promise<UserSettings> {
    const current = await this.getSettings(userId);
    const updated: UserSettings = {
      ...current,
      ...partial,
      userId,
      updatedAt: new Date()
    };

    const db = database.getDb();
    if (db) {
      await db.collection<UserSettings>('user_settings').updateOne(
        { userId },
        { $set: updated },
        { upsert: true }
      );
    }
    this.memorySettings.set(userId, updated);
    return updated;
  }

  public async getProfile(userId: string): Promise<UserProfileGraph> {
    const db = database.getDb();
    if (db) {
      const found = await db.collection<UserProfileGraph>('user_profiles').findOne({ userId });
      if (found) return found;
    }

    const cached = this.memoryProfiles.get(userId);
    if (cached) return cached;

    const defaultProfile: UserProfileGraph = {
      userId,
      personalFacts: [],
      preferences: {},
      gameStats: {
        akinatorPlayed: 0,
        akinatorWon: 0,
        tdsPlayed: 0,
        nhiePlayed: 0,
        wyrPlayed: 0
      },
      totalInteractions: 0,
      lastActiveAt: new Date()
    };
    this.memoryProfiles.set(userId, defaultProfile);
    return defaultProfile;
  }

  public async updateProfile(userId: string, partial: Partial<UserProfileGraph>): Promise<UserProfileGraph> {
    const current = await this.getProfile(userId);
    const updated: UserProfileGraph = {
      ...current,
      ...partial,
      userId,
      lastActiveAt: new Date()
    };

    const db = database.getDb();
    if (db) {
      await db.collection<UserProfileGraph>('user_profiles').updateOne(
        { userId },
        { $set: updated },
        { upsert: true }
      );
    }
    this.memoryProfiles.set(userId, updated);
    return updated;
  }

  public async addPersonalFact(userId: string, fact: string, category = 'personal'): Promise<void> {
    const profile = await this.getProfile(userId);
    const id = `fact_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const newFacts = [...profile.personalFacts, { id, fact, category, confidence: 1.0, createdAt: new Date() }];
    await this.updateProfile(userId, { personalFacts: newFacts });
  }

  public async removePersonalFact(userId: string, factKeyword: string): Promise<boolean> {
    const profile = await this.getProfile(userId);
    const lowerKey = factKeyword.toLowerCase();
    const initialLen = profile.personalFacts.length;
    const filtered = profile.personalFacts.filter(
      (f) => !f.fact.toLowerCase().includes(lowerKey) && !f.id.includes(lowerKey)
    );
    if (filtered.length !== initialLen) {
      await this.updateProfile(userId, { personalFacts: filtered });
      return true;
    }
    return false;
  }
}

export const userRepo = new UserRepository();
