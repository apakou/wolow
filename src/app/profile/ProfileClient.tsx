"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import BottomNav from "@/components/BottomNav";

type Props = {
  email: string | null;
  fullName: string | null;
  avatarUrl: string | null;
  slug: string | null;
  displayName: string | null;
};

export default function ProfileClient({
  email,
  fullName,
  avatarUrl,
  slug,
  displayName,
}: Props) {
  const [signingOut, setSigningOut] = useState(false);

  async function handleLogout() {
    if (signingOut) return;
    setSigningOut(true);
    try {
      const supabase = createClient();
      // Local scope: end the session on this device only — other devices
      // keep their sessions.
      await supabase.auth.signOut({ scope: "local" });
    } catch (err) {
      console.error("[profile] Sign-out failed:", err);
    } finally {
      // Full navigation so every Server Component re-renders without the
      // auth cookies.
      window.location.assign("/");
    }
  }

  const initial = (displayName ?? fullName ?? email ?? "?")
    .trim()
    .charAt(0)
    .toUpperCase();

  return (
    <div className="flex flex-col h-dvh bg-app-gradient">
      {/* Header */}
      <header className="shrink-0 bg-header-gradient px-4 pt-5 pb-4">
        <h1 className="font-display text-lg font-bold text-white">Profile</h1>
      </header>

      {/* Content */}
      <main className="flex-1 overflow-y-auto px-4 py-6">
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-5">
          {/* Identity */}
          <section className="flex items-center gap-4 rounded-2xl border border-border bg-surface/60 p-5">
            {avatarUrl ? (
              <Image
                src={avatarUrl}
                alt=""
                width={56}
                height={56}
                className="h-14 w-14 shrink-0 rounded-full border border-white/20 object-cover"
              />
            ) : (
              <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-accent font-display text-xl font-bold text-white">
                {initial}
              </div>
            )}
            <div className="min-w-0">
              <p className="truncate text-base font-bold text-white">
                {fullName ?? displayName ?? "Anonymous"}
              </p>
              {email && <p className="truncate text-xs text-muted">{email}</p>}
            </div>
          </section>

          {/* Room link */}
          {slug && (
            <section className="rounded-2xl border border-border bg-surface/60 p-5">
              <p className="text-xs text-muted">Your anonymous inbox link</p>
              <p className="mt-1 break-all text-sm font-medium text-slate-200">/{slug}</p>
              {displayName && (
                <p className="mt-1 text-xs text-muted">
                  Receiving messages as{" "}
                  <span className="text-slate-300">{displayName}</span>
                </p>
              )}
            </section>
          )}

          {/* Menu */}
          <section className="overflow-hidden rounded-2xl border border-border bg-surface/60">
            <Link
              href="/settings"
              className="flex items-center gap-3 px-5 py-4 text-sm text-slate-200 transition-colors hover:bg-surface-light"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={1.5}
                stroke="currentColor"
                className="h-5 w-5 text-muted"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M15.75 5.25a3 3 0 0 1 3 3m3 0a6 6 0 0 1-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1 1 21.75 8.25Z"
                />
              </svg>
              <span className="flex-1">Settings &amp; encryption keys</span>
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={2}
                stroke="currentColor"
                className="h-4 w-4 shrink-0 text-muted"
                aria-hidden="true"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
              </svg>
            </Link>
            <Link
              href="/help"
              className="flex items-center gap-3 border-t border-border px-5 py-4 text-sm text-slate-200 transition-colors hover:bg-surface-light"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={1.5}
                stroke="currentColor"
                className="h-5 w-5 text-muted"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 5.25h.008v.008H12v-.008Z"
                />
              </svg>
              <span className="flex-1">Help &amp; FAQ</span>
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={2}
                stroke="currentColor"
                className="h-4 w-4 shrink-0 text-muted"
                aria-hidden="true"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
              </svg>
            </Link>
          </section>

          {/* Logout */}
          <button
            type="button"
            onClick={handleLogout}
            disabled={signingOut}
            className="w-full rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm font-semibold text-red-400 transition hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {signingOut ? "Logging out…" : "Log out"}
          </button>
          <p className="-mt-2 text-center text-[11px] text-muted">
            Logging out keeps your encryption keys on this device, so your
            messages stay readable when you sign back in.
          </p>
        </div>
      </main>

      {slug && <BottomNav slug={slug} />}
    </div>
  );
}
