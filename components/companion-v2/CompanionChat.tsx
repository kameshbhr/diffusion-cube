'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import WikiMarkdown from '@/components/WikiMarkdown';
import { useCompanionChat } from '@/lib/companion-v2/use-companion-chat';
import type { JobState } from '@/lib/companion-v2/types';

export interface ChatJob {
  code: string;
  name: string;
  when: string;
  tag: 'Owns' | 'Tracks' | null;
}

export interface ChatAsset {
  id: string;
  title: string;
  kind: 'file' | 'link';
  url: string | null;
}

interface Props {
  slug: string;
  playbookId: string;
  memberId: string;
  jobs: ChatJob[];
  assets: ChatAsset[];
  /** From "Ask Cube about this job" (?job=CODE). */
  initialJob?: string | null;
}

const CHIPS = [
  'Where do I start?',
  'What do I own, and what do I only track?',
  'How long will this take and what will it cost?',
  'What usually goes wrong, and how do I avoid it?',
];

const STATE_LABEL: Record<JobState, string> = {
  discussed: 'Discussed',
  in_progress: 'In progress',
  done: 'Done',
  skipped: 'Skipped',
};

function shortWhen(when: string): string {
  const first = when.split(/(?<=\.)\s/)[0] ?? when;
  return first.length > 110 ? `${first.slice(0, 107).trimEnd()}…` : first;
}

export default function CompanionChat({ slug, playbookId, memberId, jobs, assets, initialJob }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const jobByCode = useMemo(() => new Map(jobs.map((j) => [j.code, j])), [jobs]);
  const assetById = useMemo(() => new Map(assets.map((a) => [a.id, a])), [assets]);

  const jobCodes = useMemo(() => jobs.map((j) => j.code), [jobs]);
  const assetIds = useMemo(() => assets.map((a) => a.id), [assets]);
  const chat = useCompanionChat({ playbookId, memberId, jobCodes, assetIds });

  const [draft, setDraft] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // On first load: answer "Ask Cube about this job", or let Cube open an
  // empty conversation.
  const opened = useRef(false);
  const { ready, send, kickoff } = chat;
  useEffect(() => {
    if (!ready || opened.current) return;
    opened.current = true;
    const job = initialJob ? jobByCode.get(initialJob) : undefined;
    if (job) {
      router.replace(pathname);
      const text = `Tell me about "${job.name}".`;
      send(text, { focusJob: job.code }).then((result) => {
        if (result === false) setDraft(text);
      });
    } else {
      kickoff(ready);
    }
  }, [ready, initialJob, jobByCode, kickoff, send, router, pathname]);

  // Keep the newest message in view.
  const lastContent = chat.messages[chat.messages.length - 1]?.content;
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [chat.messages.length, lastContent]);

  // Auto-grow the composer.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [draft]);

  async function submit(text: string) {
    if (!text.trim() || chat.busy) return;
    setDraft('');
    const result = await send(text);
    // A failed turn stores nothing: put the text back so it isn't lost. null
    // means it never started (a turn was already running, e.g. a double Enter
    // of the same text), so there is nothing to restore.
    if (result === false) setDraft(text);
    textareaRef.current?.focus();
  }

  const hasUserMessage = chat.messages.some((m) => m.role === 'user');
  const showChips = !chat.loading && !hasUserMessage && !chat.busy && chat.error?.kind !== 'limit';

  return (
    <div className="flex min-h-[60vh] flex-1 flex-col">
      <div className="mb-3 flex items-center justify-end">
        <button
          type="button"
          onClick={() => chat.startNewConversation()}
          disabled={chat.busy || chat.loading || !hasUserMessage}
          className="text-xs text-pb-muted transition hover:text-pb-accent disabled:opacity-0"
        >
          Start a new conversation
        </button>
      </div>

      <div className="flex-1 space-y-5" aria-live="polite">
        {chat.loading && <p className="text-sm text-pb-muted">Opening your conversation…</p>}

        {chat.messages.map((m) =>
          m.role === 'user' ? (
            <div key={m.id} className="flex justify-end">
              <p className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-pb-accent px-4 py-2.5 text-[15px] leading-relaxed text-white">
                {m.content}
              </p>
            </div>
          ) : (
            <div key={m.id} className="max-w-[92%]">
              {m.pending && !m.content ? (
                <span className="inline-flex gap-1 py-2" aria-label="Cube is writing">
                  {[0, 1, 2].map((i) => (
                    <span
                      key={i}
                      className="h-1.5 w-1.5 animate-bounce-dot rounded-full bg-pb-muted"
                      style={{ animationDelay: `${i * 0.15}s` }}
                    />
                  ))}
                </span>
              ) : (
                <div className="text-[15px] leading-relaxed text-pb-ink [&_li]:my-0.5 [&_p]:my-2">
                  <WikiMarkdown markdown={m.content} />
                </div>
              )}

              {!!m.ui?.focusJobs.length && (
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {m.ui.focusJobs.map((code) => {
                    const job = jobByCode.get(code);
                    if (!job) return null;
                    const state = chat.jobStates[code];
                    return (
                      <Link
                        key={code}
                        href={`/companion/${slug}/jobs?open=${encodeURIComponent(code)}`}
                        className="block rounded-xl border border-pb-line bg-pb-surface px-4 py-3 transition hover:border-pb-accent"
                      >
                        <span className="flex items-start justify-between gap-2">
                          <span className="text-sm font-medium text-pb-ink">{job.name}</span>
                          {job.tag && (
                            <span
                              className={`flex-shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                                job.tag === 'Owns' ? 'bg-pb-accent text-white' : 'bg-pb-accent-soft text-pb-accent'
                              }`}
                            >
                              {job.tag}
                            </span>
                          )}
                        </span>
                        <span className="mt-1 block text-xs leading-snug text-pb-muted">{shortWhen(job.when)}</span>
                        {state && <span className="mt-1.5 block text-[11px] text-pb-deliver">{STATE_LABEL[state]}</span>}
                      </Link>
                    );
                  })}
                </div>
              )}

              {!!m.ui?.showAssets.length && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {m.ui.showAssets.map((id) => {
                    const a = assetById.get(id);
                    if (!a) return null;
                    return a.kind === 'link' && a.url ? (
                      <a
                        key={id}
                        href={a.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="rounded-full border border-pb-line bg-pb-surface px-3 py-1 text-xs text-pb-accent transition hover:border-pb-accent"
                      >
                        {a.title} ↗
                      </a>
                    ) : (
                      <span
                        key={id}
                        className="rounded-full border border-pb-line bg-pb-surface px-3 py-1 text-xs text-pb-muted"
                        title="Files open from the job's page"
                      >
                        {a.title}
                      </span>
                    );
                  })}
                </div>
              )}
            </div>
          )
        )}

        {chat.error && (
          <div
            role="alert"
            className={`rounded-xl border px-4 py-3 text-sm ${
              chat.error.kind === 'limit'
                ? 'border-pb-line bg-pb-surface text-pb-muted'
                : 'border-pb-check-bg bg-pb-check-bg text-pb-check-ink'
            }`}
          >
            <p>{chat.error.message}</p>
            {chat.error.kind === 'retry' && (
              <button
                type="button"
                onClick={() => {
                  const text = chat.error?.kind === 'retry' ? chat.error.text : '';
                  setDraft('');
                  chat.retry().then((result) => {
                    if (result === false && text) setDraft(text);
                  });
                }}
                className="mt-2 font-medium underline underline-offset-2"
              >
                Retry
              </button>
            )}
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="sticky bottom-0 mt-6 bg-pb-bg pb-2 pt-3">
        {showChips && (
          <div className="mb-3 flex flex-wrap gap-2">
            {CHIPS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => submit(c)}
                disabled={!chat.conversationId}
                className="rounded-full border border-pb-line bg-pb-surface px-3.5 py-1.5 text-left text-sm text-pb-ink transition hover:border-pb-accent hover:bg-pb-accent-soft disabled:opacity-50"
              >
                {c}
              </button>
            ))}
          </div>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit(draft);
          }}
          className="flex items-end gap-2 rounded-2xl border border-pb-line bg-pb-surface p-2 focus-within:border-pb-accent"
        >
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submit(draft);
              }
            }}
            rows={1}
            maxLength={8000}
            placeholder="Ask Cube anything about this work…"
            aria-label="Message Cube"
            disabled={chat.loading || chat.error?.kind === 'limit'}
            className="max-h-[200px] min-h-[40px] flex-1 resize-none bg-transparent px-2 py-2 text-[15px] text-pb-ink outline-none placeholder:text-pb-muted"
          />
          <button
            type="submit"
            disabled={!draft.trim() || chat.busy || chat.loading || !chat.conversationId}
            aria-label="Send"
            className="mb-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-pb-accent text-white transition hover:opacity-90 disabled:opacity-40"
          >
            ↑
          </button>
        </form>
        <p className="mt-2 text-center text-[11px] text-pb-muted">
          Cube answers from this playbook and its source document only, and can be wrong.
        </p>
      </div>
    </div>
  );
}
