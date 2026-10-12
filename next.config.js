/** @type {import('next').NextConfig} */
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

import { legacyRedirects } from './config/redirects.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const nextConfig = {
  // 없어진 옛 주소 301 (config/redirects.mjs)
  async redirects() {
    return legacyRedirects;
  },
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
    trustHost: true,  // 🔧 이거 추가!
  },
};

export default nextConfig;