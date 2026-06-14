"use client";

import { useState } from "react";
import { FolderInput, Loader2, ArrowRight } from "lucide-react";

function parseProjectId(input: string): number | null {
  const trimmed = input.trim();
  const asInt = parseInt(trimmed, 10);
  if (!isNaN(asInt) && asInt > 0 && String(asInt) === trimmed) return asInt;

  // Try extracting from Filevine URL patterns
  const match = trimmed.match(/(?:projects?|Project\/Id)\/(\d+)/i);
  return match ? parseInt(match[1], 10) : null;
}

interface Props {
  onSubmit: (projectId: number) => void;
  loading: boolean;
  error: string | null;
}

export default function ProjectInput({ onSubmit, loading, error }: Props) {
  const [input, setInput] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const projectId = parseProjectId(input);
    if (!projectId) {
      setValidationError("Enter a valid project ID or Filevine project URL.");
      return;
    }
    setValidationError(null);
    onSubmit(projectId);
  }

  const shownError = validationError || error;

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col items-center px-6 py-16 sm:py-24">
      <div className="flex h-14 w-14 items-center justify-center rounded-md bg-brand-tint text-brand">
        <FolderInput size={26} strokeWidth={1.75} />
      </div>

      <h1 className="mt-6 text-center text-2xl font-bold text-ink">
        Open a Project
      </h1>
      <p className="mt-2 max-w-sm text-center text-sm font-light leading-relaxed text-muted">
        Enter a Filevine project ID or paste a project link to browse its folders
        and download documents as an archive.
      </p>

      <form onSubmit={handleSubmit} className="mt-8 w-full">
        <label
          htmlFor="project-id"
          className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-ink"
        >
          Project ID or URL
        </label>
        <input
          id="project-id"
          type="text"
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            setValidationError(null);
          }}
          placeholder="e.g. 12345"
          className="w-full rounded-sm border border-line bg-surface px-3.5 py-3 text-sm text-ink placeholder-muted/70 transition-colors focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand-light/40"
          disabled={loading}
          autoFocus
        />
        <p className="mt-1.5 text-xs font-light text-muted">
          Accepts a numeric ID or a full{" "}
          <span className="text-ink/70">app.filevine.com/projects/&hellip;</span>{" "}
          link.
        </p>

        {shownError && (
          <div className="mt-4 rounded-sm border border-error/30 bg-error/5 px-3.5 py-2.5">
            <p className="text-sm text-error">{shownError}</p>
          </div>
        )}

        <button
          type="submit"
          disabled={loading || !input.trim()}
          className="mt-6 flex w-full items-center justify-center gap-2 rounded-sm bg-brand px-4 py-3 text-sm font-semibold uppercase tracking-wider text-white transition-colors hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? (
            <>
              <Loader2 size={18} className="animate-spin" />
              Opening Project
            </>
          ) : (
            <>
              Open Project
              <ArrowRight size={17} />
            </>
          )}
        </button>
      </form>
    </div>
  );
}
