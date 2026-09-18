"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  CheckCircle2,
  XCircle,
  Loader2,
  Clock,
  AlertTriangle,
  X,
  Folder,
  FolderPlus,
  FolderInput,
  ChevronRight,
  ChevronDown,
  Upload,
  Eye,
  RotateCcw,
  FileUp,
  MinusCircle,
  Check,
} from "lucide-react";
import { filesFromDrop, filesFromInput, formatBytes } from "@/lib/localFiles";
import { WATCH_DONE_DIRNAME } from "@/lib/constants";
import type {
  LocalFile,
  UploadDestination,
  UploadFileProgress,
  UploadProgress,
  WatchState,
} from "@/types/upload";

interface Props {
  progress: UploadProgress;
  watch: WatchState | null;
  canWatch: boolean;
  onAddFiles: (files: LocalFile[]) => void;
  onRemoveFile: (id: string) => void;
  onToggleDuplicates: (value: boolean) => void;
  onConfirm: () => void;
  onRetryFailed: () => void;
  onCancel: () => void;
  onClose: () => void;
  onStartWatch: () => void;
  onStopWatch: () => void;
}

const ROW_LIMIT = 200;
const AUTO_EXPAND_MAX_FILES = 60;

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString()} ${n === 1 ? one : many}`;
}

function destLabel(dest: UploadDestination | null): string {
  if (!dest) return "";
  return `Project #${dest.projectId} · ${dest.folderPath || "Project root"}`;
}

interface Group {
  path: string;
  files: UploadFileProgress[];
  done: number;
  failed: number;
  active: number;
  skipped: number;
}

function groupFiles(files: Map<string, UploadFileProgress>): Group[] {
  const byPath = new Map<string, Group>();
  for (const f of files.values()) {
    let g = byPath.get(f.targetPath);
    if (!g) {
      g = { path: f.targetPath, files: [], done: 0, failed: 0, active: 0, skipped: 0 };
      byPath.set(f.targetPath, g);
    }
    g.files.push(f);
    if (f.status === "complete") g.done++;
    else if (f.status === "error") g.failed++;
    else if (f.status === "skipped") g.skipped++;
    else if (f.status !== "pending") g.active++;
  }
  return [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path));
}

export default function UploadPanel({
  progress,
  watch,
  canWatch,
  onAddFiles,
  onRemoveFile,
  onToggleDuplicates,
  onConfirm,
  onRetryFailed,
  onCancel,
  onClose,
  onStartWatch,
  onStopWatch,
}: Props) {
  const watching = watch?.active === true && progress.phase === "idle";
  const { phase } = progress;
  const isReview = phase === "review";
  const isUploading = phase === "uploading";
  const isDone = phase === "complete" || phase === "error";

  const [cancelRequested, setCancelRequested] = useState(false);
  const requestCancel = () => {
    if (isUploading) setCancelRequested(true);
    else onCancel();
  };

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      if (watching || isDone) onClose();
      else if (isReview) onCancel();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [watching, isDone, isReview, onClose, onCancel]);

  const files = watching ? watch!.files : progress.files;
  const groups = useMemo(() => groupFiles(files), [files]);
  const failures = useMemo(
    () => [...files.values()].filter((f) => f.status === "error"),
    [files]
  );
  const identical = useMemo(
    () => [...progress.files.values()].filter((f) => f.duplicate === "identical").length,
    [progress.files]
  );
  const sameName = useMemo(
    () => [...progress.files.values()].filter((f) => f.duplicate === "same-name").length,
    [progress.files]
  );
  const preflightFailed = useMemo(
    () => (isReview ? [...progress.files.values()].filter((f) => f.status === "error").length : 0),
    [isReview, progress.files]
  );
  const toUpload = progress.totalFiles - progress.skippedFiles - preflightFailed;
  const bytesToUpload = useMemo(
    () =>
      [...progress.files.values()]
        .filter((f) => f.status !== "skipped" && !(isReview && f.status === "error"))
        .reduce((n, f) => n + f.size, 0),
    [progress.files, isReview]
  );

  const [expandAll, setExpandAll] = useState<boolean | null>(null);
  const [overrides, setOverrides] = useState<Map<string, boolean>>(() => new Map());
  const defaultExpanded = expandAll ?? (groups.length === 1 || files.size <= AUTO_EXPAND_MAX_FILES);
  const isExpanded = (path: string) => overrides.get(path) ?? defaultExpanded;
  const toggleGroup = (path: string) =>
    setOverrides((prev) => new Map(prev).set(path, !isExpanded(path)));

  const title = watching
    ? "Watching Folder"
    : phase === "review"
    ? "Upload to Filevine"
    : phase === "uploading"
    ? "Uploading Files"
    : phase === "complete"
    ? progress.failedFiles > 0
      ? "Completed with Errors"
      : "Upload Complete"
    : phase === "error"
    ? "Upload Failed"
    : "Upload";

  const subtitle = watching
    ? `“${watch!.folderName}” → ${destLabel(watch!.destination)}`
    : destLabel(progress.destination);

  const percent =
    progress.totalBytes > 0 ? Math.min(100, Math.round((progress.uploadedBytes / bytesToUpload) * 100)) : 0;

  return (
    <div
      className="fixed inset-0 flex justify-end"
      style={{ zIndex: "var(--z-drawer)" }}
      role="dialog"
      aria-modal="true"
      aria-label="Upload"
    >
      <button
        type="button"
        aria-label="Close"
        tabIndex={watching || isDone ? 0 : -1}
        onClick={watching || isDone ? onClose : undefined}
        className="sh-backdrop absolute inset-0 bg-ink/40"
        style={{ cursor: watching || isDone ? "pointer" : "default" }}
      />

      <div className="sh-drawer relative flex h-full w-full max-w-lg flex-col bg-surface shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <div className="flex min-w-0 items-center gap-2.5">
            <Glyph watching={watching} phase={phase} failed={progress.failedFiles > 0} />
            <div className="min-w-0">
              <h2 className="truncate text-base font-semibold text-ink">{title}</h2>
              {subtitle && <p className="truncate text-xs font-light text-muted">{subtitle}</p>}
            </div>
          </div>
          <button
            type="button"
            onClick={isUploading || isReview ? requestCancel : onClose}
            aria-label={isUploading ? "Cancel upload" : "Close"}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-sm text-muted transition-colors hover:bg-canvas hover:text-ink"
          >
            <X size={18} />
          </button>
        </div>

        {/* Status block */}
        <div className="border-b border-line px-5 py-4">
          {watching ? (
            <WatchSummary watch={watch!} />
          ) : isReview ? (
            <>
              <DropZone onFiles={onAddFiles} compact={progress.totalFiles > 0} />
              {progress.totalFiles > 0 && (
                <ReviewSummary
                  progress={progress}
                  toUpload={toUpload}
                  bytesToUpload={bytesToUpload}
                  identical={identical}
                  sameName={sameName}
                  tooLarge={preflightFailed}
                  onToggleDuplicates={onToggleDuplicates}
                />
              )}
            </>
          ) : (
            <>
              <div className="mb-2 h-2 w-full overflow-hidden rounded-full bg-canvas">
                <div
                  className={`h-full rounded-full transition-all duration-300 ${
                    phase === "error"
                      ? "bg-error"
                      : phase === "complete" && progress.failedFiles === 0
                      ? "bg-success"
                      : "bg-brand"
                  }`}
                  style={{ width: `${phase === "complete" ? 100 : percent}%` }}
                />
              </div>
              <div className="flex items-center justify-between text-sm text-muted">
                <span>
                  {progress.completedFiles.toLocaleString()} of {plural(toUpload, "file")} uploaded
                  <span className="hidden sm:inline">
                    {" "}
                    · {formatBytes(Math.round(progress.uploadedBytes))} of {formatBytes(bytesToUpload)}
                  </span>
                </span>
                <span className="flex items-center gap-3">
                  {progress.failedFiles > 0 && (
                    <span className="flex items-center gap-1 text-error">
                      <AlertTriangle size={14} />
                      {progress.failedFiles.toLocaleString()} failed
                    </span>
                  )}
                  {isUploading && <span className="font-medium text-ink">{percent}%</span>}
                </span>
              </div>
              {isUploading && progress.activeFiles.length > 0 && (
                <p className="mt-2 truncate text-xs font-light text-muted">
                  <span className="font-medium text-ink">Now: </span>
                  {progress.activeFiles.join(" · ")}
                </p>
              )}
            </>
          )}
        </div>

        {/* Cancel confirmation */}
        {cancelRequested && isUploading && (
          <div className="border-b border-line bg-canvas px-5 py-3">
            <p className="text-sm text-ink">
              Cancel this upload? Files already uploaded stay in Filevine; files in progress are
              discarded.
            </p>
            <div className="mt-2.5 flex gap-2">
              <button
                type="button"
                autoFocus
                onClick={() => setCancelRequested(false)}
                className="rounded-sm border border-line bg-surface px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-ink transition-colors hover:bg-canvas"
              >
                Keep uploading
              </button>
              <button
                type="button"
                onClick={onCancel}
                className="rounded-sm bg-error px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-white transition-colors hover:opacity-90"
              >
                Cancel upload
              </button>
            </div>
          </div>
        )}

        {/* Result banners */}
        {phase === "error" && progress.errorMessage && (
          <div className="border-b border-error/20 bg-error/5 px-5 py-3">
            <p className="text-sm text-error">{progress.errorMessage}</p>
          </div>
        )}
        {phase === "complete" && (
          <div
            className={`border-b px-5 py-3 text-sm ${
              progress.failedFiles > 0
                ? "border-error/20 bg-error/5 text-ink"
                : "border-success/20 bg-success/5 text-success"
            }`}
          >
            <p>
              Uploaded {plural(progress.completedFiles, "file")} to{" "}
              {progress.destination?.folderPath || "the project root"}.
              {progress.failedFiles > 0 && (
                <>
                  {" "}
                  <span className="text-error">
                    {plural(progress.failedFiles, "file")} could not be uploaded
                  </span>{" "}
                  and {progress.failedFiles === 1 ? "is" : "are"} not in Filevine.
                </>
              )}
            </p>
            <p className="mt-1 text-xs font-light text-muted">
              {progress.skippedFiles > 0 &&
                `${plural(progress.skippedFiles, "identical file")} already in Filevine ${
                  progress.skippedFiles === 1 ? "was" : "were"
                } skipped. `}
              {progress.attributed === true && "Filevine records you as the uploader."}
              {progress.attributed === false &&
                "Filevine records the firm's shared account as the uploader (your email was not matched to a Filevine user)."}
            </p>
          </div>
        )}

        {/* File list */}
        <div className="min-h-0 flex-1 overflow-y-auto">
          {files.size === 0 ? (
            <div className="px-5 py-10 text-center text-sm font-light text-muted">
              {watching
                ? "No new files yet. Anything placed in the folder will appear here."
                : "No files chosen yet."}
            </div>
          ) : (
            <>
              {failures.length > 0 && (
                <section aria-label="Failed files" className="border-b border-line">
                  <h3 className="flex items-center gap-2 bg-error/5 px-5 py-2 text-xs font-semibold uppercase tracking-wider text-error">
                    <AlertTriangle size={13} />
                    Not uploaded ({failures.length.toLocaleString()})
                  </h3>
                  <ul className="divide-y divide-line">
                    {failures.slice(0, ROW_LIMIT).map((f) => (
                      <FileRow key={f.id} file={f} showFolder phase={phase} />
                    ))}
                  </ul>
                </section>
              )}

              {groups.length > 1 && (
                <div className="flex items-center justify-between px-5 py-2">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted">
                    {plural(groups.length, "destination folder")}
                  </p>
                  <div className="flex items-center gap-3 text-xs font-medium uppercase tracking-wider">
                    <button
                      type="button"
                      onClick={() => {
                        setExpandAll(true);
                        setOverrides(new Map());
                      }}
                      className="text-brand transition-colors hover:text-brand-dark"
                    >
                      Expand all
                    </button>
                    <span className="h-3 w-px bg-line" />
                    <button
                      type="button"
                      onClick={() => {
                        setExpandAll(false);
                        setOverrides(new Map());
                      }}
                      className="text-brand transition-colors hover:text-brand-dark"
                    >
                      Collapse all
                    </button>
                  </div>
                </div>
              )}

              <ul className={groups.length > 1 ? "border-t border-line" : ""}>
                {groups.map((g) => (
                  <GroupRow
                    key={g.path || " root"}
                    group={g}
                    phase={phase}
                    isNew={progress.foldersToCreate.includes(g.path)}
                    expanded={isExpanded(g.path)}
                    onToggle={() => toggleGroup(g.path)}
                    onRemove={isReview ? onRemoveFile : undefined}
                  />
                ))}
              </ul>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-line px-5 py-4">
          {watching ? (
            <div className="flex gap-3">
              <button
                type="button"
                onClick={onStopWatch}
                className="flex flex-1 items-center justify-center gap-2 rounded-sm border border-line px-4 py-2.5 text-sm font-semibold uppercase tracking-wider text-ink transition-colors hover:bg-canvas"
              >
                <MinusCircle size={16} />
                Stop watching
              </button>
              <button
                type="button"
                onClick={onClose}
                className="flex flex-1 items-center justify-center rounded-sm bg-brand px-4 py-2.5 text-sm font-semibold uppercase tracking-wider text-white transition-colors hover:bg-brand-dark"
              >
                Close
              </button>
            </div>
          ) : isReview ? (
            <div className="flex flex-col gap-3">
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={onCancel}
                  className="flex flex-1 items-center justify-center rounded-sm border border-line px-4 py-2.5 text-sm font-semibold uppercase tracking-wider text-ink transition-colors hover:bg-canvas"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={onConfirm}
                  disabled={toUpload === 0 || progress.checkingDuplicates}
                  className="flex flex-[2] items-center justify-center gap-2 rounded-sm bg-brand px-4 py-2.5 text-sm font-semibold uppercase tracking-wider text-white transition-colors hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {progress.checkingDuplicates ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : (
                    <Upload size={16} />
                  )}
                  {progress.checkingDuplicates
                    ? "Checking Filevine…"
                    : toUpload > 0
                    ? `Upload ${plural(toUpload, "file")} · ${formatBytes(bytesToUpload)}`
                    : "Upload"}
                </button>
              </div>
              {canWatch && (
                <button
                  type="button"
                  onClick={onStartWatch}
                  className="flex items-center justify-center gap-2 text-xs font-medium uppercase tracking-wider text-brand transition-colors hover:text-brand-dark"
                >
                  <Eye size={14} />
                  Or watch a folder on this computer and upload as files arrive
                </button>
              )}
            </div>
          ) : isUploading ? (
            <button
              type="button"
              onClick={requestCancel}
              disabled={cancelRequested}
              className="flex w-full items-center justify-center gap-2 rounded-sm border border-line px-4 py-2.5 text-sm font-semibold uppercase tracking-wider text-ink transition-colors hover:bg-canvas disabled:opacity-50"
            >
              Cancel Upload
            </button>
          ) : (
            <div className="flex flex-col gap-3">
              {phase === "complete" && progress.failedFiles > 0 && (
                <button
                  type="button"
                  onClick={onRetryFailed}
                  className="flex w-full items-center justify-center gap-2 rounded-sm bg-brand px-4 py-2.5 text-sm font-semibold uppercase tracking-wider text-white transition-colors hover:bg-brand-dark"
                >
                  <RotateCcw size={16} />
                  Retry {plural(progress.failedFiles, "failed file")}
                </button>
              )}
              <button
                type="button"
                onClick={onClose}
                className={`flex w-full items-center justify-center rounded-sm px-4 py-2.5 text-sm font-semibold uppercase tracking-wider transition-colors ${
                  phase === "complete" && progress.failedFiles > 0
                    ? "border border-line text-ink hover:bg-canvas"
                    : "bg-brand text-white hover:bg-brand-dark"
                }`}
              >
                Done
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- pieces */

function DropZone({ onFiles, compact }: { onFiles: (files: LocalFile[]) => void; compact: boolean }) {
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const dirInput = useRef<HTMLInputElement>(null);

  // `webkitdirectory` is not in React's typed attributes.
  useEffect(() => {
    dirInput.current?.setAttribute("webkitdirectory", "");
  }, []);

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={async (e) => {
        e.preventDefault();
        setDragging(false);
        onFiles(await filesFromDrop(e.dataTransfer));
      }}
      className={`flex flex-col items-center justify-center rounded-md border border-dashed text-center transition-colors ${
        compact ? "px-4 py-3" : "px-6 py-8"
      } ${dragging ? "border-brand bg-brand-tint" : "border-line bg-canvas/60"}`}
    >
      {!compact && (
        <>
          <FileUp size={26} strokeWidth={1.5} className="text-brand" />
          <p className="mt-3 text-sm font-medium text-ink">Drop files or folders here</p>
          <p className="mt-0.5 text-xs font-light text-muted">
            Folders keep their structure inside the Filevine folder you chose.
          </p>
        </>
      )}
      <div className={`flex items-center gap-3 ${compact ? "" : "mt-4"}`}>
        <button
          type="button"
          onClick={() => fileInput.current?.click()}
          className="rounded-sm border border-line bg-surface px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-ink transition-colors hover:bg-canvas"
        >
          {compact ? "Add files" : "Choose files"}
        </button>
        <button
          type="button"
          onClick={() => dirInput.current?.click()}
          className="rounded-sm border border-line bg-surface px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-ink transition-colors hover:bg-canvas"
        >
          {compact ? "Add folder" : "Choose folder"}
        </button>
      </div>
      <input
        ref={fileInput}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          onFiles(filesFromInput(e.target.files));
          e.target.value = "";
        }}
      />
      <input
        ref={dirInput}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          onFiles(filesFromInput(e.target.files));
          e.target.value = "";
        }}
      />
    </div>
  );
}

function ReviewSummary({
  progress,
  toUpload,
  bytesToUpload,
  identical,
  sameName,
  tooLarge,
  onToggleDuplicates,
}: {
  progress: UploadProgress;
  toUpload: number;
  bytesToUpload: number;
  identical: number;
  sameName: number;
  tooLarge: number;
  onToggleDuplicates: (v: boolean) => void;
}) {
  const folders = progress.foldersToCreate;
  const limits = progress.limits;
  return (
    <div className="mt-4 space-y-2">
      <div className="flex items-start gap-2.5">
        <FolderInput size={18} className="mt-0.5 shrink-0 text-brand" />
        <div>
          <p className="text-sm font-medium text-ink">
            {plural(toUpload, "file")} ({formatBytes(bytesToUpload)}) will be uploaded to{" "}
            {progress.destination?.folderPath || "the project root"}.
          </p>
          <p className="mt-0.5 text-xs font-light text-muted">
            Nothing is sent until you confirm.
          </p>
        </div>
      </div>
      <ul className="space-y-1 pl-7 text-xs font-light text-muted">
        {tooLarge > 0 && limits && (
          <li className="text-error">
            <span className="font-medium">
              {plural(tooLarge, "file")} {tooLarge === 1 ? "is" : "are"} too large to upload
            </span>{" "}
            {limits.largeFiles
              ? `(limit ${formatBytes(limits.largeFileMaxBytes)}).`
              : `— files over ${formatBytes(limits.relayMaxBytes)} need the large-file store, which is not set up on this deployment yet.`}{" "}
            {tooLarge === 1 ? "It is" : "They are"} listed under “Not uploaded”.
          </li>
        )}
        {folders.length > 0 && (
          <li>
            <span className="font-medium text-ink">
              {plural(folders.length, "new folder")} will be created in Filevine:
            </span>{" "}
            {folders.slice(0, 4).join(", ")}
            {folders.length > 4 && ` and ${folders.length - 4} more`}.
          </li>
        )}
        {progress.checkingDuplicates ? (
          <li className="flex items-center gap-1.5">
            <Loader2 size={12} className="animate-spin text-brand" />
            Checking the destination for files that are already there…
          </li>
        ) : (
          <>
            {identical > 0 && (
              <li>
                <span className="font-medium text-ink">
                  {plural(identical, "file")} {identical === 1 ? "is" : "are"} already in Filevine
                </span>{" "}
                (same name and size) and will be skipped.
                <label className="mt-1 flex cursor-pointer select-none items-center gap-2 text-ink">
                  <span
                    role="checkbox"
                    aria-checked={progress.uploadDuplicates}
                    tabIndex={0}
                    onClick={() => onToggleDuplicates(!progress.uploadDuplicates)}
                    onKeyDown={(e) => {
                      if (e.key === " " || e.key === "Enter") {
                        e.preventDefault();
                        onToggleDuplicates(!progress.uploadDuplicates);
                      }
                    }}
                    className={`flex h-[16px] w-[16px] items-center justify-center rounded-sm border ${
                      progress.uploadDuplicates ? "border-brand bg-brand text-white" : "border-line bg-surface"
                    }`}
                  >
                    {progress.uploadDuplicates && <Check size={11} strokeWidth={3} />}
                  </span>
                  Upload them anyway as additional copies
                </label>
              </li>
            )}
            {sameName > 0 && (
              <li>
                {plural(sameName, "file")} {sameName === 1 ? "shares" : "share"} a name with a document
                already there but {sameName === 1 ? "differs" : "differ"} in size; {sameName === 1 ? "it" : "they"}{" "}
                will be uploaded as {sameName === 1 ? "a new document" : "new documents"}.
              </li>
            )}
          </>
        )}
      </ul>
    </div>
  );
}

function WatchSummary({ watch }: { watch: WatchState }) {
  return (
    <div className="space-y-2">
      <div className="flex items-start gap-2.5">
        {watch.scanning || watch.activeNames.length > 0 ? (
          <Loader2 size={18} className="mt-0.5 shrink-0 animate-spin text-brand" />
        ) : (
          <Eye size={18} className="mt-0.5 shrink-0 text-brand" />
        )}
        <div>
          <p className="text-sm font-medium text-ink">
            {plural(watch.uploaded, "file")} uploaded
            {watch.activeNames.length > 0 && ` · ${watch.activeNames.length} uploading`}
            {watch.waiting > 0 && ` · ${watch.waiting} waiting`}
            {watch.failed > 0 && <span className="text-error"> · {watch.failed} failed</span>}
          </p>
          <p className="mt-0.5 text-xs font-light text-muted">
            New files are sent once they have stopped changing for a few seconds, then moved into
            “{WATCH_DONE_DIRNAME}” inside the folder. Keep this tab open.
          </p>
          {watch.error && <p className="mt-1 text-xs text-error">{watch.error}</p>}
        </div>
      </div>
      {watch.activeNames.length > 0 && (
        <p className="truncate pl-7 text-xs font-light text-muted">
          <span className="font-medium text-ink">Now: </span>
          {watch.activeNames.join(" · ")}
        </p>
      )}
    </div>
  );
}

function GroupRow({
  group,
  phase,
  isNew,
  expanded,
  onToggle,
  onRemove,
}: {
  group: Group;
  phase: UploadProgress["phase"];
  isNew: boolean;
  expanded: boolean;
  onToggle: () => void;
  onRemove?: (id: string) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const total = group.files.length;
  const settled = group.done + group.failed + group.skipped;
  const rows = showAll ? group.files : group.files.slice(0, ROW_LIMIT);

  const icon =
    group.active > 0 ? (
      <Loader2 size={15} className="shrink-0 animate-spin text-brand" />
    ) : group.failed > 0 && settled === total ? (
      <AlertTriangle size={15} className="shrink-0 text-error" />
    ) : settled === total && total > 0 && phase !== "review" ? (
      <CheckCircle2 size={15} className="shrink-0 text-success" />
    ) : isNew ? (
      <FolderPlus size={15} className="shrink-0 text-brand" />
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
        {icon}
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">
          {group.path || <span className="italic text-muted">Project root</span>}
          {isNew && <span className="ml-2 text-xs font-normal text-brand">new folder</span>}
        </span>
        <span className="shrink-0 text-xs font-light text-muted">
          {phase === "review"
            ? `${plural(total - group.skipped, "file")}${group.skipped > 0 ? ` · ${group.skipped} skipped` : ""}`
            : `${group.done.toLocaleString()}/${(total - group.skipped).toLocaleString()}${
                group.failed > 0 ? ` · ${group.failed} failed` : ""
              }`}
        </span>
      </button>
      {expanded && (
        <ul className="divide-y divide-line border-t border-line bg-canvas/40">
          {rows.map((f) => (
            <FileRow key={f.id} file={f} phase={phase} onRemove={onRemove} />
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
  phase,
  showFolder = false,
  onRemove,
}: {
  file: UploadFileProgress;
  phase: UploadProgress["phase"];
  showFolder?: boolean;
  onRemove?: (id: string) => void;
}) {
  let note: React.ReactNode = null;
  if (file.status === "error") note = <span className="text-error">{file.error ?? "Upload failed"}</span>;
  else if (file.status === "skipped") note = "Already in Filevine — skipped";
  else if (file.duplicate === "identical" && phase === "review") note = "Already in Filevine — will upload another copy";
  else if (file.duplicate === "same-name" && file.status === "pending") note = "Same name as an existing document, different size";
  else if (file.status === "preparing") note = "Preparing…";
  else if (file.status === "committing") note = "Filing in Filevine…";
  else if (file.status === "complete" && file.error) note = <span className="text-error">{file.error}</span>;
  else if (file.status === "complete") note = "Uploaded";

  return (
    <li className="flex items-center gap-3 py-2 pl-11 pr-5">
      <StatusIcon status={file.status} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-3">
          <p className="truncate text-sm text-ink">{file.name}</p>
          <span className="shrink-0 text-xs font-light text-muted">{formatBytes(file.size)}</span>
        </div>
        {showFolder && file.targetPath && (
          <p className="flex items-center gap-1 truncate text-xs font-light text-muted">
            <Folder size={11} className="shrink-0" />
            {file.targetPath}
          </p>
        )}
        {file.status === "uploading" ? (
          <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-canvas">
            <div
              className="h-full rounded-full bg-brand transition-all duration-200"
              style={{ width: `${Math.round(file.fraction * 100)}%` }}
            />
          </div>
        ) : (
          note && <p className="truncate text-xs font-light text-muted">{note}</p>
        )}
      </div>
      {onRemove && (
        <button
          type="button"
          onClick={() => onRemove(file.id)}
          aria-label={`Remove ${file.name}`}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-sm text-muted transition-colors hover:bg-canvas hover:text-ink"
        >
          <X size={14} />
        </button>
      )}
    </li>
  );
}

function StatusIcon({ status }: { status: UploadFileProgress["status"] }) {
  switch (status) {
    case "complete":
      return <CheckCircle2 size={15} className="shrink-0 text-success" />;
    case "error":
      return <XCircle size={15} className="shrink-0 text-error" />;
    case "skipped":
      return <MinusCircle size={15} className="shrink-0 text-muted/50" />;
    case "preparing":
    case "uploading":
    case "committing":
      return <Loader2 size={15} className="shrink-0 animate-spin text-brand" />;
    case "pending":
      return <Clock size={15} className="shrink-0 text-muted/40" />;
  }
}

function Glyph({ watching, phase, failed }: { watching: boolean; phase: UploadProgress["phase"]; failed: boolean }) {
  if (watching) return <Eye size={18} className="text-brand" />;
  switch (phase) {
    case "complete":
      return failed ? <AlertTriangle size={18} className="text-error" /> : <CheckCircle2 size={18} className="text-success" />;
    case "error":
      return <XCircle size={18} className="text-error" />;
    case "uploading":
      return <Loader2 size={18} className="animate-spin text-brand" />;
    default:
      return <Upload size={18} className="text-brand" />;
  }
}
