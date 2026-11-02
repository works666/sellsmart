import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // DeepEval and its Node telemetry dependencies are server-only SDKs.
  serverExternalPackages: ['deepeval', '@sentry/node'],
  // outputFileTracingRoot: path.resolve(__dirname, '../../'),  // Uncomment and add 'import path from "path"' if needed
  /* config options here */
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '*',
        pathname: '/**',
      },
    ],
  },
};

export default nextConfig;
