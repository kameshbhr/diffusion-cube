'use client';

import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { useConfirm } from '@/components/ConfirmDialog';
import { showToast } from '@/lib/toast';
import AssetLink from '@/components/companion-v2/AssetLink';
import {
  MAX_FILE_BYTES,
  createFileAsset,
  createLinkAsset,
  deleteAsset,
  formatBytes,
  listOrphans,
  removeOrphans,
  updateAsset,
} from '@/lib/companion-v2/assets';

export interface ManagedAsset {
  id: string;
  title: string;
  kind: 'file' | 'link';
  url: string | null;
  storage_path: string | null;
  description: string;
  job_codes: string[];
  created_at: string;
}

interface Job {
  code: string;
  name: string;
}

/** Same rule as the assets_url_http constraint. */
const HTTP_URL = /^https?:\/\/[^\s/?#]+/i;

const input =
  'w-full rounded-md border border-pb-line bg-pb-surface px-3 py-2 text-[14px] text-pb-ink outline-none focus:border-pb-accent';

/** Pick jobs by name; selected ones show as removable chips. */
function JobPicker({ jobs, value, onChange }: { jobs: Job[]; value: string[]; onChange: (v: string[]) => void }) {
  const [q, setQ] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const byCode = new Map(jobs.map((j) => [j.code, j]));
  const shown = jobs.filter((j) => !value.includes(j.code) && (!q.trim() || j.name.toLowerCase().includes(q.trim().toLowerCase())));
  return (
    <fieldset className="space-y-2">
      <legend className="text-[13px] font-medium text-pb-ink">Jobs it belongs to</legend>
      <p className="text-xs text-pb-muted">
        It shows in each of these jobs, and Cube offers it when they come up. With no job, it is listed under General
        resources.
      </p>
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {value.map((c) => (
            <span key={c} className="inline-flex items-center gap-1 rounded-full bg-pb-accent-soft px-2.5 py-0.5 text-xs text-pb-accent">
              {byCode.get(c)?.name ?? c}
              <button type="button" onClick={() => onChange(value.filter((x) => x !== c))} aria-label={`Remove ${byCode.get(c)?.name ?? c}`} className="ml-0.5">
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      <input ref={searchRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a job" aria-label="Find a job" className={input} />
      <div className="max-h-44 space-y-0.5 overflow-y-auto rounded-md border border-pb-line-soft p-1.5">
        {shown.map((j) => (
          <button
            key={j.code}
            type="button"
            onClick={() => {
              onChange([...value, j.code]);
              // The button disappears once added: keep keyboard focus nearby.
              searchRef.current?.focus();
            }}
            className="block w-full rounded px-2 py-1 text-left text-sm hover:bg-pb-accent-soft"
          >
            + {j.name}
          </button>
        ))}
        {!shown.length && <p className="px-2 py-1 text-xs text-pb-muted">No more jobs match.</p>}
      </div>
    </fieldset>
  );
}

function AddAsset({
  playbookId,
  jobs,
  onDone,
  onCancel,
  onFailed,
}: {
  playbookId: string;
  jobs: Job[];
  onDone: () => void;
  onCancel: () => void;
  /** After a failure: a file may be left behind, so the clean-up list is refreshed. */
  onFailed: () => void;
}) {
  const [kind, setKind] = useState<'file' | 'link'>('file');
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [jobCodes, setJobCodes] = useState<string[]>([]);
  const [progress, setProgress] = useState<number | null>(null);
  // After the upload, while the row is saved; cancelling is no longer possible.
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const kindRef = useRef<HTMLDivElement>(null);
  // Opening the form moves focus into it (the "+ Add an asset" button is gone).
  useEffect(() => {
    (kindRef.current?.querySelector('[aria-checked="true"]') as HTMLElement | null)?.focus();
  }, []);

  const tooBig = !!file && file.size > MAX_FILE_BYTES;
  const badUrl = kind === 'link' && !!url.trim() && !HTTP_URL.test(url.trim());
  const ready =
    !!title.trim() && !!description.trim() && (kind === 'file' ? !!file && !tooBig : !!url.trim() && !badUrl) && progress === null;

  async function submit() {
    setError(null);
    const supabase = createClient();
    try {
      if (kind === 'file' && file) {
        abortRef.current = new AbortController();
        setProgress(0);
        await createFileAsset(
          supabase,
          playbookId,
          file,
          { title, description, job_codes: jobCodes },
          setProgress,
          abortRef.current.signal,
          () => setSaving(true)
        );
      } else {
        setProgress(0);
        await createLinkAsset(supabase, playbookId, url, { title, description, job_codes: jobCodes });
      }
      showToast('Asset added.');
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      onFailed();
    } finally {
      setProgress(null);
      setSaving(false);
      abortRef.current = null;
    }
  }

  // Switching to a link drops a chosen file, so a file that no longer shows
  // in the (fresh) file picker can't be uploaded by mistake.
  const chooseKind = (next: 'file' | 'link') => {
    setKind(next);
    if (next === 'link') setFile(null);
  };

  return (
    <div className="space-y-4 rounded-xl border border-pb-accent bg-pb-surface p-5">
      <div
        ref={kindRef}
        role="radiogroup"
        aria-label="Kind of asset"
        className="inline-flex rounded-full border border-pb-line p-0.5 text-sm"
        onKeyDown={(e) => {
          if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key) || progress !== null) return;
          e.preventDefault();
          const next = kind === 'file' ? 'link' : 'file';
          chooseKind(next);
          (e.currentTarget.querySelector(`[data-kind="${next}"]`) as HTMLElement | null)?.focus();
        }}
      >
        {(['file', 'link'] as const).map((k) => (
          <button
            key={k}
            data-kind={k}
            type="button"
            role="radio"
            aria-checked={kind === k}
            tabIndex={kind === k ? 0 : -1}
            onClick={() => chooseKind(k)}
            disabled={progress !== null}
            className={`rounded-full px-3.5 py-1 ${kind === k ? 'bg-pb-accent text-white' : 'text-pb-muted'}`}
          >
            {k === 'file' ? 'Upload a file' : 'Add a link'}
          </button>
        ))}
      </div>

      {/* Nothing can be changed while the file uploads: the row is saved from these values. */}
      <fieldset disabled={progress !== null} className="min-w-0 space-y-4">
      {/* Different keys, so React mounts a fresh input on each switch instead of
          turning the uncontrolled file input into the controlled link input. */}
      {kind === 'file' ? (
        <div key="file" className="space-y-1">
          <label className="block text-[13px] font-medium text-pb-ink" htmlFor="asset-file">
            File (any type, up to 100 MB)
          </label>
          <input
            id="asset-file"
            type="file"
            disabled={progress !== null}
            onChange={(e) => {
              const f = e.target.files?.[0] ?? null;
              setFile(f);
              if (f && !title.trim()) setTitle(f.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim());
            }}
            className="block w-full text-sm"
          />
          {file && (
            <p className={`break-all text-xs ${tooBig ? 'text-pb-check-ink' : 'text-pb-muted'}`}>
              {file.name} · {formatBytes(file.size)}
              {tooBig ? ' · too big: files can be up to 100 MB' : ''}
            </p>
          )}
        </div>
      ) : (
        <div key="link" className="space-y-1">
          <label className="block text-[13px] font-medium text-pb-ink" htmlFor="asset-url">
            Link
          </label>
          <input id="asset-url" type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" className={input} />
          {badUrl && <p className="text-xs text-pb-check-ink">Enter a full link that starts with http:// or https://.</p>}
        </div>
      )}

      <div className="space-y-1">
        <label className="block text-[13px] font-medium text-pb-ink" htmlFor="asset-title">
          Title
        </label>
        <input id="asset-title" value={title} onChange={(e) => setTitle(e.target.value)} className={input} />
      </div>
      <div className="space-y-1">
        <label className="block text-[13px] font-medium text-pb-ink" htmlFor="asset-desc">
          Description
        </label>
        <p className="text-xs text-pb-muted">Cube sees only this description, never the file. Say what it is and when to use it.</p>
        <textarea id="asset-desc" value={description} onChange={(e) => setDescription(e.target.value)} rows={3} className={input} />
      </div>
      <JobPicker jobs={jobs} value={jobCodes} onChange={setJobCodes} />
      </fieldset>

      {progress !== null && kind === 'file' && (
        <div className="space-y-1">
          <div
            role="progressbar"
            aria-label="Upload"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(progress * 100)}
            className="h-2 overflow-hidden rounded-full bg-pb-line-soft"
          >
            <div className="h-full bg-pb-accent transition-[width]" style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
          <p className="text-xs text-pb-muted">{saving ? 'Saving…' : `Uploading… ${Math.round(progress * 100)}%`}</p>
          <p className="sr-only" role="status">
            {saving ? 'Upload finished, saving.' : progress === 0 ? 'Upload started.' : ''}
          </p>
        </div>
      )}
      {error && (
        <p role="alert" className="rounded-md bg-pb-check-bg px-3 py-2 text-sm text-pb-check-ink">
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={submit} disabled={!ready} className="rounded-lg bg-pb-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-40">
          {kind === 'file' ? 'Upload and add' : 'Add link'}
        </button>
        {progress !== null && kind === 'file' && !saving ? (
          <button type="button" onClick={() => abortRef.current?.abort()} className="text-sm text-pb-check-ink">
            Cancel upload
          </button>
        ) : progress === null ? (
          <button type="button" onClick={onCancel} className="text-sm text-pb-muted hover:text-pb-ink">
            Cancel
          </button>
        ) : null}
      </div>
    </div>
  );
}

function EditAsset({ asset, jobs, onDone, onCancel }: { asset: ManagedAsset; jobs: Job[]; onDone: () => void; onCancel: () => void }) {
  const [title, setTitle] = useState(asset.title);
  const [description, setDescription] = useState(asset.description);
  const [url, setUrl] = useState(asset.url ?? '');
  const [jobCodes, setJobCodes] = useState(asset.job_codes);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const changed =
    title.trim() !== asset.title ||
    description.trim() !== asset.description ||
    (asset.kind === 'link' && url.trim() !== (asset.url ?? '')) ||
    JSON.stringify(jobCodes) !== JSON.stringify(asset.job_codes);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await updateAsset(createClient(), asset.id, {
        title: title.trim(),
        description: description.trim(),
        job_codes: jobCodes,
        ...(asset.kind === 'link' ? { url: url.trim() } : {}),
      });
      showToast('Asset saved.');
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-3 space-y-3 border-t border-pb-line-soft pt-3">
      <div className="space-y-1">
        <label className="block text-[13px] font-medium" htmlFor={`t-${asset.id}`}>
          Title
        </label>
        <input id={`t-${asset.id}`} value={title} onChange={(e) => setTitle(e.target.value)} className={input} />
      </div>
      {asset.kind === 'link' && (
        <div className="space-y-1">
          <label className="block text-[13px] font-medium" htmlFor={`u-${asset.id}`}>
            Link
          </label>
          <input id={`u-${asset.id}`} type="url" value={url} onChange={(e) => setUrl(e.target.value)} className={input} />
          {!!url.trim() && !HTTP_URL.test(url.trim()) && (
            <p className="text-xs text-pb-check-ink">Enter a full link that starts with http:// or https://.</p>
          )}
        </div>
      )}
      <div className="space-y-1">
        <label className="block text-[13px] font-medium" htmlFor={`d-${asset.id}`}>
          Description
        </label>
        <textarea id={`d-${asset.id}`} value={description} onChange={(e) => setDescription(e.target.value)} rows={3} className={input} />
      </div>
      <JobPicker jobs={jobs} value={jobCodes} onChange={setJobCodes} />
      {error && (
        <p role="alert" className="rounded-md bg-pb-check-bg px-3 py-2 text-sm text-pb-check-ink">
          {error}
        </p>
      )}
      <div className="flex gap-3">
        <button
          type="button"
          onClick={save}
          disabled={
            !changed || saving || !title.trim() || !description.trim() || (asset.kind === 'link' && !HTTP_URL.test(url.trim()))
          }
          className="rounded-lg bg-pb-accent px-3.5 py-1.5 text-sm font-medium text-white disabled:opacity-40"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button type="button" onClick={onCancel} className="text-sm text-pb-muted hover:text-pb-ink">
          Cancel
        </button>
      </div>
    </div>
  );
}

// Contributor Assets screen: files (uploaded straight to Storage) and links,
// each with a title, a description Cube can read, and the jobs it belongs to.
export default function AssetsManager({ playbookId, assets, jobs }: { playbookId: string; assets: ManagedAsset[]; jobs: Job[] }) {
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [orphans, setOrphans] = useState<string[]>([]);
  const { confirm, dialog } = useConfirm();
  const jobName = useMemo(() => new Map(jobs.map((j) => [j.code, j.name])), [jobs]);

  const refresh = () => {
    startRefresh(() => router.refresh());
    listOrphans(createClient(), playbookId).then(setOrphans);
  };

  useEffect(() => {
    let cancelled = false;
    listOrphans(createClient(), playbookId).then((o) => {
      if (!cancelled) setOrphans(o);
    });
    return () => {
      cancelled = true;
    };
  }, [playbookId]);

  async function remove(a: ManagedAsset) {
    const ok = await confirm({
      title: 'Delete this asset?',
      message: (
        <>
          &ldquo;{a.title}&rdquo; will be removed from every job{a.kind === 'file' ? ', and the file deleted' : ''}. This
          can&apos;t be undone.
        </>
      ),
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    try {
      await deleteAsset(createClient(), a);
      showToast('Asset deleted.');
      refresh();
    } catch (err) {
      showToast(`Couldn’t delete: ${err instanceof Error ? err.message : String(err)}`, 'error');
    }
  }

  async function cleanUp() {
    try {
      const n = await removeOrphans(createClient(), playbookId);
      showToast(n ? `Removed ${n} file${n > 1 ? 's' : ''}.` : 'Nothing to remove any more.');
      setOrphans(await listOrphans(createClient(), playbookId));
    } catch (err) {
      showToast(`Couldn’t clean up: ${err instanceof Error ? err.message : String(err)}`, 'error');
    }
  }

  return (
    <div className="space-y-5 text-pb-ink">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-xl text-sm leading-relaxed text-pb-muted">
          Templates, sheets, guides and links for this playbook. Each one shows in the jobs it belongs to. Cube sees only
          its title, description and jobs, never the file itself.
        </p>
        {!adding && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="rounded-lg bg-pb-accent px-3.5 py-1.5 text-sm font-medium text-white transition hover:opacity-90"
          >
            + Add an asset
          </button>
        )}
      </div>

      {orphans.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-pb-thin-bg px-4 py-2.5 text-sm text-pb-thin-ink">
          <span>
            {orphans.length} uploaded file{orphans.length > 1 ? 's have' : ' has'} no asset (an upload that didn’t finish
            saving).
          </span>
          <button type="button" onClick={cleanUp} className="font-medium underline underline-offset-2">
            Remove {orphans.length > 1 ? 'them' : 'it'}
          </button>
        </div>
      )}

      {adding && (
        <AddAsset
          playbookId={playbookId}
          jobs={jobs}
          onDone={() => {
            setAdding(false);
            refresh();
          }}
          onCancel={() => setAdding(false)}
          onFailed={() => listOrphans(createClient(), playbookId).then(setOrphans)}
        />
      )}

      {refreshing && (
        <p role="status" className="text-xs text-pb-muted">
          Updating…
        </p>
      )}

      {assets.length === 0 && !adding ? (
        <p className="rounded-xl border border-dashed border-pb-line bg-pb-surface px-5 py-6 text-sm text-pb-muted">No assets yet.</p>
      ) : (
        <ul className="space-y-3">
          {assets.map((a) => (
            <li key={a.id} className="rounded-xl border border-pb-line bg-pb-surface px-4 py-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <AssetLink asset={a} className="font-medium text-pb-accent underline-offset-2 hover:underline" />
                  <span className="ml-2 rounded-full bg-pb-bg px-2 py-0.5 text-[11px] text-pb-muted">{a.kind === 'file' ? 'File' : 'Link'}</span>
                </div>
                <div className="flex gap-3 text-xs">
                  <button type="button" onClick={() => setEditing(editing === a.id ? null : a.id)} className="text-pb-accent hover:underline">
                    {editing === a.id ? 'Close' : 'Edit'}
                  </button>
                  <button type="button" onClick={() => remove(a)} className="text-pb-check-ink hover:underline">
                    Delete
                  </button>
                </div>
              </div>
              <p className="mt-1 text-sm text-pb-muted">{a.description}</p>
              <p className="mt-1.5 text-xs text-pb-muted">
                {a.job_codes.length ? (
                  <>Jobs: {a.job_codes.map((c) => jobName.get(c) ?? `${c} (no longer in the playbook)`).join(', ')}</>
                ) : (
                  'General resource (not tied to a job)'
                )}
              </p>
              {editing === a.id && (
                <EditAsset
                  asset={a}
                  jobs={jobs}
                  onDone={() => {
                    setEditing(null);
                    refresh();
                  }}
                  onCancel={() => setEditing(null)}
                />
              )}
            </li>
          ))}
        </ul>
      )}
      {dialog}
    </div>
  );
}
