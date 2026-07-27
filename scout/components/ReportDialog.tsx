'use client';

import { useState } from 'react';
import { FLAG_LIST, type FlagId } from '@/lib/flags';

export function ReportDialog({ venueId }: { venueId: string }) {
  const [open, setOpen] = useState(false);
  const [flagId, setFlagId] = useState<FlagId>(FLAG_LIST[0].id);
  const [itemName, setItemName] = useState('');
  const [note, setNote] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'done' | 'error'>('idle');
  const [message, setMessage] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setState('sending');
    setMessage(null);
    try {
      const res = await fetch('/api/reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ venueId, flagId, itemName, note }),
      });
      const body = await res.json();
      if (!res.ok) {
        setState('error');
        setMessage(body.message ?? 'Could not file that report.');
        return;
      }
      setState('done');
      setItemName('');
      setNote('');
    } catch {
      setState('error');
      setMessage('Could not reach the server.');
    }
  };

  if (!open) {
    return (
      <button type="button" className="btn w-full" onClick={() => setOpen(true)}>
        Report an ingredient
      </button>
    );
  }

  return (
    <form onSubmit={submit} className="card space-y-3 p-3">
      <p className="label-caps">Report an ingredient</p>

      <label className="block">
        <span className="label-caps mb-1 block text-slate-muted">Category</span>
        <select
          className="field"
          value={flagId}
          onChange={(e) => setFlagId(e.target.value as FlagId)}
        >
          {FLAG_LIST.map((flag) => (
            <option key={flag.id} value={flag.id}>
              {flag.label}
            </option>
          ))}
        </select>
      </label>

      <label className="block">
        <span className="label-caps mb-1 block text-slate-muted">Item (optional)</span>
        <input
          className="field"
          value={itemName}
          onChange={(e) => setItemName(e.target.value)}
          placeholder="e.g. Fries"
          maxLength={120}
        />
      </label>

      <label className="block">
        <span className="label-caps mb-1 block text-slate-muted">Note (optional)</span>
        <textarea
          className="field"
          rows={2}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="What did staff tell you?"
          maxLength={500}
        />
      </label>

      {message ? <p className="text-sm text-flagged">{message}</p> : null}
      {state === 'done' ? (
        <p className="text-sm text-verified">
          Filed. It shows as a user report until other people confirm it.
        </p>
      ) : null}

      <div className="flex gap-2">
        <button type="submit" className="btn btn-primary flex-1" disabled={state === 'sending'}>
          {state === 'sending' ? 'Sending…' : 'Submit'}
        </button>
        <button type="button" className="btn" onClick={() => setOpen(false)}>
          Close
        </button>
      </div>
    </form>
  );
}
