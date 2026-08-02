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

type InviteDecision = "accepted" | "declined";

type AppStateValue = {
  savedQuests: Set<string>;
  interestedQuests: Set<string>;
  inviteDecisions: Record<string, InviteDecision>;
  createQuestOpen: boolean;
  toast: string | null;
  toggleSaved: (slug: string) => void;
  toggleInterested: (slug: string) => void;
  decideInvite: (inviteId: string, decision: InviteDecision) => void;
  openCreateQuest: () => void;
  closeCreateQuest: () => void;
  showToast: (message: string) => void;
};

const STORAGE_KEY = "senior-quest-ui-state";
const AppStateContext = createContext<AppStateValue | null>(null);

type StoredState = {
  savedQuests?: string[];
  interestedQuests?: string[];
  inviteDecisions?: Record<string, InviteDecision>;
};

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [savedQuests, setSavedQuests] = useState<Set<string>>(new Set());
  const [interestedQuests, setInterestedQuests] = useState<Set<string>>(new Set());
  const [inviteDecisions, setInviteDecisions] = useState<Record<string, InviteDecision>>({});
  const [createQuestOpen, setCreateQuestOpen] = useState(false);
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
        setInterestedQuests(new Set(parsed.interestedQuests ?? []));
        setInviteDecisions(parsed.inviteDecisions ?? {});
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
      interestedQuests: [...interestedQuests],
      inviteDecisions,
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [savedQuests, interestedQuests, inviteDecisions]);

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

  const toggleInterested = useCallback((slug: string) => {
    setInterestedQuests((current) => {
      const next = new Set(current);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  }, []);

  const decideInvite = useCallback((inviteId: string, decision: InviteDecision) => {
    setInviteDecisions((current) => ({ ...current, [inviteId]: decision }));
  }, []);

  const value = useMemo<AppStateValue>(
    () => ({
      savedQuests,
      interestedQuests,
      inviteDecisions,
      createQuestOpen,
      toast,
      toggleSaved,
      toggleInterested,
      decideInvite,
      openCreateQuest: () => setCreateQuestOpen(true),
      closeCreateQuest: () => setCreateQuestOpen(false),
      showToast,
    }),
    [
      savedQuests,
      interestedQuests,
      inviteDecisions,
      createQuestOpen,
      toast,
      toggleSaved,
      toggleInterested,
      decideInvite,
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
