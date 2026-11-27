import Link from 'next/link';
import WikiMarkdown from '@/components/WikiMarkdown';
import { contextEntries, formatWhen, type ConversationDetail } from '@/lib/companion-v2/conversations';

// One conversation, read-only: what Cube knows about the person's situation,
// and the transcript.
export default function ConversationView({ slug, conversation }: { slug: string; conversation: ConversationDetail }) {
  const ctx = contextEntries(conversation.context);

  return (
    <div className="space-y-6">
      <div>
        <Link href={`/companion/${slug}/conversations`} className="text-xs text-pb-muted transition hover:text-pb-accent">
          ← All conversations
        </Link>
        <h2 className="mt-1.5 text-lg font-semibold text-pb-ink">{conversation.label}</h2>
        <p className="text-xs text-pb-muted">
          Started {formatWhen(conversation.started_at)} · last message {formatWhen(conversation.updated_at)}
        </p>
      </div>

      <div>
        <section className="rounded-xl border border-pb-line bg-pb-surface px-4 py-3">
          <h3 className="text-sm font-semibold text-pb-ink">What Cube knows about their situation</h3>
          {ctx.length ? (
            <dl className="mt-2 space-y-1.5 text-sm">
              {ctx.map((e) => (
                <div key={e.key}>
                  <dt className="text-xs text-pb-muted">{e.label}</dt>
                  <dd className="break-words text-pb-ink">{e.value}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="mt-2 text-sm text-pb-muted">Nothing yet.</p>
          )}
        </section>

      </div>

      <section aria-label="Conversation" className="space-y-5">
        {conversation.messages.length === 0 && <p className="text-sm text-pb-muted">No messages.</p>}
        {conversation.messages.map((m, i) =>
          m.role === 'user' ? (
            <div key={i} className="flex flex-col items-end">
              <p className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-pb-accent px-4 py-2.5 text-[15px] leading-relaxed text-white">
                {m.content}
              </p>
              <span className="mt-1 text-[11px] text-pb-muted">User · {formatWhen(m.created_at)}</span>
            </div>
          ) : (
            <div key={i} className="max-w-[92%]">
              <div className="text-[15px] leading-relaxed text-pb-ink [&_li]:my-0.5 [&_p]:my-2">
                <WikiMarkdown markdown={m.content} />
              </div>
              <span className="text-[11px] text-pb-muted">Cube · {formatWhen(m.created_at)}</span>
            </div>
          )
        )}
      </section>
    </div>
  );
}
