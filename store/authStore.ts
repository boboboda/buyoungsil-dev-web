import { subscribeWithSelector } from "zustand/middleware";
// src/stores/user-store.ts
import { createStore } from "zustand/vanilla";

type AuthStatus = "idle" | "pending" | "success" | "error";

export interface AuthState {
  signInStatus: AuthStatus;
  signUpStatus: AuthStatus;
  socialLoginStatus: AuthStatus;
  logOutStatus: AuthStatus;
}

export interface AuthStateActions {
  setSignInStatus: (status: AuthStatus) => void;
  setSignUpStatus: (status: AuthStatus) => void;
  setSocialLoginStatus: (status: AuthStatus) => void;
  setLogOutStatus: (status: AuthStatus) => void;
  resetStatus: () => void;
}

export type AuthStore = AuthState & AuthStateActions;

export const defaultInitAuthState: AuthState = {
  signInStatus: "idle",
  signUpStatus: "idle",
  socialLoginStatus: "idle",
  logOutStatus: "idle",
};

export const createAuthStore = (
  initState: AuthState = defaultInitAuthState,
) => {
  return createStore<AuthStore>()(
    subscribeWithSelector((set) => ({
      ...initState,
      setSignInStatus: (status: AuthStatus) => set({ signInStatus: status }),
      setSignUpStatus: (status: AuthStatus) => set({ signUpStatus: status }),
      setSocialLoginStatus: (status: AuthStatus) =>
        set({ socialLoginStatus: status }),
      setLogOutStatus: (status: AuthStatus) => set({ logOutStatus: status }),
      resetStatus: () =>
        set({
          signInStatus: "idle",
          signUpStatus: "idle",
          socialLoginStatus: "idle",
          logOutStatus: "idle",
        }),
    })),
  );
};
