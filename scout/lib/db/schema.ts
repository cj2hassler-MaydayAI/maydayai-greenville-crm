/**
 * Schema is written to survive a move to Postgres: no SQLite-only column types,
 * arrays stored as JSON text, timestamps as ISO strings, ids as text.
 * See lib/db/client.ts for the single swap point.
 */

import { index, integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const venues = sqliteTable(
  'venues',
  {
    id: text('id').primaryKey(),
    osmId: text('osm_id'),
    name: text('name').notNull(),
    kind: text('kind', { enum: ['restaurant', 'fast_food', 'grocery'] }).notNull(),
    lat: real('lat').notNull(),
    lng: real('lng').notNull(),
    address: text('address'),
    chainId: text('chain_id'),
    state: text('state'),
    lastAnalyzedAt: text('last_analyzed_at'),
  },
  (t) => ({
    osmIdx: uniqueIndex('venues_osm_id_idx').on(t.osmId),
    geoIdx: index('venues_geo_idx').on(t.lat, t.lng),
  }),
);

export const chains = sqliteTable('chains', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  aliases: text('aliases', { mode: 'json' }).$type<string[]>().notNull().default([]),
  website: text('website'),
});

export const menuItems = sqliteTable(
  'menu_items',
  {
    id: text('id').primaryKey(),
    venueId: text('venue_id'),
    chainId: text('chain_id'),
    name: text('name').notNull(),
    description: text('description'),
    ingredientsText: text('ingredients_text'),
    source: text('source', { enum: ['seed', 'ai', 'user'] }).notNull(),
    confidence: real('confidence').notNull().default(0.5),
    sourceNote: text('source_note'),
    verifiedAt: text('verified_at'),
    analyzedAt: text('analyzed_at'),
  },
  (t) => ({
    venueIdx: index('menu_items_venue_idx').on(t.venueId),
    chainIdx: index('menu_items_chain_idx').on(t.chainId),
  }),
);

export const flagHits = sqliteTable(
  'flag_hits',
  {
    id: text('id').primaryKey(),
    menuItemId: text('menu_item_id').notNull(),
    flagId: text('flag_id').notNull(),
    matchedText: text('matched_text').notNull(),
    severity: text('severity').notNull(),
  },
  (t) => ({
    itemIdx: index('flag_hits_item_idx').on(t.menuItemId),
  }),
);

export const reports = sqliteTable(
  'reports',
  {
    id: text('id').primaryKey(),
    venueId: text('venue_id').notNull(),
    userToken: text('user_token').notNull(),
    flagId: text('flag_id').notNull(),
    itemName: text('item_name'),
    note: text('note'),
    createdAt: text('created_at').notNull(),
    upvotes: integer('upvotes').notNull().default(0),
    downvotes: integer('downvotes').notNull().default(0),
    status: text('status', { enum: ['pending', 'confirmed', 'disputed'] })
      .notNull()
      .default('pending'),
  },
  (t) => ({
    venueIdx: index('reports_venue_idx').on(t.venueId),
    tokenIdx: index('reports_token_idx').on(t.userToken, t.createdAt),
  }),
);

export const reportVotes = sqliteTable(
  'report_votes',
  {
    id: text('id').primaryKey(),
    reportId: text('report_id').notNull(),
    userToken: text('user_token').notNull(),
    value: integer('value').notNull(), // +1 / -1
    createdAt: text('created_at').notNull(),
  },
  (t) => ({
    oneVotePerUser: uniqueIndex('report_votes_unique_idx').on(t.reportId, t.userToken),
  }),
);

export const products = sqliteTable('products', {
  barcode: text('barcode').primaryKey(),
  name: text('name'),
  brand: text('brand'),
  ingredientsText: text('ingredients_text'),
  categories: text('categories'),
  imageUrl: text('image_url'),
  cachedAt: text('cached_at').notNull(),
});

export const userPrefs = sqliteTable('user_prefs', {
  userToken: text('user_token').primaryKey(),
  enabledCategories: text('enabled_categories', { mode: 'json' })
    .$type<string[]>()
    .notNull()
    .default([]),
  strictness: text('strictness', { enum: ['strict', 'relaxed'] })
    .notNull()
    .default('strict'),
  updatedAt: text('updated_at').notNull(),
});

/** Raw HTTP response cache for Nominatim / Overpass. 30-day TTL, enforced on read. */
export const httpCache = sqliteTable('http_cache', {
  key: text('key').primaryKey(),
  body: text('body').notNull(),
  fetchedAt: text('fetched_at').notNull(),
});

/** Claude substitution-engine results, keyed on (venue, categories, menu hash). */
export const analyses = sqliteTable('analyses', {
  key: text('key').primaryKey(),
  venueId: text('venue_id').notNull(),
  categories: text('categories').notNull(),
  menuHash: text('menu_hash').notNull(),
  result: text('result', { mode: 'json' }).$type<unknown>().notNull(),
  createdAt: text('created_at').notNull(),
});
