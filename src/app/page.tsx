"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useAuth } from "@/hooks/use-auth";
import { useShouldUseModal } from "@/hooks/use-device-type";
import RoomModal from "@/components/RoomModal";
import { reportError } from "@/lib/report-error";

// Dynamically import OwnerInbox to avoid SSR issues
const OwnerInbox = dynamic(() => import("@/app/[slug]/inbox/components/OwnerInbox"), { ssr: false });

function OwnerInboxModal({ roomId, slug, displayName }: { roomId: string; slug: string; displayName: string }) {
  return (
    <div className="h-full flex flex-col">
      <OwnerInbox roomId={roomId} slug={slug} displayName={displayName} />
    </div>
  );
}

const MAX_NAME_LENGTH = 50;

type Room = {
  id: string;
  slug: string;
  display_name: string;
  created_at: string;
  is_archived?: boolean;
  deleted_at?: string | null;
  has_unread?: boolean;
  unread_count?: number;
};

function WolowLogo() {
  return (
    <div className="w-16 h-16 rounded-2xl bg-accent flex items-center justify-center shadow-lg shadow-accent/30">
      <svg width="32" height="32" viewBox="0 0 88 96" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M30.4 77.152C26.304 77.152 23.104 75.8293 20.8 73.184C18.5813 70.4533 17.0453 66.1013 16.192 60.128L13.504 41.696C13.4187 41.0133 13.248 40.544 12.992 40.288C12.736 40.032 12.352 39.904 11.84 39.904H8.384L8 38.496C9.70667 36.96 11.7547 35.7653 14.144 34.912C16.5333 33.9733 18.88 33.504 21.184 33.504C22.464 33.504 23.36 33.888 23.872 34.656C24.4693 35.424 24.9387 36.9173 25.28 39.136L28.608 62.176C29.2053 66.3573 29.888 69.216 30.656 70.752C31.424 72.288 32.576 73.056 34.112 73.056C36.5013 73.056 38.3787 71.6053 39.744 68.704C41.1947 65.7173 41.92 61.792 41.92 56.928C41.92 51.9787 41.28 46.9013 40 41.696C39.8293 41.0133 39.6587 40.544 39.488 40.288C39.3173 40.032 38.9333 39.904 38.336 39.904H35.008L34.624 38.496C36.2453 36.96 38.2507 35.7653 40.64 34.912C43.0293 33.9733 45.4187 33.504 47.808 33.504C49.0027 33.504 49.8987 33.9307 50.496 34.784C51.0933 35.552 51.52 37.0027 51.776 39.136L54.976 61.536C55.6587 66.144 56.384 69.216 57.152 70.752C58.0053 72.288 59.0293 73.056 60.224 73.056C62.528 73.056 64.3627 71.3493 65.728 67.936C67.1787 64.4373 67.904 59.9147 67.904 54.368C67.904 50.6133 67.52 47.3707 66.752 44.64C66.0693 41.824 64.9173 39.3493 63.296 37.216L62.272 35.808L63.168 34.784L73.92 33.504C74.176 36.832 74.304 39.776 74.304 42.336C74.304 53.2587 72.7253 61.792 69.568 67.936C66.496 74.08 62.0587 77.152 56.256 77.152C52.7573 77.152 50.112 76.256 48.32 74.464C46.528 72.672 45.0347 69.3867 43.84 64.608C42.1333 72.9707 37.6533 77.152 30.4 77.152Z" fill="white" />
      </svg>
    </div>
  );
}

function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0" aria-hidden="true">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05" />
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
    </svg>
  );
}

export default function Home() {
  const { user, loading: authLoading, signInWithGoogle, signOut } = useAuth();
  const shouldUseModal = useShouldUseModal();
  const [displayName, setDisplayName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [roomsLoading, setRoomsLoading] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [openedRoomId, setOpenedRoomId] = useState<string | null>(null);
  const claimedRef = useRef(false);

  const loadRooms = useCallback(async () => {
    if (!user) return;
    setRoomsLoading(true);
    try {
      const res = await fetch("/api/my-rooms");
      const data = await res.json();
      if (res.ok && Array.isArray(data)) {
        setRooms(data);
      }
    } catch (err) {
      reportError({
        message: err instanceof Error ? err.message : "Failed to fetch rooms",
        endpoint: "/api/my-rooms",
        method: "GET",
      });
    } finally {
      setRoomsLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (!user || claimedRef.current) return;
    claimedRef.current = true;

    (async () => {
      setClaiming(true);
      try {
        await fetch("/api/claim-all-sessions", { method: "POST" });
      } catch (err) {
        reportError({
          message: err instanceof Error ? err.message : "Failed to claim legacy sessions",
          endpoint: "/api/claim-all-sessions",
          method: "POST",
        });
      } finally {
        setClaiming(false);
        void loadRooms();
      }
    })();
  }, [user, loadRooms]);

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

      // Add new room to list without navigation
      setRooms([{ id: data.id, slug: data.slug, display_name: displayName || "Anonymous", created_at: new Date().toISOString(), has_unread: false, unread_count: 0 }, ...rooms]);
      setDisplayName("");
      setError(null);
    } catch (err) {
      reportError({
        message: err instanceof Error ? err.message : "Failed to create room",
        endpoint: "/api/rooms",
        method: "POST",
      });
      setError("Network error — please try again");
    } finally {
      setLoading(false);
    }
  }

  function handleConnectRoom(room: Room) {
    if (shouldUseModal) {
      setOpenedRoomId(room.id);
    } else {
      // On mobile, navigate to full page
      window.location.href = `/${room.slug}/inbox`;
    }
  }

  if (authLoading) {
    return (
      <main className="min-h-screen bg-app-gradient flex items-center justify-center px-4">
        <div className="h-10 w-10 rounded-full border-2 border-border border-t-accent animate-spin" />
      </main>
    );
  }

  if (!user) {
    return (
      <main className="min-h-screen bg-app-gradient flex items-center justify-center px-4">
        <div className="w-full max-w-md rounded-[2rem] border border-white/10 bg-surface/65 backdrop-blur-xl shadow-2xl p-8 md:p-10">
          <div className="flex flex-col items-center text-center gap-6">
            <WolowLogo />

            <div className="space-y-2">
              <p className="text-xs uppercase tracking-[0.28em] text-muted">Wolow</p>
              <h1 className="text-3xl font-bold tracking-tight text-white">Log in to create your link</h1>
              <p className="text-sm text-muted leading-6">
                Sign in before creating or managing your inbox. If you already used Wolow before, your linked rooms will reappear automatically.
              </p>
            </div>

            <button
              type="button"
              onClick={() => signInWithGoogle("/")}
              className="w-full inline-flex items-center justify-center gap-3 rounded-2xl border border-white/15 bg-white text-slate-900 px-4 py-3.5 text-sm font-semibold transition hover:opacity-95"
            >
              <GoogleMark />
              Continue with Google
            </button>

            <div className="grid w-full grid-cols-1 gap-2 text-left text-xs text-muted sm:grid-cols-3">
              <div className="rounded-2xl border border-white/10 bg-surface-light/50 px-3 py-3">Login required before creating links</div>
              <div className="rounded-2xl border border-white/10 bg-surface-light/50 px-3 py-3">Legacy rooms recovered automatically</div>
              <div className="rounded-2xl border border-white/10 bg-surface-light/50 px-3 py-3">Inbox access from any device</div>
            </div>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-app-gradient px-4 py-8">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
        {/* Header */}
        <section className="rounded-[2rem] border border-white/10 bg-surface/65 backdrop-blur-xl shadow-2xl p-6 md:p-8">
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div className="flex flex-col gap-2">
              <h1 className="text-2xl font-bold text-white tracking-tight">Room Hub</h1>
              <p className="text-sm text-muted">Create, connect, and manage your rooms</p>
              {claiming && <p className="text-xs text-accent">Restoring previously linked sessions…</p>}
            </div>

            <div className="flex gap-3">
              {user && (
                <div className="flex items-center gap-3 border-l border-white/15 pl-3">
                  <div className="text-right">
                    <p className="text-sm font-medium text-white">{user.email}</p>
                    <p className="text-xs text-muted">Signed in</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void signOut()}
                    className="rounded-full border border-white/15 bg-surface-light/60 px-4 py-2 text-xs font-medium text-slate-200 transition hover:bg-surface-light"
                  >
                    Sign out
                  </button>
                </div>
              )}
            </div>
          </div>
        </section>

        {/* Create Room Panel */}
        <section className="rounded-[2rem] border border-white/10 bg-surface/65 backdrop-blur-xl p-6 shadow-2xl">
          <div className="flex flex-col gap-4 max-w-md">
            <div>
              <h2 className="text-lg font-semibold text-white">Create a new room</h2>
              <p className="mt-1 text-sm text-muted">Give your room a name so people know who they're messaging.</p>
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="display_name" className="text-xs font-medium text-muted uppercase tracking-wide">
                Room name <span className="normal-case font-normal">(optional)</span>
              </label>
              <input
                id="display_name"
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Anonymous"
                maxLength={MAX_NAME_LENGTH}
                className="w-full bg-surface border border-border rounded-2xl px-4 py-3.5 text-sm text-white placeholder-muted focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent transition"
              />
              <span className="text-right text-xs text-muted">{displayName.length}/{MAX_NAME_LENGTH}</span>
            </div>

            {error && <p className="text-sm text-red-400">{error}</p>}

            <button
              onClick={handleCreate}
              disabled={loading}
              className="w-full bg-accent hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold py-3.5 px-6 rounded-2xl transition-all duration-150 text-sm"
            >
              {loading ? "Creating…" : "Create room"}
            </button>
          </div>
        </section>

        {/* Rooms List */}
        <section>
          <div className="flex items-center justify-between gap-3 mb-4">
            <div>
              <h2 className="text-xl font-semibold text-white">Your rooms</h2>
              <p className="mt-1 text-sm text-muted">Connect, manage, or delete your rooms</p>
            </div>
            {roomsLoading && <div className="h-5 w-5 rounded-full border-2 border-border border-t-accent animate-spin" />}
          </div>

          <div className="grid gap-3 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
            {!roomsLoading && rooms.length === 0 ? (
              <div className="col-span-full rounded-2xl border border-white/10 bg-surface-light/40 px-4 py-8 text-center text-muted text-sm">
                No rooms yet. Create one to get started!
              </div>
            ) : (
              rooms.map((room) => (
                <button
                  type="button"
                  key={room.id}
                  onClick={() => handleConnectRoom(room)}
                  className="rounded-2xl border border-white/10 bg-surface-light/40 p-4 flex flex-col gap-3 hover:bg-surface-light/60 transition text-left focus:outline-none focus:ring-2 focus:ring-accent"
                >
                  <div className="flex items-start justify-between gap-3 min-w-0">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-white">{room.display_name}</p>
                      <p className="mt-1 truncate text-xs text-muted font-mono">/{room.slug}</p>
                    </div>
                    {room.has_unread && (
                      <span
                        className="shrink-0 inline-flex items-center justify-center rounded-full bg-accent/20 text-accent border border-accent/30 w-7 h-7"
                        aria-label={`${room.unread_count ?? 0} unread messages`}
                        title={`${room.unread_count ?? 0} unread messages`}
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                          <path fillRule="evenodd" d="M16.704 5.29a1 1 0 0 1 .006 1.414l-7.25 7.313a1 1 0 0 1-1.42-.008L4.3 10.186a1 1 0 1 1 1.4-1.428l3.03 2.97 6.563-6.622a1 1 0 0 1 1.411-.006Z" clipRule="evenodd" />
                        </svg>
                      </span>
                    )}
                  </div>

                  <div className="text-xs text-muted">
                    Created {new Date(room.created_at).toLocaleDateString()}
                  </div>

                  <div className="pt-2 border-t border-white/10 flex items-center justify-between text-xs text-muted">
                    <span>{shouldUseModal ? "Tap to open" : "Tap to enter"}</span>
                    {room.has_unread ? (
                      <span className="text-accent font-medium">Unread</span>
                    ) : (
                      <span>No unread</span>
                    )}
                  </div>
                </button>
              ))
            )}
          </div>
        </section>
      </div>

      {/* Room Modal (Laptop/Tablet only) */}
      {shouldUseModal && openedRoomId && (
        <RoomModal
          isOpen={!!openedRoomId}
          onClose={() => setOpenedRoomId(null)}
          title={rooms.find((r) => r.id === openedRoomId)?.display_name || "Room"}
        >
          <OwnerInboxModal
            roomId={openedRoomId}
            slug={rooms.find((r) => r.id === openedRoomId)?.slug || ""}
            displayName={rooms.find((r) => r.id === openedRoomId)?.display_name || ""}
          />
        </RoomModal>
      )}
    </main>
  );
}
