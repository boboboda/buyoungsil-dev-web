// app/robots.ts
import { MetadataRoute } from "next";

import { siteConfig } from "@/config/site";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/admin/",
        "/api/",
        "/app/", // 앱(WebView) 전용 화면
        "/editor/",
        "/simple/",
        "/isCall/",
        "/signin",
        "/signup",
      ],
    },
    sitemap: `${siteConfig.url}/sitemap.xml`,
  };
}