"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import Wordmark from "@/components/Wordmark";

interface Props {
  onAuthenticated: () => void;
}

export default function PassphraseGate({ onAuthenticated }: Props) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!username.trim() || !password) return;

    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/verify-passphrase", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: username.trim(), password }),
      });

      if (res.ok) {
        onAuthenticated();
      } else {
        setError("Invalid username or password.");
        setPassword("");
      }
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col lg:flex-row">
      {/* Brand panel */}
      <div className="flex flex-col justify-between bg-brand px-8 py-10 text-white lg:w-[44%] lg:px-14 lg:py-16">
        <Wordmark variant="on-blue" size="lg" />

        <div className="mt-10 hidden max-w-sm lg:block">
          <p className="text-2xl font-light leading-snug text-white/90">
            Noticed. Believed. Remembered.
          </p>
          <span className="mt-6 block h-px w-16 bg-white/30" />
          <p className="mt-6 text-sm font-light leading-relaxed text-white/70">
            Secure access to firm matter documents. Browse a project&rsquo;s
            folders and download its files as an organized archive.
          </p>
        </div>

        <p className="mt-8 text-[0.7rem] font-medium uppercase tracking-[0.18em] text-white/60 lg:mt-0">
          Authorized firm personnel only
        </p>
      </div>

      {/* Sign-in form */}
      <div className="flex flex-1 items-center justify-center bg-surface px-6 py-12 sm:px-12">
        <div className="w-full max-w-sm">
          <h1 className="text-2xl font-bold text-ink">Sign In</h1>
          <p className="mt-1.5 text-sm font-light text-muted">
            Enter your firm credentials to continue.
          </p>

          <form onSubmit={handleSubmit} className="mt-8">
            <div className="mb-4">
              <label
                htmlFor="username"
                className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-ink"
              >
                Username
              </label>
              <input
                id="username"
                type="text"
                value={username}
                onChange={(e) => {
                  setUsername(e.target.value);
                  setError(null);
                }}
                placeholder="Enter your username"
                className="w-full rounded-sm border border-line bg-surface px-3.5 py-2.5 text-sm text-ink placeholder-muted/70 transition-colors focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand-light/40"
                disabled={loading}
                autoFocus
                autoComplete="username"
              />
            </div>

            <div className="mb-5">
              <label
                htmlFor="password"
                className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-ink"
              >
                Password
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setError(null);
                }}
                placeholder="Enter your password"
                className="w-full rounded-sm border border-line bg-surface px-3.5 py-2.5 text-sm text-ink placeholder-muted/70 transition-colors focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand-light/40"
                disabled={loading}
                autoComplete="current-password"
              />
            </div>

            {error && (
              <div className="mb-5 rounded-sm border border-error/30 bg-error/5 px-3.5 py-2.5">
                <p className="text-sm text-error">{error}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={loading || !username.trim() || !password}
              className="flex w-full items-center justify-center gap-2 rounded-sm bg-brand px-4 py-3 text-sm font-semibold uppercase tracking-wider text-white transition-colors hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? <Loader2 size={18} className="animate-spin" /> : "Sign In"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
