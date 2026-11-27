'use client';

import { useCallback, useEffect, useState } from 'react';

// Cube raw layer: upload documents to a use case, embed their passages in
// short batches with progress, and list what each use case holds.
// Server side: app/api/documents/{route,embed,metadata}. Used on the admin
// page (every use case) and on a use case's Documents tab (lockedUseCaseId).

interface UseCase {
  id: string;
  name: string;
}
interface Journey {
  id: string;
  use_case_id: string;
  name: string;
}
interface DocumentRow {
  id: string;
  use_case_id: string;
  title: string;
  /** Shown to admins and the use case's curators only; null for everyone else. */
  added_by_name: string | null;
  added_by_me: boolean;
  created_at: string;
  passages: number;
  pending: number;
  journeys: string[];
}
interface FileResult {
  name: string;
  state: 'reading' | 'saving' | 'saved' | 'duplicate' | 'skipped' | 'failed';
  detail?: string;
  metadata?: string;
}

const ACCEPT = '.pdf,.docx';

const FIELD_LABELS: Record<string, string> = {
  objective: 'objective',
  problem: 'problem',
  users: 'users',
  sector: 'sector',
  organisation: 'adopter',
  geography: 'geography',
  scale_achieved: 'scale achieved',
  impact_achieved: 'impact achieved',
};

function describeMetadata(result: {
  useCase: string[];
  journeys: Record<string, string[]>;
  linkedJourney: string | null;
}): string {
  const parts: string[] = [];
  if (result.linkedJourney) parts.push(`linked to ${result.linkedJourney}`);
  if (result.useCase.length > 0) parts.push(`use case: ${result.useCase.map((f) => FIELD_LABELS[f] ?? f).join(', ')}`);
  for (const [name, fields] of Object.entries(result.journeys)) {
    parts.push(`${name}: ${fields.map((f) => FIELD_LABELS[f] ?? f).join(', ')}`);
  }
  return parts.length > 0 ? `Updated ${parts.join('; ')}` : 'No metadata changes';
}

async function errorText(res: Response, fallback: string): Promise<string> {
  const data = await res.json().catch(() => ({}));
  return typeof data.error === 'string' ? data.error : fallback;
}

/** lockedUseCaseId: a use case's Documents tab, for that use case only (no picker). */
export default function AdminDocumentsPanel({ lockedUseCaseId }: { lockedUseCaseId?: string } = {}) {
  const [useCases, setUseCases] = useState<UseCase[]>([]);
  const [journeys, setJourneys] = useState<Journey[]>([]);
  const [documents, setDocuments] = useState<DocumentRow[]>([]);
  const [pendingPassages, setPendingPassages] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const [useCaseId, setUseCaseId] = useState(lockedUseCaseId ?? '');
  const [journeyIds, setJourneyIds] = useState<string[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [results, setResults] = useState<FileResult[]>([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [embedError, setEmbedError] = useState<string | null>(null);
  const [inputKey, setInputKey] = useState(0);

  const load = useCallback(async () => {
    let data;
    try {
      const res = await fetch('/api/documents', { cache: 'no-store' });
      if (!res.ok) {
        setLoadError(await errorText(res, 'Could not load documents.'));
        return;
      }
      data = await res.json();
    } catch {
      setLoadError('Could not load documents. Check your connection and reload the page.');
      return;
    }
    setUseCases(data.useCases);
    setJourneys(data.journeys);
    setDocuments(data.documents);
    setPendingPassages(data.pendingPassages);
    setLoadError(null);
    setLoaded(true);
    setUseCaseId((current) => current || data.useCases[0]?.id || '');
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch
    load();
  }, [load]);

  function updateResult(index: number, patch: Partial<FileResult>) {
    setResults((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }

  // Embeds every passage still waiting, a few per request, showing progress.
  // Passages the server couldn't embed are passed back as `skip`, so they
  // don't block the rest; the next "Embed pending" tries them again.
  async function embedPending(addNotePassages: boolean) {
    setEmbedError(null);
    let total: number | null = null;
    let first = true;
    const skip: string[] = [];
    try {
      for (;;) {
        const res = await fetch('/api/documents/embed', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ add_note_passages: addNotePassages && first, skip }),
        });
        first = false;
        if (!res.ok) {
          setEmbedError(await errorText(res, 'Embedding stopped.'));
          break;
        }
        const { embedded, failed, remaining } = (await res.json()) as {
          embedded: number;
          failed: string[];
          remaining: number;
        };
        skip.push(...failed);
        if (total === null) total = embedded + remaining;
        setProgress(`Embedding ${total - remaining} of ${total} passages`);
        if (remaining <= skip.length || embedded === 0) break;
      }
      if (skip.length > 0) {
        setEmbedError(
          `${skip.length} passage${skip.length === 1 ? '' : 's'} couldn't be embedded and ${skip.length === 1 ? 'was' : 'were'} skipped. Keyword search still finds ${skip.length === 1 ? 'it' : 'them'}; "Embed pending" tries again.`
        );
      }
    } catch {
      setEmbedError('Embedding stopped: the connection dropped. Press "Embed pending" to carry on.');
    } finally {
      setProgress(null);
    }
  }

  async function upload(e: React.FormEvent) {
    e.preventDefault();
    if (!useCaseId || files.length === 0) return;
    setBusy(true);
    setEmbedError(null);
    const batch = files;
    setResults(batch.map((f) => ({ name: f.name, state: 'reading' })));
    try {
      await uploadFiles(batch);
    } finally {
      setFiles([]);
      setInputKey((k) => k + 1);
      await load();
      setBusy(false);
    }
  }

  async function uploadFiles(batch: File[]) {
    const { extractTextFromFile } = await import('@/lib/extract-text');

    let anySaved = false;
    for (let i = 0; i < batch.length; i++) {
      const file = batch[i];
      let text: string;
      try {
        text = (await extractTextFromFile(file)).trim();
      } catch (err) {
        updateResult(i, { state: 'skipped', detail: (err as Error).message });
        continue;
      }
      if (!text) {
        updateResult(i, { state: 'skipped', detail: 'No text could be read from this file (a scanned PDF?).' });
        continue;
      }
      updateResult(i, { state: 'saving' });
      let data;
      try {
        const res = await fetch('/api/documents', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ use_case_id: useCaseId, journey_ids: journeyIds, title: file.name, text }),
        });
        if (!res.ok) {
          updateResult(i, { state: 'failed', detail: await errorText(res, 'Could not save the document.') });
          continue;
        }
        data = await res.json();
      } catch {
        updateResult(i, { state: 'failed', detail: 'The connection dropped. Upload this file again to check.' });
        continue;
      }
      if (data.status === 'duplicate') {
        updateResult(i, { state: 'duplicate', detail: `Already in this use case as "${data.title}".` });
        continue;
      }
      if (data.status === 'skipped') {
        updateResult(i, { state: 'skipped', detail: data.reason });
        continue;
      }
      anySaved = true;
      updateResult(i, { state: 'saved', detail: `${data.passages} passages`, metadata: 'Checking metadata…' });
      try {
        const meta = await fetch('/api/documents/metadata', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ source_id: data.source_id }),
        });
        updateResult(i, {
          metadata: meta.ok ? describeMetadata(await meta.json()) : await errorText(meta, 'The metadata check failed.'),
        });
      } catch {
        updateResult(i, { metadata: 'The metadata check failed: the connection dropped.' });
      }
    }

    if (anySaved) {
      await load();
      await embedPending(false);
    }
  }

  async function embedPendingClicked() {
    setBusy(true);
    try {
      await embedPending(true);
    } finally {
      await load();
      setBusy(false);
    }
  }

  if (loadError) return <p className="text-sm text-coral">{loadError}</p>;
  if (!loaded) return <p className="text-sm text-ink-soft">Loading…</p>;
  if (lockedUseCaseId && !useCases.some((u) => u.id === lockedUseCaseId)) {
    return <p className="text-sm text-ink-soft">You can&apos;t add documents to this use case. Please contact the admin.</p>;
  }
  if (useCases.length === 0) {
    return <p className="text-sm text-ink-soft">No use cases yet. Add one with SQL (see cube-connector/seed-example.sql).</p>;
  }

  const ucJourneys = journeys.filter((j) => j.use_case_id === useCaseId);

  return (
    <div className="space-y-6">
      <form onSubmit={upload} className="rounded-xl border border-navy/10 bg-white p-4 space-y-4">
        {!lockedUseCaseId && (
        <label className="flex flex-wrap items-center gap-2 text-sm text-ink">
          Use case
          <select
            value={useCaseId}
            onChange={(e) => {
              setUseCaseId(e.target.value);
              setJourneyIds([]);
            }}
            disabled={busy}
            className="rounded-lg border border-navy/15 bg-white px-2 py-1.5 text-sm"
          >
            {useCases.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        </label>
        )}

        {ucJourneys.length > 0 && (
          <fieldset className="text-sm text-ink">
            <legend className="mb-1">
              Journeys <span className="text-ink-soft">(optional; leave empty and the Cube links the one a document is clearly about)</span>
            </legend>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {ucJourneys.map((j) => (
                <label key={j.id} className="flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    disabled={busy}
                    checked={journeyIds.includes(j.id)}
                    onChange={(e) =>
                      setJourneyIds((prev) => (e.target.checked ? [...prev, j.id] : prev.filter((id) => id !== j.id)))
                    }
                  />
                  {j.name}
                </label>
              ))}
            </div>
          </fieldset>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <input
            key={inputKey}
            type="file"
            accept={ACCEPT}
            multiple
            disabled={busy}
            onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
            className="min-w-0 flex-1 text-sm"
          />
          <button
            type="submit"
            disabled={busy || files.length === 0 || !useCaseId}
            className="rounded-lg bg-navy px-3 py-1.5 text-sm font-medium text-white transition hover:bg-coral disabled:opacity-50"
          >
            Upload
          </button>
        </div>

        {results.length > 0 && (
          <ul className="divide-y divide-navy/5 text-sm">
            {results.map((r, i) => (
              <li key={i} className="py-2">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="truncate text-ink">{r.name}</span>
                  <span
                    className={
                      r.state === 'saved' ? 'text-navy' : r.state === 'failed' ? 'text-coral' : 'text-ink-soft'
                    }
                  >
                    {{ reading: 'Reading…', saving: 'Saving…', saved: 'Saved', duplicate: 'Duplicate, skipped', skipped: 'Skipped', failed: 'Failed' }[r.state]}
                  </span>
                </div>
                {r.detail && <p className="text-xs text-ink-soft">{r.detail}</p>}
                {r.metadata && <p className="text-xs text-ink-soft">{r.metadata}</p>}
              </li>
            ))}
          </ul>
        )}
      </form>

      <div className="rounded-xl border border-navy/10 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-ink">
            {progress ??
              (pendingPassages > 0
                ? `${pendingPassages} passage${pendingPassages === 1 ? '' : 's'} waiting to be embedded (keyword search already works).`
                : 'Every passage is embedded.')}
          </p>
          <button
            type="button"
            onClick={embedPendingClicked}
            disabled={busy}
            className="rounded-lg border border-navy/15 px-3 py-1.5 text-sm text-navy transition hover:border-coral hover:text-coral disabled:opacity-50"
          >
            Embed pending
          </button>
        </div>
        <p className="mt-1 text-xs text-ink-soft">
          Embeds every passage without an embedding, including Cube notes, and first adds a passage for any note that has none.
        </p>
        {embedError && <p className="mt-2 text-sm text-coral">{embedError}</p>}
      </div>

      {(lockedUseCaseId ? useCases.filter((u) => u.id === lockedUseCaseId) : useCases).map((u) => {
        const docs = documents.filter((d) => d.use_case_id === u.id);
        return (
          <section key={u.id}>
            <h2 className="font-display text-lg font-medium text-navy mb-2">{u.name}</h2>
            {docs.length === 0 ? (
              <p className="text-sm text-ink-soft">No documents yet.</p>
            ) : (
              <ul className="divide-y divide-navy/5 rounded-xl border border-navy/10 bg-white px-4 text-sm">
                {docs.map((d) => (
                  <li key={d.id} className="py-2">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="truncate text-ink">{d.title}</span>
                      <span className="text-ink-soft">
                        {d.passages} passages{d.pending > 0 ? `, ${d.pending} waiting to be embedded` : ''}
                      </span>
                    </div>
                    <p className="text-xs text-ink-soft">
                      {d.journeys.length > 0 ? `${d.journeys.join(', ')} · ` : ''}
                      {d.added_by_me ? 'Added by you' : d.added_by_name ? `Added by ${d.added_by_name}` : 'Added'} on{' '}
                      {new Date(d.created_at).toLocaleDateString()}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}
