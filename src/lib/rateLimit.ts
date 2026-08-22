/**
 * Two-tier rate limiting for /api/agent and /api/agent/followup.
 *
 * Tier 1 — per-caller sliding window, keyed by IP. Stops one visitor from
 * scripting requests.
 * Tier 2 — global daily ceiling, shared across all callers. Both endpoints
 * hit the same Groq key; that key has a shared rate limit across every
 * visitor to the site. One abusive caller working around Tier 1 (rotating
 * IPs, etc.) can still exhaust that shared quota and degrade the service
 * for everyone else. This ceiling exists to protect availability for
 * legitimate users, not to cap spend — the model itself is free to run.
 *
 * Backed by Upstash Redis when UPSTASH_REDIS_REST_URL /
 * UPSTASH_REDIS_REST_TOKEN are set (durable, shared across serverless
 * instances). Falls back to an in-memory limiter otherwise — a soft speed
 * bump that resets on cold start, fine for local dev or before Upstash is
 * configured, not a hard guarantee in production.
 */

import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

const WINDOW_SECONDS = 60;
const MAX_REQUESTS_PER_CALLER = 10;

// Generous enough that real traffic never hits it; low enough to bound
// worst-case abuse against the shared Groq quota in a single day.
const GLOBAL_DAILY_LIMIT = 2000;

const redis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? new Redis({
        url: process.env.UPSTASH_REDIS_REST_URL,
        token: process.env.UPSTASH_REDIS_REST_TOKEN,
      })
    : null;

const callerLimiter = redis
  ? new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(MAX_REQUESTS_PER_CALLER, `${WINDOW_SECONDS} s`),
      prefix: "ratelimit:caller",
      analytics: false,
    })
  : null;

const globalDailyLimiter = redis
  ? new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(GLOBAL_DAILY_LIMIT, "1 d"),
      prefix: "ratelimit:global-daily",
      analytics: false,
    })
  : null;

// --- In-memory fallback (used only when Upstash isn't configured) ---

const WINDOW_MS = WINDOW_SECONDS * 1_000;
const SWEEP_INTERVAL = 200;

const requestLog = new Map<string, number[]>();
let callsSinceSweep = 0;

function checkCallerLimitInMemory(key: string): { limited: boolean; retryAfterSeconds: number } {
  const now = Date.now();
  const timestamps = (requestLog.get(key) ?? []).filter((t) => now - t < WINDOW_MS);

  if (timestamps.length >= MAX_REQUESTS_PER_CALLER) {
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

let globalDailyCount = 0;
let globalDailyResetAt = 0;

function checkGlobalDailyLimitInMemory(): { limited: boolean; retryAfterSeconds: number } {
  const now = Date.now();
  if (now >= globalDailyResetAt) {
    globalDailyCount = 0;
    globalDailyResetAt = now + 24 * 60 * 60 * 1000;
  }
  if (globalDailyCount >= GLOBAL_DAILY_LIMIT) {
    return { limited: true, retryAfterSeconds: Math.ceil((globalDailyResetAt - now) / 1000) };
  }
  globalDailyCount += 1;
  return { limited: false, retryAfterSeconds: 0 };
}

export async function checkRateLimit(key: string): Promise<{ limited: boolean; retryAfterSeconds: number }> {
  if (callerLimiter && globalDailyLimiter) {
    const caller = await callerLimiter.limit(key);
    if (!caller.success) {
      return {
        limited: true,
        retryAfterSeconds: Math.max(1, Math.ceil((caller.reset - Date.now()) / 1000)),
      };
    }

    const global = await globalDailyLimiter.limit("global");
    if (!global.success) {
      return {
        limited: true,
        retryAfterSeconds: Math.max(1, Math.ceil((global.reset - Date.now()) / 1000)),
      };
    }
    return { limited: false, retryAfterSeconds: 0 };
  }

  const caller = checkCallerLimitInMemory(key);
  if (caller.limited) return caller;
  return checkGlobalDailyLimitInMemory();
}
