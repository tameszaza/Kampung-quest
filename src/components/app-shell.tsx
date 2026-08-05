"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useAppState } from "@/components/app-state";
import { Icon, type IconName } from "@/components/icons";
import { useUser } from "@/components/user-context";
import { listEventActivities } from "@/features/events/client";
import { authClient } from "@/lib/auth-client";
import { SafeImage } from "@/components/safe-image";

const navItems: Array<{ href: string; label: string; icon: IconName; match: string[] }> = [
  { href: "/home", label: "Home", icon: "home", match: ["/home"] },
  { href: "/quests", label: "Quests", icon: "quests", match: ["/quests", "/needs", "/invites", "/my-quests"] },
  { href: "/messages", label: "Messages", icon: "message", match: ["/messages"] },
  { href: "/profile", label: "Profile", icon: "profile", match: ["/profile", "/settings"] },
];

const desktopItems: Array<{ href: string; label: string; icon: IconName; match: string[] }> = [
  { href: "/home", label: "Home", icon: "home", match: ["/home"] },
  { href: "/quests", label: "Activities", icon: "quests", match: ["/quests", "/invites"] },
  { href: "/my-quests", label: "My Activities", icon: "check", match: ["/my-quests"] },
  { href: "/rewards", label: "Rewards", icon: "gift", match: ["/rewards"] },
  { href: "/messages", label: "Messages", icon: "message", match: ["/messages"] },
  { href: "/profile", label: "My Profile", icon: "profile", match: ["/profile"] },
  { href: "/settings", label: "Settings", icon: "settings", match: ["/settings"] },
];

function isActive(pathname: string, matches: string[]) {
  return matches.some((match) => pathname === match || pathname.startsWith(`${match}/`));
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { toast, showToast } = useAppState();
  const { user } = useUser();
  const [unreadActivityCount, setUnreadActivityCount] = useState(0);
  const [unreadMessages, setUnreadMessages] = useState(0);
  const knownActivityNotifications = useRef<Set<string> | null>(null);
  const activityReadVersion = useRef(0);

  useEffect(() => {
    let active = true;
    const loadUnreadMessages = async () => {
      try {
        const response = await fetch("/api/chat/conversations", { cache: "no-store" });
        if (!response.ok) return;
        const result = await response.json() as { conversations?: Array<{ unreadCount?: number }> };
        if (active) setUnreadMessages((result.conversations ?? []).reduce((total, item) => total + (item.unreadCount ?? 0), 0));
      } catch {
        // Navigation badges are best effort and must never block the shell.
      }
    };
    void loadUnreadMessages();
    const timer = window.setInterval(() => void loadUnreadMessages(), 4_000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);

  async function logOut() {
    await authClient.signOut();
    router.replace("/login");
    router.refresh();
  }

  useEffect(() => {
    document.documentElement.dataset.textSize = user.preferences.textSize;
    document.documentElement.dataset.contrast = user.preferences.highContrast ? "high" : "standard";
    return () => {
      delete document.documentElement.dataset.textSize;
      delete document.documentElement.dataset.contrast;
    };
  }, [user.preferences.highContrast, user.preferences.textSize]);

  useEffect(() => {
    let active = true;
    async function refreshActivityNotifications() {
      if (document.visibilityState !== "visible") return;
      const requestVersion = activityReadVersion.current;
      try {
        const activities = await listEventActivities();
        if (!active || requestVersion !== activityReadVersion.current) return;
        window.dispatchEvent(new CustomEvent("event-activities-refreshed", { detail: activities }));
        const unread = activities.notifications.filter((notification) => notification.readAt === null);
        const previous = knownActivityNotifications.current;
        if (previous) {
          const newest = unread.find((notification) => !previous.has(notification.notificationId));
          if (newest) showToast(newest.title);
        }
        knownActivityNotifications.current = new Set(unread.map((notification) => notification.notificationId));
        setUnreadActivityCount(unread.length);
      } catch {
        // Notification refresh is best effort and must not interrupt navigation.
      }
    }
    const refresh = () => void refreshActivityNotifications();
    refresh();
    const timer = window.setInterval(refresh, 5_000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [showToast]);

  useEffect(() => {
    const clearActivityBadge = () => {
      activityReadVersion.current += 1;
      knownActivityNotifications.current = new Set();
      setUnreadActivityCount(0);
    };
    window.addEventListener("event-activities-read", clearActivityBadge);
    return () => window.removeEventListener("event-activities-read", clearActivityBadge);
  }, []);

  return (
    <div className="app-shell">
      <aside className="desktop-nav">
        <div className="desktop-nav-inner">
          <Link className="desktop-brand" href="/home" aria-label="Senior Quest home">
            <span className="brand-symbol" aria-hidden="true">♥</span>
            <span>Senior Quest</span>
          </Link>
          <nav aria-label="Primary navigation">
            {desktopItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                aria-label={item.href === "/messages" && unreadMessages ? `${item.label}, ${unreadMessages} unread` : item.label}
                title={item.label}
                className={isActive(pathname, item.match) ? "active" : ""}
              >
                <Icon name={item.icon} size={21} />
                <span>{item.label}</span>
                {item.href === "/quests" && unreadActivityCount ? <b className="nav-badge" aria-label={`${unreadActivityCount} unread activity updates`}>{Math.min(unreadActivityCount, 99)}</b> : null}
                {item.href === "/messages" && unreadMessages ? <span className="nav-badge" aria-hidden="true">{unreadMessages > 99 ? "99+" : unreadMessages}</span> : null}
              </Link>
            ))}
          </nav>
          <button className="desktop-create" type="button" onClick={() => router.push("/messages?assistant=1")} aria-label="Talk to Senior Quest" title="Talk to Senior Quest">
            <Icon name="plus" size={22} />
            <span className="desktop-create-label">Talk to Senior Quest</span>
          </button>
          <Link className="desktop-avatar" href="/profile" aria-label="Open profile">
            <SafeImage src={user.photoUrl ?? "/assets/profile-maria.jpg"} alt={user.fullName} fill sizes="44px" />
          </Link>
          <div className="desktop-user-copy"><strong>{user.fullName}</strong><small>{user.username ? `@${user.username}` : "Senior member"}</small></div>
          <button className="desktop-logout" type="button" onClick={logOut}>Log Out</button>
        </div>
      </aside>

      <main className="app-main">{children}</main>

      <nav className="bottom-nav" aria-label="Primary navigation">
        {navItems.slice(0, 2).map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={isActive(pathname, item.match) ? "active" : ""}
            aria-label={item.href === "/messages" && unreadMessages ? `${item.label}, ${unreadMessages} unread` : item.label}
          >
            <Icon name={item.icon} size={23} />
            <span>{item.label}</span>
            {item.href === "/quests" && unreadActivityCount ? <b className="nav-badge" aria-label={`${unreadActivityCount} unread activity updates`}>{Math.min(unreadActivityCount, 99)}</b> : null}
          </Link>
        ))}
        <button className="mobile-create" type="button" onClick={() => router.push("/messages?assistant=1")} aria-label="Talk to Senior Quest">
          <Icon name="plus" size={28} />
        </button>
        {navItems.slice(2).map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={isActive(pathname, item.match) ? "active" : ""}
            aria-label={item.href === "/messages" && unreadMessages ? `${item.label}, ${unreadMessages} unread` : item.label}
          >
            <Icon name={item.icon} size={23} />
            <span>{item.label}</span>
            {item.href === "/messages" && unreadMessages ? <span className="nav-badge" aria-hidden="true">{unreadMessages > 99 ? "99+" : unreadMessages}</span> : null}
          </Link>
        ))}
      </nav>

      {toast ? <div className="toast" role="status">{toast}</div> : null}
    </div>
  );
}
