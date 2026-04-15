import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import SignOutButton from "./SignOutButton";
import { relativeTime } from "@/lib/relative-time";

type Room = {
  id: string;
  slug: string;
  display_name: string;
  created_at: string;
};

export default async function MyRoomsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/");
  }

  const { data: rooms } = await supabase
    .from("rooms")
    .select("id, slug, display_name, created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  const roomList: Room[] = rooms ?? [];

  return (
    <main className="min-h-screen bg-app-gradient px-4 py-8">
      <div className="w-full max-w-sm mx-auto flex flex-col gap-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-white">My rooms</h1>
            <p className="text-xs text-muted mt-0.5">{user.email}</p>
          </div>
          <SignOutButton />
        </div>

        {/* Create new */}
        <a
          href="/"
          className="flex items-center justify-center gap-2 w-full bg-accent hover:opacity-90
                     text-white font-semibold py-3.5 px-6 rounded-2xl transition-all duration-150 text-sm"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
            <path d="M10.75 4.75a.75.75 0 0 0-1.5 0v4.5h-4.5a.75.75 0 0 0 0 1.5h4.5v4.5a.75.75 0 0 0 1.5 0v-4.5h4.5a.75.75 0 0 0 0-1.5h-4.5v-4.5Z" />
          </svg>
          Create new room
        </a>

        {/* Room list */}
        {roomList.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-12 text-center">
            <div className="w-12 h-12 rounded-full bg-surface-light flex items-center justify-center mb-1">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6 text-muted">
                <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H8.25m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H12m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 0 1-2.555-.337A5.972 5.972 0 0 1 5.41 20.97a5.969 5.969 0 0 1-.474-.065 4.48 4.48 0 0 0 .978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25Z" />
              </svg>
            </div>
            <p className="text-slate-300 text-sm font-medium">No rooms yet</p>
            <p className="text-muted text-xs">Create your first room above</p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {roomList.map((room) => (
              <a
                key={room.id}
                href={`/api/rooms/${room.slug}/claim`}
                className="flex items-center justify-between gap-3 bg-surface border border-border
                           rounded-2xl px-4 py-3.5 hover:bg-surface-light transition-all active:scale-[0.98]"
              >
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-white truncate">{room.display_name}</p>
                  <p className="text-xs text-muted mt-0.5">Created {relativeTime(room.created_at)}</p>
                </div>
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 text-muted shrink-0">
                  <path fillRule="evenodd" d="M8.22 5.22a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.75.75 0 0 1-1.06-1.06L11.94 10 8.22 6.28a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" />
                </svg>
              </a>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
