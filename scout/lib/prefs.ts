/**
 * Anonymous identity + preferences. No accounts, no email, no auth in v1 —
 * just an opaque token in a cookie.
 */

import { cookies } from 'next/headers';
import { eq } from 'drizzle-orm';
import { db } from './db/client';
import { userPrefs } from './db/schema';
import { DEFAULT_ENABLED, parseFlagIds, type FlagId, type Strictness } from './flags';

export const TOKEN_COOKIE = 'scout_token';
const ONE_YEAR = 60 * 60 * 24 * 365;

export interface Prefs {
  userToken: string;
  enabledCategories: FlagId[];
  strictness: Strictness;
}

function newToken(): string {
  return crypto.randomUUID().replace(/-/g, '');
}

/** Reads the token from the request; returns null if the user has none yet. */
export async function readToken(): Promise<string | null> {
  const store = await cookies();
  return store.get(TOKEN_COOKIE)?.value ?? null;
}

/**
 * Reads the token, minting one if needed. Only callable from a Route Handler or
 * Server Action — Server Components cannot set cookies.
 */
export async function ensureToken(): Promise<string> {
  const store = await cookies();
  const existing = store.get(TOKEN_COOKIE)?.value;
  if (existing) return existing;

  const token = newToken();
  store.set(TOKEN_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: ONE_YEAR,
    secure: process.env.NODE_ENV === 'production',
  });
  return token;
}

export function defaultPrefs(userToken: string): Prefs {
  return { userToken, enabledCategories: [...DEFAULT_ENABLED], strictness: 'strict' };
}

export function loadPrefs(userToken: string): Prefs {
  const row = db.select().from(userPrefs).where(eq(userPrefs.userToken, userToken)).get();
  if (!row) return defaultPrefs(userToken);
  return {
    userToken,
    enabledCategories: parseFlagIds(row.enabledCategories),
    strictness: row.strictness,
  };
}

export function savePrefs(prefs: Prefs): Prefs {
  const now = new Date().toISOString();
  db.insert(userPrefs)
    .values({
      userToken: prefs.userToken,
      enabledCategories: prefs.enabledCategories,
      strictness: prefs.strictness,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: userPrefs.userToken,
      set: {
        enabledCategories: prefs.enabledCategories,
        strictness: prefs.strictness,
        updatedAt: now,
      },
    })
    .run();
  return prefs;
}

/** For Server Components: read-only, falls back to defaults for a first-time visitor. */
export async function currentPrefs(): Promise<Prefs> {
  const token = await readToken();
  if (!token) return defaultPrefs('anonymous');
  return loadPrefs(token);
}
