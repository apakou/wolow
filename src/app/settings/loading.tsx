import { BottomNavSkeleton } from "@/components/BottomNav";

/** Instant skeleton while the settings Server Component fetches. */
export default function Loading() {
  return (
    <div className="flex flex-col h-dvh bg-app-gradient">
      <header className="shrink-0 bg-header-gradient border-b border-border px-4 py-4 flex items-center gap-3">
        <div className="h-9 w-9 shrink-0 rounded-full bg-surface-light/50 animate-pulse" />
        <div className="flex flex-col gap-1.5">
          <div className="h-4 w-24 rounded bg-surface-light/50 animate-pulse" />
          <div className="h-3 w-32 rounded bg-surface-light/40 animate-pulse" />
        </div>
      </header>

      <div className="flex-1 overflow-hidden px-4 py-6">
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
          <div className="h-32 rounded-2xl border border-border bg-surface/60 animate-pulse" />
          <div className="h-64 rounded-2xl border border-border bg-surface/60 animate-pulse" />
        </div>
      </div>

      <BottomNavSkeleton />
    </div>
  );
}
