"use client";

import { useState } from "react";
import { LogOut, Loader2 } from "lucide-react";
import Wordmark from "@/components/Wordmark";

interface Props {
  onSignOut?: () => void;
}

export default function Header({ onSignOut }: Props) {
  const [signingOut, setSigningOut] = useState(false);

  async function handleSignOut() {
    setSigningOut(true);
    try {
      await fetch("/api/logout", { method: "POST" });
    } catch {
      // Clearing the cookie is best-effort; fall through to the reset regardless.
    } finally {
      onSignOut?.();
    }
  }

  return (
    <header className="bg-brand text-white">
      <div className="mx-auto flex h-16 max-w-[1600px] items-center justify-between gap-4 px-4 sm:px-6">
        <div className="flex items-center gap-4">
          <Wordmark variant="on-blue" size="md" />
          <span className="hidden h-7 w-px bg-white/20 sm:block" />
          <span className="hidden text-[0.65rem] font-medium uppercase tracking-[0.2em] text-white/70 sm:block">
            Project Documents
          </span>
        </div>

        {onSignOut && (
          <button
            type="button"
            onClick={handleSignOut}
            disabled={signingOut}
            className="inline-flex items-center gap-2 rounded-sm border border-white/25 px-3 py-2 text-xs font-semibold uppercase tracking-wider text-white transition-colors hover:bg-white/10 disabled:opacity-60"
          >
            {signingOut ? (
              <Loader2 size={15} className="animate-spin" />
            ) : (
              <LogOut size={15} />
            )}
            <span className="hidden sm:inline">Sign Out</span>
          </button>
        )}
      </div>
    </header>
  );
}
