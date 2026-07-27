'use client';

import { useState } from 'react';
import type { SubstitutionResult } from '@/lib/substitution';

type Payload = SubstitutionResult & { source: 'ai' | 'local' | 'none' };

const SOURCE_NOTE: Record<Payload['source'], string> = {
  ai: 'Ranked by AI analysis of this menu.',
  local: 'Ranked from matched ingredient text only (no AI key configured).',
  none: 'No menu data to rank.',
};

/**
 * The substitution engine's output: what to order, then what to skip.
 * Deliberately opt-in — the page is useful without it, and this is the only
 * path in the app that costs an API call.
 */
export function Substitutions({ venueId }: { venueId: string }) {
  const [data, setData] = useState<Payload | null>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'error'>('idle');

  const run = async () => {
    setState('loading');
    try {
      const res = await fetch(`/api/venues/${venueId}/analyze`, { method: 'POST' });
      if (!res.ok) {
        setState('error');
        return;
      }
      setData((await res.json()) as Payload);
      setState('idle');
    } catch {
      setState('error');
    }
  };

  if (!data) {
    return (
      <div className="space-y-2">
        <button
          type="button"
          className="btn btn-primary w-full"
          onClick={run}
          disabled={state === 'loading'}
        >
          {state === 'loading' ? 'Working…' : 'What should I order?'}
        </button>
        {state === 'error' ? (
          <p className="text-sm text-flagged">Could not analyze this menu right now.</p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <section>
        <h3 className="label-caps mb-2 text-verified">Best bets</h3>
        {data.recommended.length === 0 ? (
          <p className="text-sm text-slate-muted">
            Nothing here clears your categories on the data we have. That is a real answer, not a
            loading state.
          </p>
        ) : (
          <ul className="space-y-2">
            {data.recommended.map((rec) => (
              <li key={rec.item} className="border-l-4 border-verified pl-3">
                <p className="font-display text-base uppercase tracking-wide">{rec.item}</p>
                <p className="text-sm text-slate-muted">{rec.why}</p>
                <p className="label-caps mt-0.5 text-[0.625rem] text-slate-muted">
                  {rec.confidence} confidence
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {data.avoid.length > 0 ? (
        <section>
          <h3 className="label-caps mb-2 text-flagged">Also flagged here</h3>
          <ul className="space-y-2">
            {data.avoid.map((entry, index) => (
              <li key={`${entry.item}-${index}`} className="border-l-4 border-flagged pl-3">
                <p className="font-display text-base uppercase tracking-wide">{entry.item}</p>
                <p className="ingredients text-flagged">{entry.matched}</p>
                <p className="label-caps mt-0.5 text-[0.625rem] text-slate-muted">{entry.flag}</p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {data.caveats.length > 0 ? (
        <section className="border-2 border-slate-ink bg-bone-deep p-3">
          <h3 className="label-caps mb-1">Watch out</h3>
          <ul className="list-disc space-y-1 pl-4 text-sm">
            {data.caveats.map((caveat) => (
              <li key={caveat}>{caveat}</li>
            ))}
          </ul>
        </section>
      ) : null}

      <p className="text-[0.6875rem] text-slate-muted">
        {SOURCE_NOTE[data.source]}
        {data.cached ? ' Cached result.' : ''}
      </p>
    </div>
  );
}
