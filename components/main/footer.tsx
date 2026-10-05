import "@/styles/globals.css";
import NextLink from "next/link";

import { siteConfig } from "@/config/site";

const footerLinks = [
  { label: "소개", href: "/about" },
  { label: "문의", href: "/contact" },
  { label: "개인정보처리방침", href: "/privacy" },
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
        </div>

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
      </div>
    </footer>
  );
}