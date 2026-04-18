"use client";

/**
 * One-time prompt nudging the owner to back up their encryption key after
 * receiving their first message. Dismissal is sticky per-slug. The user can
 * either jump to /settings to download a `.wolow-key` file or snooze for 7 days.
 */

import { useEffect, useState } from "react";
import { getLastBackup } from "@/lib/crypto/last-backup";

const SNOOZE_KEY_PREFIX = "wolow:backup-prompt-snoozed:";
const SNOOZE_MS = 7 * 24 * 60 * 60 * 1000;

type Props = {
  slug: string;
  /** Whether the owner has at least one inbound conversation. Modal stays hidden until true. */
  hasMessages: boolean;
};

export default function BackupPromptModal({ slug, hasMessages }: Props) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!hasMessages) return;
    if (typeof window === "undefined") return;

    // Already backed up — never prompt
    if (getLastBackup(slug)) return;

    // Snoozed recently?
    const snoozedRaw = window.localStorage.getItem(`${SNOOZE_KEY_PREFIX}${slug}`);
    const snoozedTs = Number(snoozedRaw);
    if (Number.isFinite(snoozedTs) && Date.now() - snoozedTs < SNOOZE_MS) return;

    const t = window.setTimeout(() => setOpen(true), 800);
    return () => window.clearTimeout(t);
  }, [slug, hasMessages]);

  function snooze() {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(`${SNOOZE_KEY_PREFIX}${slug}`, String(Date.now()));
    }
    setOpen(false);
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-6">
      <div className="w-full max-w-sm rounded-2xl border border-white/15 bg-[#1a1a2e] shadow-2xl p-6 flex flex-col items-center gap-4 animate-in fade-in zoom-in-95 duration-200">
        <div className="w-14 h-14 rounded-full bg-accent/15 flex items-center justify-center">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-7 h-7 text-accent">
            <path fillRule="evenodd" d="M12 1.5a.75.75 0 0 1 .75.75V4.5a.75.75 0 0 1-1.5 0V2.25A.75.75 0 0 1 12 1.5ZM5.636 4.136a.75.75 0 0 1 1.06 0l1.592 1.591a.75.75 0 0 1-1.061 1.06l-1.591-1.59a.75.75 0 0 1 0-1.061Zm12.728 0a.75.75 0 0 1 0 1.06l-1.591 1.592a.75.75 0 0 1-1.061-1.061l1.591-1.591a.75.75 0 0 1 1.06 0ZM6.75 12a5.25 5.25 0 1 1 10.5 0 5.25 5.25 0 0 1-10.5 0Zm-3 0a.75.75 0 0 1 .75-.75H6a.75.75 0 0 1 0 1.5H4.5a.75.75 0 0 1-.75-.75ZM18 12a.75.75 0 0 1 .75-.75h1.5a.75.75 0 0 1 0 1.5h-1.5A.75.75 0 0 1 18 12Z" clipRule="evenodd" />
          </svg>
        </div>

        <h2 className="text-base font-bold text-white text-center">Back up your encryption key</h2>
        <p className="text-sm text-slate-300 text-center leading-relaxed">
          Your messages are end-to-end encrypted with a key stored only on this device.
          If you clear browser data or switch devices, you&apos;ll lose access to your messages forever.
        </p>
        <p className="text-xs text-muted text-center">
          Download a passphrase-protected backup file (about 1 KB) and keep it somewhere safe.
        </p>

        <a
          href="/settings"
          className="w-full rounded-xl bg-accent px-4 py-3 text-sm font-semibold text-white text-center transition hover:opacity-90"
        >
          Back up now
        </a>

        <button
          type="button"
          onClick={snooze}
          className="text-xs text-muted hover:text-slate-300 transition"
        >
          Remind me in a week
        </button>
      </div>
    </div>
  );
}
