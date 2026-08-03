"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

type AppStateValue = {
  savedQuests: Set<string>;
  toast: string | null;
  toggleSaved: (slug: string) => void;
  showToast: (message: string) => void;
};

const STORAGE_KEY = "senior-quest-ui-state";
const AppStateContext = createContext<AppStateValue | null>(null);

type StoredState = {
  savedQuests?: string[];
};

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [savedQuests, setSavedQuests] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hydrated = useRef(false);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as StoredState;
        /* eslint-disable react-hooks/set-state-in-effect -- This effect hydrates
         * client-only state from localStorage after the initial server render. */
        setSavedQuests(new Set(parsed.savedQuests ?? []));
        /* eslint-enable react-hooks/set-state-in-effect */
      }
    } catch {
      // Placeholder state should never prevent the interface from loading.
    } finally {
      hydrated.current = true;
    }
  }, []);

  useEffect(() => {
    if (!hydrated.current) return;
    const state: StoredState = {
      savedQuests: [...savedQuests],
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [savedQuests]);

  useEffect(() => {
    return () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, []);

  const showToast = useCallback((message: string) => {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2600);
  }, []);

  const toggleSaved = useCallback((slug: string) => {
    setSavedQuests((current) => {
      const next = new Set(current);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  }, []);

  const value = useMemo<AppStateValue>(
    () => ({
      savedQuests,
      toast,
      toggleSaved,
      showToast,
    }),
    [
      savedQuests,
      toast,
      toggleSaved,
      showToast,
    ],
  );

  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>;
}

export function useAppState() {
  const context = useContext(AppStateContext);
  if (!context) throw new Error("useAppState must be used within AppStateProvider");
  return context;
}
