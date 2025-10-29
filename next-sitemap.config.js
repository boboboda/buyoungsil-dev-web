/** @type {import('next-sitemap').IConfig} */
const config = {
  siteUrl: 'https://www.buyoungsilcoding.com',
  generateRobotsTxt: true,
  sitemapSize: 7000,
  changefreq: 'weekly',
  priority: 0.7,
  exclude: [
    '/admin/*',
    '/api/*'
  ],
  additionalPaths: async (config) => [
    // 개발노트 메인 페이지
    {
      loc: '/note',
      changefreq: 'weekly',
      priority: 0.9,
      lastmod: new Date().toISOString(),
    },
    // 개발 기본 지식
    {
      loc: '/note/basics',
      changefreq: 'weekly', 
      priority: 0.8,
      lastmod: new Date().toISOString(),
    },
    // 안드로이드 개발 지식
    {
      loc: '/note/android',
      changefreq: 'weekly',
      priority: 0.8,
      lastmod: new Date().toISOString(),
    },
    // Next.js 웹 개발 지식
    {
      loc: '/note/nextjs',
      changefreq: 'weekly',
      priority: 0.8,
      lastmod: new Date().toISOString(),
    },
    // NestJS 백엔드 개발지식
    {
      loc: '/note/nestjs',
      changefreq: 'weekly',
      priority: 0.8,
      lastmod: new Date().toISOString(),
    },
    // 🔥 외주 신청 페이지 추가
    {
      loc: '/work-request',
      changefreq: 'monthly',
      priority: 0.8,
      lastmod: new Date().toISOString(),
    },
  ],
  transform: async (config, path) => {
    // 홈페이지는 최우선
    if (path === '/') {
      return {
        loc: path,
        changefreq: 'daily',
        priority: 1.0,
        lastmod: new Date().toISOString(),
      }
    }
    
    // 출시어플 페이지
    if (path === '/release') {
      return {
        loc: path,
        changefreq: 'monthly',
        priority: 0.8,
        lastmod: new Date().toISOString(),
      }
    }

    // 기본 설정
    return {
      loc: path,
      changefreq: config.changefreq,
      priority: config.priority,
      lastmod: new Date().toISOString(),
    }
  },
}

export default config;