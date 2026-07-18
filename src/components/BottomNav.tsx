"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type Props = {
  /** The signed-in owner's room slug used for the inbox tab link. */
  slug: string;
};

type TabKey = "inbox" | "sent" | "profile";

const ICON_PATHS: Record<TabKey, string> = {
  // Chat bubbles (messages)
  inbox:
    "M20.25 8.511c.884.284 1.5 1.128 1.5 2.097v4.286c0 1.136-.847 2.1-1.98 2.193-.34.027-.68.052-1.02.072v3.091l-3-3c-1.354 0-2.694-.055-4.02-.163a2.115 2.115 0 0 1-.825-.242m9.345-8.334a2.126 2.126 0 0 0-.476-.095 48.64 48.64 0 0 0-8.048 0c-1.131.094-1.976 1.057-1.976 2.192v4.286c0 .837.46 1.58 1.155 1.951m9.345-8.334V6.637c0-1.621-1.152-3.026-2.76-3.235A48.455 48.455 0 0 0 11.25 3c-2.115 0-4.198.137-6.24.402-1.608.209-2.76 1.614-2.76 3.235v6.226c0 1.621 1.152 3.026 2.76 3.235.577.075 1.157.14 1.74.194V21l4.155-4.155",
  // Paper plane (sent)
  sent: "M6 12 3.269 3.125A59.769 59.769 0 0 1 21.485 12 59.768 59.768 0 0 1 3.27 20.875L5.999 12Zm0 0h7.5",
  // Person (profile)
  profile:
    "M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z",
};

/**
 * Placeholder with identical dimensions used by loading.tsx skeleton
 * screens so the tab bar area doesn't jump when the real nav mounts.
 */
export function BottomNavSkeleton() {
  return (
    <div className="shrink-0 border-t border-border bg-surface/90 backdrop-blur-lg pb-[env(safe-area-inset-bottom)]">
      <div className="mx-auto flex max-w-2xl items-stretch">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex flex-1 items-center justify-center py-3">
            <div className="h-6 w-6 rounded-full bg-surface-light/50 animate-pulse" />
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * App-wide bottom navigation for owner screens (icon tabs).
 * Rendered in-flow at the bottom of an `h-dvh` flex column no fixed
 * positioning, so content never hides behind it.
 */
export default function BottomNav({ slug }: Props) {
  const pathname = usePathname();

  const tabs: { key: TabKey; href: string; label: string; active: boolean }[] = [
    {
      key: "inbox",
      href: `/${slug}/inbox`,
      label: "Inbox",
      active: pathname.startsWith(`/${slug}/inbox`),
    },
    {
      key: "sent",
      href: "/sent",
      label: "Sent",
      active: pathname === "/sent",
    },
    {
      key: "profile",
      href: "/profile",
      label: "Profile",
      // Settings hangs off the profile screen keep the tab lit there too
      active: pathname === "/profile" || pathname === "/settings",
    },
  ];

  return (
    <nav
      aria-label="Main navigation"
      className="shrink-0 border-t border-border bg-surface/90 backdrop-blur-lg pb-[env(safe-area-inset-bottom)]"
    >
      <div className="mx-auto flex max-w-2xl items-stretch">
        {tabs.map((tab) => (
          <Link
            key={tab.key}
            href={tab.href}
            aria-label={tab.label}
            title={tab.label}
            aria-current={tab.active ? "page" : undefined}
            className={`btn-squish flex flex-1 items-center justify-center py-3 transition-colors ${
              tab.active ? "text-white" : "text-muted hover:text-slate-300"
            }`}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={tab.active ? 2 : 1.5}
              stroke="currentColor"
              className="h-6 w-6"
              aria-hidden="true"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d={ICON_PATHS[tab.key]} />
            </svg>
          </Link>
        ))}
      </div>
    </nav>
  );
}
