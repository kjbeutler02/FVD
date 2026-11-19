"use client";

import { useState } from "react";
import { signOut } from "next-auth/react";
import { LogOut } from "lucide-react";
import Wordmark from "@/components/Wordmark";
import { Button, Eyebrow, Spinner } from "@/components/ui";

/** Floating navigation (surface level 1): translucent, inset from the shell edge. */
export default function Header() {
  const [signingOut, setSigningOut] = useState(false);

  async function handleSignOut() {
    setSigningOut(true);
    try {
      await signOut({ redirectTo: "/" });
    } catch {
      setSigningOut(false);
    }
  }

  return (
    <header className="shrink-0 px-3 pt-3">
      <div className="sh-nav-surface mx-auto flex h-16 max-w-[1180px] items-center justify-between gap-4 pl-6 pr-3">
        <div className="flex items-center gap-4">
          <Wordmark size="md" />
          <span className="hidden h-7 w-px bg-line sm:block" />
          <Eyebrow as="span" className="hidden sm:block">
            Project Documents
          </Eyebrow>
        </div>

        <Button
          variant="ghost"
          onClick={handleSignOut}
          disabled={signingOut}
          aria-label="Sign out"
          icon={signingOut ? <Spinner size={16} /> : <LogOut size={16} />}
        >
          <span className="hidden sm:inline">Sign out</span>
        </Button>
      </div>
    </header>
  );
}
