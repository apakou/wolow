/** Instant skeleton while the owner thread Server Component fetches. */
export default function Loading() {
  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-app-gradient">
      {/* Header skeleton — mirrors OwnerThread's compact single-row header */}
      <header className="shrink-0 bg-header-gradient border-b border-border px-3 py-2.5 flex items-center gap-2.5">
        <div className="h-9 w-9 shrink-0 rounded-full bg-surface-light/50 animate-pulse" />
        <div className="h-9 w-9 shrink-0 rounded-full bg-surface-light/50 animate-pulse" />
        <div className="flex flex-col gap-1.5">
          <div className="h-4 w-28 rounded bg-surface-light/50 animate-pulse" />
          <div className="h-3 w-44 rounded bg-surface-light/40 animate-pulse" />
        </div>
      </header>

      {/* Message bubbles skeleton */}
      <div className="flex-1 overflow-hidden px-4 py-4 flex flex-col gap-3">
        <div className="h-12 w-3/5 self-start rounded-2xl rounded-bl-md bg-surface-light/40 animate-pulse" />
        <div className="h-12 w-1/2 self-end rounded-2xl rounded-br-md bg-surface-light/60 animate-pulse" />
        <div className="h-16 w-2/3 self-start rounded-2xl rounded-bl-md bg-surface-light/40 animate-pulse" />
      </div>
    </div>
  );
}
