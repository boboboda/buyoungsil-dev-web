// app/robots.ts
import { MetadataRoute } from 'next'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/admin/', '/api/', '/editor/', '/simple/', '/isCall/'],
    },
    sitemap: 'https://www.buyoungsilcoding.com/sitemap.xml',
  }
}