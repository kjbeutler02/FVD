"use client";

import { Eye, X } from "lucide-react";
import { Badge, Button, IconButton, Spinner } from "@/components/ui";
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
      <div className="shrink-0 px-3 pt-2">
        <div className="mx-auto flex max-w-[1180px] flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-inset bg-surface-nav py-1.5 pl-4 pr-2 text-sm shadow-nav">
          <div className="flex min-w-0 items-center gap-2.5 text-ink">
            <Badge tone="info" dot={!busy}>
              {busy && <Spinner size={11} className="text-info" />}
              Watching
            </Badge>
            <span className="truncate">
              <span className="font-semibold">“{watch.folderName}”</span>
              <span className="font-mono text-xs text-secondary">
                {" "}
                → #{watch.destination.projectId}
                {watch.destination.folderPath ? ` / ${watch.destination.folderPath}` : " / Project root"}
              </span>
            </span>
            <span className="hidden shrink-0 font-mono text-xs text-secondary sm:inline">
              · {watch.uploaded.toLocaleString()} uploaded
              {watch.activeNames.length > 0 && ` · ${watch.activeNames.length} uploading`}
              {watch.waiting > 0 && ` · ${watch.waiting} waiting`}
              {watch.failed > 0 && <span className="text-error"> · {watch.failed} failed</span>}
            </span>
          </div>
          <div className="flex items-center">
            <Button variant="ghost" size="sm" onClick={onOpen}>
              Details
            </Button>
            <Button variant="ghost" size="sm" onClick={onStop}>
              Stop
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (savedWatch) {
    return (
      <div className="shrink-0 px-3 pt-2">
        <div className="mx-auto flex max-w-[1180px] flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-inset bg-surface-nav py-1.5 pl-5 pr-2 text-sm shadow-nav">
          <div className="flex min-w-0 items-center gap-2.5 text-ink">
            <Eye size={15} className="shrink-0 text-secondary" />
            <span className="truncate">
              Resume watching <span className="font-semibold">“{savedWatch.folderName}”</span>
              <span className="font-mono text-xs text-secondary">
                {" "}
                → #{savedWatch.destination.projectId}
                {savedWatch.destination.folderPath ? ` / ${savedWatch.destination.folderPath}` : " / Project root"}
              </span>
            </span>
          </div>
          <div className="flex items-center gap-1">
            <Button variant="tinted" size="sm" onClick={onResume}>
              Resume
            </Button>
            <IconButton label="Dismiss" size="sm" onClick={onDismissSaved}>
              <X size={15} />
            </IconButton>
          </div>
        </div>
      </div>
    );
  }

  return null;
}
