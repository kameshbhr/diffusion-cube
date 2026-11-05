// Feature flags. NEXT_PUBLIC_ values are inlined at build time, so a flag is
// set per deployment (Vercel environment), not toggled at runtime.

// Cube 2.0 test version (branch cube-2): hides Explore, Analyse and Contribute
// and shows one "Companion" item instead. Cube 1.0 routes and code stay in
// place; they are only hidden (see next.config.ts redirects).
export const isCube2 = process.env.NEXT_PUBLIC_CUBE_VERSION === '2';
