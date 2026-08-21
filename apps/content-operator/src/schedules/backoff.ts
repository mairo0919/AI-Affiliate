export interface BackoffOptions {
  retryAttempt: number;
  baseDelaySeconds: number;
  maxDelaySeconds: number;
  /** Injected RNG in [0, 1) for deterministic tests. Default Math.random */
  random?: () => number;
}

/**
 * delay = min(base * 2^retryAttempt, max) with ±10% jitter.
 * retryAttempt is the upcoming attempt index (0 after first failure → base delay).
 */
export function computeRetryDelaySeconds(options: BackoffOptions): number {
  const exponent = Math.max(0, Math.floor(options.retryAttempt));
  const uncapped = options.baseDelaySeconds * 2 ** exponent;
  const capped = Math.min(uncapped, options.maxDelaySeconds);
  const random = options.random ?? Math.random;
  const jitterFactor = 1 + (random() * 0.2 - 0.1);
  return Math.max(0, capped * jitterFactor);
}

export function computeNextRetryAt(options: BackoffOptions & { now: Date }): Date {
  const delaySeconds = computeRetryDelaySeconds(options);
  return new Date(options.now.getTime() + Math.round(delaySeconds * 1000));
}
