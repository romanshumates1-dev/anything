/**
 * Circuit Breaker for Provider Failover
 * 
 * State machine:
 * - CLOSED: Normal operation, requests pass through
 * - OPEN: Provider is unhealthy, requests rejected immediately (fail-fast)
 * - HALF_OPEN: Testing provider recovery, single request allowed
 * 
 * Trips on:
 * - N consecutive failures (default: 3)
 * - Delivery rate drop below threshold (default: 90%)
 * 
 * Auto-recovery:
 * - After delay (default: 30s), transition to HALF_OPEN
 * - If probe succeeds, return to CLOSED
 * - If probe fails, return to OPEN and reset delay
 */

export type CircuitState = 'closed' | 'open' | 'half_open';

export interface CircuitBreakerConfig {
  failureThreshold: number; // consecutive failures to trip
  recoveryDelayMs: number; // time before attempting recovery
  deliveryRateThreshold: number; // e.g., 0.9 for 90%
  halfOpenProbeTimeoutMs: number; // timeout for single request in HALF_OPEN
  windowSizeMs: number; // rolling window for rate calculation
}

export class CircuitBreaker {
  private state: CircuitState = 'closed';
  private failureCount = 0;
  private successCount = 0;
  private lastFailureTime = 0;
  private lastStateChange = Date.now();
  private deliveryWindow: Array<{ timestamp: number; success: boolean }> = [];

  constructor(
    private providerName: string,
    private config: CircuitBreakerConfig,
  ) {}

  getState(): CircuitState {
    return this.state;
  }

  canAttempt(): boolean {
    if (this.state === 'closed') return true;
    if (this.state === 'open') {
      const elapsed = Date.now() - this.lastFailureTime;
      if (elapsed > this.config.recoveryDelayMs) {
        this.transitionTo('half_open');
        return true; // Allow single probe
      }
      return false;
    }
    // HALF_OPEN: return true to allow probe attempt
    return true;
  }

  recordSuccess(): void {
    this.failureCount = 0;
    this.successCount++;
    this.updateDeliveryWindow(true);

    if (this.state === 'half_open') {
      this.transitionTo('closed');
    }
  }

  recordFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();
    this.updateDeliveryWindow(false);

    if (this.failureCount >= this.config.failureThreshold) {
      this.transitionTo('open');
    }

    if (this.state === 'half_open') {
      this.transitionTo('open');
    }
  }

  private transitionTo(newState: CircuitState): void {
    const oldState = this.state;
    this.state = newState;
    this.lastStateChange = Date.now();
    this.failureCount = 0;
    if (newState === 'closed') {
      this.successCount = 0;
    }
  }

  private updateDeliveryWindow(success: boolean): void {
    const now = Date.now();
    this.deliveryWindow = this.deliveryWindow.filter(
      (e) => now - e.timestamp < this.config.windowSizeMs,
    );
    this.deliveryWindow.push({ timestamp: now, success });

    if (this.state === 'closed' && this.deliveryWindow.length > 10) {
      const successRate =
        this.deliveryWindow.filter((e) => e.success).length /
        this.deliveryWindow.length;
      if (successRate < this.config.deliveryRateThreshold) {
        this.transitionTo('open');
      }
    }
  }

  getStats(): {
    state: CircuitState;
    failureCount: number;
    successCount: number;
    timeSinceChange: number;
    deliveryRate: number;
  } {
    const successRate =
      this.deliveryWindow.length > 0
        ? this.deliveryWindow.filter((e) => e.success).length /
          this.deliveryWindow.length
        : 0;

    return {
      state: this.state,
      failureCount: this.failureCount,
      successCount: this.successCount,
      timeSinceChange: Date.now() - this.lastStateChange,
      deliveryRate: successRate,
    };
  }
}
