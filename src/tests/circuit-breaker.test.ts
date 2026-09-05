import { describe, it, expect, beforeEach } from 'vitest';
import { CircuitBreaker, CircuitState } from '@/core/ai/circuit-breaker.js';

describe('CircuitBreaker', () => {
  let breaker: CircuitBreaker;

  beforeEach(() => {
    breaker = new CircuitBreaker('test-model', {
      failureThreshold: 3,
      resetTimeoutMs: 50,
      halfOpenSuccessThreshold: 2
    });
  });

  it('should start in CLOSED state', () => {
    expect(breaker.getState()).toBe(CircuitState.CLOSED);
    expect(breaker.isAvailable()).toBe(true);
  });

  it('should trip to OPEN after consecutive failures meet threshold', () => {
    breaker.recordFailure();
    expect(breaker.getState()).toBe(CircuitState.CLOSED);
    breaker.recordFailure();
    expect(breaker.getState()).toBe(CircuitState.CLOSED);
    breaker.recordFailure();
    expect(breaker.getState()).toBe(CircuitState.OPEN);
    expect(breaker.isAvailable()).toBe(false);
  });

  it('should transition to HALF_OPEN after timeout expires', async () => {
    breaker.recordFailure();
    breaker.recordFailure();
    breaker.recordFailure();
    expect(breaker.getState()).toBe(CircuitState.OPEN);

    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(breaker.isAvailable()).toBe(true);
    expect(breaker.getState()).toBe(CircuitState.HALF_OPEN);
  });

  it('should transition back to CLOSED after consecutive successes in HALF_OPEN', async () => {
    breaker.recordFailure();
    breaker.recordFailure();
    breaker.recordFailure();

    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(breaker.isAvailable()).toBe(true);

    breaker.recordSuccess();
    expect(breaker.getState()).toBe(CircuitState.HALF_OPEN);
    breaker.recordSuccess();
    expect(breaker.getState()).toBe(CircuitState.CLOSED);
    expect(breaker.isAvailable()).toBe(true);
  });
});
