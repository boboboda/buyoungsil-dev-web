/** @type {import('next').NextConfig} */
const nextConfig = {
    webpack: (config) => {
    // Lexical 관련 설정
    config.resolve.alias = {
      ...config.resolve.alias,
      'shared/environment': require.resolve('lexical/shared/environment'),
      'shared/invariant': require.resolve('lexical/shared/invariant'),
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
