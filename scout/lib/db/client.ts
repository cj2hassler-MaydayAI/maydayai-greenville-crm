/**
 * THE SWAP POINT.
 *
 * Everything above this file talks to `db` (a Drizzle instance) and nothing else.
 * To move to Postgres / Turso for a serverless deploy, replace the body of this
 * file with the corresponding Drizzle driver and delete the DDL bootstrap below
 * in favour of `drizzle-kit` migrations:
 *
 *   import { drizzle } from 'drizzle-orm/postgres-js';
 *   import postgres from 'postgres';
 *   export const db = drizzle(postgres(process.env.DATABASE_URL!), { schema });
 *
 * No other file imports better-sqlite3.
 */

import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema';

const DB_PATH = process.env.SCOUT_DB_PATH ?? './scout.db';

// Next dev-mode hot reload would otherwise open a new handle on every request.
const globalForDb = globalThis as unknown as { __scoutSqlite?: Database.Database };

function open(): Database.Database {
  const sqlite = new Database(DB_PATH);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  bootstrap(sqlite);
  return sqlite;
}

/**
 * Creates tables if they do not exist. Keeps `npm run dev` working from a clean
 * checkout without a migration step; `drizzle-kit push` remains available and is
 * what you would use against Postgres.
 */
function bootstrap(sqlite: Database.Database): void {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS venues (
      id TEXT PRIMARY KEY, osm_id TEXT, name TEXT NOT NULL, kind TEXT NOT NULL,
      lat REAL NOT NULL, lng REAL NOT NULL, address TEXT, chain_id TEXT,
      state TEXT, last_analyzed_at TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS venues_osm_id_idx ON venues(osm_id);
    CREATE INDEX IF NOT EXISTS venues_geo_idx ON venues(lat, lng);

    CREATE TABLE IF NOT EXISTS chains (
      id TEXT PRIMARY KEY, name TEXT NOT NULL,
      aliases TEXT NOT NULL DEFAULT '[]', website TEXT
    );

    CREATE TABLE IF NOT EXISTS menu_items (
      id TEXT PRIMARY KEY, venue_id TEXT, chain_id TEXT, name TEXT NOT NULL,
      description TEXT, ingredients_text TEXT, source TEXT NOT NULL,
      confidence REAL NOT NULL DEFAULT 0.5, source_note TEXT,
      verified_at TEXT, analyzed_at TEXT
    );
    CREATE INDEX IF NOT EXISTS menu_items_venue_idx ON menu_items(venue_id);
    CREATE INDEX IF NOT EXISTS menu_items_chain_idx ON menu_items(chain_id);

    CREATE TABLE IF NOT EXISTS flag_hits (
      id TEXT PRIMARY KEY, menu_item_id TEXT NOT NULL, flag_id TEXT NOT NULL,
      matched_text TEXT NOT NULL, severity TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS flag_hits_item_idx ON flag_hits(menu_item_id);

    CREATE TABLE IF NOT EXISTS reports (
      id TEXT PRIMARY KEY, venue_id TEXT NOT NULL, user_token TEXT NOT NULL,
      flag_id TEXT NOT NULL, item_name TEXT, note TEXT, created_at TEXT NOT NULL,
      upvotes INTEGER NOT NULL DEFAULT 0, downvotes INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending'
    );
    CREATE INDEX IF NOT EXISTS reports_venue_idx ON reports(venue_id);
    CREATE INDEX IF NOT EXISTS reports_token_idx ON reports(user_token, created_at);

    CREATE TABLE IF NOT EXISTS report_votes (
      id TEXT PRIMARY KEY, report_id TEXT NOT NULL, user_token TEXT NOT NULL,
      value INTEGER NOT NULL, created_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS report_votes_unique_idx
      ON report_votes(report_id, user_token);

    CREATE TABLE IF NOT EXISTS products (
      barcode TEXT PRIMARY KEY, name TEXT, brand TEXT, ingredients_text TEXT,
      categories TEXT, image_url TEXT, cached_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS user_prefs (
      user_token TEXT PRIMARY KEY,
      enabled_categories TEXT NOT NULL DEFAULT '[]',
      strictness TEXT NOT NULL DEFAULT 'strict',
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS http_cache (
      key TEXT PRIMARY KEY, body TEXT NOT NULL, fetched_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS analyses (
      key TEXT PRIMARY KEY, venue_id TEXT NOT NULL, categories TEXT NOT NULL,
      menu_hash TEXT NOT NULL, result TEXT NOT NULL, created_at TEXT NOT NULL
    );
  `);
}

const sqlite = globalForDb.__scoutSqlite ?? open();
if (process.env.NODE_ENV !== 'production') globalForDb.__scoutSqlite = sqlite;

export const db = drizzle(sqlite, { schema });
export type Db = typeof db;
