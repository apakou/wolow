"use client";

/**
 * NGL-style empty-state card shown to a visitor opening a fresh
 * conversation. Rotates through playful invitation prompts to spark the
 * first message. Rotation pauses under prefers-reduced-motion.
 */

import { useEffect, useState } from "react";
import { INVITATION_PROMPTS, nextRandomIndex } from "@/lib/prompts";

const ROTATE_MS = 4000;

export default function PromptCard({ displayName }: { displayName: string }) {
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = setInterval(
      () => setIdx((i) => nextRandomIndex(i, INVITATION_PROMPTS.length)),
      ROTATE_MS
    );
    return () => clearInterval(id);
  }, []);

  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center px-6 text-center">
      <div className="anim-float select-none text-4xl" aria-hidden="true">
        💬
      </div>
      <div className="anim-pop-in mt-4 w-full max-w-sm rounded-[28px] bg-white px-6 py-8 shadow-2xl">
        <p className="font-display text-[11px] font-bold uppercase tracking-[0.2em] text-ink/50">
          send {displayName} a message
        </p>
        <p
          key={idx}
          className="anim-pop-in mt-3 font-display text-2xl font-bold leading-snug text-ink"
        >
          {INVITATION_PROMPTS[idx]}
        </p>
      </div>
      <p className="anim-rise-in-delayed mt-4 font-display text-sm font-semibold text-slate-300">
        tap 🎲 for an idea or just say hi 👋
      </p>
    </div>
  );
}
