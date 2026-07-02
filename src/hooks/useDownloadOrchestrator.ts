"use client";

import { useState, useCallback, useRef } from "react";
import { downloadZip } from "client-zip";
import { saveAs } from "file-saver";
import {
  downloadFileViaProxy,
  fetchAllDocuments,
  fetchDocumentsByFolders,
  buildFolderPath,
} from "@/lib/api";
import { DOWNLOAD_CONCURRENCY, MAX_RETRIES, FOLDER_SCOPED_MAX } from "@/lib/constants";
import type { DocumentItem } from "@/types/filevine";
import type { DownloadProgress, FileProgress } from "@/types/download";

// showSaveFilePicker is Chromium-only and not yet in lib.dom.
declare global {
  interface Window {
    showSaveFilePicker?: (options?: {
      suggestedName?: string;
      types?: { description?: string; accept: Record<string, string[]> }[];
    }) => Promise<FileSystemFileHandle>;
  }
}

function initialProgress(): DownloadProgress {
  return {
    totalFiles: 0,
    completedFiles: 0,
    failedFiles: 0,
    currentFile: null,
    files: new Map(),
    phase: "idle",
  };
}

export function useDownloadOrchestrator() {
  const [progress, setProgress] = useState<DownloadProgress>(initialProgress);
  const cancelledRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  const updateFile = useCallback(
    (docId: number, update: Partial<FileProgress>) => {
      setProgress((prev) => {
        const files = new Map(prev.files);
        const existing = files.get(docId);
        if (existing) {
          files.set(docId, { ...existing, ...update });
        }

        let completedFiles = 0;
        let failedFiles = 0;
        let currentFile: string | null = null;
        for (const f of files.values()) {
          if (f.status === "complete") completedFiles++;
          if (f.status === "error") failedFiles++;
          if (f.status === "downloading" || f.status === "fetching-url") {
            currentFile = f.filename;
          }
        }

        return { ...prev, files, completedFiles, failedFiles, currentFile };
      });
    },
    []
  );

  const startDownload = useCallback(
    async (
      folderFlatMap: Record<number, { name: string; parentId: number | null }>,
      selectedFolderIds: Set<number> | null,
      projectId: number
    ) => {
      cancelledRef.current = false;
      const controller = new AbortController();
      abortRef.current = controller;

      // Ask for the save location up front, while we still have the click's
      // user activation (the picker is blocked once the scan has been running
      // for a while). Streaming the ZIP to disk keeps memory flat no matter
      // how large the project is; browsers without the picker fall back to
      // an in-memory Blob save.
      const zipName = `filevine-project-${projectId}.zip`;
      let fileHandle: FileSystemFileHandle | null = null;
      if (window.showSaveFilePicker) {
        try {
          fileHandle = await window.showSaveFilePicker({
            suggestedName: zipName,
            types: [
              { description: "ZIP archive", accept: { "application/zip": [".zip"] } },
            ],
          });
        } catch (err) {
          // Picker dismissed — treat as cancel.
          if (err instanceof DOMException && err.name === "AbortError") {
            setProgress(initialProgress());
            return;
          }
          fileHandle = null; // blocked/unsupported — fall back to Blob save
        }
      }

      // A bounded, specific selection is fetched per-folder (server-scoped) so
      // we never touch unselected folders. "Select all" (null) and very large
      // selections fall back to a single project-wide scan.
      const useFolderScoped =
        selectedFolderIds != null &&
        selectedFolderIds.size > 0 &&
        selectedFolderIds.size <= FOLDER_SCOPED_MAX;

      // Phase 1: Scan for documents
      setProgress({
        ...initialProgress(),
        phase: "scanning",
        scanProgress: 0,
        ...(useFolderScoped
          ? { scanFoldersDone: 0, scanFoldersTotal: selectedFolderIds!.size }
          : { scanTotal: 0 }),
      });

      let filteredDocs: DocumentItem[];
      try {
        if (useFolderScoped) {
          filteredDocs = await fetchDocumentsByFolders(
            projectId,
            selectedFolderIds!,
            (found, done, total) => {
              setProgress((prev) => ({
                ...prev,
                scanProgress: found,
                scanFoldersDone: done,
                scanFoldersTotal: total,
              }));
            },
            controller.signal
          );
        } else {
          filteredDocs = await fetchAllDocuments(
            projectId,
            (matched, scanned) => {
              setProgress((prev) => ({ ...prev, scanProgress: matched, scanTotal: scanned }));
            },
            selectedFolderIds,
            controller.signal
          );
        }
      } catch (err) {
        // A cancel/abort is a normal outcome — return to idle, not an error.
        if (cancelledRef.current || (err instanceof DOMException && err.name === "AbortError")) {
          setProgress((prev) => ({ ...prev, phase: "idle" }));
          return;
        }
        setProgress((prev) => ({
          ...prev,
          phase: "error",
          errorMessage: err instanceof Error ? err.message : "Failed to fetch document list",
        }));
        return;
      }

      if (cancelledRef.current) {
        setProgress((prev) => ({ ...prev, phase: "idle" }));
        return;
      }

      if (filteredDocs.length === 0) {
        setProgress((prev) => ({
          ...prev,
          phase: "error",
          errorMessage: "No documents found in the selected folders.",
        }));
        return;
      }

      // Phase 2: Download files, streaming each into the ZIP as it completes.
      const files = new Map<number, FileProgress>();
      for (const doc of filteredDocs) {
        const folderPath = buildFolderPath(doc.folderId, folderFlatMap);
        files.set(doc.documentId, {
          documentId: doc.documentId,
          filename: doc.filename,
          folderPath,
          status: "pending",
        });
      }

      setProgress({
        totalFiles: filteredDocs.length,
        completedFiles: 0,
        failedFiles: 0,
        currentFile: null,
        files,
        phase: "downloading",
      });

      const entries = zipEntries(
        filteredDocs,
        folderFlatMap,
        updateFile,
        cancelledRef,
        controller.signal
      );
      const zipResponse = downloadZip(entries);

      try {
        if (fileHandle) {
          const writable = await fileHandle.createWritable();
          // pipeTo aborts the writable on cancel, discarding the partial file.
          await zipResponse.body!.pipeTo(writable, { signal: controller.signal });
        } else {
          setProgress((prev) => ({ ...prev, phase: "zipping", currentFile: null }));
          const blob = await zipResponse.blob();
          if (cancelledRef.current) {
            setProgress((prev) => ({ ...prev, phase: "idle" }));
            return;
          }
          saveAs(blob, zipName);
        }
        setProgress((prev) => ({ ...prev, phase: "complete", currentFile: null }));
      } catch (err) {
        if (cancelledRef.current || (err instanceof DOMException && err.name === "AbortError")) {
          setProgress((prev) => ({ ...prev, phase: "idle" }));
          return;
        }
        setProgress((prev) => ({
          ...prev,
          phase: "error",
          errorMessage:
            err instanceof Error ? err.message : "Failed to save ZIP file",
        }));
      }
    },
    [updateFile]
  );

  const cancel = useCallback(() => {
    cancelledRef.current = true;
    abortRef.current?.abort();
    // Surface the cancel immediately, even mid-scan before the loop unwinds.
    setProgress((prev) => ({ ...prev, phase: "idle" }));
  }, []);

  const reset = useCallback(() => {
    cancelledRef.current = false;
    abortRef.current?.abort();
    abortRef.current = null;
    setProgress(initialProgress());
  }, []);

  return { progress, startDownload, cancel, reset };
}

interface ZipEntry {
  name: string;
  input: Blob;
}

/**
 * Yields downloaded files in document order while keeping up to
 * DOWNLOAD_CONCURRENCY fetches in flight, so the ZIP stream consumes each
 * file as soon as it (and everything before it) is ready. Failed files are
 * marked in the progress map and skipped rather than aborting the archive.
 */
async function* zipEntries(
  docs: DocumentItem[],
  folderFlatMap: Record<number, { name: string; parentId: number | null }>,
  updateFile: (docId: number, update: Partial<FileProgress>) => void,
  cancelledRef: React.RefObject<boolean>,
  signal: AbortSignal
): AsyncGenerator<ZipEntry> {
  const usedPaths = new Set<string>();
  const inFlight: Promise<ZipEntry | null>[] = [];
  let next = 0;

  while (next < docs.length || inFlight.length > 0) {
    if (cancelledRef.current || signal.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }

    while (inFlight.length < DOWNLOAD_CONCURRENCY && next < docs.length) {
      inFlight.push(
        downloadSingleFile(docs[next++], folderFlatMap, usedPaths, updateFile, signal)
      );
    }

    const entry = await inFlight.shift()!;
    if (entry) yield entry;
  }
}

async function downloadSingleFile(
  doc: DocumentItem,
  folderFlatMap: Record<number, { name: string; parentId: number | null }>,
  usedPaths: Set<string>,
  updateFile: (docId: number, update: Partial<FileProgress>) => void,
  signal: AbortSignal
): Promise<ZipEntry | null> {
  updateFile(doc.documentId, { status: "downloading" });

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const blob = await downloadFileViaProxy(doc.documentId, signal);
      const folderPath = buildFolderPath(doc.folderId, folderFlatMap);
      const zipPath = uniquePath(
        folderPath ? `${folderPath}/${doc.filename}` : doc.filename,
        usedPaths
      );

      updateFile(doc.documentId, { status: "complete" });
      return { name: zipPath, input: blob };
    } catch (err) {
      // On cancel, stop quietly — don't retry or flag the file as failed.
      if (signal.aborted) return null;
      if (attempt < MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, 2 ** attempt * 1000));
      } else {
        updateFile(doc.documentId, {
          status: "error",
          error: err instanceof Error ? err.message : "Download failed",
        });
      }
    }
  }

  return null;
}

/**
 * Duplicate filenames in the same folder would collide in the archive
 * (previously JSZip silently overwrote them) — suffix repeats instead.
 */
function uniquePath(path: string, usedPaths: Set<string>): string {
  if (!usedPaths.has(path)) {
    usedPaths.add(path);
    return path;
  }
  const dot = path.lastIndexOf(".");
  const stem = dot > 0 ? path.slice(0, dot) : path;
  const ext = dot > 0 ? path.slice(dot) : "";
  for (let n = 2; ; n++) {
    const candidate = `${stem} (${n})${ext}`;
    if (!usedPaths.has(candidate)) {
      usedPaths.add(candidate);
      return candidate;
    }
  }
}
