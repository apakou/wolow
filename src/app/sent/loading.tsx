import { BottomNavSkeleton } from "@/components/BottomNav";

/** Instant skeleton while the sent list Server Component fetches. */
export default function Loading() {
  return (
    <div className="flex flex-col h-dvh bg-app-gradient">
      <header className="shrink-0 bg-header-gradient px-4 pt-5 pb-4">
        <div className="h-7 w-20 rounded-lg bg-surface-light/50 animate-pulse" />
      </header>

      <div className="flex-1 overflow-hidden px-4 py-4 flex flex-col gap-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-[68px] shrink-0 rounded-2xl bg-surface-light/40 animate-pulse" />
        ))}
      </div>

      <BottomNavSkeleton />
    </div>
  );
}
