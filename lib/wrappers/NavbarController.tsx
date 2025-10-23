// components/NavbarController.tsx
"use client";
import { useEffect } from "react";

import { useUIStore } from "@/store/uiStore";

export default function NavbarController({ show }: { show: boolean }) {
  const setShowNavbar = useUIStore((state) => state.setShowNavbar);

  useEffect(() => {
    setShowNavbar(show);

    return () => setShowNavbar(true);
  }, [setShowNavbar, show]);

  return null;
}
