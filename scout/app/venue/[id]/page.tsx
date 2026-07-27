import Link from 'next/link';
import { notFound } from 'next/navigation';
import { VerdictStamp } from '@/components/VerdictStamp';
import { IngredientText } from '@/components/IngredientText';
import { Substitutions } from '@/components/Substitutions';
import { ReportDialog } from '@/components/ReportDialog';
import { ReportList } from '@/components/ReportList';
import { assessVenue, getVenue, listReports } from '@/lib/db/repository';
import { currentPrefs } from '@/lib/prefs';
import { FLAGS } from '@/lib/flags';
import { BAN_BANNER_COPY, findCultivatedMeatBan } from '@/lib/state-laws';

export const dynamic = 'force-dynamic';

const SOURCE_LABEL: Record<string, string> = {
  seed: 'Seed data',
  ai: 'AI analysis',
  user: 'User report',
};

const VERDICT_BLURB: Record<string, string> = {
  flagged: 'We found at least one ingredient you asked to avoid. The match is shown below.',
  clear: 'Nothing in the ingredient data we have matches the categories you enabled.',
  unknown: 'We do not have enough ingredient data for this place to say either way.',
};

export default async function VenuePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const venue = getVenue(id);
  if (!venue) notFound();

  const prefs = await currentPrefs();
  const assessment = assessVenue(venue, prefs.enabledCategories, prefs.strictness);
  const reports = listReports(venue.id);
  const ban = findCultivatedMeatBan(venue.state);

  const orderThis = assessment.clean.filter((i) => (i.ingredientsText ?? '').trim().length > 0);
  const noData = assessment.clean.filter((i) => !(i.ingredientsText ?? '').trim());

  return (
    <div className="space-y-6">
      <Link href="/" className="label-caps text-slate-muted hover:underline">
        ← Nearby
      </Link>

      {/* The verdict is the screen. Everything else is supporting evidence. */}
      <header className="card p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h1 className="font-display text-3xl uppercase leading-none tracking-wide">
              {venue.name}
            </h1>
            <p className="mt-2 text-xs text-slate-muted">
              {venue.kind.replace('_', ' ')}
              {assessment.chainName ? ` · ${assessment.chainName}` : ''}
              {venue.address ? ` · ${venue.address}` : ''}
            </p>
          </div>
          <span className="shrink-0 pt-1">
            <VerdictStamp verdict={assessment.verdict} />
          </span>
        </div>
        <p className="mt-3 text-sm">{VERDICT_BLURB[assessment.verdict]}</p>
      </header>

      {ban && prefs.enabledCategories.includes('cultivated') ? (
        <div className="border-2 border-slate-ink bg-bone-deep p-3">
          <p className="label-caps mb-1">{ban.state} law</p>
          <p className="text-sm">{BAN_BANNER_COPY}</p>
          <p className="mt-1 text-xs text-slate-muted">
            {ban.statute}
            {ban.note ? ` · ${ban.note}` : ''} · checked {ban.lastVerified} ·{' '}
            <a className="underline" href={ban.source} target="_blank" rel="noreferrer">
              source
            </a>
          </p>
        </div>
      ) : null}

      {prefs.enabledCategories.length === 0 ? (
        <p className="border-2 border-slate-ink p-3 text-sm">
          You have not enabled any categories, so nothing can be flagged.{' '}
          <Link href="/settings" className="underline">
            Choose what to avoid
          </Link>
          .
        </p>
      ) : null}

      {/* Ranked picks sit above the raw menu data: the substitution engine is
          the product, the ingredient tables below are the evidence for it. */}
      <section>
        <h2 className="label-caps rule pt-2">Ranked picks</h2>
        <div className="mt-3">
          <Substitutions venueId={venue.id} />
        </div>
      </section>

      {assessment.items.length > 0 ? (
        <section className="grid gap-6 sm:grid-cols-2">
          <div>
            <h2 className="label-caps rule pt-2 text-verified">Order this</h2>
            {orderThis.length === 0 ? (
              <p className="mt-3 text-sm text-slate-muted">
                Nothing on the data we have clears your categories.
              </p>
            ) : (
              <ul className="mt-3 space-y-3">
                {orderThis.map((item) => (
                  <li key={item.id}>
                    <p className="font-display text-base uppercase tracking-wide">{item.name}</p>
                    {item.ingredientsText ? (
                      <IngredientText
                        text={item.ingredientsText}
                        hits={item.hits}
                        className="mt-1 text-slate-muted"
                      />
                    ) : null}
                    <p className="label-caps mt-1 text-[0.625rem] text-slate-muted">
                      {SOURCE_LABEL[item.source]} · confidence {item.confidence.toFixed(2)}
                      {item.verifiedAt ? ` · checked ${item.verifiedAt}` : ''}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <h2 className="label-caps rule pt-2 text-flagged">Skip this</h2>
            {assessment.flagged.length === 0 ? (
              <p className="mt-3 text-sm text-slate-muted">Nothing matched your categories.</p>
            ) : (
              <ul className="mt-3 space-y-3">
                {assessment.flagged.map((item) => (
                  <li key={item.id}>
                    <p className="font-display text-base uppercase tracking-wide">{item.name}</p>
                    <p className="mt-0.5 text-xs text-flagged">
                      {[...new Set(item.hits.map((h) => FLAGS[h.flagId].label))].join(', ')}
                    </p>
                    {item.ingredientsText ? (
                      <IngredientText
                        text={item.ingredientsText}
                        hits={item.hits}
                        className="mt-1"
                      />
                    ) : null}
                    <p className="label-caps mt-1 text-[0.625rem] text-slate-muted">
                      {SOURCE_LABEL[item.source]} · confidence {item.confidence.toFixed(2)}
                      {item.verifiedAt ? ` · checked ${item.verifiedAt}` : ''}
                    </p>
                    {item.sourceNote ? (
                      <p className="mt-0.5 text-[0.625rem] text-slate-muted">{item.sourceNote}</p>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      ) : (
        <section className="border-2 border-slate-ink p-4">
          <p className="text-sm">
            No menu data for this location yet. If you learn something standing there, file a report
            below — that is how this gets better.
          </p>
        </section>
      )}

      {noData.length > 0 ? (
        <p className="text-xs text-slate-muted">
          {noData.length} item{noData.length === 1 ? '' : 's'} on file with no published ingredients.
          They were not assessed either way.
        </p>
      ) : null}

      <section className="space-y-3">
        <h2 className="label-caps rule pt-2">User reports</h2>
        <ReportList reports={reports} />
        <ReportDialog venueId={venue.id} />
      </section>

      <p className="border-t border-slate-line pt-3 text-xs text-slate-muted">
        Ingredient formulations change and vary by franchise location. Treat this as a starting
        point for the question you ask at the counter, not the final word.
      </p>
    </div>
  );
}
