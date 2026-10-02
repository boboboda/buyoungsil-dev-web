import type { Viewport } from "next";

import { AppViewerProvider } from "@/components/app/AppViewerContext";
import { getAppViewer } from "@/lib/auth/app-session";

export const dynamic = "force-dynamic";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
};

export default async function AppModeLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const viewer = await getAppViewer();

  return (
    <AppViewerProvider viewer={viewer ? { name: viewer.name } : null}>
      <div className="w-full max-w-screen-md mx-auto overflow-x-hidden box-border">
        {children}
      </div>
    </AppViewerProvider>
  );
}