"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { useAppState } from "@/components/app-state";
import { Icon, type IconName } from "@/components/icons";

const navItems: Array<{ href: string; label: string; icon: IconName; match: string[] }> = [
  { href: "/home", label: "Home", icon: "home", match: ["/home"] },
  { href: "/quests", label: "Quests", icon: "quests", match: ["/quests", "/needs", "/invites", "/my-quests"] },
  { href: "/messages", label: "Messages", icon: "message", match: ["/messages"] },
  { href: "/profile", label: "Profile", icon: "profile", match: ["/profile", "/settings"] },
];

function isActive(pathname: string, matches: string[]) {
  return matches.some((match) => pathname === match || pathname.startsWith(`${match}/`));
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { toast } = useAppState();

  return (
    <div className="app-shell">
      <header className="desktop-nav">
        <div className="desktop-nav-inner">
          <Link className="desktop-brand" href="/home" aria-label="Senior Quest home">
            <span className="brand-symbol" aria-hidden="true">♥</span>
            <span>Senior Quest</span>
          </Link>
          <nav aria-label="Primary navigation">
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={isActive(pathname, item.match) ? "active" : ""}
              >
                <Icon name={item.icon} size={21} />
                <span>{item.label}</span>
              </Link>
            ))}
          </nav>
          <button className="desktop-create" type="button" onClick={() => router.push("/assistant")}>
            <Icon name="plus" size={22} />
            Talk to Senior Quest
          </button>
          <Link className="desktop-avatar" href="/profile" aria-label="Open profile">
            <Image src="/assets/profile-maria.jpg" alt="Maria Santos" fill sizes="44px" />
          </Link>
        </div>
      </header>

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
        <button className="mobile-create" type="button" onClick={() => router.push("/assistant")} aria-label="Talk to Senior Quest">
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
