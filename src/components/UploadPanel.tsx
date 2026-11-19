"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  CheckCircle2,
  XCircle,
  Clock,
  AlertTriangle,
  X,
  Folder,
  FolderPlus,
  ChevronRight,
  ChevronDown,
  Upload,
  Eye,
  RotateCcw,
  FileUp,
  MinusCircle,
} from "lucide-react";
import {
  Badge,
  Button,
  CancelConfirm,
  Checkbox,
  Drawer,
  DrawerHeader,
  GroupListHeader,
  IconButton,
  ProgressBar,
  Spinner,
  StatusBand,
} from "@/components/ui";
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
    ? "Watching folder"
    : phase === "review"
    ? "Upload to Filevine"
    : phase === "uploading"
    ? "Uploading files"
    : phase === "complete"
    ? progress.failedFiles > 0
      ? "Completed with errors"
      : "Upload complete"
    : phase === "error"
    ? "Upload failed"
    : "Upload";

  const subtitle = watching
    ? `“${watch!.folderName}” → ${destLabel(watch!.destination)}`
    : destLabel(progress.destination);

  const percent =
    progress.totalBytes > 0 ? Math.min(100, Math.round((progress.uploadedBytes / bytesToUpload) * 100)) : 0;

  const offersRetry = phase === "complete" && progress.failedFiles > 0;

  return (
    <Drawer label="Upload" dismissable={watching || isDone} onDismiss={onClose}>
      <DrawerHeader
        glyph={<Glyph watching={watching} phase={phase} failed={progress.failedFiles > 0} />}
        eyebrow={watching ? "Watch" : "Upload"}
        title={title}
        meta={subtitle || undefined}
        action={
          <IconButton
            label={isUploading ? "Cancel upload" : "Close"}
            onClick={isUploading || isReview ? requestCancel : onClose}
          >
            <X size={18} />
          </IconButton>
        }
      />

      {/* Status block */}
      <div className="px-7 pb-5">
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
            <ProgressBar
              percent={phase === "complete" ? 100 : percent}
              tone={
                phase === "error"
                  ? "error"
                  : phase === "complete" && progress.failedFiles === 0
                  ? "success"
                  : "brand"
              }
            />
            <div className="mt-2.5 flex items-center justify-between gap-3 text-sm text-secondary">
              <span>
                {progress.completedFiles.toLocaleString()} of {plural(toUpload, "file")} uploaded
                <span className="hidden font-mono text-xs sm:inline">
                  {" "}
                  · {formatBytes(Math.round(progress.uploadedBytes))} of {formatBytes(bytesToUpload)}
                </span>
              </span>
              <span className="flex items-center gap-3">
                {progress.failedFiles > 0 && (
                  <span className="flex items-center gap-1 font-medium text-error">
                    <AlertTriangle size={14} />
                    {progress.failedFiles.toLocaleString()} failed
                  </span>
                )}
                {isUploading && <span className="font-mono font-medium text-ink">{percent}%</span>}
              </span>
            </div>
            {isUploading && progress.activeFiles.length > 0 && (
              <p className="mt-2 truncate text-xs text-secondary">
                <span className="font-semibold text-ink">Now: </span>
                {progress.activeFiles.join(" · ")}
              </p>
            )}
          </>
        )}
      </div>

      {/* Cancel confirmation */}
      {cancelRequested && isUploading && (
        <CancelConfirm
          message="Cancel this upload? Files already uploaded stay in Filevine; files in progress are discarded."
          keepLabel="Keep uploading"
          cancelLabel="Cancel upload"
          onKeep={() => setCancelRequested(false)}
          onCancel={onCancel}
        />
      )}

      {/* Result bands */}
      {phase === "error" && progress.errorMessage && (
        <div className="px-7 pb-4">
          <StatusBand tone="error" icon={<XCircle size={17} />} title={progress.errorMessage} />
        </div>
      )}
      {phase === "complete" && (
        <div className="px-7 pb-4">
          <StatusBand
            tone={progress.failedFiles > 0 ? "error" : "success"}
            icon={
              progress.failedFiles > 0 ? <AlertTriangle size={17} /> : <CheckCircle2 size={17} />
            }
          >
            <p>
              Uploaded {plural(progress.completedFiles, "file")} to{" "}
              {progress.destination?.folderPath || "the project root"}.
              {progress.failedFiles > 0 && (
                <>
                  {" "}
                  <span className="font-semibold text-error">
                    {plural(progress.failedFiles, "file")} could not be uploaded
                  </span>{" "}
                  and {progress.failedFiles === 1 ? "is" : "are"} not in Filevine.
                </>
              )}
            </p>
            <p className="mt-1 text-xs text-ink">
              {progress.skippedFiles > 0 &&
                `${plural(progress.skippedFiles, "identical file")} already in Filevine ${
                  progress.skippedFiles === 1 ? "was" : "were"
                } skipped. `}
              {progress.attributed === true && "Filevine records you as the uploader."}
              {progress.attributed === false &&
                "Filevine records the firm's shared account as the uploader (your email was not matched to a Filevine user)."}
            </p>
          </StatusBand>
        </div>
      )}

      {/* File list */}
      <div className="min-h-0 flex-1 overflow-y-auto border-t border-line">
        {files.size === 0 ? (
          <div className="px-7 py-12 text-center text-sm text-secondary">
            {watching
              ? "No new files yet. Anything placed in the folder will appear here."
              : "No files chosen yet."}
          </div>
        ) : (
          <>
            {failures.length > 0 && (
              <section aria-label="Failed files" className="border-b border-line">
                <h3 className="flex items-center gap-2 bg-error-bg px-7 py-2.5 text-micro font-semibold uppercase tracking-label text-error">
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
              <GroupListHeader
                label={plural(groups.length, "destination folder")}
                onExpandAll={() => {
                  setExpandAll(true);
                  setOverrides(new Map());
                }}
                onCollapseAll={() => {
                  setExpandAll(false);
                  setOverrides(new Map());
                }}
              />
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
      <div className="border-t border-line bg-paper px-7 py-5">
        {watching ? (
          <div className="flex gap-3">
            <Button
              variant="secondary"
              className="flex-1"
              onClick={onStopWatch}
              icon={<MinusCircle size={16} />}
            >
              Stop watching
            </Button>
            <Button className="flex-1" onClick={onClose}>
              Close
            </Button>
          </div>
        ) : isReview ? (
          <div className="flex flex-col gap-2">
            <div className="flex gap-3">
              <Button variant="secondary" className="flex-1" onClick={onCancel}>
                Cancel
              </Button>
              <Button
                className="flex-[2]"
                onClick={onConfirm}
                disabled={toUpload === 0 || progress.checkingDuplicates}
                icon={
                  progress.checkingDuplicates ? (
                    <Spinner size={16} className="text-white" />
                  ) : (
                    <Upload size={16} />
                  )
                }
              >
                {progress.checkingDuplicates
                  ? "Checking Filevine…"
                  : toUpload > 0
                  ? `Upload ${plural(toUpload, "file")} · ${formatBytes(bytesToUpload)}`
                  : "Upload"}
              </Button>
            </div>
            {canWatch && (
              <Button
                variant="ghost"
                fullWidth
                onClick={onStartWatch}
                icon={<Eye size={15} />}
                className="h-auto whitespace-normal py-2 text-left sm:text-center"
              >
                Or watch a folder on this computer and upload as files arrive
              </Button>
            )}
          </div>
        ) : isUploading ? (
          <Button variant="secondary" fullWidth onClick={requestCancel} disabled={cancelRequested}>
            Cancel upload
          </Button>
        ) : (
          <div className="flex flex-col gap-3">
            {offersRetry && (
              <Button fullWidth onClick={onRetryFailed} icon={<RotateCcw size={16} />}>
                Retry {plural(progress.failedFiles, "failed file")}
              </Button>
            )}
            <Button variant={offersRetry ? "secondary" : "primary"} fullWidth onClick={onClose}>
              Done
            </Button>
          </div>
        )}
      </div>
    </Drawer>
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
      className={`flex flex-col items-center justify-center rounded-panel border border-dashed text-center transition-colors duration-[180ms] ease-sh ${
        compact ? "px-4 py-3" : "px-6 py-9"
      } ${dragging ? "border-blue bg-ice" : "border-line-strong bg-paper"}`}
    >
      {!compact && (
        <>
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-ice text-navy">
            <FileUp size={22} strokeWidth={1.75} />
          </span>
          <p className="mt-4 text-base font-semibold text-ink">Drop files or folders here</p>
          <p className="mt-1 text-sm text-secondary">
            Folders keep their structure inside the Filevine folder you chose.
          </p>
        </>
      )}
      <div className={`flex flex-wrap items-center justify-center gap-2 ${compact ? "" : "mt-5"}`}>
        <Button variant="secondary" size="sm" onClick={() => fileInput.current?.click()}>
          {compact ? "Add files" : "Choose files"}
        </Button>
        <Button variant="secondary" size="sm" onClick={() => dirInput.current?.click()}>
          {compact ? "Add folder" : "Choose folder"}
        </Button>
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
    <div className="mt-5 space-y-3">
      <div>
        <p className="text-base font-semibold text-ink">
          {plural(toUpload, "file")} ({formatBytes(bytesToUpload)}) will be uploaded to{" "}
          {progress.destination?.folderPath || "the project root"}.
        </p>
        <p className="mt-1 text-sm text-secondary">Nothing is sent until you confirm.</p>
      </div>
      {tooLarge > 0 && limits && (
        <StatusBand
          tone="error"
          icon={<AlertTriangle size={16} />}
          title={`${plural(tooLarge, "file")} ${tooLarge === 1 ? "is" : "are"} too large to upload`}
        >
          <p className="mt-1 text-xs text-ink">
            {limits.largeFiles
              ? `The limit is ${formatBytes(limits.largeFileMaxBytes)}.`
              : `Files over ${formatBytes(limits.relayMaxBytes)} need the large-file store, which is not set up on this deployment yet.`}{" "}
            {tooLarge === 1 ? "It is" : "They are"} listed under “Not uploaded”.
          </p>
        </StatusBand>
      )}
      <ul className="space-y-1.5 text-sm text-secondary">
        {folders.length > 0 && (
          <li>
            <span className="font-semibold text-ink">
              {plural(folders.length, "new folder")} will be created in Filevine:
            </span>{" "}
            {folders.slice(0, 4).join(", ")}
            {folders.length > 4 && ` and ${folders.length - 4} more`}.
          </li>
        )}
        {progress.checkingDuplicates ? (
          <li className="flex items-center gap-2">
            <Spinner size={13} />
            Checking the destination for files that are already there…
          </li>
        ) : (
          <>
            {identical > 0 && (
              <li>
                <span className="font-semibold text-ink">
                  {plural(identical, "file")} {identical === 1 ? "is" : "are"} already in Filevine
                </span>{" "}
                (same name and size) and will be skipped.
                <span className="mt-2 flex items-center gap-3 pl-0.5">
                  <Checkbox
                    state={progress.uploadDuplicates ? "checked" : "unchecked"}
                    onToggle={() => onToggleDuplicates(!progress.uploadDuplicates)}
                    label="Upload them anyway as additional copies"
                  />
                  <button
                    type="button"
                    tabIndex={-1}
                    aria-hidden="true"
                    onClick={() => onToggleDuplicates(!progress.uploadDuplicates)}
                    className="min-h-9 select-none text-left text-sm font-medium text-ink"
                  >
                    Upload them anyway as additional copies
                  </button>
                </span>
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
          <Spinner size={17} className="mt-1" />
        ) : (
          <Eye size={17} className="mt-1 shrink-0 text-blue" />
        )}
        <div>
          <p className="text-base font-semibold text-ink">
            {plural(watch.uploaded, "file")} uploaded
            {watch.activeNames.length > 0 && ` · ${watch.activeNames.length} uploading`}
            {watch.waiting > 0 && ` · ${watch.waiting} waiting`}
            {watch.failed > 0 && <span className="text-error"> · {watch.failed} failed</span>}
          </p>
          <p className="mt-1 text-sm text-secondary">
            New files are sent once they have stopped changing for a few seconds, then moved into
            “{WATCH_DONE_DIRNAME}” inside the folder. Keep this tab open.
          </p>
          {watch.error && <p className="mt-1.5 text-sm font-medium text-error">{watch.error}</p>}
        </div>
      </div>
      {watch.activeNames.length > 0 && (
        <p className="truncate pl-[27px] text-xs text-secondary">
          <span className="font-semibold text-ink">Now: </span>
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
      <Spinner size={15} />
    ) : group.failed > 0 && settled === total ? (
      <AlertTriangle size={15} className="shrink-0 text-error" />
    ) : settled === total && total > 0 && phase !== "review" ? (
      <CheckCircle2 size={15} className="shrink-0 text-success" />
    ) : isNew ? (
      <FolderPlus size={15} className="shrink-0 text-blue" />
    ) : (
      <Folder size={15} className="shrink-0 text-blue-soft" />
    );

  return (
    <li className="border-b border-line">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="flex min-h-12 w-full items-center gap-2.5 px-7 py-2 text-left transition-colors duration-[120ms] ease-sh hover:bg-ice"
      >
        {expanded ? (
          <ChevronDown size={14} className="shrink-0 text-secondary" />
        ) : (
          <ChevronRight size={14} className="shrink-0 text-secondary" />
        )}
        {icon}
        <span className="flex min-w-0 flex-1 items-center gap-2">
          <span className="truncate text-sm font-semibold text-ink">
            {group.path || <span className="font-medium italic text-secondary">Project root</span>}
          </span>
          {isNew && <Badge tone="info">New folder</Badge>}
        </span>
        <span className="shrink-0 font-mono text-xs text-secondary">
          {phase === "review"
            ? `${plural(total - group.skipped, "file")}${group.skipped > 0 ? ` · ${group.skipped} skipped` : ""}`
            : `${group.done.toLocaleString()}/${(total - group.skipped).toLocaleString()}${
                group.failed > 0 ? ` · ${group.failed} failed` : ""
              }`}
        </span>
      </button>
      {expanded && (
        <ul className="divide-y divide-line border-t border-line bg-paper">
          {rows.map((f) => (
            <FileRow key={f.id} file={f} phase={phase} onRemove={onRemove} />
          ))}
          {!showAll && total > ROW_LIMIT && (
            <li className="py-1 pl-[52px] pr-7">
              <Button variant="ghost" size="sm" className="-ml-3.5" onClick={() => setShowAll(true)}>
                Show all {total.toLocaleString()} files
              </Button>
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
    <li className={`flex min-h-11 items-center gap-3 py-2 pl-[52px] ${onRemove ? "pr-4" : "pr-7"}`}>
      <StatusIcon status={file.status} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-3">
          <p className="truncate text-sm text-ink">{file.name}</p>
          <span className="shrink-0 font-mono text-xs text-secondary">{formatBytes(file.size)}</span>
        </div>
        {showFolder && file.targetPath && (
          <p className="flex items-center gap-1 truncate text-xs text-secondary">
            <Folder size={11} className="shrink-0" />
            {file.targetPath}
          </p>
        )}
        {file.status === "uploading" ? (
          <ProgressBar size="sm" className="mt-1.5" percent={Math.round(file.fraction * 100)} />
        ) : (
          note && <p className="truncate text-xs text-secondary">{note}</p>
        )}
      </div>
      {onRemove && (
        <IconButton label={`Remove ${file.name}`} size="sm" onClick={() => onRemove(file.id)}>
          <X size={14} />
        </IconButton>
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
      return <MinusCircle size={15} className="shrink-0 text-line-strong" />;
    case "preparing":
    case "uploading":
    case "committing":
      return <Spinner size={15} />;
    case "pending":
      return <Clock size={15} className="shrink-0 text-line-strong" />;
  }
}

function Glyph({ watching, phase, failed }: { watching: boolean; phase: UploadProgress["phase"]; failed: boolean }) {
  if (watching) return <Eye size={14} className="text-blue" />;
  switch (phase) {
    case "complete":
      return failed ? <AlertTriangle size={14} className="text-error" /> : <CheckCircle2 size={14} className="text-success" />;
    case "error":
      return <XCircle size={14} className="text-error" />;
    case "uploading":
      return <Spinner size={14} />;
    default:
      return <Upload size={14} className="text-blue" />;
  }
}
