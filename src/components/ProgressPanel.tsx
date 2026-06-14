"use client";

import { useEffect } from "react";
import {
  CheckCircle2,
  XCircle,
  Loader2,
  Clock,
  FileArchive,
  AlertTriangle,
  X,
  Folder,
} from "lucide-react";
import type { DownloadProgress, FileProgress } from "@/types/download";

interface Props {
  progress: DownloadProgress;
  onCancel: () => void;
  onClose: () => void;
  onNewProject: () => void;
}

const PHASE_TITLES: Record<DownloadProgress["phase"], string> = {
  idle: "",
  scanning: "Scanning for Documents",
  downloading: "Downloading Files",
  zipping: "Creating ZIP Archive",
  complete: "Download Complete",
  error: "Download Failed",
};

export default function ProgressPanel({
  progress,
  onCancel,
  onClose,
  onNewProject,
}: Props) {
  const {
    totalFiles,
    completedFiles,
    failedFiles,
    phase,
    files,
    errorMessage,
    scanProgress,
    scanTotal,
  } = progress;

  const percent =
    totalFiles > 0 ? Math.round((completedFiles / totalFiles) * 100) : 0;
  const isActive =
    phase === "scanning" || phase === "downloading" || phase === "zipping";
  const isDone = phase === "complete" || phase === "error";

  // Sort: in-flight first, then pending, complete, error
  const sortedFiles = Array.from(files.values()).sort((a, b) => {
    const order = { downloading: 0, "fetching-url": 0, pending: 1, complete: 2, error: 3 };
    return order[a.status] - order[b.status];
  });

  // Esc closes the drawer once the run is finished.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && isDone) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isDone, onClose]);

  return (
    <div
      className="fixed inset-0 flex justify-end"
      style={{ zIndex: "var(--z-drawer)" }}
      role="dialog"
      aria-modal="true"
      aria-label="Download progress"
    >
      <button
        type="button"
        aria-label="Close"
        tabIndex={isDone ? 0 : -1}
        onClick={isDone ? onClose : undefined}
        className="sh-backdrop absolute inset-0 bg-ink/40"
        style={{ cursor: isDone ? "pointer" : "default" }}
      />

      <div className="sh-drawer relative flex h-full w-full max-w-md flex-col bg-surface shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <div className="flex items-center gap-2.5">
            <PhaseGlyph phase={phase} />
            <h2 className="text-base font-semibold text-ink">
              {PHASE_TITLES[phase]}
            </h2>
          </div>
          <button
            type="button"
            onClick={isActive ? onCancel : onClose}
            aria-label={isActive ? "Cancel download" : "Close"}
            className="flex h-8 w-8 items-center justify-center rounded-sm text-muted transition-colors hover:bg-canvas hover:text-ink"
          >
            <X size={18} />
          </button>
        </div>

        {/* Status block */}
        <div className="border-b border-line px-5 py-4">
          {phase === "scanning" ? (
            <div className="space-y-1.5">
              <div className="flex items-center gap-2 text-sm text-muted">
                <Loader2 size={16} className="animate-spin text-brand" />
                <span>Scanning the project for documents…</span>
              </div>
              {scanTotal != null && scanTotal > 0 && (
                <p className="pl-6 text-xs font-light text-muted">
                  {scanTotal.toLocaleString()} documents checked
                  {scanProgress != null && scanProgress !== scanTotal
                    ? ` · ${scanProgress.toLocaleString()} match your selection`
                    : ""}
                </p>
              )}
            </div>
          ) : (
            <>
              <div className="mb-2 h-2 w-full overflow-hidden rounded-full bg-canvas">
                <div
                  className={`h-full rounded-full transition-all duration-300 ${
                    phase === "error"
                      ? "bg-error"
                      : phase === "complete"
                      ? "bg-success"
                      : "bg-brand"
                  }`}
                  style={{ width: phase === "zipping" ? "100%" : `${percent}%` }}
                />
              </div>
              <div className="flex items-center justify-between text-sm text-muted">
                <span>
                  {phase === "zipping"
                    ? "Generating ZIP archive…"
                    : `${completedFiles} of ${totalFiles} files`}
                </span>
                <span className="flex items-center gap-3">
                  {failedFiles > 0 && (
                    <span className="flex items-center gap-1 text-error">
                      <AlertTriangle size={14} />
                      {failedFiles} failed
                    </span>
                  )}
                  {phase === "downloading" && (
                    <span className="font-medium text-ink">{percent}%</span>
                  )}
                </span>
              </div>
            </>
          )}
        </div>

        {/* Result banner */}
        {phase === "error" && errorMessage && (
          <div className="border-b border-error/20 bg-error/5 px-5 py-3">
            <p className="text-sm text-error">{errorMessage}</p>
          </div>
        )}
        {phase === "complete" && (
          <div className="border-b border-success/20 bg-success/5 px-5 py-3">
            <p className="text-sm text-success">
              Downloaded {completedFiles} {completedFiles === 1 ? "file" : "files"}
              {failedFiles > 0 ? `, ${failedFiles} failed` : ""}. Your ZIP archive
              is saving now.
            </p>
          </div>
        )}

        {/* File list */}
        <div className="min-h-0 flex-1 overflow-y-auto">
          {sortedFiles.length === 0 && phase === "scanning" ? (
            <div className="px-5 py-8 text-center text-sm font-light text-muted">
              Building the document list…
            </div>
          ) : (
            <ul className="divide-y divide-line">
              {sortedFiles.map((file) => (
                <FileRow key={file.documentId} file={file} />
              ))}
            </ul>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-line px-5 py-4">
          {isActive ? (
            <button
              type="button"
              onClick={onCancel}
              className="flex w-full items-center justify-center gap-2 rounded-sm border border-line px-4 py-2.5 text-sm font-semibold uppercase tracking-wider text-ink transition-colors hover:bg-canvas"
            >
              Cancel Download
            </button>
          ) : (
            <div className="flex gap-3">
              <button
                type="button"
                onClick={onClose}
                className="flex flex-1 items-center justify-center rounded-sm border border-line px-4 py-2.5 text-sm font-semibold uppercase tracking-wider text-ink transition-colors hover:bg-canvas"
              >
                Back to Project
              </button>
              <button
                type="button"
                onClick={onNewProject}
                className="flex flex-1 items-center justify-center rounded-sm bg-brand px-4 py-2.5 text-sm font-semibold uppercase tracking-wider text-white transition-colors hover:bg-brand-dark"
              >
                New Project
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function PhaseGlyph({ phase }: { phase: DownloadProgress["phase"] }) {
  switch (phase) {
    case "complete":
      return <CheckCircle2 size={18} className="text-success" />;
    case "error":
      return <XCircle size={18} className="text-error" />;
    case "zipping":
      return <FileArchive size={18} className="text-brand" />;
    default:
      return <Loader2 size={18} className="animate-spin text-brand" />;
  }
}

function FileRow({ file }: { file: FileProgress }) {
  return (
    <li className="flex items-center gap-3 px-5 py-2.5">
      <StatusIcon status={file.status} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-ink">{file.filename}</p>
        {file.folderPath && (
          <p className="flex items-center gap-1 truncate text-xs font-light text-muted">
            <Folder size={11} className="shrink-0" />
            {file.folderPath}
          </p>
        )}
        {file.error && (
          <p className="truncate text-xs text-error">{file.error}</p>
        )}
      </div>
    </li>
  );
}

function StatusIcon({ status }: { status: FileProgress["status"] }) {
  switch (status) {
    case "complete":
      return <CheckCircle2 size={16} className="shrink-0 text-success" />;
    case "error":
      return <XCircle size={16} className="shrink-0 text-error" />;
    case "downloading":
    case "fetching-url":
      return <Loader2 size={16} className="shrink-0 animate-spin text-brand" />;
    case "pending":
      return <Clock size={16} className="shrink-0 text-muted/40" />;
  }
}
