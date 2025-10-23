"use client";
import { useUIStore } from "@/store/uiStore";

export default function NavbarVisibilityWrapper({
  children,
}: {
  children: React.ReactNode;
}) {
  const showNavbar = useUIStore((state) => state.showNavbar);

  if (!showNavbar) return null;

  return <>{children}</>;
}
