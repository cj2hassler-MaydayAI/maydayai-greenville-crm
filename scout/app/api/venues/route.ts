import { NextResponse, type NextRequest } from 'next/server';
import { assessVenue, upsertVenue } from '@/lib/db/repository';
import { geocode, nearbyVenues, reverseGeocodeState } from '@/lib/osm';
import { ensureToken, loadPrefs } from '@/lib/prefs';
import { findCultivatedMeatBan } from '@/lib/state-laws';

export const runtime = 'nodejs';

export interface NearbyVenueDto {
  id: string;
  name: string;
  kind: string;
  address: string | null;
  lat: number;
  lng: number;
  distanceMeters: number;
  verdict: 'flagged' | 'clear' | 'unknown';
  chainName: string | null;
  flaggedCount: number;
  topMatch: string | null;
}

/**
 * Nearby venues for a coordinate, or for a searched place name.
 * All upstream calls are server-side and cached — the browser never touches
 * Nominatim or Overpass directly.
 */
export async function GET(request: NextRequest) {
  const token = await ensureToken();
  const prefs = loadPrefs(token);
  const params = request.nextUrl.searchParams;

  let lat = Number(params.get('lat'));
  let lng = Number(params.get('lng'));
  let label: string | null = null;
  const query = params.get('q')?.trim();

  if (query) {
    let place;
    try {
      place = await geocode(query);
    } catch {
      return NextResponse.json(
        {
          error: 'upstream_unavailable',
          message:
            'Could not reach the OpenStreetMap search service. This is an outage on their side, not an answer about this place — try again shortly.',
        },
        { status: 503 },
      );
    }
    if (!place) {
      return NextResponse.json(
        { error: 'not_found', message: `No place found for "${query}".` },
        { status: 404 },
      );
    }
    lat = place.lat;
    lng = place.lng;
    label = place.displayName;
  }

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return NextResponse.json(
      { error: 'bad_request', message: 'Provide lat and lng, or a q search term.' },
      { status: 400 },
    );
  }

  const radius = Number(params.get('radius')) || 1600;
  const state = await reverseGeocodeState(lat, lng);

  let found;
  try {
    found = await nearbyVenues(lat, lng, radius);
  } catch {
    // Never render this as "nothing nearby" — we did not establish that.
    return NextResponse.json(
      {
        error: 'upstream_unavailable',
        message:
          'Could not reach the OpenStreetMap venue service, so we do not know what is nearby. That is different from there being nothing here — try again shortly.',
      },
      { status: 503 },
    );
  }
  const venues: NearbyVenueDto[] = found.slice(0, 40).map((osm) => {
    const record = upsertVenue({
      osmId: osm.osmId,
      name: osm.name,
      kind: osm.kind,
      lat: osm.lat,
      lng: osm.lng,
      address: osm.address,
      brand: osm.brand,
      state,
    });

    const assessment = assessVenue(record, prefs.enabledCategories, prefs.strictness);
    const firstHit = assessment.flagged[0]?.hits[0] ?? null;

    return {
      id: record.id,
      name: record.name,
      kind: record.kind,
      address: record.address,
      lat: record.lat,
      lng: record.lng,
      distanceMeters: osm.distanceMeters,
      verdict: assessment.verdict,
      chainName: assessment.chainName,
      flaggedCount: assessment.flagged.length,
      topMatch: firstHit?.matchedText ?? null,
    };
  });

  const ban = findCultivatedMeatBan(state);

  return NextResponse.json({
    center: { lat, lng, state, label },
    stateLaw:
      ban && prefs.enabledCategories.includes('cultivated')
        ? { state: ban.state, statute: ban.statute, source: ban.source, lastVerified: ban.lastVerified }
        : null,
    prefs: { enabledCategories: prefs.enabledCategories, strictness: prefs.strictness },
    venues,
    attribution: '© OpenStreetMap contributors',
  });
}
