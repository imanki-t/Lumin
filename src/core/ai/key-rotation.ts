import { env } from '@/config/env.js';
import { Logger } from '@/core/logger/index.js';

const logger = Logger.get('KeyRotation');

export interface KeyHealthState {
  key: string;
  maskedKey: string;
  isHealthy: boolean;
  consecutiveErrors: number;
  totalRequests: number;
  totalErrors: number;
  lastUsedAt: number;
  cooldownUntil: number;
}

export class KeyRotationManager {
  private static instance: KeyRotationManager;
  private keyStates: KeyHealthState[] = [];
  private currentIndex = 0;

  private constructor() {
    this.init();
  }

  public static get(): KeyRotationManager {
    if (!KeyRotationManager.instance) {
      KeyRotationManager.instance = new KeyRotationManager();
    }
    return KeyRotationManager.instance;
  }

  private init(): void {
    const keys = env.GEMINI_API_KEYS;
    this.keyStates = keys.map((key) => {
      const masked = key.length > 8 ? `${key.slice(0, 4)}...${key.slice(-4)}` : '****';
      return {
        key,
        maskedKey: masked,
        isHealthy: true,
        consecutiveErrors: 0,
        totalRequests: 0,
        totalErrors: 0,
        lastUsedAt: 0,
        cooldownUntil: 0
      };
    });
    logger.info(`Initialized KeyRotationManager with ${this.keyStates.length} API keys in pool`);
  }

  /**
   * Retrieves the next optimal healthy API key using round-robin with cooldown awareness
   */
  public getNextKey(): string {
    const now = Date.now();
    const len = this.keyStates.length;
    if (len === 0) {
      throw new Error('No Gemini API keys configured in environment');
    }

    // Try finding next healthy non-cooling-down key
    for (let i = 0; i < len; i++) {
      const idx = (this.currentIndex + i) % len;
      const state = this.keyStates[idx]!;

      if (state.cooldownUntil <= now) {
        state.isHealthy = true;
      }

      if (state.isHealthy) {
        this.currentIndex = (idx + 1) % len;
        state.totalRequests += 1;
        state.lastUsedAt = now;
        return state.key;
      }
    }

    // If all keys are in cooldown, pick the one with earliest cooldown expiry
    logger.warn('All API keys are in cooldown. Picking key with lowest remaining cooldown time');
    let earliestState = this.keyStates[0]!;
    for (const s of this.keyStates) {
      if (s.cooldownUntil < earliestState.cooldownUntil) {
        earliestState = s;
      }
    }
    earliestState.totalRequests += 1;
    earliestState.lastUsedAt = now;
    return earliestState.key;
  }

  /**
   * Records a successful execution with an API key
   */
  public recordSuccess(apiKey: string): void {
    const state = this.keyStates.find((k) => k.key === apiKey);
    if (state) {
      state.consecutiveErrors = 0;
      state.isHealthy = true;
      state.cooldownUntil = 0;
    }
  }

  /**
   * Records an error or rate limit for an API key, triggering adaptive cooldowns
   */
  public recordError(apiKey: string, errorStatus?: number): void {
    const state = this.keyStates.find((k) => k.key === apiKey);
    if (!state) return;

    state.consecutiveErrors += 1;
    state.totalErrors += 1;

    // Rate Limit (429 / RESOURCE_EXHAUSTED) -> 60s cooldown
    if (errorStatus === 429) {
      state.cooldownUntil = Date.now() + 60000;
      state.isHealthy = false;
      logger.warn(`API Key ${state.maskedKey} hit 429 quota limit. Placed in 60s cooldown.`);
    } else if (state.consecutiveErrors >= 3) {
      // 3 consecutive failures -> 120s cooldown
      state.cooldownUntil = Date.now() + 120000;
      state.isHealthy = false;
      logger.warn(`API Key ${state.maskedKey} had ${state.consecutiveErrors} consecutive errors. Placed in 120s cooldown.`);
    }
  }

  /**
   * Returns snapshot for admin dashboard monitoring
   */
  public getStatus(): KeyHealthState[] {
    const now = Date.now();
    return this.keyStates.map((s) => ({
      ...s,
      isHealthy: s.cooldownUntil <= now
    }));
  }

  public getKeyStats(): KeyHealthState[] {
    return this.getStatus();
  }
}

export const keyRotation = KeyRotationManager.get();
