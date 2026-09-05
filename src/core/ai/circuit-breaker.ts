import { Logger } from '@/core/logger/index.js';
import { AppError, ErrorCode } from '@/core/errors/app-error.js';

const logger = Logger.get('CircuitBreaker');

export enum CircuitState {
  CLOSED = 'CLOSED', // Normal operation
  OPEN = 'OPEN', // Failing fast
  HALF_OPEN = 'HALF_OPEN' // Testing recovery
}

export interface CircuitBreakerOptions {
  failureThreshold?: number; // Failures before opening (default: 5)
  resetTimeoutMs?: number; // Time before testing recovery (default: 30s)
  halfOpenSuccessThreshold?: number; // Successes to close circuit (default: 2)
}

export class CircuitBreaker {
  private state: CircuitState = CircuitState.CLOSED;
  private failureCount = 0;
  private successCount = 0;
  private lastFailureTime = 0;
  private readonly failureThreshold: number;
  private readonly resetTimeoutMs: number;
  private readonly halfOpenSuccessThreshold: number;

  constructor(private name: string, options: CircuitBreakerOptions = {}) {
    this.failureThreshold = options.failureThreshold ?? 5;
    this.resetTimeoutMs = options.resetTimeoutMs ?? 30000;
    this.halfOpenSuccessThreshold = options.halfOpenSuccessThreshold ?? 2;
  }

  public async execute<T>(fn: () => Promise<T>, fallback?: () => Promise<T>): Promise<T> {
    const now = Date.now();

    if (this.state === CircuitState.OPEN) {
      if (now - this.lastFailureTime > this.resetTimeoutMs) {
        this.state = CircuitState.HALF_OPEN;
        logger.info(`Circuit breaker [${this.name}] entered HALF_OPEN state`);
      } else {
        logger.warn(`Circuit breaker [${this.name}] is OPEN. Fast failing.`);
        if (fallback) return await fallback();
        throw new AppError({
          message: `Service ${this.name} temporarily unavailable (circuit open)`,
          code: ErrorCode.SERVICE_UNAVAILABLE,
          statusCode: 503
        });
      }
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (err: any) {
      this.onFailure(err);
      if (fallback) {
        logger.warn(`Circuit breaker [${this.name}] caught error, invoking fallback.`, err?.message);
        return await fallback();
      }
      throw err;
    }
  }

  private onSuccess(): void {
    if (this.state === CircuitState.HALF_OPEN) {
      this.successCount += 1;
      if (this.successCount >= this.halfOpenSuccessThreshold) {
        this.state = CircuitState.CLOSED;
        this.failureCount = 0;
        this.successCount = 0;
        logger.info(`Circuit breaker [${this.name}] is now CLOSED (healthy)`);
      }
    } else {
      this.failureCount = 0;
    }
  }

  private onFailure(err: any): void {
    this.failureCount += 1;
    this.lastFailureTime = Date.now();

    if (this.state === CircuitState.HALF_OPEN || this.failureCount >= this.failureThreshold) {
      this.state = CircuitState.OPEN;
      logger.error(`Circuit breaker [${this.name}] tripped to OPEN state. Consecutive failures: ${this.failureCount}`, err);
    }
  }

  public getState(): CircuitState {
    return this.state;
  }

  public isAvailable(): boolean {
    const now = Date.now();
    if (this.state === CircuitState.OPEN) {
      if (now - this.lastFailureTime > this.resetTimeoutMs) {
        this.state = CircuitState.HALF_OPEN;
        return true;
      }
      return false;
    }
    return true;
  }

  public recordFailure(err?: any): void {
    this.onFailure(err);
  }

  public recordSuccess(): void {
    this.onSuccess();
  }
}
