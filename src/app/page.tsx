import { auth } from "@/lib/auth";
import SignInLanding from "@/components/SignInLanding";
import HomeClient from "@/components/HomeClient";

export default async function Home() {
  // Server-side session check — the proxy also guards /api/*, but the page
  // itself never renders the app without a valid Entra session.
  const session = await auth();
  if (!session?.user) return <SignInLanding />;
  return <HomeClient />;
}
