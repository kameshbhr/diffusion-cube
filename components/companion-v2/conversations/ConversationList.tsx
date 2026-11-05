import Link from 'next/link';
import { contextEntries, formatWhen, type ConversationSummary } from '@/lib/companion-v2/conversations';

// The contributor's list of adopter conversations (every adopter is "User").
export default function ConversationList({ slug, conversations }: { slug: string; conversations: ConversationSummary[] }) {
  return (
    <div className="space-y-4">
      <p className="max-w-[62ch] text-sm leading-relaxed text-pb-muted">
        Conversations people have had with Cube about this playbook, newest first. Everyone is shown as “User”: names and emails
        are never shown. Your own conversations as a contributor aren’t listed.
      </p>

      {conversations.length === 0 ? (
        <p className="rounded-xl border border-dashed border-pb-line bg-pb-surface px-6 py-10 text-center text-sm text-pb-muted">
          No conversations yet.
        </p>
      ) : (
        <ul className="space-y-2.5">
          {conversations.map((c) => {
            const ctx = contextEntries(c.context);
            return (
              <li key={c.conversation_id}>
                <Link
                  href={`/companion/${slug}/conversations/${c.conversation_id}`}
                  className="block rounded-xl border border-pb-line bg-pb-surface px-4 py-3 transition hover:border-pb-accent"
                >
                  <span className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                    <span className="text-sm font-medium text-pb-ink">{c.label}</span>
                    <span className="text-xs text-pb-muted">
                      {c.message_count === 0
                        ? 'No messages yet'
                        : `Last message ${formatWhen(c.updated_at)} · ${c.message_count} message${c.message_count === 1 ? '' : 's'}`}
                    </span>
                  </span>
                  {ctx.length > 0 ? (
                    <span className="mt-1.5 block space-y-0.5 text-sm text-pb-ink">
                      {ctx.slice(0, 2).map((e) => (
                        <span key={e.key} className="block break-words">
                          <span className="text-pb-muted">{e.label}:</span> {e.value}
                        </span>
                      ))}
                    </span>
                  ) : (
                    <span className="mt-1.5 block text-sm text-pb-muted">Nothing known about their situation yet.</span>
                  )}
                  <span className="mt-1 block text-xs text-pb-muted">Started {formatWhen(c.started_at)}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
