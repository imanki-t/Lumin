import { env } from '@/config/env.js';
import { db } from '@/core/database/connection.js';
import { redis } from '@/core/cache/redis.js';
import { KeyRotationManager } from '@/core/ai/key-rotation.js';
import { AIRouter } from '@/core/ai/router.js';
import { LuminClient } from '@/bot/client.js';
import { DashboardServer } from '@/dashboard/server.js';
import { Logger } from '@/core/logger/index.js';

const logger = Logger.get('Bootstrap');

async function bootstrap(): Promise<void> {
  logger.info('====================================================');
  logger.info('   LUMIN AI BOT — INDUSTRIAL ARCHITECTURAL REBUILD   ');
  logger.info('   Models: Gemini 3.5 Flash / Flash-Lite & Gemma     ');
  logger.info('====================================================');

  try {
    // 1. Initialize Database Connection
    logger.info('Connecting to MongoDB Atlas / Local database...');
    await db.connect();

    // 2. Initialize Redis Cache & Memory Pipeline
    logger.info('Connecting to Redis Cache...');
    await redis.connect();

    // 3. Initialize AI Services & Key Rotation
    logger.info('Initializing AI Key Rotation and Router...');
    KeyRotationManager.get();
    AIRouter.get();

    // 4. Start Dashboard and WebSocket Telemetry Server
    logger.info('Starting Admin Dashboard and API Server...');
    await DashboardServer.get().start();

    // 5. Connect Discord Bot Gateway
    logger.info('Starting Discord Bot Client...');
    await LuminClient.get().start();

    logger.info('🚀 Lumin Bot and Services started successfully!');
  } catch (err: any) {
    logger.fatal('Fatal error during startup sequence', err);
    process.exit(1);
  }
}

// Graceful Shutdown Handler
let isShuttingDown = false;
async function gracefulShutdown(signal: string): Promise<void> {
  if (isShuttingDown) return;
  isShuttingDown = true;

  logger.info(`Received ${signal}. Initiating graceful shutdown...`);

  try {
    // Stop Discord client
    await LuminClient.get().stop();

    // Stop Dashboard server
    await DashboardServer.get().stop();

    // Close Redis connection
    await redis.disconnect();

    // Close Database connection
    await db.disconnect();

    logger.info('All subsystems terminated cleanly. Exiting.');
    process.exit(0);
  } catch (err: any) {
    logger.error('Error occurred during graceful shutdown', err);
    process.exit(1);
  }
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled Promise Rejection', reason as Error);
});

process.on('uncaughtException', (err) => {
  logger.fatal('Uncaught Exception thrown', err);
  process.exit(1);
});

// Run Bootstrap
bootstrap();
