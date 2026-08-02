"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import type { UserProfile } from "@/server/identity/types";

type UserContextValue = {
  user: UserProfile;
  setUser: (user: UserProfile) => void;
};

const UserContext = createContext<UserContextValue | null>(null);

export function UserProvider({ initialUser, children }: { initialUser: UserProfile; children: ReactNode }) {
  const [user, setUser] = useState(initialUser);
  const value = useMemo(() => ({ user, setUser }), [user]);
  return <UserContext.Provider value={value}>{children}</UserContext.Provider>;
}

export function useUser() {
  const context = useContext(UserContext);
  if (!context) throw new Error("useUser must be used within UserProvider");
  return context;
}

