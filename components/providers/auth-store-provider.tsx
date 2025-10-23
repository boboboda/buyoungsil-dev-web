"use client";

import {
  type ReactNode,
  createContext,
  useRef,
  useContext,
  useMemo,
} from "react";
import { useStore } from "zustand";

import {
  AuthStore,
  createAuthStore,
  defaultInitAuthState,
} from "@/store/authStore";

export type AuthStoreApi = ReturnType<typeof createAuthStore>;

const AuthStoreContext = createContext<AuthStoreApi | undefined>(undefined);

export interface AuthStoreProviderProps {
  children: ReactNode;
}

export const AuthStoreProvider = ({ children }: AuthStoreProviderProps) => {
  const storeRef = useRef<AuthStoreApi>();

  if (!storeRef.current) {
    storeRef.current = createAuthStore(defaultInitAuthState);
  }

  return (
    <AuthStoreContext.Provider value={storeRef.current}>
      {children}
    </AuthStoreContext.Provider>
  );
};

export const useAuthStore = <T,>(selector: (store: AuthStore) => T): T => {
  const authStoreContext = useContext(AuthStoreContext);

  if (!authStoreContext) {
    throw new Error(`useAuthStore must be used within UserStoreProvider`);
  }

  return useStore(authStoreContext, selector);
};

export const useAuthStoreSubscribe = () => {
  const authStoreContext = useContext(AuthStoreContext);

  if (!authStoreContext) {
    throw new Error(
      `useUserStoreSubscribe must be used within AuthStoreProvider`,
    );
  }

  return useMemo(
    () => ({
      subscribe: authStoreContext.subscribe,
    }),
    [authStoreContext],
  );
};
