"use client";

import { useState } from "react";
import { AlertTriangle, ArrowRight, FolderInput } from "lucide-react";
import { Button, Eyebrow, Spinner, StatusBand } from "@/components/ui";

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
    <div className="mx-auto w-full max-w-xl px-3 py-10 sm:py-16">
      <section className="sh-content-surface sh-rise p-7 sm:p-10">
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-ice text-navy">
          <FolderInput size={22} strokeWidth={1.75} />
        </span>

        <Eyebrow className="mt-6">Filevine</Eyebrow>
        <h1 className="mt-2 text-3xl text-ink">Open a project</h1>
        <p className="mt-3 max-w-md text-base text-secondary">
          Enter a Filevine project ID or paste a project link to browse its folders
          and download documents as an archive.
        </p>

        <form onSubmit={handleSubmit} className="mt-8">
          <label htmlFor="project-id" className="sh-eyebrow mb-2 block pl-5">
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
            aria-invalid={shownError ? true : undefined}
            aria-describedby={shownError ? "project-id-error" : "project-id-hint"}
            className={`h-12 w-full rounded-full border bg-solid px-5 font-mono text-base text-ink placeholder:text-tertiary transition-[border-color,box-shadow] duration-[180ms] ease-sh focus:outline-none focus:ring-[3px] focus:ring-focus disabled:opacity-60 ${
              shownError ? "border-error" : "border-line focus:border-blue"
            }`}
            disabled={loading}
            autoFocus
          />
          <p id="project-id-hint" className="mt-2 pl-5 text-xs text-secondary">
            Accepts a numeric ID or a full{" "}
            <span className="font-mono text-ink">app.filevine.com/projects/&hellip;</span> link.
          </p>

          {shownError && (
            <StatusBand
              tone="error"
              className="mt-4"
              icon={<AlertTriangle size={16} />}
            >
              <p id="project-id-error">{shownError}</p>
            </StatusBand>
          )}

          <Button
            type="submit"
            size="lg"
            fullWidth
            className="mt-6"
            disabled={loading || !input.trim()}
            icon={loading ? <Spinner size={18} className="text-white" /> : undefined}
            iconAfter={loading ? undefined : <ArrowRight size={17} />}
          >
            {loading ? "Opening project" : "Open project"}
          </Button>
        </form>
      </section>
    </div>
  );
}
