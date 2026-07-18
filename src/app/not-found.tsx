import Link from "next/link";

export default function NotFound() {
  return (
    <main className="min-h-dvh bg-app-gradient flex items-center justify-center px-6">
      <div className="anim-pop-in w-full max-w-sm rounded-[28px] bg-surface border border-border p-8 text-center flex flex-col items-center gap-3 shadow-2xl">
        <div className="text-5xl" aria-hidden="true">
          🫥
        </div>
        <h1 className="font-display text-2xl font-bold text-white">
          This link doesn&apos;t exist
        </h1>
        <p className="text-sm text-muted leading-relaxed">
          Maybe the link changed, or it was never claimed. Your own anonymous
          inbox is one tap away.
        </p>
        <Link
          href="/"
          className="btn-squish mt-3 w-full rounded-full bg-accent px-4 py-3 text-sm font-semibold text-white transition hover:opacity-90"
        >
          Get your own link
        </Link>
      </div>
    </main>
  );
}
