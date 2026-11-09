'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

// Generate or Regenerate. The previous digest stays until a new one is saved,
// so a failure only shows a message; Retry is the same button.
export default function GenerateButton({
  playbookId,
  period,
  label,
}: {
  playbookId: string;
  period: 7 | 30;
  label: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/companion-v2/digest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playbookId, periodDays: period }),
      });
      const data = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
      if (!res.ok) {
        // Another run saved a digest meanwhile: show it.
        if (data.error === 'superseded') router.refresh();
        setError(data.message ?? data.error ?? "The digest couldn't be generated just now. Please try again.");
        return;
      }
      router.refresh();
    } catch {
      setError("The digest couldn't be generated just now. The previous digest is unchanged; please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-start gap-1.5 sm:items-end">
      <button
        type="button"
        onClick={generate}
        disabled={busy}
        className="rounded-lg bg-pb-accent px-3.5 py-1.5 text-sm font-medium text-white transition hover:opacity-90 disabled:cursor-wait disabled:opacity-60"
      >
        {busy ? 'Generating…' : label}
      </button>
      {busy && <p className="text-xs text-pb-muted">This can take a minute or two.</p>}
      {error && (
        <p role="alert" className="max-w-xs text-xs text-pb-check-ink sm:text-right">
          {error}
        </p>
      )}
    </div>
  );
}
