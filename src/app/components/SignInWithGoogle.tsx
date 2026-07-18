"use client";

import Image from "next/image";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Props = {
  next?: string;
  /** Display name of the room owner the visitor came to message (from ?next=/{slug}) */
  inviterName?: string | null;
  /** True when a previous OAuth attempt failed (?auth_error=1) */
  authError?: boolean;
};

export default function SignInWithGoogle({ next, inviterName, authError }: Props) {
  const [signingIn, setSigningIn] = useState(false);
  const [localError, setLocalError] = useState(false);

  async function handleSignIn() {
    if (signingIn) return;
    setSigningIn(true);
    setLocalError(false);
    const supabase = createClient();
    const callbackUrl = next
      ? `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`
      : `${window.location.origin}/auth/callback`;
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        // Use the current origin so local network testing works correctly
        redirectTo: callbackUrl,
      },
    });
    if (error) {
      // OAuth redirect never started surface it and let the user retry
      setSigningIn(false);
      setLocalError(true);
    }
    // On success the browser navigates away; keep the button in its busy state.
  }

  const showError = localError || authError;

  return (
    <main className="min-h-screen bg-app-gradient flex items-center justify-center px-4">
      <div className="w-full max-w-sm flex flex-col gap-8">
        {/* Logo / branding */}
        <div className="text-center flex flex-col items-center gap-5 anim-rise-in">
          <Image
            src="/wolow.png"
            alt="Wolow"
            width={188}
            height={50}
            priority
            className="h-[50px] w-auto"
          />
          <div>
            <h1 className="text-3xl font-extrabold text-white tracking-tight">
              {inviterName
                ? `Send ${inviterName} an anonymous message`
                : "Get honest, anonymous messages"}
            </h1>
            <p className="mt-2 text-sm text-muted">
              {inviterName
                ? `Sign in to continue ${inviterName} will never see who you are. You'll show up as a random nickname.`
                : "Claim your link, share it anywhere friends message you anonymously."}
            </p>
          </div>
        </div>

        {/* Teaser bubbles */}
        <div className="flex flex-col gap-2.5 anim-rise-in-delayed" aria-hidden>
          <div className="flex items-end gap-2 self-start max-w-[85%]">
            <div className="w-8 h-8 shrink-0 rounded-full bg-gradient-to-br from-white/20 to-white/5 backdrop-blur-md border border-white/30 flex items-center justify-center shadow-lg">
              <span className="text-base leading-none">🐙</span>
            </div>
            <div className="anim-float bg-surface-light rounded-2xl rounded-bl-md px-3.5 py-2.5 text-sm text-slate-200">
              be honest… what do you really think of me? 👀
            </div>
          </div>
          <div
            className="anim-float self-end max-w-[85%] bg-accent rounded-2xl rounded-br-md px-3.5 py-2.5 text-sm text-white"
            style={{ animationDelay: "1.2s" }}
          >
            ok, you asked for it 😂
          </div>
        </div>

        <div className="flex flex-col gap-3 anim-rise-in-delayed">
          {showError && (
            <div
              role="alert"
              className="rounded-2xl border border-red-500/40 bg-red-950/50 px-4 py-3 text-center text-sm text-red-200"
            >
              Sign-in didn&apos;t work. Please try again.
            </div>
          )}

          <button
            onClick={handleSignIn}
            disabled={signingIn}
            className="w-full flex items-center justify-center gap-3 bg-white hover:bg-gray-50
                       text-gray-900 font-semibold py-3.5 px-6 rounded-2xl transition-all duration-150 text-sm
                       active:scale-[0.98] disabled:opacity-70 disabled:cursor-wait"
          >
            {signingIn ? (
              <>
                <span
                  className="h-[18px] w-[18px] rounded-full border-2 border-gray-300 border-t-gray-700 animate-spin"
                  aria-hidden="true"
                />
                Connecting…
              </>
            ) : (
              <>
                {/* Google logo */}
                <svg width="18" height="18" viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
                  <path fill="#EA4335" d="M24 9.5c3.1 0 5.8 1.1 8 2.9l6-6C34.5 3.1 29.5 1 24 1 14.7 1 6.8 6.6 3.3 14.7l7 5.4C12 14 17.5 9.5 24 9.5z"/>
                  <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v8.5h12.7c-.6 3-2.3 5.5-4.8 7.2l7.4 5.7c4.3-4 6.2-9.9 6.2-16.9z"/>
                  <path fill="#FBBC05" d="M10.3 28.7A14.5 14.5 0 0 1 9.5 24c0-1.6.3-3.2.8-4.7l-7-5.4A23.9 23.9 0 0 0 0 24c0 3.9.9 7.5 2.6 10.8l7.7-6.1z"/>
                  <path fill="#34A853" d="M24 47c5.4 0 10-1.8 13.3-4.8l-7.4-5.7c-1.8 1.2-4.1 2-6.9 2-6.5 0-12-4.5-14-10.8l-7.7 6.1C6.8 41.4 14.7 47 24 47z"/>
                </svg>
                Continue with Google
              </>
            )}
          </button>

          <p className="flex items-center justify-center gap-1.5 text-center text-xs text-muted">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 20 20"
              fill="currentColor"
              className="w-3 h-3 shrink-0 text-emerald-400"
              aria-hidden="true"
            >
              <path fillRule="evenodd" d="M10 1a4.5 4.5 0 0 0-4.5 4.5V9H5a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2h-.5V5.5A4.5 4.5 0 0 0 10 1Zm3 8V5.5a3 3 0 1 0-6 0V9h6Z" clipRule="evenodd" />
            </svg>
            Anonymous to friends &amp; end-to-end encrypted
          </p>
        </div>
      </div>
    </main>
  );
}
