"use client";

import { useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  XCircle,
  Loader2,
  Clock,
  FileArchive,
  AlertTriangle,
  X,
  Folder,
  ChevronRight,
  ChevronDown,
  FileText,
  RotateCcw,
  ListChecks,
} from "lucide-react";
import { REPORT_FILENAME } from "@/lib/constants";
import type { DownloadPhase, DownloadProgress, FileProgress } from "@/types/download";

interface Props {
  progress: DownloadProgress;
  onCancel: () => void;
  onConfirm: () => void;
  onRetryFailed: () => void;
  onClose: () => void;
  onNewProject: () => void;
}

const PHASE_TITLES: Record<DownloadPhase, string> = {
  idle: "",
  scanning: "Preparing Download",
  review: "Review Download",
  downloading: "Downloading Files",
  zipping: "Creating ZIP Archive",
  complete: "Download Complete",
  error: "Download Failed",
};

// Folder groups start expanded for small runs and collapsed for large ones,
// and each group renders at most this many rows until asked for all of them.
const AUTO_EXPAND_MAX_FILES = 60;
const ROW_LIMIT = 200;

interface FolderGroup {
  path: string;
  files: FileProgress[];
  done: number;
  failed: number;
  active: number;
  convertible: number;
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString()} ${n === 1 ? one : many}`;
}

export default function ProgressPanel({
  progress,
  onCancel,
  onConfirm,
  onRetryFailed,
  onClose,
  onNewProject,
}: Props) {
  const {
    phase,
    totalFiles,
    completedFiles,
    failedFiles,
    activeFiles,
    files,
    excludedCount,
    convertToMd,
    isRetry,
    zipName,
    reportIncluded,
    errorMessage,
    scanProgress,
    scanTotal,
    scanFoldersDone,
    scanFoldersTotal,
  } = progress;

  const settled = completedFiles + failedFiles;
  const percent = totalFiles > 0 ? Math.round((settled / totalFiles) * 100) : 0;
  const isTransferring = phase === "downloading" || phase === "zipping";
  const isActive = phase === "scanning" || isTransferring;
  const isDone = phase === "complete" || phase === "error";

  // Cancelling mid-transfer throws away everything fetched so far, so the X /
  // Cancel button asks first. Scanning and review have nothing to lose.
  const [cancelRequested, setCancelRequested] = useState(false);
  const confirmingCancel = cancelRequested && isTransferring;

  const requestCancel = () => {
    if (isTransferring) setCancelRequested(true);
    else onCancel();
  };

  // Esc closes the drawer once the run is finished or while reviewing.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      if (isDone) onClose();
      else if (phase === "review") onCancel();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isDone, phase, onClose, onCancel]);

  const { groups, failures, converted, keptOriginal, convertibleTotal } = useMemo(() => {
    const byPath = new Map<string, FolderGroup>();
    const failures: FileProgress[] = [];
    let converted = 0;
    let keptOriginal = 0;
    let convertibleTotal = 0;
    for (const f of files.values()) {
      let g = byPath.get(f.folderPath);
      if (!g) {
        g = { path: f.folderPath, files: [], done: 0, failed: 0, active: 0, convertible: 0 };
        byPath.set(f.folderPath, g);
      }
      g.files.push(f);
      if (f.status === "complete") g.done++;
      else if (f.status === "error") {
        g.failed++;
        failures.push(f);
      } else if (f.status === "downloading") g.active++;
      if (f.convertible) {
        g.convertible++;
        convertibleTotal++;
      }
      if (f.outcome === "converted") converted++;
      if (f.outcome === "kept-original") keptOriginal++;
    }
    const groups = [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path));
    return { groups, failures, converted, keptOriginal, convertibleTotal };
  }, [files]);

  // Expand/collapse: a per-group override on top of a default that flips with
  // "Expand all" / "Collapse all". The drawer unmounts between runs, so the
  // toggles naturally reset.
  const [expandAll, setExpandAll] = useState<boolean | null>(null);
  const [overrides, setOverrides] = useState<Map<string, boolean>>(() => new Map());
  const defaultExpanded =
    expandAll ?? (groups.length === 1 || totalFiles <= AUTO_EXPAND_MAX_FILES);
  const isExpanded = (path: string) => overrides.get(path) ?? defaultExpanded;
  const toggleGroup = (path: string) =>
    setOverrides((prev) => new Map(prev).set(path, !isExpanded(path)));
  const setAll = (value: boolean) => {
    setExpandAll(value);
    setOverrides(new Map());
  };

  const completeTitle =
    phase === "complete" && failedFiles > 0 ? "Completed with Errors" : PHASE_TITLES[phase];

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

      <div className="sh-drawer relative flex h-full w-full max-w-lg flex-col bg-surface shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <div className="flex min-w-0 items-center gap-2.5">
            <PhaseGlyph phase={phase} failed={failedFiles > 0} />
            <div className="min-w-0">
              <h2 className="truncate text-base font-semibold text-ink">{completeTitle}</h2>
              {zipName && phase !== "scanning" && (
                <p className="truncate text-xs font-light text-muted">
                  {isRetry ? "Retry archive · " : ""}
                  {zipName}
                </p>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={isActive || phase === "review" ? requestCancel : onClose}
            aria-label={isActive ? "Cancel download" : "Close"}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-sm text-muted transition-colors hover:bg-canvas hover:text-ink"
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
                <span>
                  {scanFoldersTotal != null
                    ? "Finding documents in your selected folders…"
                    : "Scanning the project for documents…"}
                </span>
              </div>
              {scanFoldersTotal != null ? (
                <p className="pl-6 text-xs font-light text-muted">
                  {Math.min(scanFoldersDone ?? 0, scanFoldersTotal).toLocaleString()} of{" "}
                  {plural(scanFoldersTotal, "folder")} searched
                  {scanProgress ? ` · ${plural(scanProgress, "document")} found` : ""}
                </p>
              ) : (
                scanTotal != null &&
                scanTotal > 0 && (
                  <p className="pl-6 text-xs font-light text-muted">
                    {plural(scanTotal, "document")} checked
                    {scanProgress != null && scanProgress !== scanTotal
                      ? ` · ${scanProgress.toLocaleString()} match your selection`
                      : ""}
                  </p>
                )
              )}
              <p className="pl-6 text-xs font-light text-muted">
                Nothing is downloaded yet — you will review the list first.
              </p>
            </div>
          ) : phase === "review" ? (
            <ReviewSummary
              totalFiles={totalFiles}
              folderCount={groups.length}
              excludedCount={excludedCount}
              convertToMd={convertToMd}
              convertibleTotal={convertibleTotal}
            />
          ) : phase === "error" && totalFiles === 0 ? (
            <p className="text-sm text-muted">The document list could not be prepared.</p>
          ) : (
            <>
              <div className="mb-2 h-2 w-full overflow-hidden rounded-full bg-canvas">
                <div
                  className={`h-full rounded-full transition-all duration-300 ${
                    phase === "error"
                      ? "bg-error"
                      : phase === "complete" && failedFiles === 0
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
                    : `${completedFiles.toLocaleString()} of ${plural(totalFiles, "file")} saved`}
                </span>
                <span className="flex items-center gap-3">
                  {failedFiles > 0 && (
                    <span className="flex items-center gap-1 text-error">
                      <AlertTriangle size={14} />
                      {failedFiles.toLocaleString()} failed
                    </span>
                  )}
                  {phase === "downloading" && (
                    <span className="font-medium text-ink">{percent}%</span>
                  )}
                </span>
              </div>
              {phase === "downloading" && activeFiles.length > 0 && (
                <p className="mt-2 truncate text-xs font-light text-muted">
                  <span className="font-medium text-ink">Now: </span>
                  {activeFiles.join(" · ")}
                </p>
              )}
            </>
          )}
        </div>

        {/* Cancel confirmation */}
        {confirmingCancel && (
          <div className="border-b border-line bg-canvas px-5 py-3">
            <p className="text-sm text-ink">
              Cancel this download? The partial ZIP will be discarded.
            </p>
            <div className="mt-2.5 flex gap-2">
              <button
                type="button"
                autoFocus
                onClick={() => setCancelRequested(false)}
                className="rounded-sm border border-line bg-surface px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-ink transition-colors hover:bg-canvas"
              >
                Keep downloading
              </button>
              <button
                type="button"
                onClick={onCancel}
                className="rounded-sm bg-error px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-white transition-colors hover:opacity-90"
              >
                Cancel download
              </button>
            </div>
          </div>
        )}

        {/* Result banners */}
        {phase === "error" && errorMessage && (
          <div className="border-b border-error/20 bg-error/5 px-5 py-3">
            <p className="text-sm text-error">{errorMessage}</p>
            {settled > 0 && (
              <p className="mt-1 text-xs font-light text-muted">
                {completedFiles.toLocaleString()} of {totalFiles.toLocaleString()} files had
                been fetched before the failure. Nothing was saved.
              </p>
            )}
          </div>
        )}
        {phase === "complete" && (
          <div
            className={`border-b px-5 py-3 text-sm ${
              failedFiles > 0
                ? "border-error/20 bg-error/5 text-ink"
                : "border-success/20 bg-success/5 text-success"
            }`}
          >
            <p>
              Saved {plural(completedFiles, "file")}
              {zipName ? ` to ${zipName}` : ""}.
              {failedFiles > 0 && (
                <>
                  {" "}
                  <span className="text-error">
                    {plural(failedFiles, "file")} could not be downloaded
                  </span>{" "}
                  and {failedFiles === 1 ? "is" : "are"} missing from the archive.
                </>
              )}
            </p>
            {(convertToMd || reportIncluded) && (
              <p className="mt-1 text-xs font-light text-muted">
                {convertToMd &&
                  `${plural(converted, "document")} converted to Markdown` +
                    (keptOriginal > 0
                      ? `; ${keptOriginal.toLocaleString()} kept as original (no text to extract)`
                      : "") +
                    ". "}
                {reportIncluded && `A list is included in the archive as "${REPORT_FILENAME}".`}
              </p>
            )}
          </div>
        )}

        {/* File list */}
        <div className="min-h-0 flex-1 overflow-y-auto">
          {phase === "scanning" ? (
            <div className="px-5 py-8 text-center text-sm font-light text-muted">
              Building the document list…
            </div>
          ) : (
            <>
              {failures.length > 0 && (
                <section aria-label="Failed files" className="border-b border-line">
                  <h3 className="flex items-center gap-2 bg-error/5 px-5 py-2 text-xs font-semibold uppercase tracking-wider text-error">
                    <AlertTriangle size={13} />
                    Not downloaded ({failures.length.toLocaleString()})
                  </h3>
                  <ul className="divide-y divide-line">
                    {failures.slice(0, ROW_LIMIT).map((file) => (
                      <FileRow key={file.documentId} file={file} showFolder convertToMd={convertToMd} />
                    ))}
                    {failures.length > ROW_LIMIT && (
                      <li className="px-5 py-2 text-xs font-light text-muted">
                        …and {(failures.length - ROW_LIMIT).toLocaleString()} more; see the report in the archive.
                      </li>
                    )}
                  </ul>
                </section>
              )}

              {groups.length > 1 && (
                <div className="flex items-center justify-between px-5 py-2">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted">
                    {plural(groups.length, "folder")}
                  </p>
                  <div className="flex items-center gap-3 text-xs font-medium uppercase tracking-wider">
                    <button
                      type="button"
                      onClick={() => setAll(true)}
                      className="text-brand transition-colors hover:text-brand-dark"
                    >
                      Expand all
                    </button>
                    <span className="h-3 w-px bg-line" />
                    <button
                      type="button"
                      onClick={() => setAll(false)}
                      className="text-brand transition-colors hover:text-brand-dark"
                    >
                      Collapse all
                    </button>
                  </div>
                </div>
              )}

              <ul className={groups.length > 1 ? "border-t border-line" : ""}>
                {groups.map((group) => (
                  <FolderGroupRow
                    key={group.path || " root"}
                    group={group}
                    phase={phase}
                    convertToMd={convertToMd}
                    expanded={isExpanded(group.path)}
                    onToggle={() => toggleGroup(group.path)}
                  />
                ))}
              </ul>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-line px-5 py-4">
          {phase === "review" ? (
            <div className="flex gap-3">
              <button
                type="button"
                onClick={onCancel}
                className="flex flex-1 items-center justify-center rounded-sm border border-line px-4 py-2.5 text-sm font-semibold uppercase tracking-wider text-ink transition-colors hover:bg-canvas"
              >
                Back
              </button>
              <button
                type="button"
                onClick={onConfirm}
                autoFocus
                className="flex flex-[2] items-center justify-center gap-2 rounded-sm bg-brand px-4 py-2.5 text-sm font-semibold uppercase tracking-wider text-white transition-colors hover:bg-brand-dark"
              >
                <FileArchive size={16} />
                Save ZIP · {plural(totalFiles, "file")}
              </button>
            </div>
          ) : isActive ? (
            <button
              type="button"
              onClick={requestCancel}
              disabled={confirmingCancel}
              className="flex w-full items-center justify-center gap-2 rounded-sm border border-line px-4 py-2.5 text-sm font-semibold uppercase tracking-wider text-ink transition-colors hover:bg-canvas disabled:opacity-50"
            >
              Cancel Download
            </button>
          ) : (
            <div className="flex flex-col gap-3">
              {phase === "complete" && failedFiles > 0 && (
                <button
                  type="button"
                  onClick={onRetryFailed}
                  className="flex w-full items-center justify-center gap-2 rounded-sm bg-brand px-4 py-2.5 text-sm font-semibold uppercase tracking-wider text-white transition-colors hover:bg-brand-dark"
                >
                  <RotateCcw size={16} />
                  Retry {plural(failedFiles, "failed file")} into a second ZIP
                </button>
              )}
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
                  className={`flex flex-1 items-center justify-center rounded-sm px-4 py-2.5 text-sm font-semibold uppercase tracking-wider transition-colors ${
                    phase === "complete" && failedFiles > 0
                      ? "border border-line text-ink hover:bg-canvas"
                      : "bg-brand text-white hover:bg-brand-dark"
                  }`}
                >
                  New Project
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- pieces */

function ReviewSummary({
  totalFiles,
  folderCount,
  excludedCount,
  convertToMd,
  convertibleTotal,
}: {
  totalFiles: number;
  folderCount: number;
  excludedCount: number;
  convertToMd: boolean;
  convertibleTotal: number;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-start gap-2.5">
        <ListChecks size={18} className="mt-0.5 shrink-0 text-brand" />
        <div>
          <p className="text-sm font-medium text-ink">
            {plural(totalFiles, "document")} in {plural(folderCount, "folder")} will be
            downloaded.
          </p>
          <p className="mt-0.5 text-xs font-light text-muted">
            Check the list below, then choose where to save the ZIP. Nothing is fetched
            until you confirm.
          </p>
        </div>
      </div>
      <ul className="space-y-1 pl-7 text-xs font-light text-muted">
        {convertToMd ? (
          <li>
            <span className="font-medium text-ink">Markdown conversion is on:</span>{" "}
            {plural(convertibleTotal, "document")} (PDF, Word, text, CSV, …) will be saved as{" "}
            <code className="rounded-sm bg-canvas px-1 font-mono text-[0.7rem]">.md</code>{" "}
            instead of the original file. Files with no extractable text keep the original.
          </li>
        ) : (
          <li>Files are saved in their original formats, in their Filevine folders.</li>
        )}
        {excludedCount > 0 && (
          <li>
            {plural(excludedCount, "document")} you deselected{" "}
            {excludedCount === 1 ? "is" : "are"} not included.
          </li>
        )}
      </ul>
    </div>
  );
}

function FolderGroupRow({
  group,
  phase,
  convertToMd,
  expanded,
  onToggle,
}: {
  group: FolderGroup;
  phase: DownloadPhase;
  convertToMd: boolean;
  expanded: boolean;
  onToggle: () => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const total = group.files.length;
  const settled = group.done + group.failed;
  const inProgress = phase === "downloading" || phase === "zipping";
  const rows = showAll ? group.files : group.files.slice(0, ROW_LIMIT);

  let summary: React.ReactNode;
  if (phase === "review") {
    summary = (
      <>
        {plural(total, "file")}
        {convertToMd && group.convertible > 0 && (
          <span className="text-muted"> · {group.convertible.toLocaleString()} → .md</span>
        )}
      </>
    );
  } else {
    summary = (
      <>
        {group.done.toLocaleString()}/{total.toLocaleString()}
        {group.failed > 0 && (
          <span className="text-error"> · {group.failed.toLocaleString()} failed</span>
        )}
      </>
    );
  }

  const groupIcon =
    inProgress && group.active > 0 ? (
      <Loader2 size={15} className="shrink-0 animate-spin text-brand" />
    ) : group.failed > 0 && settled === total ? (
      <AlertTriangle size={15} className="shrink-0 text-error" />
    ) : settled === total && total > 0 && phase !== "review" ? (
      <CheckCircle2 size={15} className="shrink-0 text-success" />
    ) : (
      <Folder size={15} className="shrink-0 text-brand" />
    );

  return (
    <li className="border-b border-line">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="flex w-full items-center gap-2 px-5 py-2.5 text-left transition-colors hover:bg-canvas"
      >
        {expanded ? (
          <ChevronDown size={14} className="shrink-0 text-muted" />
        ) : (
          <ChevronRight size={14} className="shrink-0 text-muted" />
        )}
        {groupIcon}
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">
          {group.path || <span className="italic text-muted">Project root (no folder)</span>}
        </span>
        <span className="shrink-0 text-xs font-light text-muted">{summary}</span>
      </button>
      {inProgress && (
        <div className="mx-5 -mt-1 mb-2 h-1 overflow-hidden rounded-full bg-canvas">
          <div
            className="h-full rounded-full bg-brand transition-all duration-300"
            style={{ width: `${total > 0 ? Math.round((settled / total) * 100) : 0}%` }}
          />
        </div>
      )}
      {expanded && (
        <ul className="divide-y divide-line border-t border-line bg-canvas/40">
          {rows.map((file) => (
            <FileRow key={file.documentId} file={file} convertToMd={convertToMd} />
          ))}
          {!showAll && total > ROW_LIMIT && (
            <li className="px-5 py-2">
              <button
                type="button"
                onClick={() => setShowAll(true)}
                className="text-xs font-medium uppercase tracking-wider text-brand hover:text-brand-dark"
              >
                Show all {total.toLocaleString()} files
              </button>
            </li>
          )}
        </ul>
      )}
    </li>
  );
}

function FileRow({
  file,
  convertToMd,
  showFolder = false,
}: {
  file: FileProgress;
  convertToMd: boolean;
  showFolder?: boolean;
}) {
  const savedName = file.zipPath?.split("/").pop();
  let note: React.ReactNode = null;
  if (file.status === "error") {
    note = <span className="text-error">{file.error ?? "Download failed"}</span>;
  } else if (file.outcome === "converted") {
    note = (
      <span className="flex items-center gap-1">
        <FileText size={11} className="shrink-0" />
        Saved as {savedName}
      </span>
    );
  } else if (file.outcome === "kept-original") {
    note = "Kept original — no text to extract";
  } else if (file.status === "complete" && savedName && savedName !== file.filename) {
    note = `Saved as ${savedName}`;
  } else if (file.status === "pending" && convertToMd && file.convertible) {
    note = "Will be converted to Markdown";
  }

  return (
    <li className="flex items-center gap-3 py-2 pl-11 pr-5">
      <StatusIcon status={file.status} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-ink">{file.filename}</p>
        {showFolder && file.folderPath && (
          <p className="flex items-center gap-1 truncate text-xs font-light text-muted">
            <Folder size={11} className="shrink-0" />
            {file.folderPath}
          </p>
        )}
        {note && <p className="truncate text-xs font-light text-muted">{note}</p>}
      </div>
    </li>
  );
}

function PhaseGlyph({ phase, failed }: { phase: DownloadPhase; failed: boolean }) {
  switch (phase) {
    case "complete":
      return failed ? (
        <AlertTriangle size={18} className="text-error" />
      ) : (
        <CheckCircle2 size={18} className="text-success" />
      );
    case "error":
      return <XCircle size={18} className="text-error" />;
    case "review":
      return <ListChecks size={18} className="text-brand" />;
    case "zipping":
      return <FileArchive size={18} className="text-brand" />;
    default:
      return <Loader2 size={18} className="animate-spin text-brand" />;
  }
}

function StatusIcon({ status }: { status: FileProgress["status"] }) {
  switch (status) {
    case "complete":
      return <CheckCircle2 size={15} className="shrink-0 text-success" />;
    case "error":
      return <XCircle size={15} className="shrink-0 text-error" />;
    case "downloading":
      return <Loader2 size={15} className="shrink-0 animate-spin text-brand" />;
    case "pending":
      return <Clock size={15} className="shrink-0 text-muted/40" />;
  }
}
