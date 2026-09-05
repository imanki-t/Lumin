import { Router, Request, Response } from 'express';
import { KeyRotationManager } from '@/core/ai/key-rotation.js';
import { LuminClient } from '@/bot/client.js';
import { guildRepo } from '@/core/database/repositories/index.js';
import { AdminTerminalEvaluator } from '../terminal/eval.js';
import { LuminEmbedBuilder } from '@/bot/embeds/builder.js';
import { Logger } from '@/core/logger/index.js';

const logger = Logger.get('DashboardAPI');
export const apiRouter = Router();

// Flag for global lockdown
let isGlobalLockdown = false;

export function getLockdownStatus(): boolean {
  return isGlobalLockdown;
}

/**
 * GET /api/stats
 */
apiRouter.get('/stats', async (_req: Request, res: Response) => {
  const client = LuminClient.get().client;
  const isReady = client && client.isReady();

  res.json({
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    discord: {
      isReady,
      ping: isReady ? client.ws.ping : -1,
      guilds: isReady ? client.guilds.cache.size : 0,
      users: isReady ? client.users.cache.size : 0
    },
    lockdown: isGlobalLockdown
  });
});

/**
 * GET /api/keys
 */
apiRouter.get('/keys', (_req: Request, res: Response) => {
  const stats = KeyRotationManager.get().getKeyStats();
  res.json({ keys: stats });
});

/**
 * POST /api/keys/rotate
 */
apiRouter.post('/keys/rotate', (_req: Request, res: Response) => {
  try {
    const next = KeyRotationManager.get().getNextKey();
    const masked = next.length > 8 ? `${next.slice(0, 4)}...${next.slice(-4)}` : '****';
    res.json({ success: true, activeKey: masked });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/lockdown
 */
apiRouter.post('/lockdown', (req: Request, res: Response) => {
  const { enabled } = req.body;
  if (typeof enabled === 'boolean') {
    isGlobalLockdown = enabled;
  } else {
    isGlobalLockdown = !isGlobalLockdown;
  }

  logger.warn(`Global emergency lockdown state updated: ${isGlobalLockdown}`);
  res.json({ success: true, isGlobalLockdown });
});

/**
 * POST /api/users/blacklist
 */
apiRouter.post('/users/blacklist', async (req: Request, res: Response) => {
  const { guildId, userId, action } = req.body;
  if (!guildId || !userId || !action) {
    res.status(400).json({ error: 'guildId, userId, and action (add|remove) required' });
    return;
  }

  try {
    if (action === 'add') {
      await guildRepo.blacklistUser(guildId, userId);
    } else {
      await guildRepo.unblacklistUser(guildId, userId);
    }
    res.json({ success: true, guildId, userId, action });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/broadcast
 */
apiRouter.post('/broadcast', async (req: Request, res: Response) => {
  const { title, message, channelIds } = req.body;
  if (!message) {
    res.status(400).json({ error: 'message content required' });
    return;
  }

  const client = LuminClient.get().client;
  let sentCount = 0;

  const embed = LuminEmbedBuilder.brand({
    title: title || '📢 Official Broadcast Announcement',
    description: message
  }).setColor(0xff9900);

  const targets: string[] = channelIds || Array.from(client.guilds.cache.values()).map((g) => g.systemChannelId).filter(Boolean);

  for (const id of targets) {
    try {
      const ch = await client.channels.fetch(id).catch(() => null);
      if (ch && ch.isTextBased()) {
        await (ch as any).send({ embeds: [embed] });
        sentCount++;
      }
    } catch {
      // Continue
    }
  }

  res.json({ success: true, sentCount, totalTargets: targets.length });
});

/**
 * POST /api/terminal/js
 */
apiRouter.post('/terminal/js', async (req: Request, res: Response) => {
  const { code } = req.body;
  if (!code) {
    res.status(400).json({ error: 'JavaScript code required' });
    return;
  }

  try {
    const outcome = await AdminTerminalEvaluator.executeJs(code);
    res.json({ success: true, ...outcome });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/terminal/mongo
 */
apiRouter.post('/terminal/mongo', async (req: Request, res: Response) => {
  const { collection, operation, query, options } = req.body;
  if (!collection || !operation) {
    res.status(400).json({ error: 'collection and operation required' });
    return;
  }

  try {
    const outcome = await AdminTerminalEvaluator.executeMongoQuery(collection, operation, query, options);
    res.json({ success: true, ...outcome });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});
