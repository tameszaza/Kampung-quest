import type { SVGProps } from "react";

export type IconName =
  | "home"
  | "quests"
  | "plus"
  | "message"
  | "profile"
  | "menu"
  | "back"
  | "share"
  | "heart"
  | "calendar"
  | "clock"
  | "pin"
  | "people"
  | "chevron"
  | "gift"
  | "settings"
  | "camera"
  | "needs"
  | "invite"
  | "connections"
  | "badge"
  | "bell"
  | "privacy"
  | "blocked"
  | "help"
  | "shield"
  | "edit"
  | "close"
  | "trash"
  | "check"
  | "lock"
  | "eye"
  | "eye-off";

type IconProps = SVGProps<SVGSVGElement> & {
  name: IconName;
  size?: number;
  strokeWidth?: number;
};

export function Icon({ name, size = 24, strokeWidth = 1.8, ...props }: IconProps) {
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
    ...props,
  };

  switch (name) {
    case "home":
      return <svg {...common}><path d="M3 10.8 12 3l9 7.8"/><path d="M5.5 9.8V21h13V9.8"/><path d="M9.5 21v-6h5v6"/></svg>;
    case "quests":
      return <svg {...common}><path d="M7 3.5h10v4H7z"/><path d="M5 7.5h14v13H5z"/><path d="M9 12h6M9 16h4"/></svg>;
    case "plus":
      return <svg {...common}><path d="M12 5v14M5 12h14"/></svg>;
    case "message":
      return <svg {...common}><path d="M4 5h16v11H9l-5 4z"/><path d="M8 10h.01M12 10h.01M16 10h.01"/></svg>;
    case "profile":
      return <svg {...common}><circle cx="12" cy="8" r="4"/><path d="M4.5 21a7.5 7.5 0 0 1 15 0"/></svg>;
    case "menu":
      return <svg {...common}><path d="M4 7h16M4 12h16M4 17h11"/></svg>;
    case "back":
      return <svg {...common}><path d="m15 18-6-6 6-6"/></svg>;
    case "share":
      return <svg {...common}><circle cx="18" cy="5" r="2.2"/><circle cx="6" cy="12" r="2.2"/><circle cx="18" cy="19" r="2.2"/><path d="m8 11 8-5M8 13l8 5"/></svg>;
    case "heart":
      return <svg {...common}><path d="M20.8 4.9a5.5 5.5 0 0 0-7.8 0L12 6l-1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.3a5.5 5.5 0 0 0 0-7.8Z"/></svg>;
    case "calendar":
      return <svg {...common}><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/></svg>;
    case "clock":
      return <svg {...common}><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>;
    case "pin":
      return <svg {...common}><path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/></svg>;
    case "people":
      return <svg {...common}><circle cx="9" cy="8" r="3"/><circle cx="17" cy="9" r="2.5"/><path d="M3 20a6 6 0 0 1 12 0M14.5 15.5a5 5 0 0 1 6.5 4.5"/></svg>;
    case "chevron":
      return <svg {...common}><path d="m9 18 6-6-6-6"/></svg>;
    case "gift":
      return <svg {...common}><path d="M3 9h18v12H3zM2 5h20v4H2zM12 5v16"/><path d="M12 5H8.5a2.5 2.5 0 1 1 2.3-3.4L12 5Zm0 0h3.5a2.5 2.5 0 1 0-2.3-3.4L12 5Z"/></svg>;
    case "settings":
      return <svg {...common}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.03 1.56V21h-4v-.08A1.7 1.7 0 0 0 9 19.36a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.64 15 1.7 1.7 0 0 0 3.08 14H3v-4h.08A1.7 1.7 0 0 0 4.64 9a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.64a1.7 1.7 0 0 0 1-1.56V3h4v.08A1.7 1.7 0 0 0 15 4.64a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.36 9a1.7 1.7 0 0 0 1.56 1H21v4h-.08A1.7 1.7 0 0 0 19.4 15Z"/></svg>;
    case "camera":
      return <svg {...common}><path d="M4 7h3l1.5-2h7L17 7h3v13H4z"/><circle cx="12" cy="13" r="4"/></svg>;
    case "needs":
      return <svg {...common}><path d="M4 12h4l2-7 4 14 2-7h4"/></svg>;
    case "invite":
      return <svg {...common}><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg>;
    case "connections":
      return <svg {...common}><circle cx="8" cy="8" r="3"/><circle cx="17" cy="7" r="2"/><path d="M2.5 20a5.5 5.5 0 0 1 11 0M14 14.5a4.5 4.5 0 0 1 7 3.75"/></svg>;
    case "badge":
      return <svg {...common}><circle cx="12" cy="9" r="6"/><path d="m8.5 14-1 7 4.5-2 4.5 2-1-7"/></svg>;
    case "bell":
      return <svg {...common}><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 7h18s-3 0-3-7"/><path d="M10 20h4"/></svg>;
    case "privacy":
      return <svg {...common}><path d="M12 2 4 5v6c0 5 3.4 8.6 8 11 4.6-2.4 8-6 8-11V5z"/><path d="M9 12h6M12 9v6"/></svg>;
    case "blocked":
      return <svg {...common}><circle cx="12" cy="12" r="9"/><path d="m6 6 12 12"/></svg>;
    case "help":
      return <svg {...common}><circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.6 2.25C12.3 11.7 12 12.2 12 13v.5M12 17h.01"/></svg>;
    case "shield":
      return <svg {...common}><path d="M12 2 4 5v6c0 5 3.4 8.6 8 11 4.6-2.4 8-6 8-11V5z"/><path d="m9 12 2 2 4-5"/></svg>;
    case "edit":
      return <svg {...common}><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4z"/></svg>;
    case "close":
      return <svg {...common}><path d="m6 6 12 12M18 6 6 18"/></svg>;
    case "trash":
      return <svg {...common}><path d="M4 7h16M10 11v6M14 11v6M6 7l1 14h10l1-14M9 7V4h6v3"/></svg>;
    case "check":
      return <svg {...common}><path d="m5 12 4 4L19 6"/></svg>;
    case "lock":
      return <svg {...common}><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 15v2"/></svg>;
    case "eye":
      return <svg {...common}><path d="M2.5 12s3.5-5 9.5-5 9.5 5 9.5 5-3.5 5-9.5 5-9.5-5-9.5-5Z"/><circle cx="12" cy="12" r="2.5"/></svg>;
    case "eye-off":
      return <svg {...common}><path d="m3 3 18 18M10.6 6.2A10.8 10.8 0 0 1 12 6c6 0 9.5 6 9.5 6a16.5 16.5 0 0 1-3.2 3.7M6.2 6.2C3.8 7.8 2.5 12 2.5 12s3.5 6 9.5 6c1 0 1.9-.2 2.7-.5"/></svg>;
  }
}
