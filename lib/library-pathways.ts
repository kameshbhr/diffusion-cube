// Card-tile data for /explore (the Diffusion Library), ported verbatim from
// the standalone Diffusion Library app's app/lib/pathways.ts. This is a
// fully separate entity from the Analyse corpus (content/wiki/pathways/) —
// same brand tokens, deliberately different content, tone, and pathway set.
// Kept as static data (not fetched) exactly like the original: this file
// only carries what the card needs to display; the chat backend reads the
// full pathway document from content/library-wiki/pathways/<id>.md (see
// lib/library-wiki-loader.ts).
export type Stage = 'Explore' | 'Define' | 'Pilot' | 'Scale';

export type Accent = 'coral' | 'yellow' | 'blue' | 'navy';

export type LibraryPathway = {
  /** Matches the filename (minus .md) under content/library-wiki/pathways/. */
  id: string;
  title: string;
  location: string;
  category: string;
  stage: Stage;
  accent: Accent;
  /** Short, impact-driven hook shown on the tile — not the full context. */
  hook: string;
  /** Sector this pathway belongs to (Agriculture, Livelihoods, etc.). Absent for cross-cutting pathways. */
  sector?: string;
  /** Horizontal technology / approach tags — no sector values. */
  tags: string[];
};

export const libraryPathways: LibraryPathway[] = [
  
];

export const libraryStages: Stage[] = ['Explore', 'Define', 'Pilot', 'Scale'];

export const librarySectors: string[] = Array.from(
  new Set(libraryPathways.map((p) => p.sector).filter((s): s is string => !!s))
);

export const libraryTags: string[] = Array.from(
  new Set(libraryPathways.flatMap((p) => p.tags))
).sort();
