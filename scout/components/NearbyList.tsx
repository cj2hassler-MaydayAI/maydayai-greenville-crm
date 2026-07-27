'use client';

import { useCallback, useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { VerdictStamp } from './VerdictStamp';
import type { NearbyVenueDto } from '@/app/api/venues/route';

// Leaflet touches `window` on import, so the map only loads in the browser.
const VenueMap = dynamic(() => import('./VenueMap'), {
  ssr: false,
  loading: () => (
    <div className="flex h-[62vh] items-center justify-center border-2 border-slate-ink">
      <span className="label-caps text-slate-muted">Loading map…</span>
    </div>
  ),
});

interface Payload {
  center: { lat: number; lng: number; state: string | null; label: string | null };
  stateLaw: { state: string; statute: string; source: string; lastVerified: string } | null;
  venues: NearbyVenueDto[];
  attribution: string;
}

type Status = 'idle' | 'locating' | 'loading' | 'ready' | 'error';

const KIND_LABEL: Record<string, string> = {
  restaurant: 'Restaurant',
  fast_food: 'Fast food',
  grocery: 'Grocery',
};

function distance(meters: number): string {
  const miles = meters / 1609.34;
  if (miles < 0.1) return `${Math.round(meters * 3.28084)} ft`;
  return `${miles.toFixed(1)} mi`;
}

export function NearbyList() {
  const router = useRouter();
  const [data, setData] = useState<Payload | null>(null);
  const [status, setStatus] = useState<Status>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [showMap, setShowMap] = useState(false);

  const load = useCallback(async (url: string) => {
    setStatus('loading');
    setMessage(null);
    try {
      const res = await fetch(url);
      const body = await res.json();
      if (!res.ok) {
        setStatus('error');
        setMessage(body.message ?? 'Something went wrong.');
        return;
      }
      setData(body as Payload);
      setStatus('ready');
    } catch {
      setStatus('error');
      setMessage('Could not reach the server.');
    }
  }, []);

  const locate = useCallback(() => {
    if (!('geolocation' in navigator)) {
      setStatus('error');
      setMessage('This browser has no location support. Search for a place instead.');
      return;
    }
    setStatus('locating');
    setMessage(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => load(`/api/venues?lat=${pos.coords.latitude}&lng=${pos.coords.longitude}`),
      () => {
        setStatus('error');
        setMessage('Location permission denied. Search for a place instead.');
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 },
    );
  }, [load]);

  useEffect(() => {
    locate();
  }, [locate]);

  const search = (event: React.FormEvent) => {
    event.preventDefault();
    if (query.trim()) load(`/api/venues?q=${encodeURIComponent(query.trim())}`);
  };

  return (
    <div className="space-y-4">
      <form onSubmit={search} className="flex gap-2">
        <input
          className="field"
          placeholder="Search a place or address"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search for a place"
        />
        <button type="submit" className="btn btn-primary shrink-0">
          Go
        </button>
      </form>

      <div className="flex items-center justify-between gap-2">
        <button type="button" onClick={locate} className="btn text-xs">
          Use my location
        </button>
        <button
          type="button"
          onClick={() => setShowMap((v) => !v)}
          className="btn text-xs"
          aria-pressed={showMap}
        >
          {showMap ? 'Show list' : 'Show map'}
        </button>
      </div>

      {data?.stateLaw ? (
        <div className="border-2 border-slate-ink bg-bone-deep p-3">
          <p className="label-caps mb-1">{data.stateLaw.state} law</p>
          <p className="text-sm">Cultivated meat sales are prohibited in this state.</p>
          <p className="mt-1 text-xs text-slate-muted">
            {data.stateLaw.statute} · checked {data.stateLaw.lastVerified} ·{' '}
            <a className="underline" href={data.stateLaw.source} target="_blank" rel="noreferrer">
              source
            </a>
          </p>
        </div>
      ) : null}

      {status === 'locating' || status === 'loading' ? (
        <p className="label-caps py-8 text-center text-slate-muted">
          {status === 'locating' ? 'Finding you…' : 'Checking nearby…'}
        </p>
      ) : null}

      {status === 'error' ? (
        <div className="border-2 border-flagged p-3">
          <p className="text-sm text-flagged">{message}</p>
        </div>
      ) : null}

      {status === 'ready' && data ? (
        <>
          {data.center.label ? (
            <p className="text-xs text-slate-muted">Near {data.center.label}</p>
          ) : null}

          {showMap ? (
            <VenueMap
              center={data.center}
              venues={data.venues}
              onSelect={(id) => router.push(`/venue/${id}`)}
            />
          ) : data.venues.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-muted">
              Nothing found within a mile. Try searching a different place.
            </p>
          ) : (
            <ul className="space-y-3">
              {data.venues.map((venue) => (
                <li key={venue.id}>
                  <Link
                    href={`/venue/${venue.id}`}
                    className="card flex items-start justify-between gap-3 p-3 hover:bg-bone-deep"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block font-display text-lg uppercase leading-tight tracking-wide">
                        {venue.name}
                      </span>
                      <span className="mt-1 block text-xs text-slate-muted">
                        {KIND_LABEL[venue.kind] ?? venue.kind} · {distance(venue.distanceMeters)}
                        {venue.chainName ? ` · ${venue.chainName}` : ''}
                      </span>
                      {venue.topMatch ? (
                        <span className="ingredients mt-1.5 block text-flagged">
                          {venue.topMatch}
                          {venue.flaggedCount > 1 ? ` +${venue.flaggedCount - 1} more` : ''}
                        </span>
                      ) : null}
                    </span>
                    <span className="shrink-0 pt-1">
                      <VerdictStamp verdict={venue.verdict} size="sm" />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}

          <p className="pt-2 text-center text-[0.6875rem] text-slate-muted">
            {data.attribution}
          </p>
        </>
      ) : null}
    </div>
  );
}
