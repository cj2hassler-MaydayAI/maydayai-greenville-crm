'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { VerdictStamp } from './VerdictStamp';
import { IngredientText } from './IngredientText';
import { FLAGS } from '@/lib/flags';
import type { FlagHit, Verdict } from '@/lib/matcher';
import type { Product } from '@/lib/openfoodfacts';

interface LookupPayload {
  product: Product;
  hits: FlagHit[];
  verdict: Verdict;
  attribution: string;
}

const SCANNER_ID = 'scout-scanner';

export function Scanner() {
  const [scanning, setScanning] = useState(false);
  const [result, setResult] = useState<LookupPayload | null>(null);
  const [alternatives, setAlternatives] = useState<Product[] | null>(null);
  const [manual, setManual] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Held outside React state: the html5-qrcode instance is imperative and must
  // be stopped exactly once, including on unmount.
  const scannerRef = useRef<{ stop: () => Promise<void>; clear: () => void } | null>(null);

  const lookup = useCallback(async (barcode: string) => {
    setBusy(true);
    setError(null);
    setAlternatives(null);
    try {
      const res = await fetch(`/api/product/${encodeURIComponent(barcode)}`);
      const body = await res.json();
      if (!res.ok) {
        setResult(null);
        setError(body.message ?? 'Lookup failed.');
        return;
      }
      setResult(body as LookupPayload);

      // Only bother searching for swaps when there is something to swap away from.
      if ((body as LookupPayload).hits.length > 0) {
        const alt = await fetch(`/api/product/similar?barcode=${encodeURIComponent(barcode)}`);
        if (alt.ok) setAlternatives(((await alt.json()).alternatives ?? []) as Product[]);
      }
    } catch {
      setError('Could not reach the server.');
    } finally {
      setBusy(false);
    }
  }, []);

  const stop = useCallback(async () => {
    const instance = scannerRef.current;
    scannerRef.current = null;
    if (!instance) return;
    try {
      await instance.stop();
      instance.clear();
    } catch {
      // Already stopped — nothing to clean up.
    }
  }, []);

  const start = useCallback(async () => {
    setError(null);
    setScanning(true);
    try {
      const { Html5Qrcode } = await import('html5-qrcode');
      const instance = new Html5Qrcode(SCANNER_ID, { verbose: false });
      scannerRef.current = instance as unknown as { stop: () => Promise<void>; clear: () => void };

      await instance.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 260, height: 160 } },
        (decoded) => {
          void stop().then(() => {
            setScanning(false);
            void lookup(decoded);
          });
        },
        () => {
          // Per-frame decode misses are normal; ignore them.
        },
      );
    } catch {
      setScanning(false);
      setError('Could not start the camera. Type the barcode instead.');
    }
  }, [lookup, stop]);

  useEffect(() => {
    return () => {
      void stop();
    };
  }, [stop]);

  const submitManual = (event: React.FormEvent) => {
    event.preventDefault();
    if (manual.trim()) void lookup(manual.trim());
  };

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        {scanning ? (
          <>
            <div id={SCANNER_ID} className="w-full border-2 border-slate-ink" />
            <button
              type="button"
              className="btn w-full"
              onClick={() => {
                void stop();
                setScanning(false);
              }}
            >
              Stop camera
            </button>
          </>
        ) : (
          <button type="button" className="btn btn-primary w-full" onClick={start}>
            Scan a barcode
          </button>
        )}

        <form onSubmit={submitManual} className="flex gap-2">
          <input
            className="field font-mono"
            inputMode="numeric"
            placeholder="or type the barcode"
            value={manual}
            onChange={(e) => setManual(e.target.value)}
            aria-label="Barcode number"
          />
          <button type="submit" className="btn shrink-0" disabled={busy}>
            {busy ? '…' : 'Check'}
          </button>
        </form>
      </div>

      {error ? (
        <div className="border-2 border-flagged p-3">
          <p className="text-sm text-flagged">{error}</p>
        </div>
      ) : null}

      {result ? (
        <article className="space-y-4">
          {/* Flex rather than absolute positioning: the stamp is wider than any
              padding we could reserve, and a long product name must not run
              underneath it. */}
          <header className="card flex items-start justify-between gap-3 p-4">
            <div className="min-w-0 flex-1">
              <h2 className="font-display text-2xl uppercase leading-none tracking-wide">
                {result.product.name ?? 'Unnamed product'}
              </h2>
              <p className="mt-1.5 text-xs text-slate-muted">
                {result.product.brand ?? 'Unknown brand'} · {result.product.barcode}
              </p>
            </div>
            <span className="shrink-0 pt-1">
              <VerdictStamp verdict={result.verdict} />
            </span>
          </header>

          {result.hits.length > 0 ? (
            <p className="text-sm">
              Matched{' '}
              <span className="font-semibold text-flagged">
                {[...new Set(result.hits.map((h) => FLAGS[h.flagId].label))].join(', ')}
              </span>
              .
            </p>
          ) : null}

          <section>
            <h3 className="label-caps rule pt-2">Ingredients</h3>
            {result.product.ingredientsText ? (
              <IngredientText
                text={result.product.ingredientsText}
                hits={result.hits}
                className="mt-2"
              />
            ) : (
              <p className="mt-2 text-sm text-slate-muted">
                Open Food Facts has this product but no ingredient list. That is why the verdict is
                &ldquo;no data&rdquo; rather than a clear.
              </p>
            )}
          </section>

          {alternatives ? (
            <section>
              <h3 className="label-caps rule pt-2 text-verified">Similar products without this</h3>
              {alternatives.length === 0 ? (
                <p className="mt-2 text-sm text-slate-muted">
                  Nothing in the same category came back clean. Not the same as nothing existing —
                  only that Open Food Facts has no ingredient list proving it.
                </p>
              ) : (
                <ul className="mt-2 space-y-2">
                  {alternatives.map((alt) => (
                    <li key={alt.barcode} className="border-l-4 border-verified pl-3">
                      <p className="font-display text-base uppercase tracking-wide">
                        {alt.name ?? alt.barcode}
                      </p>
                      <p className="text-xs text-slate-muted">{alt.brand ?? 'Unknown brand'}</p>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ) : null}

          <p className="text-[0.6875rem] text-slate-muted">{result.attribution}</p>
        </article>
      ) : null}
    </div>
  );
}
