// 'use client'

// import { type ReactNode, createContext, useRef, useContext, useEffect, useMemo } from 'react'
// import { useStore } from 'zustand'
// import {
//   type UserStore,
//   createUserStore,
//   defaultInitState,
// } from '@/store/userStore'
// import { Session, User } from "@auth/core/types";

// export type UserStoreApi = ReturnType<typeof createUserStore>

// const UserStoreContext = createContext<UserStoreApi | undefined>(undefined)

// export interface UserStoreProviderProps {
//     children: ReactNode
//   }

//   export const UserStoreProvider = ({ children }: UserStoreProviderProps) => {
//     const storeRef = useRef<UserStoreApi>()

//     if (!storeRef.current) {
//       // 스토어 초기화 시 세션 값 사용
//       storeRef.current = createUserStore({
//         ...defaultInitState,
//       })
//     }

//     return (
//       <UserStoreContext.Provider value={storeRef.current}>
//         {children}
//       </UserStoreContext.Provider>
//     )
//   }

// export const useUserStore = <T,>(selector: (store: UserStore) => T): T => {
//   const userStoreContext = useContext(UserStoreContext)
//   if (!userStoreContext) {
//     throw new Error(`useUserStore must be used within UserStoreProvider`)
//   }
//   return useStore(userStoreContext, selector)
// }

// export const useUserStoreSubscribe = () => {
//   const userStoreContext = useContext(UserStoreContext)
//   if (!userStoreContext) {
//     throw new Error(`useUserStoreSubscribe must be used within UserStoreProvider`)
//   }

//   return useMemo(() => ({
//     subscribe: userStoreContext.subscribe
//   }), [userStoreContext])
// }
