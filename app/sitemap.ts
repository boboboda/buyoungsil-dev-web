// app/sitemap.ts
import { MetadataRoute } from "next";

import prisma from "@/lib/prisma";
import { siteConfig } from "@/config/site";

// 빌드 시점에 DB 없이 고정되지 않도록 요청 때마다 생성한다.
export const dynamic = "force-dynamic";

const BASE = siteConfig.url;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();

  const staticPages: MetadataRoute.Sitemap = [
    { url: BASE, lastModified: now, changeFrequency: "daily", priority: 1.0 },
    { url: `${BASE}/note`, lastModified: now, changeFrequency: "weekly", priority: 0.9 },
    { url: `${BASE}/project`, lastModified: now, changeFrequency: "weekly", priority: 0.8 },
    { url: `${BASE}/stories`, lastModified: now, changeFrequency: "weekly", priority: 0.8 },
    { url: `${BASE}/release`, lastModified: now, changeFrequency: "monthly", priority: 0.7 },
    { url: `${BASE}/work-request`, lastModified: now, changeFrequency: "monthly", priority: 0.6 },
    { url: `${BASE}/about`, lastModified: now, changeFrequency: "yearly", priority: 0.5 },
    { url: `${BASE}/contact`, lastModified: now, changeFrequency: "yearly", priority: 0.5 },
    { url: `${BASE}/privacy`, lastModified: now, changeFrequency: "yearly", priority: 0.4 },
  ];

  try {
    const [categories, stories, projects] = await Promise.all([
      prisma.noteCategory.findMany({
        where: { isPublished: true },
        select: { slug: true, updatedAt: true },
      }),
      prisma.story.findMany({
        where: { isPublished: true },
        select: { slug: true, updatedAt: true },
      }),
      prisma.project.findMany({
        select: { name: true, updatedAt: true },
      }),
    ]);

    const categoryPages: MetadataRoute.Sitemap = categories.map((c) => ({
      url: `${BASE}/note/${c.slug}`,
      lastModified: c.updatedAt,
      changeFrequency: "weekly",
      priority: 0.8,
    }));

    const storyPages: MetadataRoute.Sitemap = stories.map((s) => ({
      url: `${BASE}/stories/${s.slug}`,
      lastModified: s.updatedAt,
      changeFrequency: "monthly",
      priority: 0.7,
    }));

    const projectPages: MetadataRoute.Sitemap = projects.map((p) => ({
      url: `${BASE}/project/${p.name}`,
      lastModified: p.updatedAt,
      changeFrequency: "monthly",
      priority: 0.7,
    }));

    return [...staticPages, ...categoryPages, ...storyPages, ...projectPages];
  } catch (error) {
    // DB 오류가 나도 사이트맵 자체는 응답하도록 정적 페이지만 반환한다.
    console.error("[sitemap] DB 조회 실패:", error);
    return staticPages;
  }
}