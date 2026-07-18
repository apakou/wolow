"use client";

import { usePathname } from "next/navigation";
import { useEffect, useLayoutEffect, useState } from "react";
import { getScreenAnimation } from "@/lib/nav-transition";

// useLayoutEffect on the client (runs before paint → the animation class is
// present on the first visible frame); harmless useEffect during SSR.
const useIsoLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

/**
 * Remounts on every route navigation and plays a native-app style screen
 * transition: push (slide in from right), pop (slide in from left) or a
 * quick tab cross-fade — direction inferred in src/lib/nav-transition.ts.
 */
export default function Template({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [anim, setAnim] = useState("");

  useIsoLayoutEffect(() => {
    setAnim(getScreenAnimation(pathname));
  }, [pathname]);

  return <div className={anim}>{children}</div>;
}
