import "@/styles/globals.css";
import NextLink from "next/link";

import { siteConfig } from "@/config/site";
import { DiscordIcon, GithubIcon, KakaoIcon, YouTubeIcon } from "@/components/icons";

const footerLinks = [
  { label: "소개", href: "/about" },
  { label: "문의", href: "/contact" },
  { label: "개인정보처리방침", href: "/privacy" },
];

const socialLinks = [
  { label: "GitHub", href: siteConfig.links.github, icon: <GithubIcon size={20} /> },
  { label: "YouTube", href: siteConfig.links.youtube, icon: <YouTubeIcon size={20} /> },
  { label: "Discord", href: siteConfig.links.discord, icon: <DiscordIcon size={20} /> },
  { label: "카카오톡 오픈채팅", href: siteConfig.links.kakao, icon: <KakaoIcon size={20} /> },
];

export default function Footer() {
  const year = new Date().getFullYear();

  return (
    <footer className="border-t border-gray-200 dark:border-gray-800">
      <div className="container mx-auto px-4 py-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-1">
          <NextLink
            className="title-font font-medium text-[1.1rem]"
            href="/"
          >
            코딩천재 부영실
          </NextLink>
          <p className="text-sm text-gray-500">
            © {year} 코딩천재 부영실 · {siteConfig.contactEmail}
          </p>
          <a
            className="mt-1 inline-flex w-fit items-center gap-1 text-sm font-medium text-blue-600 dark:text-blue-400 hover:underline"
            href={siteConfig.links.company}
            rel="noopener noreferrer"
            target="_blank"
          >
            코지소프트(COSYSOFT) 공식 사이트 ↗
          </a>
        </div>

        <div className="flex flex-col gap-3 sm:items-end">
          <nav
            aria-label="사이트 정보"
            className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-gray-600 dark:text-gray-400"
          >
            {footerLinks.map((link) => (
              <NextLink
                key={link.href}
                className="hover:underline"
                href={link.href}
              >
                {link.label}
              </NextLink>
            ))}
          </nav>
          <div className="flex gap-3 text-gray-500">
            {socialLinks.map((link) => (
              <a
                key={link.label}
                aria-label={link.label}
                className="hover:text-gray-800 dark:hover:text-gray-200 transition-colors"
                href={link.href}
                rel="noopener noreferrer"
                target="_blank"
              >
                {link.icon}
              </a>
            ))}
          </div>
        </div>
      </div>
    </footer>
  );
}