"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { downloadZip } from "client-zip";
import { saveAs } from "file-saver";
import {
  downloadFileViaProxy,
  fetchAllDocuments,
  fetchDocumentsByFolders,
  resolveMissingFolders,
  isRetryable,
  retryDelay,
} from "@/lib/api";
import { archivePath, displayFolderPath, folderPathParts } from "@/lib/zipPath";
import {
  DOWNLOAD_CONCURRENCY,
  MAX_RETRIES,
  FOLDER_SCOPED_MAX,
  PART_MAX_FILES,
  REPORT_FILENAME,
  RUN_REPORT_FILENAME,
} from "@/lib/constants";
import { convertToMarkdown, isConvertible, markdownFilename } from "@/lib/toMarkdown";
import type { DocumentItem } from "@/types/filevine";
import type {
  DownloadProgress,
  DownloadSelection,
  FileOutcome,
  FileProgress,
  PartProgress,
} from "@/types/download";

// The File System Access API is Chromium-only and not yet in lib.dom.
declare global {
  interface Window {
    showSaveFilePicker?: (options?: {
      suggestedName?: string;
      types?: { description?: string; accept: Record<string, string[]> }[];
    }) => Promise<FileSystemFileHandle>;
    showDirectoryPicker?: (options?: {
      id?: string;
      mode?: "read" | "readwrite";
      startIn?: string;
    }) => Promise<FileSystemDirectoryHandle>;
  }
}

type FolderFlatMap = Record<number, { name: string; parentId: number | null }>;

/** Everything a confirmed run needs; captured at review time. */
interface PendingRun {
  docs: DocumentItem[];
  folderFlatMap: FolderFlatMap;
  projectId: number;
  convertToMd: boolean;
  /** Archive name for a single-ZIP run, or the base name parts are derived from. */
  zipName: string;
  isRetry: boolean;
  excludedCount: number;
}

/** Where a run's archive(s) are written. */
type SaveTarget =
  | { mode: "file"; handle: FileSystemFileHandle }
  | { mode: "directory"; handle: FileSystemDirectoryHandle }
  | { mode: "blob" };

interface PartReport {
  failures: FileProgress[];
  keptOriginal: FileProgress[];
}

/**
 * Everything needed to pick a failed split run back up from the failed part.
 * The save target is kept so no new picker (and no new user gesture) is needed.
 */
interface ResumeState {
  run: PendingRun;
  target: SaveTarget;
  parts: DocumentItem[][];
  fromPart: number;
  files: Map<number, FileProgress>;
  partProgress: PartProgress[];
  partReports: PartReport[];
}

function initialProgress(): DownloadProgress {
  return {
    phase: "idle",
    totalFiles: 0,
    completedFiles: 0,
    failedFiles: 0,
    activeFiles: [],
    files: new Map(),
    excludedCount: 0,
    convertToMd: false,
    isRetry: false,
    parts: [],
    canResume: false,
    reportIncluded: false,
    unknownFolderDocs: 0,
  };
}

function isAbort(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
}

/**
 * Split the (already sorted) document list into parts of at most
 * PART_MAX_FILES, balanced so the last part is not a stub. Because the list
 * is ordered by folder, each part covers a contiguous range of folders.
 */
function splitIntoParts(docs: DocumentItem[]): DocumentItem[][] {
  const count = Math.max(1, Math.ceil(docs.length / PART_MAX_FILES));
  const size = Math.ceil(docs.length / count);
  const parts: DocumentItem[][] = [];
  for (let i = 0; i < docs.length; i += size) parts.push(docs.slice(i, i + size));
  return parts.length > 0 ? parts : [[]];
}

function partZipName(baseName: string, index: number, count: number): string {
  if (count === 1) return baseName;
  const width = String(count).length;
  const pad = (n: number) => String(n).padStart(width, "0");
  return `${baseName.replace(/\.zip$/i, "")}-part-${pad(index)}-of-${pad(count)}.zip`;
}

function buildPartProgress(
  parts: DocumentItem[][],
  baseName: string,
  completedThrough = 0
): PartProgress[] {
  return parts.map((docs, i) => ({
    index: i + 1,
    zipName: partZipName(baseName, i + 1, parts.length),
    fileCount: docs.length,
    status: i + 1 <= completedThrough ? "complete" : "pending",
  }));
}

function buildFileMap(parts: DocumentItem[][], flatMap: FolderFlatMap): Map<number, FileProgress> {
  const files = new Map<number, FileProgress>();
  parts.forEach((docs, i) => {
    for (const doc of docs) {
      files.set(doc.documentId, {
        documentId: doc.documentId,
        filename: doc.filename,
        folderPath: displayFolderPath(doc.folderId, flatMap),
        status: "pending",
        convertible: isConvertible(doc.filename),
        part: i + 1,
      });
    }
  });
  return files;
}

function tally(files: Map<number, FileProgress>) {
  let completedFiles = 0;
  let failedFiles = 0;
  const activeFiles: string[] = [];
  for (const f of files.values()) {
    if (f.status === "complete") completedFiles++;
    else if (f.status === "error") failedFiles++;
    else if (f.status === "downloading") activeFiles.push(f.filename);
  }
  return { completedFiles, failedFiles, activeFiles };
}

export function useDownloadOrchestrator() {
  const [progress, setProgress] = useState<DownloadProgress>(initialProgress);
  const abortRef = useRef<AbortController | null>(null);
  // Every scan/download gets its own id. State updates from a superseded run
  // (e.g. one that was cancelled and is still unwinding) are dropped, so a
  // stale run can never close or overwrite the drawer of the current one.
  const runIdRef = useRef(0);
  const pendingRef = useRef<PendingRun | null>(null);
  // The docs of the most recent download, so failures can be retried.
  const lastRunRef = useRef<PendingRun | null>(null);
  // Set when a split run fails part-way; cleared on completion, cancel, or a new run.
  const resumeRef = useRef<ResumeState | null>(null);

  // Closing the tab mid-transfer would silently lose the part in progress.
  useEffect(() => {
    if (progress.phase !== "downloading" && progress.phase !== "zipping") return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [progress.phase]);

  const commit = useCallback(
    (runId: number, update: (prev: DownloadProgress) => DownloadProgress) => {
      if (runId !== runIdRef.current) return;
      setProgress(update);
    },
    []
  );

  const beginRun = useCallback(() => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    runIdRef.current += 1;
    return { runId: runIdRef.current, controller };
  }, []);

  /* ------------------------------------------------------------- scan */

  const startDownload = useCallback(
    async (folderFlatMap: FolderFlatMap, selection: DownloadSelection, projectId: number) => {
      const { folderIds: selectedFolderIds, extraDocs, excludedDocIds, convertToMd } = selection;
      const { runId, controller } = beginRun();
      pendingRef.current = null;
      resumeRef.current = null;

      // A bounded, specific selection is fetched per-folder (server-scoped) so
      // we never touch unselected folders. "Select all" (null) and very large
      // selections fall back to a single project-wide scan. A selection of
      // individual documents only (no folders) needs no scan at all.
      const skipScan = selectedFolderIds != null && selectedFolderIds.size === 0;
      const useFolderScoped =
        selectedFolderIds != null &&
        selectedFolderIds.size > 0 &&
        selectedFolderIds.size <= FOLDER_SCOPED_MAX;

      commit(runId, () => ({
        ...initialProgress(),
        phase: "scanning",
        convertToMd,
        scanProgress: 0,
        ...(useFolderScoped
          ? { scanFoldersDone: 0, scanFoldersTotal: selectedFolderIds!.size }
          : { scanTotal: 0 }),
      }));

      let docs: DocumentItem[];
      try {
        if (skipScan) {
          docs = [];
        } else if (useFolderScoped) {
          docs = await fetchDocumentsByFolders(
            projectId,
            selectedFolderIds!,
            (found, done, total) => {
              commit(runId, (prev) => ({
                ...prev,
                scanProgress: found,
                scanFoldersDone: done,
                scanFoldersTotal: total,
              }));
            },
            controller.signal
          );
        } else {
          docs = await fetchAllDocuments(
            projectId,
            (matched, scanned) => {
              commit(runId, (prev) => ({ ...prev, scanProgress: matched, scanTotal: scanned }));
            },
            selectedFolderIds,
            controller.signal
          );
        }
      } catch (err) {
        // A cancel/abort is a normal outcome — return to idle, not an error.
        if (controller.signal.aborted || isAbort(err)) {
          commit(runId, (prev) => ({ ...prev, phase: "idle" }));
          return;
        }
        commit(runId, (prev) => ({
          ...prev,
          phase: "error",
          errorMessage: err instanceof Error ? err.message : "Failed to fetch document list",
        }));
        return;
      }

      if (controller.signal.aborted) {
        commit(runId, (prev) => ({ ...prev, phase: "idle" }));
        return;
      }

      // Apply the document-level overrides: drop individually deselected
      // documents, then add individually selected ones (de-duped by id).
      let excludedCount = 0;
      if (excludedDocIds.size > 0) {
        const before = docs.length;
        docs = docs.filter((d) => !excludedDocIds.has(d.documentId));
        excludedCount = before - docs.length;
      }
      const included = new Set(docs.map((d) => d.documentId));
      for (const doc of extraDocs) {
        if (!included.has(doc.documentId)) {
          included.add(doc.documentId);
          docs.push(doc);
        }
      }

      if (docs.length === 0) {
        commit(runId, (prev) => ({
          ...prev,
          phase: "error",
          errorMessage: "No documents found in the selected folders.",
        }));
        return;
      }

      // The project's folder list can miss folders (deleted, moved, or not
      // visible to the list call). Look those up individually so every
      // document keeps its real path; whatever still cannot be identified is
      // counted and grouped under "_Unknown folder <id>" rather than dumped
      // at the archive root. The run works on its own copy of the map.
      const flatMap: FolderFlatMap = { ...folderFlatMap };
      let unknownFolderDocs = 0;
      try {
        unknownFolderDocs = await resolveMissingFolders(
          docs,
          flatMap,
          controller.signal,
          (done, total) => commit(runId, (prev) => ({ ...prev, resolvingFolders: { done, total } }))
        );
      } catch (err) {
        if (controller.signal.aborted || isAbort(err)) {
          commit(runId, (prev) => ({ ...prev, phase: "idle" }));
          return;
        }
      }
      if (controller.signal.aborted) {
        commit(runId, (prev) => ({ ...prev, phase: "idle" }));
        return;
      }

      // Stable, predictable archive order: by folder path, then filename.
      const pathOf = new Map<number, string>();
      for (const d of docs) {
        if (!pathOf.has(d.folderId)) pathOf.set(d.folderId, displayFolderPath(d.folderId, flatMap));
      }
      docs.sort(
        (a, b) =>
          pathOf.get(a.folderId)!.localeCompare(pathOf.get(b.folderId)!) ||
          a.filename.localeCompare(b.filename)
      );

      const run: PendingRun = {
        docs,
        folderFlatMap: flatMap,
        projectId,
        convertToMd,
        zipName: `filevine-project-${projectId}.zip`,
        isRetry: false,
        excludedCount,
      };
      pendingRef.current = run;

      const parts = splitIntoParts(docs);
      commit(runId, (prev) => ({
        ...prev,
        phase: "review",
        totalFiles: docs.length,
        files: buildFileMap(parts, flatMap),
        parts: buildPartProgress(parts, run.zipName),
        excludedCount,
        zipName: run.zipName,
        resolvingFolders: undefined,
        unknownFolderDocs,
      }));
    },
    [beginRun, commit]
  );

  /* --------------------------------------------------------- download */

  const runDownload = useCallback(
    async (run: PendingRun, resume: ResumeState | null = null) => {
      const { runId, controller } = beginRun();

      const parts = resume?.parts ?? splitIntoParts(run.docs);
      const partCount = parts.length;

      // Ask for the save location first, while we still have the click's user
      // activation. A single ZIP streams straight to a file; a split run gets
      // a folder and writes each part into it as it finishes. Browsers without
      // the File System Access API fall back to in-memory Blob saves.
      let target: SaveTarget | null = resume?.target ?? null;
      if (!target) {
        target = await chooseSaveTarget(partCount, partZipName(run.zipName, 1, partCount));
        if (!target) {
          // Picker dismissed — leave the drawer exactly as it was (review or
          // complete) so they can try again.
          pendingRef.current = run.isRetry ? null : run;
          return;
        }
      }
      if (controller.signal.aborted) return;
      pendingRef.current = null;
      lastRunRef.current = run;
      resumeRef.current = null;

      const startPart = resume?.fromPart ?? 1;
      // Local mirror of per-file state, so the resume snapshot and the folder
      // report never depend on React having flushed a render.
      const fileState = resume ? new Map(resume.files) : buildFileMap(parts, run.folderFlatMap);
      if (resume) {
        // The failed part (and anything after it) starts over from scratch.
        for (const f of fileState.values()) {
          if (f.part >= startPart) {
            fileState.set(f.documentId, {
              ...f,
              status: "pending",
              zipPath: undefined,
              outcome: undefined,
              error: undefined,
            });
          }
        }
      }
      const partProgress = buildPartProgress(parts, run.zipName, startPart - 1);
      const partReports: PartReport[] = resume ? resume.partReports.slice(0, startPart - 1) : [];
      const saveFolder = target.mode === "directory" ? target.handle.name : undefined;

      commit(runId, () => ({
        ...initialProgress(),
        phase: "downloading",
        totalFiles: run.docs.length,
        files: new Map(fileState),
        ...tally(fileState),
        excludedCount: run.excludedCount,
        convertToMd: run.convertToMd,
        isRetry: run.isRetry,
        zipName: run.zipName,
        parts: [...partProgress],
        currentPart: startPart,
        saveMode: target.mode,
        saveFolder,
        reportIncluded: partReports.some(
          (r) => r.failures.length > 0 || r.keptOriginal.length > 0
        ),
      }));

      const updateFile = (docId: number, update: Partial<FileProgress>) => {
        const existing = fileState.get(docId);
        if (!existing) return;
        fileState.set(docId, { ...existing, ...update });
        commit(runId, (prev) => ({ ...prev, files: new Map(fileState), ...tally(fileState) }));
      };

      const setPart = (index: number, status: PartProgress["status"]) => {
        partProgress[index - 1] = { ...partProgress[index - 1], status };
        commit(runId, (prev) => ({ ...prev, parts: [...partProgress], currentPart: index }));
      };

      for (let p = startPart; p <= partCount; p++) {
        const partDocs = parts[p - 1];
        const zipName = partProgress[p - 1].zipName;
        setPart(p, "writing");

        const report: PartReport = { failures: [], keptOriginal: [] };
        const entries = zipEntries(partDocs, p, zipName, run, updateFile, controller.signal, report, () =>
          commit(runId, (prev) => ({ ...prev, reportIncluded: true }))
        );

        try {
          await writeArchive(target, zipName, downloadZip(entries), controller.signal, () =>
            commit(runId, (prev) => ({ ...prev, phase: "zipping", activeFiles: [] }))
          );
          if (target.mode === "blob") {
            commit(runId, (prev) => ({ ...prev, phase: "downloading" }));
          }
          partReports.push(report);
          setPart(p, "complete");
        } catch (err) {
          if (controller.signal.aborted || isAbort(err)) {
            commit(runId, (prev) => ({ ...prev, phase: "idle" }));
            return;
          }
          partProgress[p - 1] = { ...partProgress[p - 1], status: "error" };
          // Parts before this one are already on disk. Keep everything needed
          // to carry on from here without re-fetching them.
          const canResume = partCount > 1;
          resumeRef.current = canResume
            ? {
                run,
                target,
                parts,
                fromPart: p,
                files: new Map(fileState),
                partProgress: [...partProgress],
                partReports: [...partReports],
              }
            : null;
          commit(runId, (prev) => ({
            ...prev,
            phase: "error",
            activeFiles: [],
            parts: [...partProgress],
            currentPart: p,
            canResume,
            errorMessage: err instanceof Error ? err.message : "Failed to save ZIP file",
          }));
          return;
        }
      }

      // A folder-level summary next to the parts: which files went where, and
      // what (if anything) is missing. Best effort — never fail a finished run
      // over the summary.
      if (target.mode === "directory" && partCount > 1) {
        try {
          await writeTextFile(
            target.handle,
            RUN_REPORT_FILENAME,
            buildRunReport(run, target.handle.name, partProgress, partReports, fileState)
          );
        } catch {
          /* ignore */
        }
      }

      resumeRef.current = null;
      commit(runId, (prev) => ({
        ...prev,
        phase: "complete",
        activeFiles: [],
        currentPart: undefined,
        canResume: false,
      }));
    },
    [beginRun, commit]
  );

  /** Confirm the reviewed list: choose a save location and start downloading. */
  const confirmDownload = useCallback(() => {
    const run = pendingRef.current;
    if (!run) return;
    void runDownload(run);
  }, [runDownload]);

  /** After a failure in a split run: continue from the part that failed. */
  const resumeDownload = useCallback(() => {
    const state = resumeRef.current;
    if (!state) return;
    void runDownload(state.run, state);
  }, [runDownload]);

  /** Download only the files that failed in the last run, into a second ZIP. */
  const retryFailed = useCallback(() => {
    const last = lastRunRef.current;
    if (!last) return;
    const failedIds = new Set<number>();
    for (const f of progress.files.values()) {
      if (f.status === "error") failedIds.add(f.documentId);
    }
    const docs = last.docs.filter((d) => failedIds.has(d.documentId));
    if (docs.length === 0) return;
    const baseName = last.zipName.replace(/(-retry(-\d+)?)?\.zip$/, "");
    const attempt = /-retry-(\d+)\.zip$/.exec(last.zipName);
    const n = attempt ? Number(attempt[1]) + 1 : last.zipName.includes("-retry") ? 2 : 1;
    void runDownload({
      ...last,
      docs,
      isRetry: true,
      excludedCount: 0,
      zipName: n === 1 ? `${baseName}-retry.zip` : `${baseName}-retry-${n}.zip`,
    });
  }, [progress.files, runDownload]);

  const cancel = useCallback(() => {
    // Invalidate the run first so its unwinding never touches state again.
    runIdRef.current += 1;
    pendingRef.current = null;
    resumeRef.current = null;
    abortRef.current?.abort();
    abortRef.current = null;
    setProgress(initialProgress());
  }, []);

  const reset = cancel;

  return {
    progress,
    startDownload,
    confirmDownload,
    resumeDownload,
    retryFailed,
    cancel,
    reset,
  };
}

/* ------------------------------------------------------------ save target */

/**
 * Pick where the run is saved. Returns null if the user dismissed the picker.
 * Any other picker failure (unsupported, blocked, no user activation) falls
 * back to in-memory Blob saves so the download still happens.
 */
async function chooseSaveTarget(partCount: number, suggestedName: string): Promise<SaveTarget | null> {
  if (partCount > 1 && window.showDirectoryPicker) {
    try {
      const handle = await window.showDirectoryPicker({
        id: "fvd-downloads",
        mode: "readwrite",
        startIn: "downloads",
      });
      return { mode: "directory", handle };
    } catch (err) {
      if (isAbort(err)) return null;
    }
  } else if (partCount === 1 && window.showSaveFilePicker) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName,
        types: [{ description: "ZIP archive", accept: { "application/zip": [".zip"] } }],
      });
      return { mode: "file", handle };
    } catch (err) {
      if (isAbort(err)) return null;
    }
  }
  return { mode: "blob" };
}

/** Write one archive to the chosen target; resolves once it is fully on disk. */
async function writeArchive(
  target: SaveTarget,
  zipName: string,
  zipResponse: Response,
  signal: AbortSignal,
  onZipping: () => void
): Promise<void> {
  switch (target.mode) {
    case "file": {
      const writable = await target.handle.createWritable();
      // pipeTo aborts the writable on cancel, discarding the partial file.
      await zipResponse.body!.pipeTo(writable, { signal });
      return;
    }
    case "directory": {
      const fileHandle = await target.handle.getFileHandle(zipName, { create: true });
      const writable = await fileHandle.createWritable();
      await zipResponse.body!.pipeTo(writable, { signal });
      return;
    }
    case "blob": {
      onZipping();
      const blob = await zipResponse.blob();
      if (signal.aborted) throw new DOMException("Aborted", "AbortError");
      saveAs(blob, zipName);
      return;
    }
  }
}

async function writeTextFile(
  dir: FileSystemDirectoryHandle,
  name: string,
  text: string
): Promise<void> {
  const fileHandle = await dir.getFileHandle(name, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(text);
  await writable.close();
}

/* ------------------------------------------------------------- workers */

interface ZipEntry {
  name: string;
  input: Blob | string;
}

interface FileResult {
  entry: ZipEntry | null;
  progress: FileProgress | null;
}

/**
 * Yields downloaded files in document order while keeping up to
 * DOWNLOAD_CONCURRENCY fetches in flight, so the ZIP stream consumes each
 * file as soon as it (and everything before it) is ready. Failed files are
 * marked in the progress map and skipped rather than aborting the archive;
 * if any failed (or kept their original because no text could be extracted),
 * a plain-text report is appended as the last entry.
 */
async function* zipEntries(
  docs: DocumentItem[],
  part: number,
  zipName: string,
  run: PendingRun,
  updateFile: (docId: number, update: Partial<FileProgress>) => void,
  signal: AbortSignal,
  report: PartReport,
  onReportIncluded: () => void
): AsyncGenerator<ZipEntry> {
  const usedPaths = new Set<string>();
  const inFlight: Promise<FileResult>[] = [];
  let next = 0;

  while (next < docs.length || inFlight.length > 0) {
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");

    while (inFlight.length < DOWNLOAD_CONCURRENCY && next < docs.length) {
      inFlight.push(downloadSingleFile(docs[next++], part, run, usedPaths, updateFile, signal));
    }

    const { entry, progress } = await inFlight.shift()!;
    if (progress?.status === "error") report.failures.push(progress);
    if (progress?.outcome === "kept-original") report.keptOriginal.push(progress);
    if (entry) yield entry;
  }

  if (report.failures.length > 0 || report.keptOriginal.length > 0) {
    onReportIncluded();
    yield {
      name: archivePath([], REPORT_FILENAME, usedPaths),
      input: buildPartReport(run, zipName, docs.length, report),
    };
  }
}

async function downloadSingleFile(
  doc: DocumentItem,
  part: number,
  run: PendingRun,
  usedPaths: Set<string>,
  updateFile: (docId: number, update: Partial<FileProgress>) => void,
  signal: AbortSignal
): Promise<FileResult> {
  updateFile(doc.documentId, { status: "downloading" });
  const folderParts = folderPathParts(doc.folderId, run.folderFlatMap);
  const base: FileProgress = {
    documentId: doc.documentId,
    filename: doc.filename,
    folderPath: folderParts.join("/"),
    status: "pending",
    convertible: isConvertible(doc.filename),
    part,
  };

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      let blob = await downloadFileViaProxy(doc.documentId, signal);
      let filename = doc.filename;
      let outcome: FileOutcome | undefined;

      // Replace convertible documents (PDF, Word, text, CSV, …) with their
      // extracted Markdown. Files with no usable text (scanned PDFs, corrupt
      // or encrypted documents) keep the original file instead.
      if (run.convertToMd && base.convertible) {
        const markdown = await convertToMarkdown(blob, doc.filename);
        if (markdown != null) {
          blob = new Blob([markdown], { type: "text/markdown" });
          filename = markdownFilename(doc.filename);
          outcome = "converted";
        } else {
          outcome = "kept-original";
        }
      }

      const zipPath = archivePath(folderParts, filename, usedPaths);
      const done: FileProgress = { ...base, status: "complete", zipPath, outcome };
      updateFile(doc.documentId, { status: "complete", zipPath, outcome });
      return { entry: { name: zipPath, input: blob }, progress: done };
    } catch (err) {
      // On cancel, stop quietly — don't retry or flag the file as failed.
      if (signal.aborted) return { entry: null, progress: null };
      if (attempt < MAX_RETRIES && isRetryable(err)) {
        await new Promise((r) => setTimeout(r, retryDelay(err, attempt)));
        continue;
      }
      const message = err instanceof Error ? err.message : "Download failed";
      const failed: FileProgress = { ...base, status: "error", error: message };
      updateFile(doc.documentId, { status: "error", error: message });
      return { entry: null, progress: failed };
    }
  }

  return { entry: null, progress: null };
}

/* ------------------------------------------------------------- reports */

function fullPath(f: FileProgress): string {
  return f.folderPath ? `${f.folderPath}/${f.filename}` : f.filename;
}

/** Report written inside one archive when some of its files failed or kept their original. */
function buildPartReport(
  run: PendingRun,
  zipName: string,
  total: number,
  report: PartReport
): string {
  const { failures, keptOriginal } = report;
  const lines: string[] = [
    `Filevine project ${run.projectId} — download report`,
    `Archive: ${zipName}`,
    `Generated: ${new Date().toLocaleString()}`,
    "",
    `${total - failures.length} of ${total} files were saved to this archive.`,
  ];

  if (failures.length > 0) {
    lines.push(
      "",
      `NOT DOWNLOADED (${failures.length})`,
      `These files could not be retrieved after ${MAX_RETRIES} attempts and are missing from the archive.`,
      `Use "Retry failed files" in the downloader to fetch them into a second archive.`,
      ""
    );
    for (const f of failures) {
      lines.push(`  ${fullPath(f)}`, `      Document ID ${f.documentId} — ${f.error ?? "Download failed"}`);
    }
  }

  if (keptOriginal.length > 0) {
    lines.push(
      "",
      `KEPT AS ORIGINAL (${keptOriginal.length})`,
      "Markdown conversion was on, but no text could be extracted from these files",
      "(typically scanned PDFs without OCR, or encrypted documents). The original file was saved instead.",
      ""
    );
    for (const f of keptOriginal) {
      lines.push(`  ${f.zipPath ?? f.filename}`);
    }
  }

  return lines.join("\n") + "\n";
}

/** Folder-level summary written next to the parts of a split run. */
function buildRunReport(
  run: PendingRun,
  folderName: string,
  parts: PartProgress[],
  partReports: PartReport[],
  files: Map<number, FileProgress>
): string {
  const { completedFiles, failedFiles } = tally(files);
  const total = run.docs.length;
  let converted = 0;
  let kept = 0;
  for (const f of files.values()) {
    if (f.outcome === "converted") converted++;
    if (f.outcome === "kept-original") kept++;
  }

  const lines: string[] = [
    `Filevine project ${run.projectId} — download report`,
    `Folder: ${folderName}`,
    `Generated: ${new Date().toLocaleString()}`,
    "",
    `${completedFiles.toLocaleString()} of ${total.toLocaleString()} files were saved across ${parts.length} ZIP files.`,
  ];
  if (run.convertToMd) {
    lines.push(
      `Markdown conversion was on: ${converted.toLocaleString()} converted` +
        (kept > 0 ? `, ${kept.toLocaleString()} kept as original (no text to extract)` : "") +
        "."
    );
  }

  lines.push("", `ARCHIVES (${parts.length})`);
  for (const part of parts) {
    const partFiles = [...files.values()].filter((f) => f.part === part.index);
    const folders = new Set(partFiles.map((f) => f.folderPath || "(project root)"));
    const first = [...folders][0] ?? "";
    const last = [...folders][folders.size - 1] ?? "";
    const range = folders.size <= 1 ? first : `${first}  …  ${last}`;
    const failed = partReports[part.index - 1]?.failures.length ?? 0;
    lines.push(
      `  ${part.zipName}`,
      `      ${part.fileCount.toLocaleString()} files` +
        (failed > 0 ? `, ${failed.toLocaleString()} missing` : "") +
        (range ? ` — ${range}` : "")
    );
  }

  const failures = partReports.flatMap((r) => r.failures);
  if (failures.length > 0) {
    lines.push(
      "",
      `NOT DOWNLOADED (${failedFiles.toLocaleString()})`,
      `These files could not be retrieved after ${MAX_RETRIES} attempts and are missing from the archives.`,
      `Use "Retry failed files" in the downloader to fetch them into a separate archive.`,
      ""
    );
    for (const f of failures) {
      lines.push(
        `  ${fullPath(f)}`,
        `      Document ID ${f.documentId} — part ${f.part} — ${f.error ?? "Download failed"}`
      );
    }
  }

  return lines.join("\n") + "\n";
}
