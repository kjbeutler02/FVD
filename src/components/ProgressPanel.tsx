"use client";

import { useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  XCircle,
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
  FolderDown,
  Play,
} from "lucide-react";
import {
  Button,
  CancelConfirm,
  Drawer,
  DrawerHeader,
  Eyebrow,
  GroupListHeader,
  IconButton,
  ProgressBar,
  Spinner,
  StatusBand,
} from "@/components/ui";
import {
  PART_MAX_FILES,
  REPORT_FILENAME,
  RUN_REPORT_FILENAME,
  UNKNOWN_FOLDER_PREFIX,
} from "@/lib/constants";
import type {
  DownloadPhase,
  DownloadProgress,
  FileProgress,
  PartProgress,
} from "@/types/download";

interface Props {
  progress: DownloadProgress;
  onCancel: () => void;
  onConfirm: () => void;
  onResume: () => void;
  onRetryFailed: () => void;
  onClose: () => void;
  onNewProject: () => void;
}

const PHASE_TITLES: Record<DownloadPhase, string> = {
  idle: "",
  scanning: "Preparing download",
  review: "Review download",
  downloading: "Downloading files",
  zipping: "Creating ZIP archive",
  complete: "Download complete",
  error: "Download failed",
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
  onResume,
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
    parts,
    currentPart,
    saveMode,
    saveFolder,
    canResume,
    reportIncluded,
    errorMessage,
    resolvingFolders,
    unknownFolderDocs,
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
  const isSplit = parts.length > 1;
  const activePart = currentPart != null ? parts[currentPart - 1] : undefined;
  const savedParts = parts.filter((p) => p.status === "complete").length;

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
    phase === "complete" && failedFiles > 0 ? "Completed with errors" : PHASE_TITLES[phase];

  const meta =
    zipName && phase !== "scanning"
      ? `${isRetry ? "Retry archive · " : ""}${
          isSplit
            ? isTransferring && activePart
              ? `Part ${activePart.index} of ${parts.length} · ${activePart.zipName}`
              : `${plural(parts.length, "ZIP file")}${saveFolder ? ` in "${saveFolder}"` : ""}`
            : zipName
        }`
      : undefined;

  // One primary action per view: "New project" steps back when a resume or
  // retry is the thing to do next.
  const offersResume = phase === "error" && canResume;
  const offersRetry = phase === "complete" && failedFiles > 0;

  return (
    <Drawer label="Download progress" dismissable={isDone} onDismiss={onClose}>
      <DrawerHeader
        glyph={<PhaseGlyph phase={phase} failed={failedFiles > 0} />}
        eyebrow={isRetry ? "Retry download" : "Download"}
        title={completeTitle}
        meta={meta}
        action={
          <IconButton
            label={isActive ? "Cancel download" : "Close"}
            onClick={isActive || phase === "review" ? requestCancel : onClose}
          >
            <X size={18} />
          </IconButton>
        }
      />

      {/* Status block */}
      <div className="px-7 pb-5">
        {phase === "scanning" ? (
          <div className="space-y-1.5">
            <div className="flex items-center gap-2.5 text-sm font-medium text-ink">
              <Spinner size={16} />
              <span>
                {scanFoldersTotal != null
                  ? "Finding documents in your selected folders…"
                  : "Scanning the project for documents…"}
              </span>
            </div>
            {scanFoldersTotal != null ? (
              <p className="pl-[26px] text-xs text-secondary">
                {Math.min(scanFoldersDone ?? 0, scanFoldersTotal).toLocaleString()} of{" "}
                {plural(scanFoldersTotal, "folder")} searched
                {scanProgress ? ` · ${plural(scanProgress, "document")} found` : ""}
              </p>
            ) : (
              scanTotal != null &&
              scanTotal > 0 && (
                <p className="pl-[26px] text-xs text-secondary">
                  {plural(scanTotal, "document")} checked
                  {scanProgress != null && scanProgress !== scanTotal
                    ? ` · ${scanProgress.toLocaleString()} match your selection`
                    : ""}
                </p>
              )
            )}
            {resolvingFolders && (
              <p className="pl-[26px] text-xs text-secondary">
                Looking up {plural(resolvingFolders.total, "folder")} not in the project&apos;s
                folder list… {Math.min(resolvingFolders.done, resolvingFolders.total)} of{" "}
                {resolvingFolders.total}
              </p>
            )}
            <p className="pl-[26px] text-xs text-secondary">
              Nothing is downloaded yet — you will review the list first.
            </p>
          </div>
        ) : phase === "review" ? (
          <ReviewSummary
            totalFiles={totalFiles}
            folderCount={groups.length}
            partCount={parts.length}
            unknownFolderDocs={unknownFolderDocs}
            excludedCount={excludedCount}
            convertToMd={convertToMd}
            convertibleTotal={convertibleTotal}
          />
        ) : phase === "error" && totalFiles === 0 ? (
          <p className="text-sm text-secondary">The document list could not be prepared.</p>
        ) : (
          <>
            <ProgressBar
              percent={phase === "zipping" ? 100 : percent}
              tone={
                phase === "error"
                  ? "error"
                  : phase === "complete" && failedFiles === 0
                  ? "success"
                  : "brand"
              }
            />
            <div className="mt-2.5 flex items-center justify-between gap-3 text-sm text-secondary">
              <span>
                {phase === "zipping"
                  ? "Generating ZIP archive…"
                  : `${completedFiles.toLocaleString()} of ${plural(totalFiles, "file")} saved`}
              </span>
              <span className="flex items-center gap-3">
                {failedFiles > 0 && (
                  <span className="flex items-center gap-1 font-medium text-error">
                    <AlertTriangle size={14} />
                    {failedFiles.toLocaleString()} failed
                  </span>
                )}
                {phase === "downloading" && (
                  <span className="font-mono font-medium text-ink">{percent}%</span>
                )}
              </span>
            </div>
            {isTransferring && isSplit && activePart && (
              <p className="mt-2 truncate text-xs text-secondary">
                <span className="font-semibold text-ink">
                  Part {activePart.index} of {parts.length}:{" "}
                </span>
                <span className="font-mono">{activePart.zipName}</span> ·{" "}
                {plural(activePart.fileCount, "file")}
                {savedParts > 0 && ` · ${savedParts} saved`}
              </p>
            )}
            {phase === "downloading" && activeFiles.length > 0 && (
              <p className="mt-2 truncate text-xs text-secondary">
                <span className="font-semibold text-ink">Now: </span>
                {activeFiles.join(" · ")}
              </p>
            )}
          </>
        )}
      </div>

      {/* Cancel confirmation */}
      {confirmingCancel && (
        <CancelConfirm
          message={
            isSplit
              ? `Cancel this download? ${
                  savedParts > 0
                    ? `The ${plural(savedParts, "part")} already saved will stay on disk; the part in progress`
                    : "The part in progress"
                } will be discarded.`
              : "Cancel this download? The partial ZIP will be discarded."
          }
          keepLabel="Keep downloading"
          cancelLabel="Cancel download"
          onKeep={() => setCancelRequested(false)}
          onCancel={onCancel}
        />
      )}

      {/* Result bands */}
      {phase === "error" && errorMessage && (
        <div className="px-7 pb-4">
          <StatusBand
            tone="error"
            icon={<XCircle size={17} />}
            title={`${
              isSplit && activePart ? `Part ${activePart.index} of ${parts.length} failed: ` : ""
            }${errorMessage}`}
          >
            {canResume ? (
              <p className="mt-1 text-xs text-ink">
                {savedParts > 0
                  ? `${plural(savedParts, "part")} (${plural(
                      parts
                        .filter((p) => p.status === "complete")
                        .reduce((n, p) => n + p.fileCount, 0),
                      "file"
                    )}) ${savedParts === 1 ? "is" : "are"} safely saved${
                      saveFolder ? ` in "${saveFolder}"` : ""
                    }. `
                  : ""}
                Resume to continue from part {activePart?.index ?? currentPart} without
                re-downloading them.
              </p>
            ) : (
              settled > 0 && (
                <p className="mt-1 text-xs text-ink">
                  {completedFiles.toLocaleString()} of {totalFiles.toLocaleString()} files had
                  been fetched before the failure. Nothing was saved.
                </p>
              )
            )}
          </StatusBand>
        </div>
      )}
      {phase === "complete" && (
        <div className="px-7 pb-4">
          <StatusBand
            tone={failedFiles > 0 ? "error" : "success"}
            icon={failedFiles > 0 ? <AlertTriangle size={17} /> : <CheckCircle2 size={17} />}
          >
            <p>
              Saved {plural(completedFiles, "file")}
              {isSplit
                ? ` in ${plural(parts.length, "ZIP file")}${
                    saveFolder ? ` to the folder "${saveFolder}"` : ""
                  }`
                : zipName
                ? ` to ${zipName}`
                : ""}
              .
              {failedFiles > 0 && (
                <>
                  {" "}
                  <span className="font-semibold text-error">
                    {plural(failedFiles, "file")} could not be downloaded
                  </span>{" "}
                  and {failedFiles === 1 ? "is" : "are"} missing from the archive.
                </>
              )}
            </p>
            {(convertToMd || reportIncluded) && (
              <p className="mt-1 text-xs text-ink">
                {convertToMd &&
                  `${plural(converted, "document")} converted to Markdown` +
                    (keptOriginal > 0
                      ? `; ${keptOriginal.toLocaleString()} kept as original (no text to extract)`
                      : "") +
                    ". "}
                {reportIncluded &&
                  (isSplit
                    ? `Each affected archive contains a "${REPORT_FILENAME}".`
                    : `A list is included in the archive as "${REPORT_FILENAME}".`)}
                {isSplit &&
                  saveMode === "directory" &&
                  ` A summary of all parts is saved as "${RUN_REPORT_FILENAME}" next to them.`}
              </p>
            )}
          </StatusBand>
        </div>
      )}

      {/* File list */}
      <div className="min-h-0 flex-1 overflow-y-auto border-t border-line">
        {phase === "scanning" ? (
          <div className="px-7 py-10 text-center text-sm text-secondary">
            Building the document list…
          </div>
        ) : (
          <>
            {isSplit && <PartsSection parts={parts} phase={phase} />}

            {failures.length > 0 && (
              <section aria-label="Failed files" className="border-b border-line">
                <h3 className="flex items-center gap-2 bg-error-bg px-7 py-2.5 text-micro font-semibold uppercase tracking-label text-error">
                  <AlertTriangle size={13} />
                  Not downloaded ({failures.length.toLocaleString()})
                </h3>
                <ul className="divide-y divide-line">
                  {failures.slice(0, ROW_LIMIT).map((file) => (
                    <FileRow key={file.documentId} file={file} showFolder convertToMd={convertToMd} />
                  ))}
                  {failures.length > ROW_LIMIT && (
                    <li className="px-7 py-2.5 text-xs text-secondary">
                      …and {(failures.length - ROW_LIMIT).toLocaleString()} more; see the report in the archive.
                    </li>
                  )}
                </ul>
              </section>
            )}

            {groups.length > 1 && (
              <GroupListHeader
                label={plural(groups.length, "folder")}
                onExpandAll={() => setAll(true)}
                onCollapseAll={() => setAll(false)}
              />
            )}

            <ul className={groups.length > 1 ? "border-t border-line" : ""}>
              {groups.map((group) => (
                <FolderGroupRow
                  key={group.path || " root"}
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
      <div className="border-t border-line bg-paper px-7 py-5">
        {phase === "review" ? (
          <div className="flex gap-3">
            <Button variant="secondary" className="flex-1" onClick={onCancel}>
              Back
            </Button>
            <Button
              className="flex-[2]"
              onClick={onConfirm}
              autoFocus
              icon={isSplit ? <FolderDown size={16} /> : <FileArchive size={16} />}
            >
              {isSplit
                ? `Choose folder · ${plural(parts.length, "ZIP file")}`
                : `Save ZIP · ${plural(totalFiles, "file")}`}
            </Button>
          </div>
        ) : isActive ? (
          <Button variant="secondary" fullWidth onClick={requestCancel} disabled={confirmingCancel}>
            Cancel download
          </Button>
        ) : (
          <div className="flex flex-col gap-3">
            {offersResume && (
              <Button fullWidth onClick={onResume} autoFocus icon={<Play size={16} />}>
                Resume from part {activePart?.index ?? currentPart} of {parts.length}
              </Button>
            )}
            {offersRetry && (
              <Button fullWidth onClick={onRetryFailed} icon={<RotateCcw size={16} />}>
                Retry {plural(failedFiles, "failed file")} into a second ZIP
              </Button>
            )}
            <div className="flex gap-3">
              <Button variant="secondary" className="flex-1" onClick={onClose}>
                Back to project
              </Button>
              <Button
                variant={offersResume || offersRetry ? "secondary" : "primary"}
                className="flex-1"
                onClick={onNewProject}
              >
                New project
              </Button>
            </div>
          </div>
        )}
      </div>
    </Drawer>
  );
}

/* ---------------------------------------------------------------- pieces */

const CODE = "rounded-check bg-ice px-1.5 py-px font-mono text-[0.75rem] text-ink";

function ReviewSummary({
  totalFiles,
  folderCount,
  partCount,
  unknownFolderDocs,
  excludedCount,
  convertToMd,
  convertibleTotal,
}: {
  totalFiles: number;
  folderCount: number;
  partCount: number;
  unknownFolderDocs: number;
  excludedCount: number;
  convertToMd: boolean;
  convertibleTotal: number;
}) {
  return (
    <div className="space-y-3">
      <div>
        <p className="text-base font-semibold text-ink">
          {plural(totalFiles, "document")} in {plural(folderCount, "folder")} will be
          downloaded.
        </p>
        <p className="mt-1 text-sm text-secondary">
          {partCount > 1
            ? "Check the list below, then choose a folder to save into. Nothing is fetched until you confirm."
            : "Check the list below, then choose where to save the ZIP. Nothing is fetched until you confirm."}
        </p>
      </div>
      <ul className="space-y-1.5 text-sm text-secondary">
        {partCount > 1 && (
          <li>
            <span className="font-semibold text-ink">Large download:</span> it will be split
            into {plural(partCount, "ZIP file")} of up to {PART_MAX_FILES.toLocaleString()}{" "}
            files each, saved into the folder you choose. Each part is safely on disk before
            the next begins, and a failed part can be resumed without redoing the others.
          </li>
        )}
        {convertToMd ? (
          <li>
            <span className="font-semibold text-ink">Markdown conversion is on:</span>{" "}
            {plural(convertibleTotal, "document")} (PDF, Word, text, CSV, …) will be saved as{" "}
            <code className={CODE}>.md</code> instead of the original file. Files with no
            extractable text keep the original.
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
      {unknownFolderDocs > 0 && (
        <StatusBand
          tone="warning"
          icon={<AlertTriangle size={16} />}
          title={`${plural(unknownFolderDocs, "document")} ${
            unknownFolderDocs === 1 ? "is" : "are"
          } in folders Filevine could not identify.`}
        >
          <p className="mt-1 text-xs text-ink">
            {unknownFolderDocs === 1 ? "It" : "They"} will be saved under{" "}
            <code className={CODE}>{UNKNOWN_FOLDER_PREFIX} &lt;id&gt;</code> at the top of the
            archive so {unknownFolderDocs === 1 ? "it stays" : "they stay"} traceable.
          </p>
        </StatusBand>
      )}
    </div>
  );
}

function PartsSection({ parts, phase }: { parts: PartProgress[]; phase: DownloadPhase }) {
  const saved = parts.filter((p) => p.status === "complete").length;
  return (
    <section aria-label="ZIP files" className="border-b border-line">
      <h3 className="flex items-center justify-between gap-3 px-7 pb-2 pt-4">
        <Eyebrow as="span" className="flex items-center gap-2">
          <FileArchive size={13} />
          {plural(parts.length, "ZIP file")}
        </Eyebrow>
        {phase !== "review" && (
          <span className="font-mono text-xs font-normal text-secondary">
            {saved} of {parts.length} saved
          </span>
        )}
      </h3>
      <ul className="divide-y divide-line border-t border-line">
        {parts.map((part) => (
          <li key={part.index} className="flex min-h-12 items-center gap-3 px-7 py-2">
            <PartStatusIcon status={part.status} phase={phase} />
            <div className="min-w-0 flex-1">
              <p className="truncate font-mono text-xs text-ink">{part.zipName}</p>
              <p className="truncate text-xs text-secondary">
                {plural(part.fileCount, "file")}
                {part.status === "writing" && " · writing…"}
                {part.status === "complete" && " · saved"}
                {part.status === "error" && (
                  <span className="text-error"> · failed — resume to retry this part</span>
                )}
              </p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function PartStatusIcon({ status, phase }: { status: PartProgress["status"]; phase: DownloadPhase }) {
  switch (status) {
    case "complete":
      return <CheckCircle2 size={15} className="shrink-0 text-success" />;
    case "error":
      return <XCircle size={15} className="shrink-0 text-error" />;
    case "writing":
      return <Spinner size={15} />;
    case "pending":
      return phase === "review" ? (
        <FileArchive size={15} className="shrink-0 text-navy" />
      ) : (
        <Clock size={15} className="shrink-0 text-line-strong" />
      );
  }
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
          <span> · {group.convertible.toLocaleString()} → .md</span>
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
      <Spinner size={15} />
    ) : group.failed > 0 && settled === total ? (
      <AlertTriangle size={15} className="shrink-0 text-error" />
    ) : settled === total && total > 0 && phase !== "review" ? (
      <CheckCircle2 size={15} className="shrink-0 text-success" />
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
        {groupIcon}
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">
          {group.path || <span className="font-medium italic text-secondary">Project root (no folder)</span>}
        </span>
        <span className="shrink-0 font-mono text-xs text-secondary">{summary}</span>
      </button>
      {inProgress && (
        <div className="-mt-0.5 px-7 pb-2.5">
          <ProgressBar size="sm" percent={total > 0 ? Math.round((settled / total) * 100) : 0} />
        </div>
      )}
      {expanded && (
        <ul className="divide-y divide-line border-t border-line bg-paper">
          {rows.map((file) => (
            <FileRow key={file.documentId} file={file} convertToMd={convertToMd} />
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
    <li className="flex min-h-11 items-center gap-3 py-2 pl-[52px] pr-7">
      <StatusIcon status={file.status} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-ink">{file.filename}</p>
        {showFolder && file.folderPath && (
          <p className="flex items-center gap-1 truncate text-xs text-secondary">
            <Folder size={11} className="shrink-0" />
            {file.folderPath}
          </p>
        )}
        {note && <p className="truncate text-xs text-secondary">{note}</p>}
      </div>
    </li>
  );
}

function PhaseGlyph({ phase, failed }: { phase: DownloadPhase; failed: boolean }) {
  switch (phase) {
    case "complete":
      return failed ? (
        <AlertTriangle size={14} className="text-error" />
      ) : (
        <CheckCircle2 size={14} className="text-success" />
      );
    case "error":
      return <XCircle size={14} className="text-error" />;
    case "review":
      return <ListChecks size={14} className="text-blue" />;
    case "zipping":
      return <FileArchive size={14} className="text-blue" />;
    default:
      return <Spinner size={14} />;
  }
}

function StatusIcon({ status }: { status: FileProgress["status"] }) {
  switch (status) {
    case "complete":
      return <CheckCircle2 size={15} className="shrink-0 text-success" />;
    case "error":
      return <XCircle size={15} className="shrink-0 text-error" />;
    case "downloading":
      return <Spinner size={15} />;
    case "pending":
      return <Clock size={15} className="shrink-0 text-line-strong" />;
  }
}
