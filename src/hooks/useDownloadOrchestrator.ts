"use client";

import { useState, useCallback, useRef } from "react";
import { downloadZip } from "client-zip";
import { saveAs } from "file-saver";
import {
  downloadFileViaProxy,
  fetchAllDocuments,
  fetchDocumentsByFolders,
  isRetryable,
  retryDelay,
} from "@/lib/api";
import { archivePath, displayFolderPath, folderPathParts } from "@/lib/zipPath";
import {
  DOWNLOAD_CONCURRENCY,
  MAX_RETRIES,
  FOLDER_SCOPED_MAX,
  REPORT_FILENAME,
} from "@/lib/constants";
import { convertToMarkdown, isConvertible, markdownFilename } from "@/lib/toMarkdown";
import type { DocumentItem } from "@/types/filevine";
import type {
  DownloadProgress,
  DownloadSelection,
  FileOutcome,
  FileProgress,
} from "@/types/download";

// showSaveFilePicker is Chromium-only and not yet in lib.dom.
declare global {
  interface Window {
    showSaveFilePicker?: (options?: {
      suggestedName?: string;
      types?: { description?: string; accept: Record<string, string[]> }[];
    }) => Promise<FileSystemFileHandle>;
  }
}

type FolderFlatMap = Record<number, { name: string; parentId: number | null }>;

/** Everything a confirmed run needs; captured at review time. */
interface PendingRun {
  docs: DocumentItem[];
  folderFlatMap: FolderFlatMap;
  projectId: number;
  convertToMd: boolean;
  zipName: string;
  isRetry: boolean;
  excludedCount: number;
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
    reportIncluded: false,
  };
}

function isAbort(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
}

function buildFileMap(docs: DocumentItem[], flatMap: FolderFlatMap): Map<number, FileProgress> {
  const files = new Map<number, FileProgress>();
  for (const doc of docs) {
    files.set(doc.documentId, {
      documentId: doc.documentId,
      filename: doc.filename,
      folderPath: displayFolderPath(doc.folderId, flatMap),
      status: "pending",
      convertible: isConvertible(doc.filename),
    });
  }
  return files;
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

      // Stable, predictable archive order: by folder path, then filename.
      const pathOf = new Map<number, string>();
      for (const d of docs) {
        if (!pathOf.has(d.folderId)) pathOf.set(d.folderId, displayFolderPath(d.folderId, folderFlatMap));
      }
      docs.sort(
        (a, b) =>
          pathOf.get(a.folderId)!.localeCompare(pathOf.get(b.folderId)!) ||
          a.filename.localeCompare(b.filename)
      );

      pendingRef.current = {
        docs,
        folderFlatMap,
        projectId,
        convertToMd,
        zipName: `filevine-project-${projectId}.zip`,
        isRetry: false,
        excludedCount,
      };

      commit(runId, (prev) => ({
        ...prev,
        phase: "review",
        totalFiles: docs.length,
        files: buildFileMap(docs, folderFlatMap),
        excludedCount,
        zipName: pendingRef.current!.zipName,
      }));
    },
    [beginRun, commit]
  );

  /* --------------------------------------------------------- download */

  const runDownload = useCallback(
    async (run: PendingRun) => {
      const { runId, controller } = beginRun();

      // Ask for the save location first, while we still have the click's user
      // activation. Streaming the ZIP to disk keeps memory flat no matter how
      // large the project is; browsers without the picker fall back to an
      // in-memory Blob save.
      let fileHandle: FileSystemFileHandle | null = null;
      if (window.showSaveFilePicker) {
        try {
          fileHandle = await window.showSaveFilePicker({
            suggestedName: run.zipName,
            types: [{ description: "ZIP archive", accept: { "application/zip": [".zip"] } }],
          });
        } catch (err) {
          if (isAbort(err)) {
            // Picker dismissed — leave the drawer exactly as it was (review or
            // complete) so they can try again.
            pendingRef.current = run.isRetry ? null : run;
            return;
          }
          fileHandle = null; // blocked/unsupported — fall back to Blob save
        }
      }
      if (controller.signal.aborted) return;
      pendingRef.current = null;
      lastRunRef.current = run;

      const files = buildFileMap(run.docs, run.folderFlatMap);
      commit(runId, () => ({
        ...initialProgress(),
        phase: "downloading",
        totalFiles: run.docs.length,
        files,
        excludedCount: run.excludedCount,
        convertToMd: run.convertToMd,
        isRetry: run.isRetry,
        zipName: run.zipName,
      }));

      const updateFile = (docId: number, update: Partial<FileProgress>) => {
        commit(runId, (prev) => {
          const existing = prev.files.get(docId);
          if (!existing) return prev;
          const files = new Map(prev.files);
          files.set(docId, { ...existing, ...update });

          let completedFiles = 0;
          let failedFiles = 0;
          const activeFiles: string[] = [];
          for (const f of files.values()) {
            if (f.status === "complete") completedFiles++;
            else if (f.status === "error") failedFiles++;
            else if (f.status === "downloading") activeFiles.push(f.filename);
          }
          return { ...prev, files, completedFiles, failedFiles, activeFiles };
        });
      };

      const report = { failures: [] as FileProgress[], keptOriginal: [] as FileProgress[] };
      const entries = zipEntries(run, updateFile, controller.signal, report, () =>
        commit(runId, (prev) => ({ ...prev, reportIncluded: true }))
      );
      const zipResponse = downloadZip(entries);

      try {
        if (fileHandle) {
          const writable = await fileHandle.createWritable();
          // pipeTo aborts the writable on cancel, discarding the partial file.
          await zipResponse.body!.pipeTo(writable, { signal: controller.signal });
        } else {
          commit(runId, (prev) => ({ ...prev, phase: "zipping", activeFiles: [] }));
          const blob = await zipResponse.blob();
          if (controller.signal.aborted) {
            commit(runId, (prev) => ({ ...prev, phase: "idle" }));
            return;
          }
          saveAs(blob, run.zipName);
        }
        commit(runId, (prev) => ({ ...prev, phase: "complete", activeFiles: [] }));
      } catch (err) {
        if (controller.signal.aborted || isAbort(err)) {
          commit(runId, (prev) => ({ ...prev, phase: "idle" }));
          return;
        }
        commit(runId, (prev) => ({
          ...prev,
          phase: "error",
          activeFiles: [],
          errorMessage: err instanceof Error ? err.message : "Failed to save ZIP file",
        }));
      }
    },
    [beginRun, commit]
  );

  /** Confirm the reviewed list: choose a save location and start downloading. */
  const confirmDownload = useCallback(() => {
    const run = pendingRef.current;
    if (!run) return;
    void runDownload(run);
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
    abortRef.current?.abort();
    abortRef.current = null;
    setProgress(initialProgress());
  }, []);

  const reset = cancel;

  return { progress, startDownload, confirmDownload, retryFailed, cancel, reset };
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
  run: PendingRun,
  updateFile: (docId: number, update: Partial<FileProgress>) => void,
  signal: AbortSignal,
  report: { failures: FileProgress[]; keptOriginal: FileProgress[] },
  onReportIncluded: () => void
): AsyncGenerator<ZipEntry> {
  const usedPaths = new Set<string>();
  const inFlight: Promise<FileResult>[] = [];
  let next = 0;

  while (next < run.docs.length || inFlight.length > 0) {
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");

    while (inFlight.length < DOWNLOAD_CONCURRENCY && next < run.docs.length) {
      inFlight.push(downloadSingleFile(run.docs[next++], run, usedPaths, updateFile, signal));
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
      input: buildReport(run, report.failures, report.keptOriginal),
    };
  }
}

async function downloadSingleFile(
  doc: DocumentItem,
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

function buildReport(
  run: PendingRun,
  failures: FileProgress[],
  keptOriginal: FileProgress[]
): string {
  const total = run.docs.length;
  const lines: string[] = [
    `Filevine project ${run.projectId} — download report`,
    `Archive: ${run.zipName}`,
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
      const path = f.folderPath ? `${f.folderPath}/${f.filename}` : f.filename;
      lines.push(`  ${path}`, `      Document ID ${f.documentId} — ${f.error ?? "Download failed"}`);
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
