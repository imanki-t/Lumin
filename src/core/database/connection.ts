import { MongoClient, Db } from 'mongodb';
import { env } from '@/config/env.js';
import { Logger } from '@/core/logger/index.js';

const logger = Logger.get('DatabaseConnection');

export class DatabaseService {
  private static instance: DatabaseService;
  private client: MongoClient | null = null;
  private db: Db | null = null;
  private isConnected = false;

  private constructor() {}

  public static get(): DatabaseService {
    if (!DatabaseService.instance) {
      DatabaseService.instance = new DatabaseService();
    }
    return DatabaseService.instance;
  }

  public async connect(): Promise<void> {
    if (this.isConnected && this.db) return;

    try {
      this.client = new MongoClient(env.MONGODB_URI, {
        maxPoolSize: 50,
        minPoolSize: 5,
        serverSelectionTimeoutMS: 5000,
        connectTimeoutMS: 10000
      });

      await this.client.connect();
      this.db = this.client.db();
      this.isConnected = true;
      logger.info('Connected to MongoDB database successfully');

      // Create compound indices
      await this.initIndices();
    } catch (err) {
      logger.warn('Failed to connect to MongoDB, operating in resilient memory mode', err);
      this.isConnected = false;
    }
  }

  private async initIndices(): Promise<void> {
    if (!this.db) return;
    try {
      await Promise.all([
        this.db.collection('user_settings').createIndex({ userId: 1 }, { unique: true }),
        this.db.collection('user_profiles').createIndex({ userId: 1 }, { unique: true }),
        this.db.collection('guild_settings').createIndex({ guildId: 1 }, { unique: true }),
        this.db.collection('reminders').createIndex({ remindAt: 1, isDelivered: 1 }),
        this.db.collection('birthdays').createIndex({ month: 1, day: 1 }),
        this.db.collection('dialogue_summaries').createIndex({ contextId: 1 }, { unique: true }),
        this.db.collection('vector_chunks').createIndex({ contextId: 1 })
      ]);
      logger.debug('Database indices created successfully');
    } catch (err) {
      logger.warn('Error creating database indices', err);
    }
  }

  public getDb(): Db | null {
    return this.db;
  }

  public isReady(): boolean {
    return this.isConnected && this.db !== null;
  }

  public async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.close();
      this.isConnected = false;
      this.db = null;
      logger.info('Database connection closed');
    }
  }
}

export const database = DatabaseService.get();
export const db = database;
