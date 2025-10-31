/** @type {import('next').NextConfig} */
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const nextConfig = {
  webpack: (config, { isServer }) => {
    // Lexical 관련 설정
    config.resolve.alias = {
      ...config.resolve.alias,
      'shared/environment': join(__dirname, 'node_modules/lexical/shared/environment'),
      'shared/invariant': join(__dirname, 'node_modules/lexical/shared/invariant'),
    };
    return config;
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  experimental: {
    optimizeCss: false,
    useLightningcss: false,
  },
};

export default nextConfig;