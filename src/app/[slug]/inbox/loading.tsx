import { BottomNavSkeleton } from "@/components/BottomNav";

/** Instant skeleton while the inbox Server Component fetches. */
export default function Loading() {
  return (
    <div className="flex flex-col h-dvh bg-app-gradient">
      {/* Header skeleton mirrors OwnerInbox's header anatomy */}
      <header className="shrink-0 bg-header-gradient px-4 pt-5 pb-3 flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div className="h-7 w-28 rounded-lg bg-surface-light/50 animate-pulse" />
          <div className="h-8 w-32 rounded-full bg-surface-light/50 animate-pulse" />
        </div>
        <div className="flex gap-2">
          <div className="h-7 w-20 rounded-full bg-surface-light/40 animate-pulse" />
          <div className="h-7 w-20 rounded-full bg-surface-light/40 animate-pulse" />
        </div>
      </header>

      {/* Conversation list skeleton */}
      <div className="flex-1 overflow-hidden px-4 py-4 flex flex-col gap-3">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-[72px] shrink-0 rounded-2xl bg-surface-light/40 animate-pulse" />
        ))}
      </div>

      <BottomNavSkeleton />
    </div>
  );
}
