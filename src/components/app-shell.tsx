"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { useAppState } from "@/components/app-state";
import { Icon, type IconName } from "@/components/icons";
import { useUser } from "@/components/user-context";
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
  const { toast } = useAppState();
  const { user } = useUser();

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
            <span className="brand-symbol" aria-hidden="true">♥</span>
            <span>Senior Quest</span>
          </Link>
          <nav aria-label="Primary navigation">
            {desktopItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                aria-label={item.label}
                title={item.label}
                className={isActive(pathname, item.match) ? "active" : ""}
              >
                <Icon name={item.icon} size={21} />
                <span>{item.label}</span>
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
          >
            <Icon name={item.icon} size={23} />
            <span>{item.label}</span>
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
          >
            <Icon name={item.icon} size={23} />
            <span>{item.label}</span>
          </Link>
        ))}
      </nav>

      {toast ? <div className="toast" role="status">{toast}</div> : null}
    </div>
  );
}
