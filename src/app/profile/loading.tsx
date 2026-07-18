import { BottomNavSkeleton } from "@/components/BottomNav";

/** Instant skeleton while the profile Server Component fetches. */
export default function Loading() {
  return (
    <div className="flex flex-col h-dvh bg-app-gradient">
      <header className="shrink-0 bg-header-gradient px-4 pt-5 pb-4">
        <div className="h-7 w-24 rounded-lg bg-surface-light/50 animate-pulse" />
      </header>

      <div className="flex-1 overflow-hidden px-4 py-6">
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-5">
          {/* Identity card */}
          <div className="flex items-center gap-4 rounded-2xl border border-border bg-surface/60 p-5">
            <div className="h-14 w-14 shrink-0 rounded-full bg-surface-light/50 animate-pulse" />
            <div className="flex flex-col gap-2">
              <div className="h-4 w-36 rounded bg-surface-light/50 animate-pulse" />
              <div className="h-3 w-44 rounded bg-surface-light/40 animate-pulse" />
            </div>
          </div>
          {/* Link card */}
          <div className="h-24 rounded-2xl border border-border bg-surface/60 animate-pulse" />
          {/* Menu */}
          <div className="h-28 rounded-2xl border border-border bg-surface/60 animate-pulse" />
        </div>
      </div>

      <BottomNavSkeleton />
    </div>
  );
}
