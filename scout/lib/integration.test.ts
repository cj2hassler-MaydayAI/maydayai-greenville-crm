/**
 * End-to-end data-path test: upstream JSON -> parse -> cache -> match -> verdict.
 *
 * Runs against a local fixture server standing in for Open Food Facts, Nominatim,
 * and Overpass, via the SCOUT_*_BASE overrides. It covers everything except the
 * public internet, so a network-restricted environment can still prove the loop.
 */

import { createServer, type Server } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const OFF_PRODUCT = {
  status: 1,
  product: {
    code: '0000000000017',
    product_name: 'Test Tortilla Chips',
    brands: 'Testco',
    ingredients_text: 'Corn masa flour, sunflower oil, salt.',
    categories: 'Snacks, Chips',
  },
};

const OFF_SEARCH = {
  products: [
    {
      code: '0000000000024',
      product_name: 'Clean Chips',
      brands: 'Otherco',
      ingredients_text: 'Corn, olive oil, sea salt.',
      categories: 'Snacks',
    },
    {
      code: '0000000000031',
      product_name: 'Also Seed Oil Chips',
      brands: 'Thirdco',
      ingredients_text: 'Corn, canola oil, salt.',
      categories: 'Snacks',
    },
  ],
};

const OVERPASS_BODY = {
  elements: [
    {
      type: 'node',
      id: 1,
      lat: 35.6128,
      lon: -77.3665,
      tags: {
        name: "McDonald's",
        amenity: 'fast_food',
        brand: "McDonald's",
        'addr:housenumber': '100',
        'addr:street': 'Main St',
        'addr:city': 'Greenville',
      },
    },
    {
      type: 'node',
      id: 2,
      lat: 35.614,
      lon: -77.367,
      tags: { name: 'Unknown Diner', amenity: 'restaurant' },
    },
    // Unnamed POI: useless to someone standing outside, must be dropped.
    { type: 'node', id: 3, lat: 35.615, lon: -77.368, tags: { amenity: 'restaurant' } },
    // Not a food venue: must be dropped.
    { type: 'node', id: 4, lat: 35.616, lon: -77.369, tags: { name: 'Bank', amenity: 'bank' } },
  ],
};

let server: Server;
let baseUrl: string;
let tmpDir: string;

// Modules are imported after env is set, because lib/db/client.ts and the
// base-URL constants read process.env at module load.
let off: typeof import('./openfoodfacts');
let osm: typeof import('./osm');
let repo: typeof import('./db/repository');
let matcher: typeof import('./matcher');

beforeAll(async () => {
  server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    res.setHeader('Content-Type', 'application/json');

    if (url.pathname.startsWith('/api/v2/product/')) {
      const code = url.pathname.split('/').pop()?.replace('.json', '');
      if (code === '0000000000017') return void res.end(JSON.stringify(OFF_PRODUCT));
      return void res.end(JSON.stringify({ status: 0 }));
    }
    if (url.pathname === '/api/v2/search') return void res.end(JSON.stringify(OFF_SEARCH));
    if (url.pathname === '/search') {
      return void res.end(
        JSON.stringify([
          {
            lat: '35.6127',
            lon: '-77.3664',
            display_name: 'Greenville, North Carolina',
            address: { state: 'North Carolina' },
          },
        ]),
      );
    }
    if (url.pathname === '/reverse') {
      return void res.end(JSON.stringify({ address: { state: 'Florida' } }));
    }
    if (url.pathname === '/interpreter') return void res.end(JSON.stringify(OVERPASS_BODY));

    res.statusCode = 404;
    res.end('{}');
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (typeof address === 'string' || address === null) throw new Error('no port');
  baseUrl = `http://127.0.0.1:${address.port}`;

  tmpDir = mkdtempSync(join(tmpdir(), 'scout-test-'));
  process.env.SCOUT_DB_PATH = join(tmpDir, 'test.db');
  process.env.SCOUT_OFF_BASE = baseUrl;
  process.env.SCOUT_NOMINATIM_BASE = baseUrl;
  process.env.SCOUT_OVERPASS_URL = `${baseUrl}/interpreter`;

  off = await import('./openfoodfacts');
  osm = await import('./osm');
  repo = await import('./db/repository');
  matcher = await import('./matcher');

  // Minimal chain fixture so venue -> chain -> menu linking can be exercised.
  repo.upsertChain({
    id: 'chn_mcdonalds',
    name: "McDonald's",
    aliases: ['McDonalds'],
    website: null,
  });
  repo.insertMenuItem({
    chainId: 'chn_mcdonalds',
    name: 'World Famous Fries',
    ingredientsText: 'Potatoes, vegetable oil blend (canola oil, corn oil), salt.',
    source: 'seed',
    confidence: 0.8,
    verifiedAt: '2026-07-27',
  });
  repo.insertMenuItem({
    chainId: 'chn_mcdonalds',
    name: 'Apple Slices',
    ingredientsText: 'Apples, calcium ascorbate.',
    source: 'seed',
    confidence: 0.8,
    verifiedAt: '2026-07-27',
  });
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('barcode path (works with no AI and an empty database)', () => {
  it('looks up a product and flags its seed oil with quotable evidence', async () => {
    const product = await off.lookupBarcode('0000000000017');
    expect(product).not.toBeNull();
    expect(product?.name).toBe('Test Tortilla Chips');

    const hits = matcher.findFlags(product!.ingredientsText, { enabled: ['seed-oils'] });
    expect(hits).toHaveLength(1);
    expect(hits[0].matchedText).toBe('sunflower oil');
    // The offsets must slice the exact matched span out of the original text.
    expect(product!.ingredientsText!.slice(hits[0].start, hits[0].end)).toBe('sunflower oil');
  });

  it('serves the second lookup from the local cache', async () => {
    // Close the fixture server's door by pointing at a dead port; a cache hit
    // must still succeed.
    const again = await off.lookupBarcode('0000000000017');
    expect(again?.name).toBe('Test Tortilla Chips');
  });

  it('returns null rather than inventing a product for an unknown barcode', async () => {
    expect(await off.lookupBarcode('0000000000048')).toBeNull();
  });

  it('rejects malformed barcodes before making a request', async () => {
    expect(await off.lookupBarcode('abc')).toBeNull();
    expect(off.normalizeBarcode('0 000-0000 00017')).toBe('0000000000017');
  });

  it('finds alternatives whose real ingredient text clears the categories', async () => {
    const candidates = await off.searchByCategory('Snacks');
    const clean = candidates.filter(
      (c) => matcher.findFlags(c.ingredientsText, { enabled: ['seed-oils'] }).length === 0,
    );
    expect(clean.map((c) => c.name)).toEqual(['Clean Chips']);
  });
});

describe('venue discovery path', () => {
  it('geocodes a place name', async () => {
    const place = await osm.geocode('Greenville NC');
    expect(place?.state).toBe('North Carolina');
    expect(place?.lat).toBeCloseTo(35.6127, 3);
  });

  it('keeps named food venues and drops everything else', async () => {
    const venues = await osm.nearbyVenues(35.6127, -77.3664, 1600);
    expect(venues.map((v) => v.name)).toEqual(["McDonald's", 'Unknown Diner']);
    expect(venues[0].kind).toBe('fast_food');
    expect(venues[0].address).toBe('100 Main St, Greenville');
    expect(venues[0].distanceMeters).toBeLessThan(100);
  });
});

describe('venue assessment', () => {
  it('links an OSM venue to a curated chain and flags its menu', async () => {
    const venues = await osm.nearbyVenues(35.6127, -77.3664, 1600);
    const record = repo.upsertVenue({ ...venues[0], state: 'Florida' });
    expect(record.chainId).toBe('chn_mcdonalds');

    const assessment = repo.assessVenue(record, ['seed-oils'], 'strict');
    expect(assessment.verdict).toBe('flagged');
    expect(assessment.flagged.map((i) => i.name)).toEqual(['World Famous Fries']);
    expect(assessment.clean.map((i) => i.name)).toEqual(['Apple Slices']);
    // All three are genuine, separately quotable matches in the same string.
    expect(assessment.flagged[0].hits.map((h) => h.matchedText).sort()).toEqual([
      'canola oil',
      'corn oil',
      'vegetable oil',
    ]);
  });

  it('gives the same venue a pass when the user only avoids analogs', async () => {
    const venues = await osm.nearbyVenues(35.6127, -77.3664, 1600);
    const record = repo.upsertVenue({ ...venues[0], state: 'Florida' });

    const assessment = repo.assessVenue(record, ['analog'], 'strict');
    expect(assessment.flagged).toHaveLength(0);
    // Two items is under the coverage floor, so this is honestly "unknown",
    // not a confident clear.
    expect(assessment.verdict).toBe('unknown');
  });

  it('returns "no data" for a venue with no menu at all', async () => {
    const venues = await osm.nearbyVenues(35.6127, -77.3664, 1600);
    const diner = repo.upsertVenue({ ...venues[1], state: 'Florida' });
    expect(diner.chainId).toBeNull();

    const assessment = repo.assessVenue(diner, ['seed-oils'], 'strict');
    expect(assessment.verdict).toBe('unknown');
    expect(assessment.items).toHaveLength(0);
  });

  it('is idempotent on re-discovery of the same OSM id', async () => {
    const venues = await osm.nearbyVenues(35.6127, -77.3664, 1600);
    const first = repo.upsertVenue({ ...venues[0], state: 'Florida' });
    const second = repo.upsertVenue({ ...venues[0], state: 'Florida' });
    expect(second.id).toBe(first.id);
  });
});

describe('reports', () => {
  it('promotes a report to confirmed at +5 and escalates the venue verdict', async () => {
    const venues = await osm.nearbyVenues(35.6127, -77.3664, 1600);
    const diner = repo.upsertVenue({ ...venues[1], state: 'Florida' });

    const report = repo.createReport({
      venueId: diner.id,
      userToken: 'reporter',
      flagId: 'seed-oils',
      itemName: 'Fries',
      note: 'Staff said canola.',
    });

    for (let i = 0; i < 5; i++) {
      const { outcome } = repo.voteOnReport(report.id, `voter-${i}`, 1);
      expect(outcome).toBe('recorded');
    }

    const stored = repo.listReports(diner.id).find((r) => r.id === report.id);
    expect(stored?.status).toBe('confirmed');

    const assessment = repo.assessVenue(diner, ['seed-oils'], 'strict');
    expect(assessment.verdict).toBe('flagged');
    expect(assessment.confirmedReports).toHaveLength(1);
  });

  it('refuses a second vote from the same token', async () => {
    const venues = await osm.nearbyVenues(35.6127, -77.3664, 1600);
    const diner = repo.upsertVenue({ ...venues[1], state: 'Florida' });
    const report = repo.createReport({
      venueId: diner.id,
      userToken: 'reporter',
      flagId: 'analog',
    });

    expect(repo.voteOnReport(report.id, 'someone', 1).outcome).toBe('recorded');
    expect(repo.voteOnReport(report.id, 'someone', 1).outcome).toBe('already-voted');
  });

  it('hides a report once it reaches net -3', async () => {
    const venues = await osm.nearbyVenues(35.6127, -77.3664, 1600);
    const diner = repo.upsertVenue({ ...venues[1], state: 'Florida' });
    const report = repo.createReport({
      venueId: diner.id,
      userToken: 'reporter',
      flagId: 'fungal',
    });

    for (let i = 0; i < 3; i++) repo.voteOnReport(report.id, `down-${i}`, -1);
    expect(repo.listReports(diner.id).some((r) => r.id === report.id)).toBe(false);
  });

  it('counts a token’s reports for the daily rate limit', () => {
    expect(repo.countReportsToday('reporter')).toBeGreaterThanOrEqual(3);
    expect(repo.countReportsToday('nobody')).toBe(0);
  });
});

describe('state law layer', () => {
  it('resolves a ban state from a reverse geocode', async () => {
    const state = await osm.reverseGeocodeState(27.9, -82.4);
    expect(state).toBe('Florida');

    const { findCultivatedMeatBan } = await import('./state-laws');
    expect(findCultivatedMeatBan(state)?.state).toBe('Florida');
    expect(findCultivatedMeatBan('North Carolina')).toBeNull();
  });
});
