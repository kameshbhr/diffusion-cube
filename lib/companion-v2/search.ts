// SERVER-ONLY. Finds what a use case's notes and documents say about one
// message, for the web chat (the same cube_search_passages the connector's
// cube_search_notes uses: meaning and keyword, merged by reciprocal rank).
// Runs with the service-role client; the caller has already checked that the
// person can read the use case.
//
// Notes are cited without names ("team note"), except for a curator of the
// use case (showAuthors), who sees who wrote each one. Documents are cited by
// title (migration 0042: people are stored by user id, names looked up here).

import type { SupabaseClient } from '@supabase/supabase-js';
import { embedTexts, QUICK_EMBED, toPgVector } from '@/lib/embeddings';
import type { SourceHit } from './prompt';

const LIMIT = 8;
const DAY = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric' });

interface Row {
  kind: 'note' | 'document';
  note_id: string | null;
  source_id: string | null;
  source_title: string | null;
  chunk_index: number;
  text: string;
}

/** Hits labelled for citing, or [] when nothing matches. Never throws: a failed search returns []. */
export async function searchUseCase(
  admin: SupabaseClient,
  useCaseId: string,
  query: string,
  opts: { showAuthors: boolean }
): Promise<SourceHit[]> {
  const q = query.trim().slice(0, 1000);
  if (!q) return [];
  try {
    let embedding: string | null = null;
    try {
      embedding = toPgVector((await embedTexts([q], QUICK_EMBED))[0]);
    } catch {
      // Logged by embedTexts; keyword search still runs.
    }
    const { data, error } = await admin.rpc('cube_search_passages', {
      p_query: q,
      p_embedding: embedding,
      p_use_case_ids: [useCaseId],
      p_limit: LIMIT,
    });
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as Row[];

    const noteIds = rows.filter((r) => r.note_id).map((r) => r.note_id as string);
    const notes = new Map<string, { author: string | null; title: string | null; at: string; journeys: string[] }>();
    if (noteIds.length) {
      const [noteRes, linkRes] = await Promise.all([
        admin.from('cube_notes').select('id, author_id, title, created_at, occurred_at').in('id', noteIds),
        admin.from('cube_note_journeys').select('note_id, journeys(name)').in('note_id', noteIds),
      ]);
      if (noteRes.error) throw new Error(noteRes.error.message);
      const journeysByNote = new Map<string, string[]>();
      for (const l of (linkRes.data ?? []) as unknown as { note_id: string; journeys: { name: string } | { name: string }[] | null }[]) {
        const names = Array.isArray(l.journeys) ? l.journeys.map((j) => j.name) : l.journeys ? [l.journeys.name] : [];
        journeysByNote.set(l.note_id, [...(journeysByNote.get(l.note_id) ?? []), ...names]);
      }
      const names = new Map<string, string>();
      const authorIds = [...new Set((noteRes.data ?? []).map((n) => n.author_id as string | null).filter(Boolean))];
      if (opts.showAuthors && authorIds.length) {
        const { data: people } = await admin.rpc('cube_person_names', { p_user_ids: authorIds });
        for (const p of (people ?? []) as { user_id: string; name: string }[]) names.set(p.user_id, p.name);
      }
      for (const n of noteRes.data ?? []) {
        notes.set(n.id as string, {
          author: opts.showAuthors ? (names.get(n.author_id as string) ?? null) : null,
          title: (n.title as string | null) ?? null,
          at: (n.occurred_at as string | null) ?? (n.created_at as string),
          journeys: journeysByNote.get(n.id as string) ?? [],
        });
      }
    }

    return rows.map((r): SourceHit => {
      if (r.kind === 'note') {
        const n = r.note_id ? notes.get(r.note_id) : undefined;
        const where = n?.journeys.length ? n.journeys.join(' and ') : 'general note';
        return {
          kind: 'note',
          cite: n ? `${n.author ? `note from ${n.author}` : 'team note'}, ${where}, ${DAY.format(new Date(n.at))}` : 'team note',
          text: n?.title ? `${n.title}. ${r.text}` : r.text,
        };
      }
      const title = (r.source_title ?? 'a document').replace(/\.(pdf|docx)$/i, '');
      return { kind: 'document', cite: `document: "${title}"`, text: r.text };
    });
  } catch (err) {
    console.error('[companion search] failed:', (err as Error).message);
    return [];
  }
}
