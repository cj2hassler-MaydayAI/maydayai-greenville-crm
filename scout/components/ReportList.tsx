'use client';

import { useState } from 'react';
import { FLAGS, isFlagId } from '@/lib/flags';
import type { ReportRecord } from '@/lib/db/repository';

/**
 * User reports are visually distinct from verified data and never merged into it.
 * A report only affects the venue verdict once the community confirms it.
 */
export function ReportList({ reports: initial }: { reports: ReportRecord[] }) {
  const [reports, setReports] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const vote = async (reportId: string, value: 1 | -1) => {
    const res = await fetch('/api/reports/vote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reportId, value }),
    });
    const body = await res.json();
    if (!res.ok) {
      setErrors((prev) => ({ ...prev, [reportId]: body.message ?? 'Vote failed.' }));
      return;
    }
    setReports((prev) => prev.map((r) => (r.id === reportId ? body.report : r)));
  };

  if (reports.length === 0) {
    return <p className="text-sm text-slate-muted">No user reports for this place yet.</p>;
  }

  return (
    <ul className="space-y-2">
      {reports.map((report) => (
        <li key={report.id} className="border border-dashed border-slate-muted p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="label-caps text-slate-muted">
                Reported by users
                {report.status === 'confirmed' ? ' · confirmed' : ''}
                {report.status === 'disputed' ? ' · disputed' : ''}
              </p>
              <p className="mt-1 font-display text-base uppercase tracking-wide">
                {isFlagId(report.flagId) ? FLAGS[report.flagId].label : report.flagId}
                {report.itemName ? ` — ${report.itemName}` : ''}
              </p>
              {report.note ? <p className="mt-1 text-sm">{report.note}</p> : null}
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                aria-label="Confirm this report"
                className="btn px-2 py-1 text-xs"
                onClick={() => vote(report.id, 1)}
              >
                ▲
              </button>
              <span className="w-6 text-center font-mono text-sm">{report.score}</span>
              <button
                type="button"
                aria-label="Dispute this report"
                className="btn px-2 py-1 text-xs"
                onClick={() => vote(report.id, -1)}
              >
                ▼
              </button>
            </div>
          </div>
          {errors[report.id] ? (
            <p className="mt-1 text-xs text-flagged">{errors[report.id]}</p>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
