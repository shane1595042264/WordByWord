import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Ensure server-only modules aren't bundled for Edge or client
  serverExternalPackages: ['postgres', 'bcryptjs'],
  // Silence turbopack config warning
  turbopack: {},
};

export default nextConfig;
