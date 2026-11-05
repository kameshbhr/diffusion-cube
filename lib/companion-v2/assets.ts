'use client';

// Assets for a playbook: files in the private `assets` Storage bucket, or
// links. Uploads go straight from the browser to Supabase Storage with the
// contributor's own session (never through a Next.js route: Vercel functions
// can't take a 100 MB body). Storage RLS (migration 0035) lets only
// contributors of the playbook write under `{playbook_id}/`.
//
// Order for a file: upload the object, then insert the row; if the insert
// fails, remove the object straight away so no file is left without a row.
// Delete runs the other way: row first, then the object. Anything left behind
// by a failed clean-up shows in the asset_orphans view.

import type { SupabaseClient } from '@supabase/supabase-js';

export const BUCKET = 'assets';
export const MAX_FILE_BYTES = 100 * 1024 * 1024;
/** Objects younger than this aren't offered for clean-up (an upload may still be saving its row). */
const ORPHAN_MIN_AGE_MS = 10 * 60 * 1000;

/**
 * Types a browser may show inline. Everything else is stored as
 * application/octet-stream and opened as a download, so an uploaded HTML or
 * SVG file never renders on the storage domain.
 */
const INLINE_TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  txt: 'text/plain',
};
const extOf = (name: string) => (name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : '');
export const contentTypeFor = (name: string) => INLINE_TYPES[extOf(name)] ?? 'application/octet-stream';
/** Whether a stored file can open in the browser (else it downloads). */
export const opensInline = (path: string) => extOf(path) in INLINE_TYPES;

export interface AssetInput {
  title: string;
  description: string;
  job_codes: string[];
}

/** A Storage-safe file name that keeps the extension. */
export function safeFileName(name: string): string {
  const dot = name.lastIndexOf('.');
  const ext = dot > 0 ? name.slice(dot).toLowerCase().replace(/[^.a-z0-9]/g, '') : '';
  const stem = (dot > 0 ? name.slice(0, dot) : name)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 100);
  return `${stem || 'file'}${ext.slice(0, 12)}`;
}

/**
 * Uploads one object with progress (XMLHttpRequest; supabase-js has no
 * progress callback). Resolves on 2xx; rejects with the server's message.
 */
export async function uploadWithProgress(
  supabase: SupabaseClient,
  path: string,
  file: File,
  onProgress: (fraction: number) => void,
  signal?: AbortSignal
): Promise<void> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new Error('Your session has ended. Please sign in again.');
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL!.replace(/\/$/, '');
  const url = `${base}/storage/v1/object/${BUCKET}/${path.split('/').map(encodeURIComponent).join('/')}`;

  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    xhr.setRequestHeader('Authorization', `Bearer ${session.access_token}`);
    xhr.setRequestHeader('apikey', process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
    xhr.setRequestHeader('x-upsert', 'false');
    xhr.setRequestHeader('Content-Type', contentTypeFor(path));
    xhr.setRequestHeader('cache-control', 'max-age=3600');
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    const onAbort = () => xhr.abort();
    xhr.onload = () => {
      signal?.removeEventListener('abort', onAbort);
      if (xhr.status >= 200 && xhr.status < 300) return resolve();
      let msg = `Upload failed (${xhr.status}).`;
      try {
        const body = JSON.parse(xhr.responseText);
        msg = body.message || body.error || msg;
      } catch {
        /* keep the status message */
      }
      if (xhr.status === 413 || /maximum allowed size|too large/i.test(msg))
        msg = 'This file is bigger than the project allows. (The Supabase project’s upload limit may be lower than 100 MB.)';
      if (xhr.status === 403 || /row-level security/i.test(msg)) msg = 'You can’t upload files to this playbook.';
      reject(new Error(msg));
    };
    xhr.onerror = () => reject(new Error('The upload was interrupted. Check your connection and try again.'));
    xhr.onabort = () => reject(new Error('Upload cancelled.'));
    signal?.addEventListener('abort', onAbort);
    xhr.send(file);
  });
}

/** Upload, then insert the row; remove the object if the insert fails. */
export async function createFileAsset(
  supabase: SupabaseClient,
  playbookId: string,
  file: File,
  input: AssetInput,
  onProgress: (fraction: number) => void,
  signal?: AbortSignal,
  /** Called once the file is uploaded and the row is being saved (no cancelling from here). */
  onSaving?: () => void
): Promise<{ id: string }> {
  if (file.size > MAX_FILE_BYTES) throw new Error('Files can be up to 100 MB.');
  const id = crypto.randomUUID();
  const path = `${playbookId}/${id}/${safeFileName(file.name)}`;
  await uploadWithProgress(supabase, path, file, onProgress, signal);
  onSaving?.();

  const { error } = await supabase.from('assets').insert({
    id,
    playbook_id: playbookId,
    kind: 'file',
    storage_path: path,
    url: null,
    title: input.title.trim(),
    description: input.description.trim(),
    job_codes: input.job_codes,
  });
  if (error) {
    // Don't leave a file without a row. Under RLS a refused removal returns
    // no error but no removed objects, so check both.
    const { data: removed, error: rmError } = await supabase.storage.from(BUCKET).remove([path]);
    const cleaned = !rmError && (removed?.length ?? 0) > 0;
    throw new Error(
      cleaned
        ? `The file was uploaded but couldn’t be saved, so it was removed again: ${error.message}`
        : `The file was uploaded but couldn’t be saved, and it couldn’t be removed either (${error.message}). It will show under clean-up.`
    );
  }
  return { id };
}

export async function createLinkAsset(supabase: SupabaseClient, playbookId: string, url: string, input: AssetInput) {
  const { error } = await supabase.from('assets').insert({
    playbook_id: playbookId,
    kind: 'link',
    url: url.trim(),
    storage_path: null,
    title: input.title.trim(),
    description: input.description.trim(),
    job_codes: input.job_codes,
  });
  if (error) throw new Error(/assets_url_http/.test(error.message) ? 'Links must start with http:// or https://.' : error.message);
}

export async function updateAsset(supabase: SupabaseClient, id: string, patch: Partial<AssetInput> & { url?: string }) {
  const { data, error } = await supabase.from('assets').update(patch).eq('id', id).select('id');
  if (error) throw new Error(/assets_url_http/.test(error.message) ? 'Links must start with http:// or https://.' : error.message);
  // RLS hides rows you can't change: zero rows means nothing was saved.
  if (!data?.length) throw new Error('This asset couldn’t be changed. You may no longer be a contributor; reload the page.');
}

/** Row first, then the file. A file left by a failed removal shows as an orphan. */
export async function deleteAsset(supabase: SupabaseClient, asset: { id: string; storage_path: string | null }) {
  const { data, error } = await supabase.from('assets').delete().eq('id', asset.id).select('id');
  if (error) throw new Error(error.message);
  if (!data?.length) throw new Error('This asset couldn’t be deleted. You may no longer be a contributor; reload the page.');
  if (asset.storage_path) {
    const { data: removed, error: rmError } = await supabase.storage.from(BUCKET).remove([asset.storage_path]);
    if (rmError || !removed?.length) console.warn('[assets] file not removed; it will show under clean-up:', rmError ?? 'nothing removed');
  }
}

export async function listOrphans(supabase: SupabaseClient, playbookId: string): Promise<string[]> {
  // Only files old enough that no upload can still be saving its row.
  const cutoff = new Date(Date.now() - ORPHAN_MIN_AGE_MS).toISOString();
  const { data, error } = await supabase
    .from('asset_orphans')
    .select('storage_path')
    .eq('playbook_id', playbookId)
    .lt('created_at', cutoff);
  if (error) {
    console.warn('[assets] could not list files without an asset:', error);
    return [];
  }
  return (data ?? []).map((r) => r.storage_path as string);
}

/**
 * Removes files that have no asset row. The list is fetched again here (not
 * taken from what the page showed earlier), so a file that got its row in the
 * meantime is never deleted.
 */
export async function removeOrphans(supabase: SupabaseClient, playbookId: string): Promise<number> {
  const paths = await listOrphans(supabase, playbookId);
  if (!paths.length) return 0;
  const { data, error } = await supabase.storage.from(BUCKET).remove(paths);
  if (error) throw new Error(error.message);
  return data?.length ?? 0;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
