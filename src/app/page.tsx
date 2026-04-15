import { createClient } from "@/lib/supabase/server";
import SignInWithGoogle from "./components/SignInWithGoogle";
import CreateRoomForm from "./components/CreateRoomForm";

export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return <SignInWithGoogle />;
  }

  const email = user.email ?? "";
  return <CreateRoomForm email={email} />;
}
