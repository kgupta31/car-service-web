/**
 * In-memory sliding-window rate limiter, keyed by caller (e.g. IP).
 *
 * This is a soft speed bump, not a hard guarantee: it resets on cold start
 * and isn't shared across serverless instances. That's an acceptable
 * trade-off for a low-traffic hobby deployment where the goal is stopping
 * casual scripted abuse of a shared, rate-limited upstream (Groq) API key
 * — not enforcing precise quotas. Swap for a durable store (e.g. Upstash
 * Redis) if traffic grows enough to need a real guarantee.
 */

const WINDOW_MS = 60_000;
const MAX_REQUESTS = 5;
const SWEEP_INTERVAL = 200;

const requestLog = new Map<string, number[]>();
let callsSinceSweep = 0;

export function checkRateLimit(key: string): { limited: boolean; retryAfterSeconds: number } {
  const now = Date.now();
  const timestamps = (requestLog.get(key) ?? []).filter((t) => now - t < WINDOW_MS);

  if (timestamps.length >= MAX_REQUESTS) {
    requestLog.set(key, timestamps);
    const retryAfterMs = WINDOW_MS - (now - timestamps[0]);
    return { limited: true, retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)) };
  }

  timestamps.push(now);
  requestLog.set(key, timestamps);

  callsSinceSweep += 1;
  if (callsSinceSweep >= SWEEP_INTERVAL) {
    callsSinceSweep = 0;
    for (const [k, v] of requestLog) {
      const fresh = v.filter((t) => now - t < WINDOW_MS);
      if (fresh.length === 0) requestLog.delete(k);
      else requestLog.set(k, fresh);
    }
  }

  return { limited: false, retryAfterSeconds: 0 };
}
