"use client";

import { Eye, Loader2, X } from "lucide-react";
import type { WatchState } from "@/types/upload";
import type { SavedWatch } from "@/lib/watchStore";

interface Props {
  watch: WatchState | null;
  savedWatch: SavedWatch | null;
  onOpen: () => void;
  onStop: () => void;
  onResume: () => void;
  onDismissSaved: () => void;
}

/**
 * Slim status strip under the header while a local folder is being watched,
 * or offering to resume a watch saved from a previous visit. Watching runs
 * in the background; this keeps it visible without a drawer in the way.
 */
export default function WatchBar({ watch, savedWatch, onOpen, onStop, onResume, onDismissSaved }: Props) {
  if (watch?.active) {
    const busy = watch.scanning || watch.activeNames.length > 0;
    return (
      <div className="border-b border-line bg-brand-tint">
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-2 text-sm sm:px-6">
          <div className="flex min-w-0 items-center gap-2 text-ink">
            {busy ? (
              <Loader2 size={15} className="shrink-0 animate-spin text-brand" />
            ) : (
              <Eye size={15} className="shrink-0 text-brand" />
            )}
            <span className="truncate">
              <span className="font-medium">Watching “{watch.folderName}”</span>
              <span className="text-muted">
                {" "}
                → #{watch.destination.projectId}
                {watch.destination.folderPath ? ` / ${watch.destination.folderPath}` : " / Project root"}
              </span>
            </span>
            <span className="hidden shrink-0 text-xs font-light text-muted sm:inline">
              · {watch.uploaded.toLocaleString()} uploaded
              {watch.activeNames.length > 0 && ` · ${watch.activeNames.length} uploading`}
              {watch.waiting > 0 && ` · ${watch.waiting} waiting`}
              {watch.failed > 0 && <span className="text-error"> · {watch.failed} failed</span>}
            </span>
          </div>
          <div className="flex items-center gap-3 text-xs font-semibold uppercase tracking-wider">
            <button type="button" onClick={onOpen} className="text-brand transition-colors hover:text-brand-dark">
              Details
            </button>
            <span className="h-3 w-px bg-line" />
            <button type="button" onClick={onStop} className="text-ink transition-colors hover:text-error">
              Stop
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (savedWatch) {
    return (
      <div className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-2 text-sm sm:px-6">
          <div className="flex min-w-0 items-center gap-2 text-ink">
            <Eye size={15} className="shrink-0 text-muted" />
            <span className="truncate">
              Resume watching <span className="font-medium">“{savedWatch.folderName}”</span>
              <span className="text-muted">
                {" "}
                → #{savedWatch.destination.projectId}
                {savedWatch.destination.folderPath ? ` / ${savedWatch.destination.folderPath}` : " / Project root"}
              </span>
            </span>
          </div>
          <div className="flex items-center gap-3 text-xs font-semibold uppercase tracking-wider">
            <button type="button" onClick={onResume} className="text-brand transition-colors hover:text-brand-dark">
              Resume
            </button>
            <button
              type="button"
              onClick={onDismissSaved}
              aria-label="Dismiss"
              className="flex h-6 w-6 items-center justify-center rounded-sm text-muted transition-colors hover:bg-canvas hover:text-ink"
            >
              <X size={14} />
            </button>
          </div>
        </div>
      </div>
    );
  }

  return null;
}
