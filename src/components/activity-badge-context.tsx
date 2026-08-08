"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useAppState } from "@/components/app-state";
import { useUser } from "@/components/user-context";
import { listEventActivities, markEventNotificationsRead } from "@/features/events/client";
import {
  activityBadgeCounts,
  emptyActivityReadState,
  loadActivityReadState,
  markActivityCategoryRead,
  saveActivityReadState,
  type ActivityBadgeCounts,
  type ActivityReadState,
} from "@/features/events/activity-badges";
import type { UserEventActivities } from "@/server/domain/event-coordination";
import type { ActivityGroup } from "@/lib/my-activities";

type ActivityBadgeContextValue = {
  activities: UserEventActivities | null;
  counts: ActivityBadgeCounts;
  loading: boolean;
  error: string;
  refresh: () => Promise<boolean>;
  markCategoryRead: (category: "suggested" | "invited" | "notifications" | "my", group?: ActivityGroup) => void;
};

const emptyCounts: ActivityBadgeCounts = {
  activities: 0,
  suggested: 0,
  invited: 0,
  notifications: 0,
  my: 0,
  myByGroup: {
    "Awaiting coordination": 0,
    "Awaiting confirmation": 0,
    Upcoming: 0,
    Completed: 0,
    Cancelled: 0,
  },
};

const ActivityBadgeContext = createContext<ActivityBadgeContextValue | null>(null);

export function ActivityBadgeProvider({ children }: { children: ReactNode }) {
  const { user } = useUser();
  const { showToast } = useAppState();
  const [activities, setActivities] = useState<UserEventActivities | null>(null);
  const [readState, setReadState] = useState<ActivityReadState>(emptyActivityReadState);
  const [hydrated, setHydrated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const requestVersion = useRef(0);
  const knownNotifications = useRef<Set<string> | null>(null);
  const readStateRef = useRef(readState);

  useEffect(() => {
    const next = loadActivityReadState(user.id);
    /* eslint-disable react-hooks/set-state-in-effect -- Hydrates client-only read markers. */
    setReadState(next);
    setHydrated(true);
    /* eslint-enable react-hooks/set-state-in-effect */
    readStateRef.current = next;
  }, [user.id]);

  useEffect(() => {
    readStateRef.current = readState;
  }, [readState]);

  const refresh = useCallback(async () => {
    const currentRequest = ++requestVersion.current;
    try {
      const next = await listEventActivities();
      if (currentRequest !== requestVersion.current) return false;
      const previous = knownNotifications.current;
      const unread = next.notifications.filter((notification) => notification.readAt === null);
      if (previous) {
        const newest = unread.find((notification) => !previous.has(notification.notificationId)
          && !readStateRef.current.notifications.includes(notification.notificationId));
        if (newest) showToast(newest.title);
      }
      knownNotifications.current = new Set(unread.map((notification) => notification.notificationId));
      setActivities(next);
      setError("");
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("event-activities-refreshed", { detail: next }));
      }
      return true;
    } catch (reason) {
      if (currentRequest === requestVersion.current) setError(reason instanceof Error ? reason.message : "Activities could not be loaded");
      return false;
    } finally {
      if (currentRequest === requestVersion.current) setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    refreshWhenVisible();
    const timer = window.setInterval(refreshWhenVisible, 15_000);
    window.addEventListener("focus", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [refresh]);

  const markCategoryRead = useCallback((category: "suggested" | "invited" | "notifications" | "my", group?: ActivityGroup) => {
    if (!activities) return;
    setReadState((current) => {
      const next = markActivityCategoryRead(activities, current, category, group);
      readStateRef.current = next;
      saveActivityReadState(user.id, next);
      return next;
    });
    if (category === "notifications") {
      void markEventNotificationsRead().then(() => void refresh()).catch(() => {
        // The local marker still prevents a badge from reappearing during this visit.
      });
    }
    if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("event-activity-badges-read", { detail: { category, group } }));
  }, [activities, refresh, user.id]);

  const counts = useMemo(
    () => hydrated && activities ? activityBadgeCounts(activities, readState) : emptyCounts,
    [activities, hydrated, readState],
  );
  const value = useMemo<ActivityBadgeContextValue>(() => ({
    activities,
    counts,
    loading,
    error,
    refresh,
    markCategoryRead,
  }), [activities, counts, error, loading, markCategoryRead, refresh]);

  return <ActivityBadgeContext.Provider value={value}>{children}</ActivityBadgeContext.Provider>;
}

export function useActivityBadges() {
  const context = useContext(ActivityBadgeContext);
  if (!context) throw new Error("useActivityBadges must be used within ActivityBadgeProvider");
  return context;
}
