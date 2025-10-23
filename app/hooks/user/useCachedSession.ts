import { useSessionStore } from "@/store/sesstionStore";

export function useCachedSession() {
  const { cachedSession, isInitialized } = useSessionStore();

  return {
    session: cachedSession,
    isLoading: !isInitialized,
    isAuthenticated: !!cachedSession,
    user: cachedSession?.user,
    // 🔥 role이 확실히 있는지 체크
    isSessionComplete: !!cachedSession?.user?.role,
  };
}
