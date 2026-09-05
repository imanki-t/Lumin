/**
 * Complete Database Entity Schemas and Interfaces
 */

export interface UserSettings {
  userId: string;
  continuousReply: boolean;
  customTone: string;
  timezone: string;
  preferredModel: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface UserProfileGraph {
  userId: string;
  personalFacts: Array<{
    id: string;
    fact: string;
    category: string;
    confidence: number;
    createdAt: Date;
  }>;
  preferences: Record<string, any>;
  gameStats: {
    akinatorPlayed: number;
    akinatorWon: number;
    tdsPlayed: number;
    nhiePlayed: number;
    wyrPlayed: number;
  };
  totalInteractions: number;
  lastActiveAt: Date;
}

export interface GuildSettings {
  guildId: string;
  overrideUserSettings: boolean;
  allowedChannels: string[];
  alwaysRespondChannels: string[];
  blacklistedUsers: string[];
  rouletteEnabled: boolean;
  rouletteRarity: number;
  reviveIntervalHours: number;
  reviveEnabled: boolean;
  lastReviveAt?: Date;
  serverFacts: Array<{
    id: string;
    fact: string;
    category: 'relationship' | 'nickname' | 'role' | 'activity' | 'event' | 'personal';
    addedBy: string;
    createdAt: Date;
  }>;
  createdAt: Date;
  updatedAt: Date;
}

export interface ReminderEntity {
  id: string;
  userId: string;
  channelId: string;
  guildId?: string;
  message: string;
  remindAt: Date;
  isDelivered: boolean;
  createdAt: Date;
}

export interface BirthdayEntity {
  id: string;
  userId: string;
  guildId?: string;
  day: number;
  month: number;
  year?: number;
  timezone: string;
  lastNotifiedYear?: number;
  createdAt: Date;
}

export interface QuoteEntity {
  id: string;
  guildId?: string;
  channelId?: string;
  userId?: string;
  category: string;
  scheduledTime?: string; // HH:mm
  lastSentDate?: string;
  isEnabled: boolean;
  createdAt: Date;
}

export interface DialogueSummaryEntity {
  id: string;
  contextId: string; // e.g. guildId:channelId or dm:userId
  summary: string;
  keyTopics: string[];
  messageCount: number;
  lastMessageTimestamp: Date;
  updatedAt: Date;
}

export interface VectorDocumentChunk {
  id: string;
  contextId: string;
  fileName: string;
  chunkIndex: number;
  content: string;
  embedding: number[];
  metadata: {
    fileType: string;
    uploadedBy: string;
    timestamp: Date;
  };
}

export interface UsageAnalyticsEntity {
  id: string;
  date: string; // YYYY-MM-DD
  totalMessages: number;
  totalTokensPrompt: number;
  totalTokensCandidate: number;
  modelBreakdown: Record<string, number>;
  toolCalls: Record<string, number>;
}
