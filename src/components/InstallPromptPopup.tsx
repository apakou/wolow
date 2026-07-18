"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  type BeforeInstallPromptEvent,
  isIosDevice,
  isMobileDevice,
  isStandaloneDisplayMode,
  setInstallPromptOpen,
} from "@/lib/pwa";

const SEEN_KEY = "wolow_install_prompt_seen";
const SHOW_DELAY_MS = 900;

/**
 * One-time install invite — pops up on the user's first opening of the app,
 * inviting them to add Wolow to their home screen.
 *
 * - Chromium: captures `beforeinstallprompt` → native install dialog.
 * - iOS Safari: "Share → Add to Home Screen" instructions (no event exists).
 * - Desktop browsers without install support: never shows.
 * - Already installed (standalone) or shown before: never shows.
 */
export default function InstallPromptPopup() {
  const [visible, setVisible] = useState(false);
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [installing, setInstalling] = useState(false);
  const [ios, setIos] = useState(false);
  const installEventRef = useRef<BeforeInstallPromptEvent | null>(null);
  const shownRef = useRef(false);
  const delayElapsedRef = useRef(false);

  const open = useCallback(() => {
    if (shownRef.current) return;
    shownRef.current = true;
    setVisible(true);
    setInstallPromptOpen(true);
    // First-opening semantics: mark as seen the moment it appears.
    try {
      localStorage.setItem(SEEN_KEY, String(Date.now()));
    } catch {
      // Storage unavailable (private mode) — it may show again next visit.
    }
  }, []);

  const close = useCallback(() => {
    setVisible(false);
    setInstallPromptOpen(false);
  }, []);

  useEffect(() => {
    if (isStandaloneDisplayMode()) return;
    let seen = false;
    try {
      seen = !!localStorage.getItem(SEEN_KEY);
    } catch {
      seen = false;
    }
    if (seen) return;

    setIos(isIosDevice());

    const onBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      installEventRef.current = event as BeforeInstallPromptEvent;
      setInstallEvent(installEventRef.current);
      // Browser announced installability after our delay (e.g. slow desktop
      // Chrome) — surface the invite now.
      if (delayElapsedRef.current) open();
    };

    const onAppInstalled = () => {
      installEventRef.current = null;
      setInstallEvent(null);
      close();
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("appinstalled", onAppInstalled);

    // Mobile devices get the invite even without `beforeinstallprompt`
    // (iOS Safari never fires it) — with add-to-home-screen instructions.
    // Desktop only shows once installability is confirmed by the event.
    const timer = window.setTimeout(() => {
      delayElapsedRef.current = true;
      if (isStandaloneDisplayMode()) return;
      if (installEventRef.current || isMobileDevice()) open();
    }, SHOW_DELAY_MS);

    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onAppInstalled);
    };
  }, [open, close]);

  const handleInstall = useCallback(async () => {
    const event = installEventRef.current;
    if (!event) return;
    try {
      setInstalling(true);
      await event.prompt();
      const choice = await event.userChoice;
      installEventRef.current = null;
      setInstallEvent(null);
      if (choice.outcome === "accepted") close();
    } finally {
      setInstalling(false);
    }
  }, [close]);

  if (!visible) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm px-6">
      <div className="anim-pop-in w-full max-w-sm rounded-2xl border border-white/15 bg-surface shadow-2xl p-6 flex flex-col items-center gap-4">
        <Image
          src="/icons/icon-192x192.png"
          alt=""
          width={56}
          height={56}
          className="rounded-2xl shadow-lg"
        />
        <h2 className="text-base font-bold text-white text-center">
          Add Wolow to your home screen
        </h2>
        <p className="text-sm text-slate-300 text-center leading-relaxed">
          Install the app for faster access and instant notifications when new
          messages arrive.
        </p>
        {installEvent ? (
          <button
            type="button"
            onClick={handleInstall}
            disabled={installing}
            className="w-full rounded-xl bg-accent px-4 py-3 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
          >
            {installing ? "Opening installer…" : "Install app"}
          </button>
        ) : (
          <div className="w-full rounded-xl border border-border bg-surface-light/70 px-4 py-3 text-xs text-slate-300 leading-relaxed text-center">
            {ios ? (
              <>
                Tap the{" "}
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={1.8}
                  stroke="currentColor"
                  className="inline-block w-3.5 h-3.5 -mt-0.5 text-slate-200"
                  aria-label="Share"
                  role="img"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M12 15V3m0 0-4 4m4-4 4 4M5 11v8a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-8"
                  />
                </svg>{" "}
                Share button, then choose{" "}
                <span className="font-semibold text-white">&quot;Add to Home Screen&quot;</span>.
              </>
            ) : (
              <>
                Open your browser menu, then tap{" "}
                <span className="font-semibold text-white">&quot;Add to Home Screen&quot;</span>.
              </>
            )}
          </div>
        )}
        <button
          type="button"
          onClick={close}
          className="text-xs text-muted hover:text-slate-300 transition"
        >
          Not now
        </button>
      </div>
    </div>
  );
}
