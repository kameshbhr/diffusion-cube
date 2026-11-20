// Copied from main @ 7b8b5ff (chunkText from lib/seed.ts, the function only).

// Cuts text into passages of at most `size` characters (~400 tokens at
// 1,600), breaking at a paragraph or sentence where it can, with `overlap`
// characters carried into the next passage so no sentence is lost at a seam.
// gte-small reads ~512 tokens, so passages stay under that.
export function chunkText(text: string, size = 1600, overlap = 200): string[] {
  const clean = text.replace(/\r\n/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  if (!clean) return [];
  const chunks: string[] = [];
  let start = 0;
  while (start < clean.length) {
    let end = Math.min(start + size, clean.length);
    if (end < clean.length) {
      const window = clean.slice(start, end);
      const para = window.lastIndexOf('\n\n');
      const sentence = Math.max(window.lastIndexOf('. '), window.lastIndexOf('.\n'));
      const cut = para > size * 0.5 ? para : sentence > size * 0.5 ? sentence + 1 : -1;
      if (cut > 0) end = start + cut;
    }
    const piece = clean.slice(start, end).trim();
    if (piece) chunks.push(piece);
    if (end >= clean.length) break;
    start = Math.max(end - overlap, start + 1);
  }
  return chunks;
}
