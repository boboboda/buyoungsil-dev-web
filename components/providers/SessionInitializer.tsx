// SessionInitializer 개선
// components/SessionInitializer.tsx
"use client";

import { useSession } from "next-auth/react";
import { useEffect } from "react";

import { useSessionStore } from "@/store/sesstionStore";

export function SessionInitializer() {
  const { data: session, status } = useSession();
  const { setCachedSession, setInitialized } = useSessionStore();

  useEffect(() => {
    if (status !== "loading") {
      setCachedSession(session); // role이 이미 포함됨!
      setInitialized(true);
    }
  }, [session, status]);

  return null;
}
