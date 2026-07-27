import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // better-sqlite3 is a native module — keep it out of the bundler.
  // Swapping the storage driver (see lib/db/client.ts) means editing this list too.
  serverExternalPackages: ['better-sqlite3'],
};

export default nextConfig;
