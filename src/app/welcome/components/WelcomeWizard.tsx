"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { reportError } from "@/lib/report-error";
import {
  validateSlug,
  suggestSlugFromName,
  randomSlugSuffix,
  SLUG_ERROR_MESSAGES,
  SLUG_MAX,
} from "@/lib/slug";

type Props = {
  initialSlug: string;
  initialDisplayName: string;
};

type Step = 1 | 2 | 3;

type Availability =
  | { state: "idle" }
  | { state: "checking" }
  | { state: "available" }
  | { state: "own" }
  | { state: "taken" }
  | { state: "invalid"; message: string }
  | { state: "unchecked" }; // network hiccup — server verifies on claim

const NAME_MAX = 40;

export default function WelcomeWizard({ initialSlug, initialDisplayName }: Props) {
  const router = useRouter();

  const [step, setStep] = useState<Step>(1);

  // ── Identity state ──────────────────────────────────────────
  const [displayName, setDisplayName] = useState(initialDisplayName);
  const [savedName, setSavedName] = useState(initialDisplayName);
  const [slugInput, setSlugInput] = useState(() => suggestSlugFromName(initialDisplayName));
  const [effectiveSlug, setEffectiveSlug] = useState(initialSlug); // saved server-side
  const [availability, setAvailability] = useState<Availability>({ state: "idle" });
  const [claiming, setClaiming] = useState(false);
  const [claimError, setClaimError] = useState<string | null>(null);
  const autoSuffixed = useRef(false);

  // ── Link / share state ──────────────────────────────────────
  const [host, setHost] = useState("wolow.app");
  const [origin, setOrigin] = useState("");
  const [copied, setCopied] = useState(false);
  const [canShare, setCanShare] = useState(false);
  const [finishing, setFinishing] = useState(false);

  const link = origin ? `${origin}/${effectiveSlug}` : `https://${host}/${effectiveSlug}`;

  useEffect(() => {
    setHost(window.location.host);
    setOrigin(window.location.origin);
    setCanShare(!!navigator.share);
  }, []);

  // ── Live slug availability (debounced) ──────────────────────
  useEffect(() => {
    const candidate = slugInput.trim().toLowerCase();

    if (candidate.length === 0) {
      setAvailability({ state: "idle" });
      return;
    }

    const validation = validateSlug(candidate);
    if (!validation.ok) {
      setAvailability({ state: "invalid", message: SLUG_ERROR_MESSAGES[validation.reason] });
      return;
    }

    if (validation.slug === effectiveSlug) {
      setAvailability({ state: "own" });
      return;
    }

    setAvailability({ state: "checking" });
    const timer = setTimeout(async () => {
      try {
        const supabase = createClient();
        const { data, error } = await supabase
          .from("rooms")
          .select("id")
          .eq("slug", validation.slug)
          .maybeSingle();

        if (error) {
          setAvailability({ state: "unchecked" });
          return;
        }

        if (data) {
          // First suggestion taken? Auto-retry once with a fun suffix.
          if (!autoSuffixed.current) {
            autoSuffixed.current = true;
            setSlugInput(`${validation.slug.slice(0, SLUG_MAX - 3)}${randomSlugSuffix(3)}`);
            return;
          }
          setAvailability({ state: "taken" });
        } else {
          setAvailability({ state: "available" });
        }
      } catch {
        setAvailability({ state: "unchecked" });
      }
    }, 400);

    return () => clearTimeout(timer);
  }, [slugInput, effectiveSlug]);

  // ── Actions ─────────────────────────────────────────────────
  const patchRoom = useCallback(
    (body: Record<string, unknown>): Promise<Response> =>
      fetch(`/api/rooms/${encodeURIComponent(effectiveSlug)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    [effectiveSlug]
  );

  async function handleClaim() {
    setClaimError(null);

    const name = displayName.trim();
    if (name.length < 1 || name.length > NAME_MAX) {
      setClaimError(`Name must be 1–${NAME_MAX} characters.`);
      return;
    }

    const validation = validateSlug(slugInput);
    if (!validation.ok) {
      setClaimError(SLUG_ERROR_MESSAGES[validation.reason]);
      return;
    }

    const body: Record<string, unknown> = {};
    if (name !== savedName) body.display_name = name;
    if (validation.slug !== effectiveSlug) body.slug = validation.slug;

    // Nothing changed — just move on.
    if (Object.keys(body).length === 0) {
      setStep(2);
      return;
    }

    setClaiming(true);
    try {
      const res = await patchRoom(body);
      const data = (await res.json().catch(() => ({}))) as {
        slug?: string;
        display_name?: string;
        error?: string;
      };

      if (!res.ok) {
        if (res.status === 409) setAvailability({ state: "taken" });
        setClaimError(data.error ?? "Couldn't save — please try again.");
        return;
      }

      if (data.slug) setEffectiveSlug(data.slug);
      if (data.display_name) setSavedName(data.display_name);
      setStep(2);
    } catch {
      setClaimError("Network error — please try again.");
    } finally {
      setClaiming(false);
    }
  }

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(link);
    } catch {
      // Fallback for denied clipboard permission
      try {
        const el = document.createElement("input");
        el.value = link;
        el.style.position = "fixed";
        el.style.opacity = "0";
        document.body.appendChild(el);
        el.focus();
        el.select();
        document.execCommand("copy");
        document.body.removeChild(el);
      } catch {
        return; // couldn't copy — leave the "Next" link as the way forward
      }
    }
    setCopied(true);
    setTimeout(() => setStep(3), 900);
  }, [link]);

  /** Mark onboarding complete and land in the inbox. Never traps the user. */
  const finish = useCallback(async () => {
    if (finishing) return;
    setFinishing(true);
    try {
      const res = await patchRoom({ onboarding_completed: true });
      if (!res.ok) {
        reportError({
          message: `Onboarding completion PATCH failed (${res.status})`,
          endpoint: `/api/rooms/${effectiveSlug}`,
          method: "PATCH",
          statusCode: res.status,
          slug: effectiveSlug,
        });
      }
    } catch (err) {
      reportError({
        message: err instanceof Error ? err.message : "Onboarding completion failed",
        endpoint: `/api/rooms/${effectiveSlug}`,
        slug: effectiveSlug,
      });
    }
    // Proceed regardless — if the flag didn't stick, /welcome shows again
    // next sign-in (logged above), which beats trapping the user here.
    router.replace(`/${effectiveSlug}/inbox`);
  }, [effectiveSlug, finishing, patchRoom, router]);

  async function handleShare() {
    try {
      await navigator.share({
        title: `${savedName} wants your anonymous messages`,
        text: "Send me an anonymous message on Wolow",
        url: link,
      });
      finish();
    } catch {
      // User cancelled the share sheet — stay on this step.
    }
  }

  const shareText = encodeURIComponent(`${savedName} wants your anonymous messages — ${link}`);
  const platforms = [
    { name: "WhatsApp", emoji: "💬", href: `https://wa.me/?text=${shareText}` },
    {
      name: "Telegram",
      emoji: "✈️",
      href: `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(
        `${savedName} wants your anonymous messages`
      )}`,
    },
    { name: "X", emoji: "𝕏", href: `https://x.com/intent/post?text=${shareText}` },
  ];

  // ── UI helpers ──────────────────────────────────────────────
  const availabilityLine = (() => {
    switch (availability.state) {
      case "checking":
        return (
          <span className="flex items-center gap-1.5 text-muted">
            <span className="w-3 h-3 border-2 border-border border-t-accent rounded-full animate-spin" />
            Checking…
          </span>
        );
      case "available":
        return <span className="text-emerald-400">✓ {host}/{slugInput.trim().toLowerCase()} is yours</span>;
      case "own":
        return <span className="text-emerald-400">✓ This is your current link</span>;
      case "taken":
        return <span className="text-red-400">Already taken — try another</span>;
      case "invalid":
        return <span className="text-amber-400">{availability.message}</span>;
      case "unchecked":
        return <span className="text-muted">We&apos;ll confirm availability when you claim it</span>;
      default:
        return <span className="text-muted">Pick something short and memorable</span>;
    }
  })();

  const claimDisabled =
    claiming ||
    availability.state === "checking" ||
    availability.state === "taken" ||
    availability.state === "invalid" ||
    displayName.trim().length === 0;

  return (
    <main className="min-h-dvh bg-app-gradient flex flex-col items-center px-5 pt-6 pb-8">
      {/* Top bar: back + progress dots */}
      <div className="w-full max-w-sm flex items-center justify-between h-9">
        {step > 1 ? (
          <button
            type="button"
            onClick={() => setStep((s) => (s - 1) as Step)}
            className="w-9 h-9 -ml-2 rounded-full flex items-center justify-center text-slate-400 hover:text-white hover:bg-surface-light/60 transition"
            aria-label="Back"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
              <path
                fillRule="evenodd"
                d="M17 10a.75.75 0 01-.75.75H5.612l4.158 3.96a.75.75 0 11-1.04 1.08l-5.5-5.25a.75.75 0 010-1.08l5.5-5.25a.75.75 0 111.04 1.08L5.612 9.25H16.25A.75.75 0 0117 10z"
                clipRule="evenodd"
              />
            </svg>
          </button>
        ) : (
          <span className="w-9" />
        )}

        <div className="flex items-center gap-1.5" aria-label={`Step ${step} of 3`}>
          {([1, 2, 3] as const).map((s) => (
            <span
              key={s}
              className={`h-1.5 rounded-full transition-all duration-300 ${
                s === step ? "w-6 bg-secondary" : s < step ? "w-1.5 bg-secondary/50" : "w-1.5 bg-surface-light"
              }`}
            />
          ))}
        </div>

        <span className="w-9" />
      </div>

      {/* Step content */}
      <div key={step} className="w-full max-w-sm flex-1 flex flex-col justify-center gap-7 anim-rise-in">
        {step === 1 && (
          <>
            <header className="text-center flex flex-col items-center gap-4">
              <div className="w-16 h-16 rounded-2xl bg-accent/15 flex items-center justify-center text-3xl anim-float">
                <span role="img" aria-hidden>
                  🔗
                </span>
              </div>
              <div>
                <h1 className="text-3xl font-extrabold text-white tracking-tight">Claim your link</h1>
                <p className="mt-2 text-sm text-muted leading-relaxed">
                  Your name and link are what friends see. The messages you receive stay anonymous.
                </p>
              </div>
            </header>

            <div className="flex flex-col gap-4">
              <label className="text-xs font-medium text-slate-300">
                Your name
                <input
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  maxLength={NAME_MAX}
                  autoComplete="nickname"
                  className="mt-1.5 w-full bg-surface-light border border-border rounded-xl px-3.5 py-3 text-base text-white placeholder-muted focus:outline-none focus:ring-2 focus:ring-secondary"
                  placeholder="What friends call you"
                />
              </label>

              <label className="text-xs font-medium text-slate-300">
                Your link
                <div className="mt-1.5 flex items-center bg-surface-light border border-border rounded-xl focus-within:ring-2 focus-within:ring-secondary overflow-hidden">
                  <span className="pl-3.5 pr-1 py-3 text-base text-muted select-none shrink-0">{host}/</span>
                  <input
                    type="text"
                    value={slugInput}
                    onChange={(e) => setSlugInput(e.target.value.toLowerCase())}
                    maxLength={SLUG_MAX}
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    className="flex-1 min-w-0 bg-transparent py-3 pr-3.5 text-base text-white placeholder-muted focus:outline-none"
                    placeholder="yourname"
                  />
                </div>
                <p className="mt-1.5 text-xs min-h-4">{availabilityLine}</p>
              </label>

              {claimError && <p className="text-xs text-red-400">{claimError}</p>}

              <button
                type="button"
                onClick={handleClaim}
                disabled={claimDisabled}
                className="w-full rounded-2xl bg-accent px-4 py-4 text-base font-bold text-white transition hover:opacity-90 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {claiming ? "Claiming…" : "Claim my link"}
              </button>

              <button
                type="button"
                onClick={() => setStep(2)}
                className="text-xs text-muted hover:text-slate-300 transition self-center"
              >
                Keep my random link for now
              </button>
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <header className="text-center flex flex-col items-center gap-4">
              <div className="w-16 h-16 rounded-2xl bg-accent/15 flex items-center justify-center text-3xl anim-float">
                <span role="img" aria-hidden>
                  📋
                </span>
              </div>
              <div>
                <h1 className="text-3xl font-extrabold text-white tracking-tight">Copy your link</h1>
                <p className="mt-2 text-sm text-muted leading-relaxed">
                  This is your inbox address — anyone with it can send you an anonymous message.
                </p>
              </div>
            </header>

            <div className="flex flex-col gap-4">
              <button
                type="button"
                onClick={handleCopy}
                className="w-full rounded-2xl border border-border bg-surface/60 backdrop-blur px-4 py-5 transition hover:border-accent/60 active:scale-[0.98]"
              >
                <span className="block font-mono text-base text-white break-all">
                  {host}/{effectiveSlug}
                </span>
                <span className="mt-1 block text-xs text-muted">tap to copy</span>
              </button>

              <button
                type="button"
                onClick={handleCopy}
                className={`w-full rounded-2xl px-4 py-4 text-base font-bold transition active:scale-[0.98] ${
                  copied ? "bg-emerald-500 text-white" : "bg-accent text-white hover:opacity-90"
                }`}
              >
                {copied ? "Copied ✓" : "Copy link"}
              </button>

              <button
                type="button"
                onClick={() => setStep(3)}
                className="text-xs text-muted hover:text-slate-300 transition self-center"
              >
                Next →
              </button>
            </div>
          </>
        )}

        {step === 3 && (
          <>
            <header className="text-center flex flex-col items-center gap-4">
              <div className="w-16 h-16 rounded-2xl bg-accent/15 flex items-center justify-center text-3xl anim-float">
                <span role="img" aria-hidden>
                  📣
                </span>
              </div>
              <div>
                <h1 className="text-3xl font-extrabold text-white tracking-tight">Share it everywhere</h1>
                <p className="mt-2 text-sm text-muted leading-relaxed">
                  Story, bio, group chats — the more you share, the more honest messages you get.
                </p>
              </div>
            </header>

            <div className="flex flex-col gap-4">
              {canShare && (
                <button
                  type="button"
                  onClick={handleShare}
                  disabled={finishing}
                  className="w-full rounded-2xl bg-accent px-4 py-4 text-base font-bold text-white transition hover:opacity-90 active:scale-[0.98] disabled:opacity-40"
                >
                  Share my link
                </button>
              )}

              <div className="grid grid-cols-3 gap-2.5">
                {platforms.map((p) => (
                  <a
                    key={p.name}
                    href={p.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => finish()}
                    className="flex flex-col items-center gap-1.5 rounded-2xl border border-border bg-surface/60 px-2 py-4 transition hover:bg-surface-light active:scale-[0.98]"
                  >
                    <span className="text-2xl leading-none">{p.emoji}</span>
                    <span className="text-xs font-medium text-slate-200">{p.name}</span>
                  </a>
                ))}
              </div>

              <button
                type="button"
                onClick={() => finish()}
                disabled={finishing}
                className="text-xs text-muted hover:text-slate-300 transition self-center disabled:opacity-50"
              >
                {finishing ? "Opening your inbox…" : "I'll do it later"}
              </button>
            </div>
          </>
        )}
      </div>

      {/* Trust line */}
      <p className="w-full max-w-sm text-center text-xs text-muted flex items-center justify-center gap-1.5 anim-rise-in-delayed">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5">
          <path
            fillRule="evenodd"
            d="M10 1a4.5 4.5 0 00-4.5 4.5V9H5a2 2 0 00-2 2v6a2 2 0 002 2h10a2 2 0 002-2v-6a2 2 0 00-2-2h-.5V5.5A4.5 4.5 0 0010 1zm3 8V5.5a3 3 0 10-6 0V9h6z"
            clipRule="evenodd"
          />
        </svg>
        Anonymous &amp; end-to-end encrypted
      </p>
    </main>
  );
}
