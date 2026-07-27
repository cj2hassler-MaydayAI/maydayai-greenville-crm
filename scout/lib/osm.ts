/**
 * Venue discovery via OpenStreetMap: Nominatim for geocoding, Overpass for
 * nearby POIs. Both go through lib/http-cache.ts, which enforces the descriptive
 * User-Agent and the ~1 req/sec ceiling their usage policies require.
 *
 * Attribution requirement: any UI that shows this data must credit
 * "© OpenStreetMap contributors".
 */

import { cachedFetch, cachedFetchJson, UpstreamError } from './http-cache';

// Overridable: OSM asks heavy users to run their own Nominatim/Overpass rather
// than lean on the public instances. Also lets tests point at a fixture server.
const NOMINATIM = process.env.SCOUT_NOMINATIM_BASE ?? 'https://nominatim.openstreetmap.org';
const OVERPASS = process.env.SCOUT_OVERPASS_URL ?? 'https://overpass-api.de/api/interpreter';

export type VenueKind = 'restaurant' | 'fast_food' | 'grocery';

export interface OsmVenue {
  osmId: string;
  name: string;
  kind: VenueKind;
  lat: number;
  lng: number;
  address: string | null;
  brand: string | null;
  distanceMeters: number;
}

export interface GeocodeResult {
  displayName: string;
  lat: number;
  lng: number;
  state: string | null;
}

interface NominatimPlace {
  lat: string;
  lon: string;
  display_name: string;
  address?: Record<string, string>;
}

interface OverpassElement {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

interface OverpassResponse {
  elements?: OverpassElement[];
}

export async function geocode(query: string): Promise<GeocodeResult | null> {
  const trimmed = query.trim();
  if (!trimmed) return null;

  const url =
    `${NOMINATIM}/search?q=${encodeURIComponent(trimmed)}` +
    `&format=json&limit=1&addressdetails=1&countrycodes=us`;

  // A failed request propagates: "we could not reach Nominatim" and "that place
  // does not exist" are different answers and must not collapse into one.
  const places = await cachedFetchJson<NominatimPlace[]>(url);
  const place = places[0];
  if (!place) return null;
  return {
    displayName: place.display_name,
    lat: Number(place.lat),
    lng: Number(place.lon),
    state: place.address?.state ?? null,
  };
}

/**
 * Reverse geocode, used to resolve which state a user's location falls in.
 * Best-effort by design: this only drives the state-law banner, so a Nominatim
 * hiccup degrades to "no banner" rather than failing the whole nearby lookup.
 */
export async function reverseGeocodeState(lat: number, lng: number): Promise<string | null> {
  const url =
    `${NOMINATIM}/reverse?lat=${lat.toFixed(4)}&lon=${lng.toFixed(4)}` +
    `&format=json&zoom=8&addressdetails=1`;
  try {
    const place = await cachedFetchJson<NominatimPlace>(url);
    return place.address?.state ?? null;
  } catch {
    return null;
  }
}

function classify(tags: Record<string, string>): VenueKind | null {
  const amenity = tags.amenity;
  const shop = tags.shop;
  if (amenity === 'fast_food') return 'fast_food';
  if (amenity === 'restaurant' || amenity === 'cafe') return 'restaurant';
  if (shop === 'supermarket' || shop === 'convenience' || shop === 'greengrocer') return 'grocery';
  return null;
}

function formatAddress(tags: Record<string, string>): string | null {
  const parts = [
    [tags['addr:housenumber'], tags['addr:street']].filter(Boolean).join(' '),
    tags['addr:city'],
    tags['addr:state'],
  ].filter((part) => part && part.length > 0);
  return parts.length > 0 ? parts.join(', ') : null;
}

export function haversineMeters(
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number,
): number {
  const R = 6_371_000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/**
 * Rounds coordinates to ~1km so nearby users share cache entries instead of each
 * minting a fresh Overpass query.
 */
function cacheKeyFor(lat: number, lng: number, radius: number): string {
  return `overpass:${lat.toFixed(2)}:${lng.toFixed(2)}:${radius}`;
}

export async function nearbyVenues(
  lat: number,
  lng: number,
  radiusMeters = 1600,
): Promise<OsmVenue[]> {
  const radius = Math.min(Math.max(Math.round(radiusMeters), 200), 5000);
  const around = `${radius},${lat.toFixed(4)},${lng.toFixed(4)}`;

  const query = `
    [out:json][timeout:25];
    (
      node["amenity"~"^(restaurant|fast_food|cafe)$"](around:${around});
      way["amenity"~"^(restaurant|fast_food|cafe)$"](around:${around});
      node["shop"~"^(supermarket|convenience|greengrocer)$"](around:${around});
      way["shop"~"^(supermarket|convenience|greengrocer)$"](around:${around});
    );
    out center 80;
  `.trim();

  // Deliberately not caught: an unreachable or rate-limited Overpass is NOT the
  // same as "no restaurants nearby". Swallowing it here would make the UI assert
  // an absence we have not established. The caller distinguishes the two.
  const body = await cachedFetch(OVERPASS, {
    method: 'POST',
    body: `data=${encodeURIComponent(query)}`,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    key: cacheKeyFor(lat, lng, radius),
  });

  let payload: OverpassResponse;
  try {
    payload = JSON.parse(body) as OverpassResponse;
  } catch {
    throw new UpstreamError('Overpass returned a response we could not parse', 502);
  }

  const venues: OsmVenue[] = [];
  for (const el of payload.elements ?? []) {
    const tags = el.tags ?? {};
    const name = tags.name?.trim();
    if (!name) continue; // unnamed POIs are useless to a person standing outside

    const kind = classify(tags);
    if (!kind) continue;

    const vLat = el.lat ?? el.center?.lat;
    const vLng = el.lon ?? el.center?.lon;
    if (typeof vLat !== 'number' || typeof vLng !== 'number') continue;

    venues.push({
      osmId: `${el.type}/${el.id}`,
      name,
      kind,
      lat: vLat,
      lng: vLng,
      address: formatAddress(tags),
      brand: tags.brand ?? tags.operator ?? null,
      distanceMeters: Math.round(haversineMeters(lat, lng, vLat, vLng)),
    });
  }

  return venues.sort((a, b) => a.distanceMeters - b.distanceMeters);
}
