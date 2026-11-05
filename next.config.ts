import type { NextConfig } from "next";

// Cube 2.0 test version (see lib/flags.ts). Read here directly because
// next.config runs before the app's own modules are available.
const isCube2 = process.env.NEXT_PUBLIC_CUBE_VERSION === "2";

// With the flag on, the Cube 1.0 surfaces are hidden by redirecting to the
// Companion. Their code and API routes are untouched. Config redirects run
// before proxy.ts, so a signed-out visitor then lands on /login?next=/companion.
const CUBE1_PATHS = ["/explore", "/analyse", "/contribute", "/navigate", "/adoptions", "/wiki"];

const nextConfig: NextConfig = {
  devIndicators: false,
  // Emits .next/standalone (a self-contained node server) so the Docker
  // image used on AWS doesn't need node_modules or the Next CLI at runtime.
  // Harmless on Vercel, which ignores it.
  output: "standalone",
  async redirects() {
    if (!isCube2) return [];
    return [
      { source: "/", destination: "/companion", permanent: false },
      ...CUBE1_PATHS.flatMap((p) => [
        { source: p, destination: "/companion", permanent: false },
        { source: `${p}/:rest*`, destination: "/companion", permanent: false },
      ]),
    ];
  },
};

export default nextConfig;
