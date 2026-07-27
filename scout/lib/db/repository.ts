/**
 * Every query the app makes lives here. Nothing outside lib/db imports Drizzle
 * tables directly, so moving to another store means rewriting this file plus
 * client.ts and nothing else.
 */

import { and, desc, eq, gte, inArray, or, sql } from 'drizzle-orm';
import { db } from './client';
import { analyses, chains, flagHits, menuItems, reports, reportVotes, venues } from './schema';
import type { FlagId, Strictness } from '../flags';
import { computeVerdict, findFlags, type FlagHit, type Verdict } from '../matcher';

export type VenueKind = 'restaurant' | 'fast_food' | 'grocery';

export interface VenueRecord {
  id: string;
  osmId: string | null;
  name: string;
  kind: VenueKind;
  lat: number;
  lng: number;
  address: string | null;
  chainId: string | null;
  state: string | null;
}

export interface MenuItemRecord {
  id: string;
  name: string;
  description: string | null;
  ingredientsText: string | null;
  source: 'seed' | 'ai' | 'user';
  confidence: number;
  sourceNote: string | null;
  verifiedAt: string | null;
}

export interface ScoredMenuItem extends MenuItemRecord {
  hits: FlagHit[];
}

export interface VenueAssessment {
  venue: VenueRecord;
  chainName: string | null;
  items: ScoredMenuItem[];
  clean: ScoredMenuItem[];
  flagged: ScoredMenuItem[];
  verdict: Verdict;
  confirmedReports: ReportRecord[];
}

export interface ReportRecord {
  id: string;
  venueId: string;
  flagId: string;
  itemName: string | null;
  note: string | null;
  createdAt: string;
  upvotes: number;
  downvotes: number;
  status: 'pending' | 'confirmed' | 'disputed';
  score: number;
}

function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`;
}

// ---------------------------------------------------------------------------
// Venues
// ---------------------------------------------------------------------------

export function getVenue(id: string): VenueRecord | null {
  return (db.select().from(venues).where(eq(venues.id, id)).get() as VenueRecord) ?? null;
}

export function getVenueByOsmId(osmId: string): VenueRecord | null {
  return (db.select().from(venues).where(eq(venues.osmId, osmId)).get() as VenueRecord) ?? null;
}

export interface UpsertVenueInput {
  osmId: string;
  name: string;
  kind: VenueKind;
  lat: number;
  lng: number;
  address: string | null;
  brand?: string | null;
  state?: string | null;
}

/** Inserts a discovered venue, linking it to a known chain by name/alias/brand. */
export function upsertVenue(input: UpsertVenueInput): VenueRecord {
  const existing = getVenueByOsmId(input.osmId);
  const chainId = matchChain(input.brand ?? input.name)?.id ?? null;

  if (existing) {
    if (existing.chainId !== chainId || existing.state !== (input.state ?? existing.state)) {
      db.update(venues)
        .set({ chainId, state: input.state ?? existing.state })
        .where(eq(venues.id, existing.id))
        .run();
      return { ...existing, chainId, state: input.state ?? existing.state };
    }
    return existing;
  }

  const record: VenueRecord = {
    id: newId('ven'),
    osmId: input.osmId,
    name: input.name,
    kind: input.kind,
    lat: input.lat,
    lng: input.lng,
    address: input.address,
    chainId,
    state: input.state ?? null,
  };
  db.insert(venues).values(record).run();
  return record;
}

// ---------------------------------------------------------------------------
// Chains
// ---------------------------------------------------------------------------

let chainCache: Array<{ id: string; name: string; aliases: string[] }> | null = null;

function allChains(): Array<{ id: string; name: string; aliases: string[] }> {
  if (!chainCache) {
    chainCache = db
      .select({ id: chains.id, name: chains.name, aliases: chains.aliases })
      .from(chains)
      .all()
      .map((row) => ({ ...row, aliases: Array.isArray(row.aliases) ? row.aliases : [] }));
  }
  return chainCache;
}

export function invalidateChainCache(): void {
  chainCache = null;
}

function canonical(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Matches an OSM venue name or brand tag against the curated chain list. */
export function matchChain(name: string | null | undefined): { id: string; name: string } | null {
  if (!name) return null;
  const needle = canonical(name);
  if (!needle) return null;

  for (const chain of allChains()) {
    const candidates = [chain.name, ...chain.aliases].map(canonical).filter(Boolean);
    if (candidates.some((c) => c === needle || needle.startsWith(c) || c.startsWith(needle))) {
      return { id: chain.id, name: chain.name };
    }
  }
  return null;
}

export function getChain(id: string): { id: string; name: string; website: string | null } | null {
  const row = db.select().from(chains).where(eq(chains.id, id)).get();
  return row ? { id: row.id, name: row.name, website: row.website } : null;
}

export function upsertChain(input: {
  id: string;
  name: string;
  aliases: string[];
  website: string | null;
}): void {
  db.insert(chains)
    .values(input)
    .onConflictDoUpdate({
      target: chains.id,
      set: { name: input.name, aliases: input.aliases, website: input.website },
    })
    .run();
  invalidateChainCache();
}

// ---------------------------------------------------------------------------
// Menu items
// ---------------------------------------------------------------------------

export function menuForVenue(venue: VenueRecord): MenuItemRecord[] {
  // Items attached to this specific location, plus anything curated for its chain.
  const where = venue.chainId
    ? or(eq(menuItems.venueId, venue.id), eq(menuItems.chainId, venue.chainId))
    : eq(menuItems.venueId, venue.id);

  const rows = db.select().from(menuItems).where(where).all();

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    ingredientsText: row.ingredientsText,
    source: row.source,
    confidence: row.confidence,
    sourceNote: row.sourceNote,
    verifiedAt: row.verifiedAt,
  }));
}

export function insertMenuItem(input: {
  venueId?: string | null;
  chainId?: string | null;
  name: string;
  description?: string | null;
  ingredientsText?: string | null;
  source: 'seed' | 'ai' | 'user';
  confidence: number;
  sourceNote?: string | null;
  verifiedAt?: string | null;
}): string {
  const id = newId('itm');
  db.insert(menuItems)
    .values({
      id,
      venueId: input.venueId ?? null,
      chainId: input.chainId ?? null,
      name: input.name,
      description: input.description ?? null,
      ingredientsText: input.ingredientsText ?? null,
      source: input.source,
      confidence: input.confidence,
      sourceNote: input.sourceNote ?? null,
      verifiedAt: input.verifiedAt ?? null,
      analyzedAt: new Date().toISOString(),
    })
    .run();
  return id;
}

/** Persists computed hits so the UI can render evidence without re-matching. */
export function replaceFlagHits(menuItemId: string, hits: FlagHit[]): void {
  db.delete(flagHits).where(eq(flagHits.menuItemId, menuItemId)).run();
  if (hits.length === 0) return;
  db.insert(flagHits)
    .values(
      hits.map((hit) => ({
        id: newId('hit'),
        menuItemId,
        flagId: hit.flagId,
        matchedText: hit.matchedText,
        severity: hit.severity,
      })),
    )
    .run();
}

// ---------------------------------------------------------------------------
// Assessment
// ---------------------------------------------------------------------------

/**
 * Scores a venue against exactly the categories this user enabled. Matching is
 * done live rather than read from flag_hits so that toggling a category in
 * settings takes effect immediately.
 */
export function assessVenue(
  venue: VenueRecord,
  enabled: FlagId[],
  strictness: Strictness,
): VenueAssessment {
  const items = menuForVenue(venue);

  const scored: ScoredMenuItem[] = items.map((item) => ({
    ...item,
    hits: findFlags([item.ingredientsText, item.description].filter(Boolean).join(' — '), {
      enabled,
      strictness,
    }),
  }));

  const flagged = scored.filter((i) => i.hits.length > 0);
  const clean = scored.filter((i) => i.hits.length === 0);
  const withIngredients = scored.filter((i) => (i.ingredientsText ?? '').trim().length > 0);

  const confirmedReports = listReports(venue.id).filter(
    (r) => r.status === 'confirmed' && enabled.includes(r.flagId as FlagId),
  );

  const verdict = computeVerdict({
    analyzedCount: scored.length,
    withIngredients: withIngredients.length,
    minConfidence:
      withIngredients.length > 0 ? Math.min(...withIngredients.map((i) => i.confidence)) : 0,
    hits: flagged.flatMap((i) => i.hits),
  });

  // A confirmed community report escalates an otherwise unknown venue.
  const finalVerdict: Verdict =
    verdict !== 'flagged' && confirmedReports.length > 0 ? 'flagged' : verdict;

  return {
    venue,
    chainName: venue.chainId ? (getChain(venue.chainId)?.name ?? null) : null,
    items: scored,
    clean,
    flagged,
    verdict: finalVerdict,
    confirmedReports,
  };
}

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

const HIDE_AT = -3;
const CONFIRM_AT = 5;
export const MAX_REPORTS_PER_DAY = 10;

export function listReports(venueId: string): ReportRecord[] {
  return db
    .select()
    .from(reports)
    .where(eq(reports.venueId, venueId))
    .orderBy(desc(reports.createdAt))
    .all()
    .map((row) => ({
      id: row.id,
      venueId: row.venueId,
      flagId: row.flagId,
      itemName: row.itemName,
      note: row.note,
      createdAt: row.createdAt,
      upvotes: row.upvotes,
      downvotes: row.downvotes,
      status: row.status,
      score: row.upvotes - row.downvotes,
    }))
    .filter((r) => r.score > HIDE_AT);
}

export function countReportsToday(userToken: string): number {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const row = db
    .select({ n: sql<number>`count(*)` })
    .from(reports)
    .where(and(eq(reports.userToken, userToken), gte(reports.createdAt, since)))
    .get();
  return row?.n ?? 0;
}

export function createReport(input: {
  venueId: string;
  userToken: string;
  flagId: string;
  itemName?: string | null;
  note?: string | null;
}): ReportRecord {
  const record = {
    id: newId('rep'),
    venueId: input.venueId,
    userToken: input.userToken,
    flagId: input.flagId,
    itemName: input.itemName ?? null,
    note: input.note ?? null,
    createdAt: new Date().toISOString(),
    upvotes: 0,
    downvotes: 0,
    status: 'pending' as const,
  };
  db.insert(reports).values(record).run();
  return { ...record, score: 0 };
}

export type VoteOutcome = 'recorded' | 'already-voted' | 'not-found';

export function voteOnReport(
  reportId: string,
  userToken: string,
  value: 1 | -1,
): { outcome: VoteOutcome; report?: ReportRecord } {
  const existing = db.select().from(reports).where(eq(reports.id, reportId)).get();
  if (!existing) return { outcome: 'not-found' };

  const priorVote = db
    .select()
    .from(reportVotes)
    .where(and(eq(reportVotes.reportId, reportId), eq(reportVotes.userToken, userToken)))
    .get();
  if (priorVote) return { outcome: 'already-voted' };

  db.insert(reportVotes)
    .values({
      id: newId('vot'),
      reportId,
      userToken,
      value,
      createdAt: new Date().toISOString(),
    })
    .run();

  const upvotes = existing.upvotes + (value === 1 ? 1 : 0);
  const downvotes = existing.downvotes + (value === -1 ? 1 : 0);
  const score = upvotes - downvotes;
  const status: 'pending' | 'confirmed' | 'disputed' =
    score >= CONFIRM_AT ? 'confirmed' : score <= HIDE_AT ? 'disputed' : 'pending';

  db.update(reports).set({ upvotes, downvotes, status }).where(eq(reports.id, reportId)).run();

  return {
    outcome: 'recorded',
    report: {
      id: existing.id,
      venueId: existing.venueId,
      flagId: existing.flagId,
      itemName: existing.itemName,
      note: existing.note,
      createdAt: existing.createdAt,
      upvotes,
      downvotes,
      status,
      score,
    },
  };
}

export function listReportsForModeration(limit = 50): ReportRecord[] {
  return db
    .select()
    .from(reports)
    .where(inArray(reports.status, ['pending', 'disputed']))
    .orderBy(desc(reports.createdAt))
    .limit(limit)
    .all()
    .map((row) => ({
      id: row.id,
      venueId: row.venueId,
      flagId: row.flagId,
      itemName: row.itemName,
      note: row.note,
      createdAt: row.createdAt,
      upvotes: row.upvotes,
      downvotes: row.downvotes,
      status: row.status,
      score: row.upvotes - row.downvotes,
    }));
}

// ---------------------------------------------------------------------------
// Analysis cache
// ---------------------------------------------------------------------------

export function readAnalysis<T>(key: string): T | null {
  const row = db.select().from(analyses).where(eq(analyses.key, key)).get();
  return row ? (row.result as T) : null;
}

export function writeAnalysis(input: {
  key: string;
  venueId: string;
  categories: string;
  menuHash: string;
  result: unknown;
}): void {
  db.insert(analyses)
    .values({ ...input, createdAt: new Date().toISOString() })
    .onConflictDoUpdate({
      target: analyses.key,
      set: { result: input.result, createdAt: new Date().toISOString() },
    })
    .run();
}
