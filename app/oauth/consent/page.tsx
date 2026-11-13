'use client';

// Cube connector approval page (cube-connector/README.md).
//
// When someone connects Claude to the Cube connector, Supabase's OAuth 2.1
// server sends their browser here (Site URL + the authorization path set in
// Authentication → OAuth Server) with ?authorization_id=<id>. proxy.ts sends
// a signed-out visitor to /login first and brings them back with the id kept.
//
// The check here (office email, confirmed) is for a clear message only. The
// connector repeats it on every tool call, so approving here can't widen
// access.

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

const ALLOWED_DOMAINS = (process.env.NEXT_PUBLIC_CUBE_ALLOWED_DOMAINS || 'ekstep.org')
  .split(',')
  .map((d) => d.trim().toLowerCase().replace(/^@/, ''))
  .filter(Boolean);
const ALLOWED_TEXT = ALLOWED_DOMAINS.map((d) => `@${d}`).join(' or ');

// Claude's own addresses (and localhost, for testing with the MCP Inspector).
// Anything else still works but gets a warning, because dynamic registration
// lets anyone register an app called "Claude".
const TRUSTED_REDIRECT_HOSTS = ['claude.ai', 'claude.com', 'localhost', '127.0.0.1'];

const primaryButtonClass =
  'flex-1 bg-navy hover:bg-coral disabled:opacity-60 text-white rounded-xl py-2.5 text-sm font-medium transition-colors';
const secondaryButtonClass =
  'flex-1 border border-navy/15 hover:border-coral hover:text-coral disabled:opacity-60 text-navy rounded-xl py-2.5 text-sm font-medium transition-colors';
const linkButtonClass = 'text-xs text-ink-soft hover:text-coral transition-colors disabled:opacity-60';

type View =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'refused'; email: string; reason: 'domain' | 'unconfirmed' }
  | { kind: 'consent'; email: string; clientName: string; redirectHost: string; trusted: boolean };

function hostOf(uri: string): string {
  try {
    return new URL(uri).host;
  } catch {
    return '';
  }
}

function isTrusted(uri: string): boolean {
  try {
    const host = new URL(uri).hostname.toLowerCase();
    return TRUSTED_REDIRECT_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
  } catch {
    return false;
  }
}

function emailAllowed(email: string): boolean {
  const domain = email.slice(email.lastIndexOf('@') + 1).toLowerCase();
  return email.includes('@') && ALLOWED_DOMAINS.includes(domain);
}

function ConsentInner() {
  const searchParams = useSearchParams();
  const authorizationId = searchParams.get('authorization_id');
  const [loadedView, setView] = useState<View>({ kind: 'loading' });
  const view: View = authorizationId
    ? loadedView
    : { kind: 'error', message: 'This link is missing its sign-in request. Start again from Claude.' };
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const thisPage = `/oauth/consent?authorization_id=${encodeURIComponent(authorizationId ?? '')}`;

  useEffect(() => {
    if (!authorizationId) return;
    let cancelled = false;
    (async () => {
      const supabase = createClient();
      const { data: userData } = await supabase.auth.getUser();
      const user = userData.user;
      if (!user) {
        window.location.replace(`/login?next=${encodeURIComponent(thisPage)}`);
        return;
      }
      const email = (user.email ?? '').toLowerCase();
      if (!user.email_confirmed_at) {
        if (!cancelled) setView({ kind: 'refused', email, reason: 'unconfirmed' });
        return;
      }
      if (!emailAllowed(email)) {
        if (!cancelled) setView({ kind: 'refused', email, reason: 'domain' });
        return;
      }

      const { data, error } = await supabase.auth.oauth.getAuthorizationDetails(authorizationId);
      if (cancelled) return;
      if (error || !data) {
        setView({
          kind: 'error',
          message: `This sign-in request couldn't be loaded (${error?.message ?? 'unknown error'}). It may have expired: start again from Claude.`,
        });
        return;
      }
      // Approved before: Supabase hands back the redirect straight away.
      if ('redirect_url' in data && data.redirect_url) {
        window.location.replace(data.redirect_url);
        return;
      }
      const details = data as { client?: { name?: string }; redirect_uri?: string };
      const redirectUri = details.redirect_uri ?? '';
      setView({
        kind: 'consent',
        email,
        clientName: details.client?.name || 'An application',
        redirectHost: hostOf(redirectUri) || 'an unknown address',
        trusted: isTrusted(redirectUri),
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [authorizationId, thisPage]);

  async function decide(approve: boolean) {
    if (!authorizationId) return;
    setBusy(true);
    setActionError(null);
    const supabase = createClient();
    const { data, error } = approve
      ? await supabase.auth.oauth.approveAuthorization(authorizationId, { skipBrowserRedirect: true })
      : await supabase.auth.oauth.denyAuthorization(authorizationId, { skipBrowserRedirect: true });
    const redirectUrl = (data as { redirect_url?: string } | null)?.redirect_url;
    if (error || !redirectUrl) {
      setBusy(false);
      setActionError(error?.message ?? 'Something went wrong. Please try again.');
      return;
    }
    window.location.assign(redirectUrl);
  }

  async function switchAccount() {
    setBusy(true);
    await createClient().auth.signOut();
    window.location.replace(`/login?next=${encodeURIComponent(thisPage)}`);
  }

  let content;
  if (view.kind === 'loading') {
    content = <p className="text-sm text-ink-soft">Loading…</p>;
  } else if (view.kind === 'error') {
    content = (
      <>
        <h2 className="font-display text-lg font-medium text-navy">Couldn&apos;t connect</h2>
        <p className="text-sm text-ink">{view.message}</p>
      </>
    );
  } else if (view.kind === 'refused') {
    content = (
      <>
        <h2 className="font-display text-lg font-medium text-navy">This account can&apos;t connect</h2>
        <p className="text-sm text-ink">
          {view.reason === 'domain' ? (
            <>
              You&apos;re signed in as <strong className="font-medium text-navy">{view.email}</strong>. Only {ALLOWED_TEXT}{' '}
              accounts can connect Claude to the Cube.
            </>
          ) : (
            <>
              The email for <strong className="font-medium text-navy">{view.email}</strong> isn&apos;t verified yet. Sign in
              again to get a new code.
            </>
          )}
        </p>
        {actionError && <p className="text-xs text-coral">{actionError}</p>}
        <div className="mt-2 flex gap-3">
          <button type="button" onClick={switchAccount} disabled={busy} className={primaryButtonClass}>
            Use another account
          </button>
          <button type="button" onClick={() => decide(false)} disabled={busy} className={secondaryButtonClass}>
            Cancel
          </button>
        </div>
      </>
    );
  } else {
    content = (
      <>
        <h2 className="font-display text-lg font-medium text-navy">Connect {view.clientName} to the Cube?</h2>
        <p className="text-sm text-ink">
          {view.clientName} will be able to search the team&apos;s notes and add notes for you. Notes you add are saved under
          your name.
        </p>
        <dl className="flex flex-col gap-2 rounded-xl bg-paper px-4 py-3 text-xs">
          <div>
            <dt className="text-ink-soft">Signed in as</dt>
            <dd className="font-medium text-navy break-all">{view.email}</dd>
          </div>
          <div>
            <dt className="text-ink-soft">Sends you back to</dt>
            <dd className="font-mono text-navy break-all">{view.redirectHost}</dd>
          </div>
        </dl>
        {!view.trusted && (
          <p role="alert" className="rounded-xl border border-coral/40 bg-coral/5 px-4 py-3 text-xs text-coral">
            This isn&apos;t Claude&apos;s usual address. Don&apos;t approve unless you know and trust {view.redirectHost}: it
            would be able to read and add Cube notes as you.
          </p>
        )}
        {actionError && <p className="text-xs text-coral">{actionError}</p>}
        <div className="mt-2 flex gap-3">
          <button type="button" onClick={() => decide(true)} disabled={busy} className={primaryButtonClass}>
            {busy ? 'Please wait…' : 'Approve'}
          </button>
          <button type="button" onClick={() => decide(false)} disabled={busy} className={secondaryButtonClass}>
            Deny
          </button>
        </div>
        <button type="button" onClick={switchAccount} disabled={busy} className={`${linkButtonClass} self-start`}>
          Not you? Use another account
        </button>
      </>
    );
  }

  return (
    <div className="min-h-screen bg-paper flex flex-col items-center justify-center px-6">
      <div className="mb-8 text-center">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-coral">100 Pathways</p>
        <h1 className="mt-2 font-display text-3xl font-medium tracking-tight text-navy">
          Diffusion <span className="font-serif italic text-coral">Cube</span>
        </h1>
      </div>
      <div className="w-full max-w-sm bg-white border border-navy/10 rounded-2xl p-8 flex flex-col gap-4">{content}</div>
    </div>
  );
}

export default function OAuthConsentPage() {
  return (
    <Suspense fallback={null}>
      <ConsentInner />
    </Suspense>
  );
}
