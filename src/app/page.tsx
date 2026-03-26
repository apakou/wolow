"use client";

import { useState } from "react";

const MAX_NAME_LENGTH = 50;

export default function Home() {
  const [displayName, setDisplayName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCreate() {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ display_name: displayName }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? "Something went wrong");
        return;
      }

      window.location.href = `/${data.slug}/inbox`;
    } catch {
      setError("Network error — please try again");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-zinc-950 flex items-center justify-center px-4">
      <div className="w-full max-w-sm flex flex-col gap-6">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-white tracking-tight">
            Send me anonymous messages
          </h1>
          <p className="mt-2 text-sm text-zinc-400">
            Create a link and share it — anyone can message you anonymously.
          </p>
        </div>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="display_name"
              className="text-xs font-medium text-zinc-400 uppercase tracking-wide"
            >
              Your name <span className="normal-case font-normal">(optional)</span>
            </label>
            <input
              id="display_name"
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Anonymous"
              maxLength={MAX_NAME_LENGTH}
              className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 text-sm text-white placeholder-zinc-600
                         focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition"
            />
            <span className="text-right text-xs text-zinc-600">
              {displayName.length}/{MAX_NAME_LENGTH}
            </span>
          </div>

          {error && (
            <p className="text-sm text-red-400 text-center">{error}</p>
          )}

          <button
            onClick={handleCreate}
            disabled={loading}
            className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed
                       text-white font-semibold py-3 px-6 rounded-xl transition-colors duration-150 text-sm"
          >
            {loading ? "Creating…" : "Create my link"}
          </button>
        </div>
      </div>
    </main>
  );
}
