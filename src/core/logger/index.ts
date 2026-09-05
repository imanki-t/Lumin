import pino from 'pino';
import { env } from '@/config/env.js';

const isProduction = env.NODE_ENV === 'production';

// Base Pino logger instance with structured JSON in prod or pretty printing in dev
const baseLogger = pino({
  level: env.LOG_LEVEL,
  transport: isProduction
    ? undefined
    : {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:yyyy-mm-dd HH:MM:ss',
          ignore: 'pid,hostname'
        }
      },
  redact: {
    paths: ['token', 'password', 'key', 'apiKey', 'authorization', 'headers.authorization'],
    censor: '[REDACTED]'
  }
});

export class Logger {
  private static instances = new Map<string, Logger>();
  private pinoLogger: pino.Logger;
  private contextName: string;

  private constructor(context: string) {
    this.contextName = context;
    this.pinoLogger = baseLogger.child({ module: context });
  }

  public static get(context: string): Logger {
    let instance = this.instances.get(context);
    if (!instance) {
      instance = new Logger(context);
      this.instances.set(context, instance);
    }
    return instance;
  }

  public trace(msg: string, ...args: any[]): void {
    this.pinoLogger.trace({ args }, msg);
  }

  public debug(msg: string, ...args: any[]): void {
    this.pinoLogger.debug({ args }, msg);
  }

  public info(msg: string, ...args: any[]): void {
    this.pinoLogger.info({ args }, msg);
  }

  public warn(msg: string, ...args: any[]): void {
    this.pinoLogger.warn({ args }, msg);
  }

  public error(msg: string, error?: unknown, ...args: any[]): void {
    const errorObj = error instanceof Error
      ? { message: error.message, stack: error.stack, name: error.name }
      : { raw: error };
    this.pinoLogger.error({ error: errorObj, args }, msg);
  }

  public fatal(msg: string, error?: unknown, ...args: any[]): void {
    const errorObj = error instanceof Error
      ? { message: error.message, stack: error.stack, name: error.name }
      : { raw: error };
    this.pinoLogger.fatal({ error: errorObj, args }, msg);
    this.sendDiscordAlert(msg, error);
  }

  private async sendDiscordAlert(msg: string, error?: unknown): Promise<void> {
    if (!env.ALERT_WEBHOOK_URL) return;
    try {
      const errDetail = error instanceof Error ? `\`\`\`${error.stack?.slice(0, 1000)}\`\`\`` : '';
      await fetch(env.ALERT_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          embeds: [
            {
              title: `🚨 CRITICAL ALERT: [${this.contextName}]`,
              description: `**Message:** ${msg}\n${errDetail}`,
              color: 0xff0000,
              timestamp: new Date().toISOString()
            }
          ]
        })
      });
    } catch {
      // Swallow webhook delivery failures to avoid crash loops
    }
  }
}
