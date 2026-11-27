'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { useConfirm } from '@/components/ConfirmDialog';
import { showToast } from '@/lib/toast';
import { CONVERSATIONS_CHANGED, notifyConversationsChanged } from '@/lib/companion-v2/use-companion-chat';

interface Item {
  id: string;
  slug: string;
  useCaseName: string;
  label: string;
  updatedAt: string;
  latestForUseCase: boolean;
}

const LIMIT = 30;
const LABEL_MAX = 60;

function label(text: string | undefined): string {
  if (!text) return 'New conversation';
  const oneLine = text.replace(/\s+/g, ' ').trim();
  return oneLine.length > LABEL_MAX ? `${oneLine.slice(0, LABEL_MAX - 1).trimEnd()}…` : oneLine;
}

// Cube 2.0: the signed-in user's own companion conversations in the sidebar,
// newest first, like Cube 1.0's Recent Explorations, through
// my_companion_conversations() (only the user's own, in use cases they can
// still read). Deleting removes the conversation and its messages for good.
export default function RecentConversations({ onNavigate }: { onNavigate?: () => void } = {}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const [supabase] = useState(() => createClient());
  const [items, setItems] = useState<Item[]>([]);
  const [manyUseCases, setManyUseCases] = useState(false);
  const { confirm, dialog } = useConfirm();

  const fetchItems = useCallback(async () => {
    const { data, error } = await supabase.rpc('my_companion_conversations', { p_limit: LIMIT });
    if (error) {
      console.error('[recent conversations] could not load:', error);
      return;
    }
    type Row = {
      conversation_id: string;
      updated_at: string;
      use_case_id: string;
      use_case_slug: string;
      use_case_name: string;
      first_message: string | null;
    };
    const seenUseCase = new Set<string>();
    const next: Item[] = [];
    for (const c of (data ?? []) as Row[]) {
      const latest = !seenUseCase.has(c.use_case_id);
      seenUseCase.add(c.use_case_id);
      next.push({
        id: c.conversation_id,
        slug: c.use_case_slug,
        useCaseName: c.use_case_name,
        label: label(c.first_message ?? undefined),
        updatedAt: c.updated_at,
        latestForUseCase: latest,
      });
    }
    setItems(next);
    setManyUseCases(seenUseCase.size > 1);
  }, [supabase]);

  useEffect(() => {
    let cancelled = false;
    const run = () => {
      if (!cancelled) fetchItems();
    };
    // From a microtask, so no state is set synchronously inside the effect.
    Promise.resolve().then(run);
    window.addEventListener(CONVERSATIONS_CHANGED, run);
    return () => {
      cancelled = true;
      window.removeEventListener(CONVERSATIONS_CHANGED, run);
    };
  }, [fetchItems]);

  const currentC = searchParams.get('c');
  const isActive = (item: Item) =>
    pathname === `/companion/${item.slug}` && (currentC ? currentC === item.id : item.latestForUseCase);

  async function remove(e: React.MouseEvent, item: Item) {
    e.preventDefault();
    e.stopPropagation();
    const ok = await confirm({
      title: 'Delete this conversation?',
      message: (
        <>
          &ldquo;{item.label}&rdquo; and all its messages will be permanently deleted. This can&apos;t be undone.
        </>
      ),
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    const active = isActive(item);
    const { error } = await supabase.from('companion_conversations').delete().eq('id', item.id);
    if (error) {
      showToast('Could not delete that conversation. Please try again.', 'error');
      return;
    }
    setItems((prev) => prev.filter((i) => i.id !== item.id));
    showToast('Conversation deleted.');
    // Exactly one reload of the chat: if the address names the deleted
    // conversation, leaving it (?c= removed) reloads; otherwise the chat is
    // told which conversation was deleted and reloads if it is on screen.
    if (active && currentC === item.id) {
      notifyConversationsChanged();
      router.push(`/companion/${item.slug}`);
    } else {
      notifyConversationsChanged({ deletedId: item.id });
    }
  }

  if (!items.length) return dialog;

  return (
    <>
      <p className="mt-2 mb-1 px-3 font-mono text-[10px] uppercase tracking-[0.15em] text-ink-soft">Recent conversations</p>
      <div className="space-y-0.5">
        {items.map((item) => {
          const active = isActive(item);
          return (
            <div
              key={item.id}
              className={`group/item flex items-center rounded-lg ${active ? 'bg-paper-dim' : 'hover:bg-paper-dim'}`}
            >
              <Link
                href={`/companion/${item.slug}?c=${item.id}`}
                onClick={onNavigate}
                aria-current={active ? 'page' : undefined}
                className={`block min-w-0 flex-1 px-3 py-1.5 text-xs transition ${
                  active ? 'font-medium text-navy' : 'text-ink-soft group-hover/item:text-navy'
                }`}
                title={manyUseCases ? `${item.label} · ${item.useCaseName}` : item.label}
              >
                <span className="block truncate">{item.label}</span>
                {manyUseCases && <span className="block truncate text-[10px] text-ink-soft/70">{item.useCaseName}</span>}
              </Link>
              <button
                type="button"
                onClick={(e) => remove(e, item)}
                aria-label={`Delete conversation: ${item.label}`}
                className="flex-shrink-0 px-2 text-ink-soft/50 transition hover:text-coral focus:opacity-100 md:opacity-0 md:group-hover/item:opacity-100"
              >
                🗑
              </button>
            </div>
          );
        })}
      </div>
      {dialog}
    </>
  );
}
