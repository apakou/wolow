/**
 * Shared PWA helpers install-prompt detection and display-mode checks.
 */

export type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

/** True when running as an installed app (home-screen / standalone window). */
export function isStandaloneDisplayMode(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

/** iPhone / iPad / iPod including iPadOS 13+ which reports as Macintosh. */
export function isIosDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  if (/iphone|ipad|ipod/i.test(navigator.userAgent)) return true;
  return /macintosh/i.test(navigator.userAgent) && navigator.maxTouchPoints > 1;
}

export function isMobileDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  return /android/i.test(navigator.userAgent) || isIosDevice();
}

// Module-level flag so other popups (e.g. the push-notification invite) can
// avoid stacking on top of the install popup. All client components share
// this module instance within a page load.
let installPromptOpen = false;

export function setInstallPromptOpen(open: boolean): void {
  installPromptOpen = open;
}

export function isInstallPromptOpen(): boolean {
  return installPromptOpen;
}
