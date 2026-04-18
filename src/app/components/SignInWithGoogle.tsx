"use client";

import { createClient } from "@/lib/supabase/client";

export default function SignInWithGoogle({ next }: { next?: string }) {
  async function handleSignIn() {
    const supabase = createClient();
    const callbackUrl = next
      ? `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`
      : `${window.location.origin}/auth/callback`;
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        // Use the current origin so local network testing works correctly
        redirectTo: callbackUrl,
      },
    });
  }

  return (
    <main className="min-h-screen bg-app-gradient flex items-center justify-center px-4">
      <div className="w-full max-w-sm flex flex-col gap-8">
        {/* Logo / branding */}
        <div className="text-center flex flex-col items-center gap-4">
          <div className="w-16 h-16 rounded-2xl bg-accent flex items-center justify-center">
            <svg width="32" height="32" viewBox="0 0 88 96" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M30.4 77.152C26.304 77.152 23.104 75.8293 20.8 73.184C18.5813 70.4533 17.0453 66.1013 16.192 60.128L13.504 41.696C13.4187 41.0133 13.248 40.544 12.992 40.288C12.736 40.032 12.352 39.904 11.84 39.904H8.384L8 38.496C9.70667 36.96 11.7547 35.7653 14.144 34.912C16.5333 33.9733 18.88 33.504 21.184 33.504C22.464 33.504 23.36 33.888 23.872 34.656C24.4693 35.424 24.9387 36.9173 25.28 39.136L28.608 62.176C29.2053 66.3573 29.888 69.216 30.656 70.752C31.424 72.288 32.576 73.056 34.112 73.056C36.5013 73.056 38.3787 71.6053 39.744 68.704C41.1947 65.7173 41.92 61.792 41.92 56.928C41.92 51.9787 41.28 46.9013 40 41.696C39.8293 41.0133 39.6587 40.544 39.488 40.288C39.3173 40.032 38.9333 39.904 38.336 39.904H35.008L34.624 38.496C36.2453 36.96 38.2507 35.7653 40.64 34.912C43.0293 33.9733 45.4187 33.504 47.808 33.504C49.0027 33.504 49.8987 33.9307 50.496 34.784C51.0933 35.552 51.52 37.0027 51.776 39.136L54.976 61.536C55.6587 66.144 56.384 69.216 57.152 70.752C58.0053 72.288 59.0293 73.056 60.224 73.056C62.528 73.056 64.3627 71.3493 65.728 67.936C67.1787 64.4373 67.904 59.9147 67.904 54.368C67.904 50.6133 67.52 47.3707 66.752 44.64C66.0693 41.824 64.9173 39.3493 63.296 37.216L62.272 35.808L63.168 34.784L73.92 33.504C74.176 36.832 74.304 39.776 74.304 42.336C74.304 53.2587 72.7253 61.792 69.568 67.936C66.496 74.08 62.0587 77.152 56.256 77.152C52.7573 77.152 50.112 76.256 48.32 74.464C46.528 72.672 45.0347 69.3867 43.84 64.608C42.1333 72.9707 37.6533 77.152 30.4 77.152Z" fill="white"/>
            </svg>
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white tracking-tight">
              Send me anonymous messages
            </h1>
            <p className="mt-2 text-sm text-muted">
              Create a link and share it — anyone can message you anonymously.
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <button
            onClick={handleSignIn}
            className="w-full flex items-center justify-center gap-3 bg-white hover:bg-gray-50
                       text-gray-900 font-semibold py-3.5 px-6 rounded-2xl transition-all duration-150 text-sm"
          >
            {/* Google logo */}
            <svg width="18" height="18" viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
              <path fill="#EA4335" d="M24 9.5c3.1 0 5.8 1.1 8 2.9l6-6C34.5 3.1 29.5 1 24 1 14.7 1 6.8 6.6 3.3 14.7l7 5.4C12 14 17.5 9.5 24 9.5z"/>
              <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v8.5h12.7c-.6 3-2.3 5.5-4.8 7.2l7.4 5.7c4.3-4 6.2-9.9 6.2-16.9z"/>
              <path fill="#FBBC05" d="M10.3 28.7A14.5 14.5 0 0 1 9.5 24c0-1.6.3-3.2.8-4.7l-7-5.4A23.9 23.9 0 0 0 0 24c0 3.9.9 7.5 2.6 10.8l7.7-6.1z"/>
              <path fill="#34A853" d="M24 47c5.4 0 10-1.8 13.3-4.8l-7.4-5.7c-1.8 1.2-4.1 2-6.9 2-6.5 0-12-4.5-14-10.8l-7.7 6.1C6.8 41.4 14.7 47 24 47z"/>
            </svg>
            Continue with Google
          </button>

          <p className="text-center text-xs text-muted">
            By continuing, you agree to our terms of service.
          </p>
        </div>
      </div>
    </main>
  );
}
