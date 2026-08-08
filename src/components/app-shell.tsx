"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { useAppState } from "@/components/app-state";
import { ActivityBadgeProvider, useActivityBadges } from "@/components/activity-badge-context";
import { Icon, type IconName } from "@/components/icons";
import { useUser } from "@/components/user-context";
import { authClient } from "@/lib/auth-client";
import { SafeImage } from "@/components/safe-image";
import { KampungLogo } from "@/components/kampung-logo";

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
  return <ActivityBadgeProvider><AppShellContent>{children}</AppShellContent></ActivityBadgeProvider>;
}

function AppShellContent({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { toast } = useAppState();
  const { user } = useUser();
  const { counts: activityCounts } = useActivityBadges();
  const [unreadMessages, setUnreadMessages] = useState(0);

  useEffect(() => {
    // ChatCenter owns the conversation list while this route is open. Avoid
    // running a second identical poller beside the active chat view.
    if (pathname === "/messages") return;
    let active = true;
    const loadUnreadMessages = async () => {
      if (document.visibilityState !== "visible") return;
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
    const timer = window.setInterval(() => void loadUnreadMessages(), 15_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [pathname]);

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

  return (
    <div className="app-shell">
      <aside className="desktop-nav">
        <div className="desktop-nav-inner">
          <Link className="desktop-brand" href="/home" aria-label="Senior Quest home">
            <KampungLogo className="brand-symbol" size={42} priority />
            <span>Senior Quest</span>
          </Link>
          <nav aria-label="Primary navigation">
            {desktopItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                aria-label={navAriaLabel(item, activityCounts.activities, activityCounts.my, unreadMessages)}
                title={item.label}
                className={isActive(pathname, item.match) ? "active" : ""}
              >
                <Icon name={item.icon} size={21} />
                <span className="nav-label">{item.label}</span>
                {item.href === "/quests" && activityCounts.activities ? <b className="nav-badge nav-activity-badge" aria-hidden="true">{formatCount(activityCounts.activities)}</b> : null}
                {item.href === "/my-quests" && activityCounts.my ? <b className="nav-badge" aria-label={`${activityCounts.my} new activities`}>{formatCount(activityCounts.my)}</b> : null}
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
            aria-label={navAriaLabel(item, activityCounts.activities, activityCounts.my, unreadMessages)}
          >
            <Icon name={item.icon} size={23} />
            <span className="nav-label">{item.label}</span>
            {item.href === "/quests" && activityCounts.activities ? <b className="nav-badge" aria-hidden="true">{formatCount(activityCounts.activities)}</b> : null}
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
            aria-label={navAriaLabel(item, activityCounts.activities, activityCounts.my, unreadMessages)}
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

function formatCount(count: number) {
  return count > 99 ? "99+" : String(count);
}

function navAriaLabel(
  item: { href: string; label: string },
  activityCount: number,
  myActivityCount: number,
  unreadMessages: number,
) {
  if (item.href === "/quests" && activityCount) return `${item.label}, ${activityCount} new`;
  if (item.href === "/my-quests" && myActivityCount) return `${item.label}, ${myActivityCount} new`;
  if (item.href === "/messages" && unreadMessages) return `${item.label}, ${unreadMessages} unread`;
  return item.label;
}
