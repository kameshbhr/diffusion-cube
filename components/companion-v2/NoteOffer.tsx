'use client';

import { useState } from 'react';

// Cube's offer to save a piece of know-how to the Cube for the team, under
// its reply. Saved only when the person presses Save (POST /api/companion/notes).
export default function NoteOffer({ useCaseId, text }: { useCaseId: string; text: string }) {
  const [state, setState] = useState<'offer' | 'saving' | 'saved' | 'dismissed'>('offer');
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState<string | null>(null);

  if (state === 'dismissed') return null;

  async function save() {
    setState('saving');
    setError(null);
    try {
      const res = await fetch('/api/companion/notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ useCaseId, text }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof data.error === 'string' ? data.error : 'The note could not be saved. Please try again.');
        setState('offer');
        return;
      }
      setTitle(typeof data.title === 'string' ? data.title : null);
      setState('saved');
    } catch {
      setError('The connection dropped. Please try again.');
      setState('offer');
    }
  }

  return (
    <div className="mt-3 rounded-xl border border-pb-line bg-pb-surface px-4 py-3 text-sm">
      {state === 'saved' ? (
        <p className="text-pb-ink">
          Saved to the Cube{title ? <>: <em>{title}</em></> : '.'} Your team can now find it.
        </p>
      ) : (
        <>
          <p className="text-pb-muted">Save this to the Cube for your team?</p>
          <p className="mt-1 text-pb-ink">{text}</p>
          {error && <p className="mt-2 text-pb-check-ink">{error}</p>}
          <div className="mt-2 flex gap-3">
            <button
              type="button"
              onClick={save}
              disabled={state === 'saving'}
              className="rounded-lg bg-pb-accent px-3 py-1.5 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-50"
            >
              {state === 'saving' ? 'Saving…' : 'Save'}
            </button>
            <button
              type="button"
              onClick={() => setState('dismissed')}
              disabled={state === 'saving'}
              className="text-sm text-pb-muted transition hover:text-pb-ink disabled:opacity-50"
            >
              Not now
            </button>
          </div>
        </>
      )}
    </div>
  );
}
