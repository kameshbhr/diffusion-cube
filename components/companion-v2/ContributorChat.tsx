'use client';

import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import WikiMarkdown from '@/components/WikiMarkdown';
import PatchReview from './PatchReview';
import { useConfirm } from '@/components/ConfirmDialog';
import { showToast } from '@/lib/toast';
import { useLeaveWarning } from '@/lib/companion-v2/leave-warning';
import type { Snapshot } from '@/lib/companion-v2/patch';
import { useContributorChat, type ContributorMessage } from '@/lib/companion-v2/use-contributor-chat';
import { approxTokens, chunkFiles, MAX_UPLOAD_CHARS, type UploadedText } from '@/lib/companion-v2/playbook-patch';

interface Props {
  playbookId: string;
  base: Snapshot;
  /** updated_at exactly as loaded; a save fails as stale if it has moved. */
  updatedAt: string;
}

const CHIPS = ['Edit a job', 'Edit the overview, roles, sequence or rules', "What's missing from the playbook?"] as const;
const ACCEPT = '.pdf,.docx,.pptx,.xlsx,.xls,.md,.txt';

interface Attachment {
  id: string;
  name: string;
  status: 'reading' | 'ready' | 'error';
  text?: string;
  error?: string;
}

let attachSeq = 0;

// The contributor's Converse tab: ask about the playbook, ask for a change, or
// add files with "+"; Cube proposes changes, shown as a diff under its reply.
// Nothing changes until Apply, and this conversation is never saved.
export default function ContributorChat({ playbookId, base, updatedAt }: Props) {
  const router = useRouter();
  const { confirm, dialog } = useConfirm();
  const chat = useContributorChat({ playbookId, base, updatedAt });
  const [draft, setDraft] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [refreshing, startRefresh] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const ready = attachments.filter((a) => a.status === 'ready');
  const reading = attachments.some((a) => a.status === 'reading');
  const uploadChars = ready.reduce((n, a) => n + (a.text?.length ?? 0), 0);
  const tooMuch = uploadChars > MAX_UPLOAD_CHARS;
  const partCount = useMemo(() => {
    const files = attachments.filter((a) => a.status === 'ready').map((a) => ({ name: a.name, text: a.text ?? '' }));
    return files.length ? chunkFiles(files).length : 0;
  }, [attachments]);
  const openProposals = chat.messages.some((m) => m.status === 'open');

  // Warn before leaving with a proposal not yet applied or work in the composer.
  const unsaved = openProposals || chat.busy || ready.length > 0 || draft.trim().length > 0;
  useLeaveWarning(unsaved);

  // Keep the newest message in view.
  const last = chat.messages[chat.messages.length - 1];
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [chat.messages.length, last?.pending]);

  // Auto-grow the composer.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  }, [draft]);

  async function addFiles(list: FileList | null) {
    if (!list?.length) return;
    const picked = [...list].map((f) => ({ file: f, id: `a${attachSeq++}` }));
    setAttachments((prev) => [...prev, ...picked.map(({ file, id }) => ({ id, name: file.name, status: 'reading' as const }))]);
    // The text is read here in the browser; the files themselves are never uploaded or stored.
    const { extractTextFromFile } = await import('@/lib/extract-text');
    await Promise.all(
      picked.map(async ({ file, id }) => {
        let next: Partial<Attachment>;
        try {
          const text = (await extractTextFromFile(file)).trim();
          next = text ? { status: 'ready', text } : { status: 'error', error: 'No text found in this file.' };
        } catch (err) {
          next = {
            status: 'error',
            error: err instanceof Error && /image/i.test(err.message) ? 'Only PDF, Word, PowerPoint, Excel, Markdown and text files can be read.' : 'This file couldn’t be read.',
          };
        }
        setAttachments((prev) => prev.map((a) => (a.id === id ? { ...a, ...next } : a)));
      })
    );
  }

  async function submit(text: string) {
    // Not while the page reloads after an Apply: Cube would see the old playbook.
    if (chat.busy || refreshing || reading || tooMuch) return;
    const files: UploadedText[] = ready.map((a) => ({ name: a.name, text: a.text ?? '' }));
    if (!text.trim() && !files.length) return;
    const keptDraft = text;
    const keptFiles = attachments;
    setDraft('');
    setAttachments([]);
    const ok = await chat.send(text, files);
    if (!ok) {
      // Nothing arrived: put the text and files back.
      setDraft(keptDraft);
      setAttachments(keptFiles);
    }
    textareaRef.current?.focus();
  }

  async function startOver() {
    if (openProposals) {
      const yes = await confirm({
        title: 'Start over?',
        message: 'Changes Cube proposed that you haven’t applied will be lost.',
        confirmLabel: 'Start over',
        danger: true,
      });
      if (!yes) return;
    }
    chat.reset();
  }

  const canSend = !chat.busy && !refreshing && !reading && !tooMuch && (draft.trim().length > 0 || ready.length > 0);

  return (
    <div className="flex min-h-[60vh] flex-1 flex-col">
      {dialog}
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-[62ch] text-sm leading-relaxed text-pb-muted">
          Ask Cube about the playbook or ask it to change something. To update the playbook from documents, add them with +. Each
          change is shown first; nothing changes until you apply it. This conversation isn’t saved.
        </p>
        {chat.messages.length > 0 && (
          <button type="button" onClick={startOver} className="text-xs text-pb-muted transition hover:text-pb-accent">
            Start over
          </button>
        )}
      </div>

      <div className="flex-1 space-y-6">
        {chat.messages.map((m) =>
          m.role === 'user' ? (
            <div key={m.id} className="flex flex-col items-end gap-1.5">
              <p className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-pb-accent px-4 py-2.5 text-[15px] leading-relaxed text-white">
                {m.content}
              </p>
              {m.files?.map((f) => (
                <span key={f.name} className="max-w-[85%] break-all text-xs text-pb-muted">
                  📄 {f.name} · {f.chars.toLocaleString('en')} characters
                </span>
              ))}
            </div>
          ) : (
            <Reply
              key={m.id}
              message={m}
              base={base}
              playbookId={playbookId}
              updatedAt={updatedAt}
              disabled={refreshing || chat.busy}
              onApplied={() => {
                chat.setStatus(m.id, 'applied');
                showToast('Applied. The change is live.');
                startRefresh(() => router.refresh());
              }}
              onDiscard={() => chat.setStatus(m.id, 'discarded')}
              onReload={() => startRefresh(() => router.refresh())}
            />
          )
        )}

        {chat.error && (
          <div
            role="alert"
            className={`rounded-xl border px-4 py-3 text-sm ${
              chat.error.kind === 'limit' ? 'border-pb-line bg-pb-surface text-pb-muted' : 'border-pb-check-bg bg-pb-check-bg text-pb-check-ink'
            }`}
          >
            {chat.error.message}
            {chat.error.kind === 'retry' && ' Your message is back in the box below.'}
          </div>
        )}
        {refreshing && (
          <p role="status" className="text-xs text-pb-muted">
            Updating the playbook…
          </p>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="sticky bottom-0 mt-6 bg-pb-bg pb-2 pt-3">
        {chat.messages.length === 0 && !chat.busy && (
          <div className="mb-3 flex flex-wrap gap-2">
            {CHIPS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => submit(c)}
                className="rounded-full border border-pb-line bg-pb-surface px-3.5 py-1.5 text-left text-sm text-pb-ink transition hover:border-pb-accent hover:bg-pb-accent-soft"
              >
                {c}
              </button>
            ))}
          </div>
        )}

        {attachments.length > 0 && (
          <div className="mb-2 space-y-1.5 rounded-xl border border-pb-line bg-pb-surface px-3 py-2.5">
            <ul className="space-y-1">
              {attachments.map((a) => (
                <li key={a.id} className="flex items-start justify-between gap-3 text-sm">
                  <span className="min-w-0 break-all text-pb-ink">
                    {a.name}
                    <span className={`ml-2 text-xs ${a.status === 'error' ? 'text-pb-check-ink' : 'text-pb-muted'}`}>
                      {a.status === 'reading'
                        ? 'Reading…'
                        : a.status === 'error'
                          ? a.error
                          : `${(a.text ?? '').length.toLocaleString('en')} characters, about ${approxTokens((a.text ?? '').length).toLocaleString('en')} tokens`}
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={() => setAttachments((prev) => prev.filter((x) => x.id !== a.id))}
                    disabled={chat.busy}
                    aria-label={`Remove ${a.name}`}
                    className="flex-shrink-0 text-pb-muted hover:text-pb-ink"
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
            {tooMuch ? (
              <p className="text-xs text-pb-check-ink">
                That’s more than one update can take ({MAX_UPLOAD_CHARS.toLocaleString('en')} characters). Remove a file, or upload
                the rest in a second update.
              </p>
            ) : (
              partCount > 1 && (
                <p className="text-xs text-pb-muted">
                  This is long, so Cube reads it in {partCount} parts, one request each, and shows all the changes together. Each part
                  counts toward today’s limit.
                </p>
              )
            )}
          </div>
        )}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit(draft);
          }}
          className="flex items-end gap-2 rounded-2xl border border-pb-line bg-pb-surface p-2 focus-within:border-pb-accent"
        >
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={chat.busy}
            aria-label="Add files to update from"
            title="Add files to update from"
            className="mb-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full text-lg text-pb-muted transition hover:bg-pb-accent-soft hover:text-pb-accent disabled:opacity-40"
          >
            +
          </button>
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
            placeholder={ready.length ? 'What should Cube do with these files? (optional)' : 'What should change?'}
            aria-label="Message Cube"
            className="max-h-[220px] min-h-[40px] flex-1 resize-none bg-transparent px-2 py-2 text-[15px] text-pb-ink outline-none placeholder:text-pb-muted"
          />
          <button
            type="submit"
            disabled={!canSend}
            aria-label="Send"
            className="mb-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-pb-accent text-white transition hover:opacity-90 disabled:opacity-40"
          >
            ↑
          </button>
        </form>
        <input
          ref={fileRef}
          type="file"
          multiple
          accept={ACCEPT}
          className="hidden"
          onChange={(e) => {
            addFiles(e.target.files);
            e.target.value = '';
          }}
        />
        <p className="mt-2 text-center text-[11px] text-pb-muted">
          Cube can be wrong. Check each change before you apply it; applied changes go live at once.
        </p>
      </div>
    </div>
  );
}

function Reply({
  message: m,
  base,
  playbookId,
  updatedAt,
  disabled,
  onApplied,
  onDiscard,
  onReload,
}: {
  message: ContributorMessage;
  base: Snapshot;
  playbookId: string;
  updatedAt: string;
  disabled: boolean;
  onApplied: () => void;
  onDiscard: () => void;
  onReload: () => void;
}) {
  const p = m.proposal;
  // The playbook changed after Cube proposed these (another proposal or a form
  // was applied). Changes that look for exact text then fail, but whole-field
  // changes would quietly put back what was there before.
  const outdated = !!m.madeAgainst && m.madeAgainst !== updatedAt;
  return (
    <div className="max-w-[96%] space-y-3">
      {m.pending && !m.content ? (
        <span className="inline-flex gap-1 py-2" aria-label="Cube is writing">
          {[0, 1, 2].map((i) => (
            <span key={i} className="h-1.5 w-1.5 animate-bounce-dot rounded-full bg-pb-muted" style={{ animationDelay: `${i * 0.15}s` }} />
          ))}
        </span>
      ) : (
        <div className="text-[15px] leading-relaxed text-pb-ink [&_li]:my-0.5 [&_p]:my-2">
          <WikiMarkdown markdown={m.content} />
        </div>
      )}

      {m.notes?.map((n) => (
        <p key={n} className="rounded-md bg-pb-thin-bg px-3 py-2 text-sm text-pb-thin-ink">
          {n}
        </p>
      ))}

      {!!p?.refused.length && (
        <div className="rounded-md bg-pb-thin-bg px-3 py-2 text-sm text-pb-thin-ink">
          <p className="font-medium">Not offered here:</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {p.refused.map((r, i) => (
              <li key={i}>{r.reason}</li>
            ))}
          </ul>
        </div>
      )}

      {p && !p.ops.length && !!p.contradictions.length && (
        <div className="rounded-lg border border-pb-check-bg bg-pb-check-bg/50 px-4 py-3 text-sm">
          <h3 className="mb-1.5 font-semibold text-pb-check-ink">Where the new material disagrees with the playbook</h3>
          <ul className="space-y-2">
            {p.contradictions.map((c, i) => (
              <li key={i}>
                <b>{c.topic}.</b> The playbook says: {c.existing} The new material says: {c.incoming}
                {c.source ? <span className="text-pb-muted"> ({c.source})</span> : null}
              </li>
            ))}
          </ul>
        </div>
      )}

      {p && p.ops.length > 0 && m.status === 'open' && (
        <div className="rounded-xl border border-pb-line bg-pb-bg/60 p-3 sm:p-4">
          {outdated && (
            <p role="note" className="mb-3 rounded-md bg-pb-thin-bg px-3 py-2 text-sm text-pb-thin-ink">
              The playbook has changed since Cube proposed these. Check each diff: a change here may undo one you applied since.
              To be safe, ask Cube to propose them again.
            </p>
          )}
          <PatchReview
            playbookId={playbookId}
            baseUpdatedAt={updatedAt}
            base={base}
            ops={p.ops}
            contradictions={p.contradictions}
            overlaps={p.overlaps}
            disabled={disabled}
            onApplied={onApplied}
            onDiscard={onDiscard}
            onReload={onReload}
          />
        </div>
      )}
      {p && p.ops.length > 0 && m.status === 'applied' && (
        <p className="text-sm text-pb-deliver">Applied. These changes are live.</p>
      )}
      {p && p.ops.length > 0 && m.status === 'discarded' && <p className="text-sm text-pb-muted">Discarded. Nothing was changed.</p>}
    </div>
  );
}
