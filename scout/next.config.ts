import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // better-sqlite3 is a native module — keep it out of the bundler.
  // Swapping the storage driver (see lib/db/client.ts) means editing this list too.
  serverExternalPackages: ['better-sqlite3'],

  // The dev indicator defaults to the bottom, directly on top of the fixed
  // bottom nav. Dev-only, but it makes the nav hard to tap while testing.
  devIndicators: { position: 'top-right' },
};

export default nextConfig;
