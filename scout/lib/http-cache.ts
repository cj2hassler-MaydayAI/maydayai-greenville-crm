/**
 * Server-side rate limiting + response caching for the free OSM endpoints.
 *
 * Nominatim and Overpass are volunteer-run. Their usage policies require a
 * descriptive User-Agent and roughly one request per second. Both rules are
 * enforced here, and this module is the only thing in the app allowed to call
 * them — nothing hits these hosts from the browser.
 */

import { eq } from 'drizzle-orm';
import { db } from './db/client';
import { httpCache } from './db/schema';

const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const MIN_INTERVAL_MS = 1100;

export const USER_AGENT =
  process.env.SCOUT_USER_AGENT ??
  'Scout/0.1 (ingredient transparency app; https://github.com/cj2hassler-maydayai/maydayai-greenville-crm)';

/** One serialized queue per host: no more than one in-flight request each. */
const hostQueues = new Map<string, Promise<unknown>>();
const lastCallAt = new Map<string, number>();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Serializes calls to `host` and spaces them at least MIN_INTERVAL_MS apart.
 * Every caller awaits its own turn in the chain.
 */
async function withHostThrottle<T>(host: string, fn: () => Promise<T>): Promise<T> {
  const previous = hostQueues.get(host) ?? Promise.resolve();

  const run = previous.then(async () => {
    const last = lastCallAt.get(host) ?? 0;
    const wait = MIN_INTERVAL_MS - (Date.now() - last);
    if (wait > 0) await sleep(wait);
    try {
      return await fn();
    } finally {
      lastCallAt.set(host, Date.now());
    }
  });

  // Keep the chain alive even if this call rejects.
  hostQueues.set(
    host,
    run.then(
      () => undefined,
      () => undefined,
    ),
  );
  return run as Promise<T>;
}

function readCache(key: string): string | null {
  const row = db.select().from(httpCache).where(eq(httpCache.key, key)).get();
  if (!row) return null;
  if (Date.now() - new Date(row.fetchedAt).getTime() > CACHE_TTL_MS) return null;
  return row.body;
}

function writeCache(key: string, body: string): void {
  db.insert(httpCache)
    .values({ key, body, fetchedAt: new Date().toISOString() })
    .onConflictDoUpdate({
      target: httpCache.key,
      set: { body, fetchedAt: new Date().toISOString() },
    })
    .run();
}

export interface CachedFetchOptions {
  /** Cache key. Defaults to the URL; POST callers must supply one. */
  key?: string;
  method?: 'GET' | 'POST';
  body?: string;
  headers?: Record<string, string>;
  /** Skip the throttle for hosts without a published rate limit. */
  throttle?: boolean;
}

/**
 * Fetches a URL through the 30-day cache. Cache hits do not consume a rate-limit
 * slot, so a warm database means near-zero traffic to the upstream services.
 */
export async function cachedFetch(
  url: string,
  options: CachedFetchOptions = {},
): Promise<string> {
  const { method = 'GET', body, headers = {}, throttle = true } = options;
  const key = options.key ?? `${method} ${url}`;

  const hit = readCache(key);
  if (hit !== null) return hit;

  const host = new URL(url).host;

  const doFetch = async (): Promise<string> => {
    const res = await fetch(url, {
      method,
      body,
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'application/json',
        ...headers,
      },
      // We do our own persistent caching; don't let the platform layer another on top.
      cache: 'no-store',
    });

    if (!res.ok) {
      throw new UpstreamError(`${host} responded ${res.status}`, res.status);
    }
    return res.text();
  };

  const text = throttle ? await withHostThrottle(host, doFetch) : await doFetch();
  writeCache(key, text);
  return text;
}

export class UpstreamError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'UpstreamError';
  }
}

export async function cachedFetchJson<T>(url: string, options: CachedFetchOptions = {}): Promise<T> {
  return JSON.parse(await cachedFetch(url, options)) as T;
}
