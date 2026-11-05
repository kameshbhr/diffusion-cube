import Link from 'next/link';
import WikiMarkdown from '@/components/WikiMarkdown';
import StateMarker from '../StateMarker';
import { contextEntries, formatWhen, type ConversationDetail } from '@/lib/companion-v2/conversations';

// One adopter conversation, read-only: what Cube knows, their job states, and
// the transcript.
export default function ConversationView({
  slug,
  conversation,
  jobs,
}: {
  slug: string;
  conversation: ConversationDetail;
  jobs: { job_code: string; name: string; position: number | null }[];
}) {
  const nameOf = new Map(jobs.map((j) => [j.job_code, j.name]));
  const order = new Map(jobs.map((j) => [j.job_code, j.position ?? 1e9]));
  // Job states belong to the person, across all their conversations; in sequence order.
  const states = [...conversation.job_states].sort((a, b) => (order.get(a.job) ?? 1e9) - (order.get(b.job) ?? 1e9));
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

      <div className="grid gap-4 md:grid-cols-2">
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

        <section className="rounded-xl border border-pb-line bg-pb-surface px-4 py-3">
          <h3 className="text-sm font-semibold text-pb-ink">Where they are on the jobs</h3>
          <p className="text-xs text-pb-muted">From all their conversations. Jobs they haven’t talked about aren’t listed.</p>
          {states.length ? (
            <ul className="mt-2 space-y-2 text-sm">
              {states.map((s) => (
                <li key={s.job}>
                  <span className="flex flex-wrap items-baseline justify-between gap-x-3">
                    <span className="text-pb-ink">{nameOf.get(s.job) ?? 'A job no longer in the playbook'}</span>
                    <StateMarker
                      state={s.state}
                      title={s.set_by === 'user' ? 'Set by the person' : 'Recorded by Cube from what they said'}
                    />
                  </span>
                  {s.note && <span className="block break-words text-xs text-pb-muted">{s.note}</span>}
                  {s.set_by === 'user' && <span className="block text-[11px] text-pb-muted">Set by the person</span>}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-pb-muted">None yet.</p>
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
