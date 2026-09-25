import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    // Pin the workspace root. A stray package.json in a parent directory (a home
    // directory, say) otherwise makes Turbopack's root inference ambiguous, which
    // it warns about on every build and which changes how modules resolve.
    root: __dirname,
  },
};

export default nextConfig;
