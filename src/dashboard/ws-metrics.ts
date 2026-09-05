import { WebSocketServer, WebSocket } from 'ws';
import os from 'os';
import { LuminClient } from '@/bot/client.js';
import { KeyRotationManager } from '@/core/ai/key-rotation.js';
import { UserMessageQueue } from '@/core/queue/message-queue.js';
import { Logger } from '@/core/logger/index.js';

const logger = Logger.get('WSMetrics');

export interface SystemMetricsPayload {
  timestamp: number;
  uptimeSeconds: number;
  system: {
    platform: string;
    cpus: number;
    loadAvg: number[];
    freeMemMb: number;
    totalMemMb: number;
    memUsagePercent: number;
  };
  process: {
    rssMb: number;
    heapUsedMb: number;
    heapTotalMb: number;
  };
  discord: {
    pingMs: number;
    guildCount: number;
    userCount: number;
    status: string;
  };
  queues: {
    activeUsersCount: number;
  };
  aiKeys: Array<{
    maskedKey: string;
    isHealthy: boolean;
    consecutiveErrors: number;
    totalRequests: number;
    totalErrors: number;
    cooldownUntil: number;
  }>;
}

export class WSMetricsBroadcaster {
  private static instance: WSMetricsBroadcaster;
  private wss: WebSocketServer | null = null;
  private intervalTimer: NodeJS.Timeout | null = null;

  private constructor() {}

  public static get(): WSMetricsBroadcaster {
    if (!WSMetricsBroadcaster.instance) {
      WSMetricsBroadcaster.instance = new WSMetricsBroadcaster();
    }
    return WSMetricsBroadcaster.instance;
  }

  public init(wss: WebSocketServer): void {
    this.wss = wss;

    wss.on('connection', (ws) => {
      logger.info('New WebSocket telemetry client connected');

      // Send initial snapshot immediately
      ws.send(JSON.stringify(this.gatherMetrics()));

      ws.on('close', () => {
        logger.info('WebSocket telemetry client disconnected');
      });

      ws.on('error', (err) => {
        logger.warn('WebSocket client error', err);
      });
    });

    // Broadcast telemetry update every 1 second
    this.intervalTimer = setInterval(() => {
      this.broadcastMetrics();
    }, 1000);

    logger.info('WSMetricsBroadcaster initialized with 1-second cadence.');
  }

  private gatherMetrics(): SystemMetricsPayload {
    const memUsage = process.memoryUsage();
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;

    const discordClient = LuminClient.get().client;
    const isReady = discordClient && discordClient.isReady();

    return {
      timestamp: Date.now(),
      uptimeSeconds: Math.floor(process.uptime()),
      system: {
        platform: os.platform(),
        cpus: os.cpus().length,
        loadAvg: os.loadavg(),
        freeMemMb: Math.round(freeMem / 1024 / 1024),
        totalMemMb: Math.round(totalMem / 1024 / 1024),
        memUsagePercent: Math.round((usedMem / totalMem) * 100)
      },
      process: {
        rssMb: Math.round(memUsage.rss / 1024 / 1024),
        heapUsedMb: Math.round(memUsage.heapUsed / 1024 / 1024),
        heapTotalMb: Math.round(memUsage.heapTotal / 1024 / 1024)
      },
      discord: {
        pingMs: isReady ? discordClient.ws.ping : -1,
        guildCount: isReady ? discordClient.guilds.cache.size : 0,
        userCount: isReady ? discordClient.users.cache.size : 0,
        status: isReady ? 'ONLINE' : 'CONNECTING'
      },
      queues: {
        activeUsersCount: UserMessageQueue.get().getActiveQueuesCount()
      },
      aiKeys: KeyRotationManager.get().getKeyStats()
    };
  }

  private broadcastMetrics(): void {
    if (!this.wss || this.wss.clients.size === 0) return;

    const payload = JSON.stringify(this.gatherMetrics());
    for (const client of this.wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    }
  }

  public stop(): void {
    if (this.intervalTimer) {
      clearInterval(this.intervalTimer);
      this.intervalTimer = null;
    }
  }
}
