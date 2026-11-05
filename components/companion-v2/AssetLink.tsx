'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';

export interface AssetLinkData {
  id: string;
  title: string;
  kind: 'file' | 'link';
  url: string | null;
  storage_path: string | null;
  description?: string;
}

// Opens a link asset directly, or a file asset through a short-lived signed
// URL (the bucket is private; Storage RLS lets playbook members read).
export default function AssetLink({ asset, className = '' }: { asset: AssetLinkData; className?: string }) {
  const [error, setError] = useState<string | null>(null);

  if (asset.kind === 'link' && asset.url) {
    return (
      <a href={asset.url} target="_blank" rel="noopener noreferrer" className={className}>
        {asset.title} <span aria-hidden>↗</span>
      </a>
    );
  }

  async function open() {
    if (!asset.storage_path) return;
    setError(null);
    // Open the tab synchronously (popup blockers), then point it at the file.
    const tab = window.open('', '_blank');
    if (!tab) {
      setError('Your browser blocked the new tab. Allow pop-ups for this site and try again.');
      return;
    }
    // The file is uploaded content: cut its link back to this app (no
    // reverse tabnabbing).
    tab.opener = null;
    const { data, error: signError } = await createClient()
      .storage.from('assets')
      .createSignedUrl(asset.storage_path, 60);
    if (signError || !data?.signedUrl) {
      tab.close();
      setError("Couldn't open this file. Please try again.");
      return;
    }
    tab.location.href = data.signedUrl;
  }

  return (
    <>
      <button type="button" onClick={open} className={className}>
        {asset.title} <span aria-hidden>↓</span>
      </button>
      {error && (
        <span role="status" className="ml-2 text-xs text-pb-check-ink">
          {error}
        </span>
      )}
    </>
  );
}
