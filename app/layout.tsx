import "@/styles/globals.css";
import "react-toastify/dist/ReactToastify.css";
import clsx from "clsx";
import { Metadata, Viewport } from "next";
import { Divider } from "@heroui/divider";

import Header from "./header";

import Footer from "@/components/main/footer";
import { siteConfig } from "@/config/site";
import { Providers } from "@/components/providers/providers";
import { fontSans } from "@/config/fonts";
import AdFooter from "@/components/main/adFooter";
import NavBar from "@/components/main/navBar";
import NavbarVisibilityWrapper from "@/lib/wrappers/NavbarWrapper";
import SponsorModal from "@/components/main/sponsorModal";

export const metadata: Metadata = {
  metadataBase: new URL(siteConfig.url),
  keywords: [
    "개발",
    "프로그래밍",
    "앱개발",
    "웹개발",
    "NestJS",
    "React",
    "Flutter",
    "Next.js",
    "부영실",
    "코딩",
    "개발노트",
    "TypeScript",
    "JavaScript",
    "모바일앱",
  ],
  authors: [
    {
      name: "부영실",
      url: siteConfig.url,
    },
  ],
  creator: "부영실",
  publisher: "코딩천재 부영실",
  icons: {
    icon: "/siteIcon.ico",
    shortcut: "/siteIcon.png",
    apple: "/apple-touch-icon.png",
  },
  manifest: "/site.webmanifest",
  openGraph: {
    type: "website",
    locale: "ko_KR",
    // 전역 openGraph도 최소화
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: siteConfig.name,
      },
    ],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
  verification: {
    google: "m5OSAuutjyid3qZGPul7bLxNpaLK1TLfY_jCeh5TpXM",
    other: {
      "naver-site-verification": "b7b75d7682b41309d6fc648705881f1001ff75cf",
      "google-adsense-account": "ca-pub-8596470561558049",
    },
  },
  alternates: {
    canonical: siteConfig.url,
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "white" },
    { media: "(prefers-color-scheme: dark)", color: "black" },
  ],
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html className="light" lang="ko">
      <body className={clsx("flex flex-col min-h-screen", fontSans.className)}>
        <Providers themeProps={{ attribute: "class", defaultTheme: "light" }}>
          {/* 나머지 코드는 동일... */}
          <div className="flex flex-col flex-grow min-h-0">
            <div className="flex flex-col w-full justify-center items-center">
              <Header />
              <NavbarVisibilityWrapper>
                <div className="w-full flex justify-center">
                  <NavBar />
                </div>
                <Divider className="w-full mt-4" />
              </NavbarVisibilityWrapper>
            </div>

             <main className="flex-grow w-full min-h-screen">
              {children}
            </main>
            <SponsorModal />
          </div>

          <div className="mt-auto">
            <Footer />
          </div>

          {/* <AdFooter /> */}
        </Providers>
      </body>
    </html>
  );
}
