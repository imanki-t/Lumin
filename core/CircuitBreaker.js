/**
 * @fileoverview Circuit Breaker for Gemini AI API Calls
 * @module core/CircuitBreaker
 * @version 2.0.0
 *
 * Prevents cascading failures when the Gemini API is down or overwhelmed.
 *
 * State machine:
 *
 *   ┌─────────┐  N failures   ┌──────┐  timeout  ┌───────────┐
 *   │  CLOSED │ ────────────► │ OPEN │ ─────────► │ HALF_OPEN │
 *   │(normal) │              │(fast │            │  (probe)  │
 *   └─────────┘              │ fail)│            └─────┬─────┘
 *        ▲                   └──────┘                  │
 *        │    success                       success ───┘
 *        └──────────────────────────────────
 *                              failure ───► back to OPEN
 *
 * CLOSED:    All calls pass through normally.
 * OPEN:      All calls are rejected immediately with CircuitOpenError.
 *            Re-evaluated after resetTimeoutMs.
 * HALF_OPEN: One probe call is allowed through.
 *            Success → CLOSED.  Failure → OPEN (reset timer).
 *
 * Usage:
 *   import { CircuitBreaker } from '../core/CircuitBreaker.js';
 *
 *   const breaker = new CircuitBreaker({ name: 'GeminiAPI' });
 *
 *   // Wrap every Gemini call:
 *   const result = await breaker.execute(() =>
 *     genAI.models.generateContent(request)
 *   );
 *
 * @requires core/Logger
 * @requires core/AppError
 */

import { Logger }           from './Logger.js';
import { CircuitOpenError } from './AppError.js';

const log = Logger.get('CircuitBreaker');

// ============================================================================
// STATE CONSTANTS
// ============================================================================

/**
 * Circuit breaker states.
 * @readonly
 * @enum {string}
 */
export const CircuitState = Object.freeze({
  CLOSED:    'CLOSED',
  OPEN:      'OPEN',
  HALF_OPEN: 'HALF_OPEN',
});

// ============================================================================
// DEFAULT CONFIGURATION
// ============================================================================

/**
 * @typedef {object} CircuitBreakerOptions
 * @property {string} [name='default']             - Name shown in logs
 * @property {number} [failureThreshold=5]         - Consecutive failures before opening
 * @property {number} [resetTimeoutMs=30000]       - Ms to wait in OPEN before probing
 * @property {number} [halfOpenProbeTimeoutMs=10000] - Ms to wait for the probe call
 * @property {number} [successThreshold=2]         - Consecutive successes in HALF_OPEN to close
 */

const DEFAULT_OPTIONS = Object.freeze({
  name:                  'default',
  failureThreshold:      5,
  resetTimeoutMs:        30_000,
  halfOpenProbeTimeoutMs: 10_000,
  successThreshold:      2,
});

// ============================================================================
// CIRCUIT BREAKER CLASS
// ============================================================================

/**
 * Implements the circuit breaker pattern for a single protected resource.
 *
 * @class CircuitBreaker
 *
 * @example
 * const breaker = new CircuitBreaker({ name: 'GeminiAPI', failureThreshold: 3 });
 *
 * async function callGemini(request) {
 *   return breaker.execute(() => genAI.models.generateContent(request));
 * }
 */
export class CircuitBreaker {
  /**
   * @param {CircuitBreakerOptions} [options]
   */
  constructor(options = {}) {
    /** @type {Required<CircuitBreakerOptions>} */
    this._opts = { ...DEFAULT_OPTIONS, ...options };

    /** @type {CircuitState} Current breaker state */
    this._state = CircuitState.CLOSED;

    /** Consecutive failure count (resets on any success while CLOSED) */
    this._failures = 0;

    /** Consecutive success count in HALF_OPEN state */
    this._halfOpenSuccesses = 0;

    /** Timestamp when the circuit opened (ms since epoch) */
    this._openedAt = 0;

    /**
     * Whether a HALF_OPEN probe is currently in-flight.
     * Prevents multiple probes from racing.
     * @type {boolean}
     */
    this._probeInFlight = false;

    /** Lifetime stats */
    this._stats = {
      totalCalls:     0,
      successCalls:   0,
      failedCalls:    0,
      rejectedCalls:  0,
      stateChanges:   0,
    };

    log.info(`Circuit breaker "${this._opts.name}" initialised`, {
      failureThreshold: this._opts.failureThreshold,
      resetTimeoutMs:   this._opts.resetTimeoutMs,
    });
  }

  // ──────────────────────────────────────────────────────────────────────────
  // PUBLIC API
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Execute a function through the circuit breaker.
   *
   * @template T
   * @param {() => Promise<T>} fn - The async function to protect
   * @returns {Promise<T>}
   * @throws {CircuitOpenError} When the circuit is OPEN
   * @throws {*}                Re-throws any error from fn after recording the failure
   *
   * @example
   * const response = await breaker.execute(() =>
   *   genAI.models.generateContent(request)
   * );
   */
  async execute(fn) {
    this._stats.totalCalls++;
    this._evaluateState();

    // ── OPEN: fast-fail immediately ─────────────────────────────────────────
    if (this._state === CircuitState.OPEN) {
      this._stats.rejectedCalls++;
      const retryAfterMs = Math.max(
        0,
        this._opts.resetTimeoutMs - (Date.now() - this._openedAt),
      );
      log.warn(`Circuit "${this._opts.name}" is OPEN — rejecting call`, { retryAfterMs });
      throw new CircuitOpenError(retryAfterMs);
    }

    // ── HALF_OPEN: only allow one probe at a time ──────────────────────────
    if (this._state === CircuitState.HALF_OPEN) {
      if (this._probeInFlight) {
        this._stats.rejectedCalls++;
        const retryAfterMs = this._opts.halfOpenProbeTimeoutMs;
        log.warn(`Circuit "${this._opts.name}" probe already in-flight — rejecting`);
        throw new CircuitOpenError(retryAfterMs);
      }
      this._probeInFlight = true;
    }

    // ── Execute the protected call ─────────────────────────────────────────
    try {
      const result = await fn();
      this._onSuccess();
      return result;
    } catch (error) {
      this._onFailure(error);
      throw error;
    } finally {
      if (this._state === CircuitState.HALF_OPEN) {
        this._probeInFlight = false;
      }
    }
  }

  /**
   * Manually force the circuit to CLOSED state.
   * Use only in tests or emergency admin commands.
   */
  reset() {
    log.warn(`Circuit "${this._opts.name}" manually reset to CLOSED`);
    this._transition(CircuitState.CLOSED);
    this._failures          = 0;
    this._halfOpenSuccesses = 0;
    this._openedAt          = 0;
  }

  /**
   * Current breaker state.
   * @returns {CircuitState}
   */
  get state() {
    this._evaluateState();
    return this._state;
  }

  /**
   * Whether calls are currently being allowed through.
   * @returns {boolean}
   */
  get isAvailable() {
    return this.state !== CircuitState.OPEN;
  }

  /**
   * Snapshot of lifetime statistics.
   * @returns {{ name: string, state: CircuitState, failures: number, stats: object }}
   */
  getStats() {
    return {
      name:             this._opts.name,
      state:            this._state,
      failures:         this._failures,
      openedAt:         this._openedAt ? new Date(this._openedAt).toISOString() : null,
      retryAfterMs:     this._state === CircuitState.OPEN
        ? Math.max(0, this._opts.resetTimeoutMs - (Date.now() - this._openedAt))
        : 0,
      ...this._stats,
    };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // PRIVATE HELPERS
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Re-evaluate state transitions that are purely time-based.
   * Called before every execute() and on state property access.
   * @private
   */
  _evaluateState() {
    if (
      this._state === CircuitState.OPEN &&
      Date.now() - this._openedAt >= this._opts.resetTimeoutMs
    ) {
      log.info(`Circuit "${this._opts.name}" timeout elapsed — transitioning to HALF_OPEN`);
      this._transition(CircuitState.HALF_OPEN);
      this._halfOpenSuccesses = 0;
    }
  }

  /**
   * Record a successful call and advance state if appropriate.
   * @private
   */
  _onSuccess() {
    this._stats.successCalls++;

    if (this._state === CircuitState.HALF_OPEN) {
      this._halfOpenSuccesses++;
      log.debug(`Circuit "${this._opts.name}" HALF_OPEN probe succeeded`, {
        successes: this._halfOpenSuccesses,
        needed:    this._opts.successThreshold,
      });

      if (this._halfOpenSuccesses >= this._opts.successThreshold) {
        log.info(`Circuit "${this._opts.name}" recovered — transitioning to CLOSED`);
        this._transition(CircuitState.CLOSED);
        this._failures          = 0;
        this._halfOpenSuccesses = 0;
      }
      return;
    }

    // Reset consecutive failure count on any success while CLOSED
    if (this._failures > 0) {
      log.debug(`Circuit "${this._opts.name}" success — resetting failure count`);
      this._failures = 0;
    }
  }

  /**
   * Record a failed call and open the circuit if the threshold is reached.
   * @param {unknown} error - The error thrown by the protected function
   * @private
   */
  _onFailure(error) {
    this._stats.failedCalls++;
    this._failures++;

    if (this._state === CircuitState.HALF_OPEN) {
      log.warn(`Circuit "${this._opts.name}" probe FAILED — reopening`, {
        error: error?.message,
      });
      this._transition(CircuitState.OPEN);
      this._openedAt          = Date.now();
      this._halfOpenSuccesses = 0;
      return;
    }

    log.debug(`Circuit "${this._opts.name}" failure recorded`, {
      failures:  this._failures,
      threshold: this._opts.failureThreshold,
    });

    if (this._failures >= this._opts.failureThreshold) {
      log.warn(`Circuit "${this._opts.name}" threshold reached — transitioning to OPEN`, {
        failures: this._failures,
      });
      this._transition(CircuitState.OPEN);
      this._openedAt = Date.now();
    }
  }

  /**
   * Update state and increment the change counter.
   * @param {CircuitState} newState
   * @private
   */
  _transition(newState) {
    if (this._state !== newState) {
      log.info(`Circuit "${this._opts.name}" state: ${this._state} → ${newState}`);
      this._state = newState;
      this._stats.stateChanges++;
    }
  }
}

// ============================================================================
// SHARED SINGLETON INSTANCE
// ============================================================================

/**
 * Shared circuit breaker instance for Gemini AI API calls.
 * Import and use this everywhere rather than creating new instances.
 *
 * @type {CircuitBreaker}
 *
 * @example
 * import { geminiCircuitBreaker } from '../core/CircuitBreaker.js';
 *
 * const result = await geminiCircuitBreaker.execute(() =>
 *   genAI.models.generateContent(request)
 * );
 */
export const geminiCircuitBreaker = new CircuitBreaker({
  name:                  'GeminiAPI',
  failureThreshold:      5,
  resetTimeoutMs:        30_000,
  halfOpenProbeTimeoutMs: 10_000,
  successThreshold:      2,
});
