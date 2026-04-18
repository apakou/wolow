import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import ChatRoom from "./components/ChatRoom";

type Props = { params: Promise<{ slug: string }> };

async function getRoom(slug: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("rooms")
    .select("id, slug, display_name, user_id")
    .eq("slug", slug)
    .single();
  return data;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const room = await getRoom(slug);
  if (!room) return {};

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://wolow.app";
  const url = `${appUrl}/${slug}`;
  const title = `${room.display_name} wants your anonymous messages`;
  const description = "Send them a message anonymously on Wolow";

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: "website",
      url,
    },
    twitter: {
      card: "summary",
      title,
      description,
    },
  };
}

export default async function SlugPage({ params }: Props) {
  const { slug } = await params;

  // Require authentication — visitors must be signed in
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    redirect(`/?next=/${slug}`);
  }

  const room = await getRoom(slug);
  if (!room) notFound();

  // If the signed-in user owns this room, send them to their inbox
  if (room.user_id === user.id) {
    redirect(`/${slug}/inbox`);
  }

  return <ChatRoom roomId={room.id} slug={room.slug} displayName={room.display_name} />;
}
