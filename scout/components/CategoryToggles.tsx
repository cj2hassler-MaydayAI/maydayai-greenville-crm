'use client';

import { useState } from 'react';
import { FLAG_LIST, type FlagId } from '@/lib/flags';
import type { Strictness } from '@/lib/flags';
import { CULTIVATED_MEAT_BANS } from '@/lib/state-laws';

export function CategoryToggles({
  initialEnabled,
  initialStrictness,
}: {
  initialEnabled: FlagId[];
  initialStrictness: Strictness;
}) {
  const [enabled, setEnabled] = useState<FlagId[]>(initialEnabled);
  const [strictness, setStrictness] = useState<Strictness>(initialStrictness);
  const [saved, setSaved] = useState(false);

  const persist = async (next: { enabled?: FlagId[]; strictness?: Strictness }) => {
    const payload = {
      enabledCategories: next.enabled ?? enabled,
      strictness: next.strictness ?? strictness,
    };
    setSaved(false);
    const res = await fetch('/api/prefs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (res.ok) setSaved(true);
  };

  const toggle = (id: FlagId) => {
    const next = enabled.includes(id) ? enabled.filter((f) => f !== id) : [...enabled, id];
    setEnabled(next);
    void persist({ enabled: next });
  };

  const setLevel = (level: Strictness) => {
    setStrictness(level);
    void persist({ strictness: level });
  };

  return (
    <div className="space-y-6">
      <section>
        <h2 className="label-caps rule pt-2">What to avoid</h2>
        <ul className="mt-3 space-y-3">
          {FLAG_LIST.map((flag) => {
            const on = enabled.includes(flag.id);
            return (
              <li key={flag.id} className="card p-3">
                <label className="flex cursor-pointer items-start gap-3">
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() => toggle(flag.id)}
                    className="mt-1 h-5 w-5 shrink-0 accent-[#2B3440]"
                  />
                  <span>
                    <span className="block font-display text-lg uppercase leading-tight tracking-wide">
                      {flag.label}
                    </span>
                    <span className="mt-1 block text-sm text-slate-muted">{flag.explainer}</span>
                    {flag.id === 'cultivated' ? (
                      <span className="mt-2 block text-xs text-slate-muted">
                        Sales are prohibited in{' '}
                        {CULTIVATED_MEAT_BANS.map((law) => law.state).join(', ')}. Scout shows a
                        banner when your location resolves to one of those states.
                      </span>
                    ) : null}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      </section>

      <section>
        <h2 className="label-caps rule pt-2">How strict</h2>
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            className={`btn flex-1 ${strictness === 'strict' ? 'btn-primary' : ''}`}
            aria-pressed={strictness === 'strict'}
            onClick={() => setLevel('strict')}
          >
            Strict
          </button>
          <button
            type="button"
            className={`btn flex-1 ${strictness === 'relaxed' ? 'btn-primary' : ''}`}
            aria-pressed={strictness === 'relaxed'}
            onClick={() => setLevel('relaxed')}
          >
            Relaxed
          </button>
        </div>
        <p className="mt-2 text-sm text-slate-muted">
          {strictness === 'strict'
            ? 'Flags any appearance, including trace amounts and "may contain" warnings.'
            : 'Flags only primary ingredients — nothing after a "contains 2% or less" line, and no trace warnings.'}
        </p>
      </section>

      {saved ? <p className="text-sm text-verified">Saved.</p> : null}

      <section className="border-t border-slate-line pt-4 text-xs text-slate-muted">
        <p>
          Scout stores your choices against an anonymous token in a cookie. There is no account, no
          email, and no login.
        </p>
        <p className="mt-2">
          Place data © OpenStreetMap contributors. Product data from Open Food Facts (ODbL).
        </p>
      </section>
    </div>
  );
}
