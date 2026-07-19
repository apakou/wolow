"use client";

import { useEffect } from "react";

/**
 * Locks document scrolling while the calling component is mounted.
 *
 * App-shell screens (fixed header/nav + one internal `overflow-y-auto`
 * region inside an `h-dvh` flex column) must never let the document itself
 * scroll: on mobile, focusing an input or scroll-into-view otherwise pans
 * the page and pushes the header/tab bar off-screen.
 *
 * Previous inline overflow values are restored on unmount so body-scrolling
 * pages (/, /help, /welcome) keep working after navigation.
 */
export function useDocumentScrollLock() {
  useEffect(() => {
    const html = document.documentElement;
    const prevHtmlOverflow = html.style.overflow;
    const prevBodyOverflow = document.body.style.overflow;
    html.style.overflow = "hidden";
    document.body.style.overflow = "hidden";
    return () => {
      html.style.overflow = prevHtmlOverflow;
      document.body.style.overflow = prevBodyOverflow;
    };
  }, []);
}
