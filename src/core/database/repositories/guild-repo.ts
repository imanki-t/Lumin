import { database } from '@/core/database/connection.js';
import { GuildSettings } from '@/core/database/schema.js';
import { DEFAULT_SERVER_SETTINGS } from '@/config/constants.js';

export class GuildRepository {
  private memoryGuilds = new Map<string, GuildSettings>();

  public async getSettings(guildId: string): Promise<GuildSettings> {
    const db = database.getDb();
    if (db) {
      const found = await db.collection<GuildSettings>('guild_settings').findOne({ guildId });
      if (found) return found;
    }

    const cached = this.memoryGuilds.get(guildId);
    if (cached) return cached;

    const defaultObj: GuildSettings = {
      guildId,
      overrideUserSettings: DEFAULT_SERVER_SETTINGS.overrideUserSettings,
      allowedChannels: [...DEFAULT_SERVER_SETTINGS.allowedChannels],
      alwaysRespondChannels: [...DEFAULT_SERVER_SETTINGS.alwaysRespondChannels],
      blacklistedUsers: [...DEFAULT_SERVER_SETTINGS.blacklistedUsers],
      rouletteEnabled: DEFAULT_SERVER_SETTINGS.rouletteEnabled,
      rouletteRarity: DEFAULT_SERVER_SETTINGS.rouletteRarity,
      reviveIntervalHours: DEFAULT_SERVER_SETTINGS.reviveIntervalHours,
      reviveEnabled: DEFAULT_SERVER_SETTINGS.reviveEnabled,
      serverFacts: [],
      createdAt: new Date(),
      updatedAt: new Date()
    };
    this.memoryGuilds.set(guildId, defaultObj);
    return defaultObj;
  }

  public async updateSettings(guildId: string, partial: Partial<GuildSettings>): Promise<GuildSettings> {
    const current = await this.getSettings(guildId);
    const updated: GuildSettings = {
      ...current,
      ...partial,
      guildId,
      updatedAt: new Date()
    };

    const db = database.getDb();
    if (db) {
      await db.collection<GuildSettings>('guild_settings').updateOne(
        { guildId },
        { $set: updated },
        { upsert: true }
      );
    }
    this.memoryGuilds.set(guildId, updated);
    return updated;
  }

  public async addServerFact(
    guildId: string,
    fact: string,
    category: 'relationship' | 'nickname' | 'role' | 'activity' | 'event' | 'personal',
    addedBy: string
  ): Promise<void> {
    const settings = await this.getSettings(guildId);
    const id = `sfact_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const newFacts = [...settings.serverFacts, { id, fact, category, addedBy, createdAt: new Date() }];
    await this.updateSettings(guildId, { serverFacts: newFacts });
  }

  public async removeServerFact(guildId: string, keyword: string): Promise<boolean> {
    const settings = await this.getSettings(guildId);
    const lowerKey = keyword.toLowerCase();
    const initialLen = settings.serverFacts.length;
    const filtered = settings.serverFacts.filter(
      (f) => !f.fact.toLowerCase().includes(lowerKey) && !f.id.includes(lowerKey)
    );
    if (filtered.length !== initialLen) {
      await this.updateSettings(guildId, { serverFacts: filtered });
      return true;
    }
    return false;
  }

  public async getAllGuildsWithRevival(): Promise<GuildSettings[]> {
    const db = database.getDb();
    if (db) {
      return await db.collection<GuildSettings>('guild_settings').find({ reviveEnabled: true }).toArray();
    }
    return Array.from(this.memoryGuilds.values()).filter((g) => g.reviveEnabled);
  }

  public async findAllReviveEligible(): Promise<GuildSettings[]> {
    return this.getAllGuildsWithRevival();
  }

  public async updateLastRevive(guildId: string): Promise<void> {
    await this.updateSettings(guildId, { lastReviveAt: new Date() });
  }

  public async blacklistUser(guildId: string, userId: string): Promise<void> {
    const settings = await this.getSettings(guildId);
    if (!settings.blacklistedUsers.includes(userId)) {
      await this.updateSettings(guildId, { blacklistedUsers: [...settings.blacklistedUsers, userId] });
    }
  }

  public async unblacklistUser(guildId: string, userId: string): Promise<void> {
    const settings = await this.getSettings(guildId);
    await this.updateSettings(guildId, {
      blacklistedUsers: settings.blacklistedUsers.filter((id) => id !== userId)
    });
  }
}

export const guildRepo = new GuildRepository();
