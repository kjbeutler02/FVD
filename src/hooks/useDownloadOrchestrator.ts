"use client";

import { useState, useCallback, useRef } from "react";
import JSZip from "jszip";
import { saveAs } from "file-saver";
import { downloadFileViaProxy, buildFolderPath } from "@/lib/api";
import { DOWNLOAD_CONCURRENCY, MAX_RETRIES } from "@/lib/constants";
import type { DocumentItem } from "@/types/filevine";
import type { DownloadProgress, FileProgress } from "@/types/download";

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
      documents: DocumentItem[],
      folderFlatMap: Record<number, { name: string; parentId: number | null }>,
      selectedFolderIds: Set<number> | null,
      projectId: number
    ) => {
      cancelledRef.current = false;

      // Filter documents by selected folders
      const filteredDocs = selectedFolderIds
        ? documents.filter((d) => selectedFolderIds.has(d.folderId))
        : documents;

      // Initialize progress
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

      const zip = new JSZip();

      // Download all files with concurrency limit, proxied through our API
      await downloadWithConcurrency(
        filteredDocs,
        folderFlatMap,
        zip,
        updateFile,
        cancelledRef
      );

      if (cancelledRef.current) {
        setProgress((prev) => ({ ...prev, phase: "idle" }));
        return;
      }

      // Generate ZIP
      setProgress((prev) => ({ ...prev, phase: "zipping", currentFile: null }));

      try {
        const blob = await zip.generateAsync({ type: "blob" });
        saveAs(blob, `filevine-project-${projectId}.zip`);
        setProgress((prev) => ({ ...prev, phase: "complete" }));
      } catch (err) {
        setProgress((prev) => ({
          ...prev,
          phase: "error",
          errorMessage:
            err instanceof Error ? err.message : "Failed to generate ZIP file",
        }));
      }
    },
    [updateFile]
  );

  const cancel = useCallback(() => {
    cancelledRef.current = true;
  }, []);

  const reset = useCallback(() => {
    cancelledRef.current = false;
    setProgress(initialProgress());
  }, []);

  return { progress, startDownload, cancel, reset };
}

async function downloadWithConcurrency(
  docs: DocumentItem[],
  folderFlatMap: Record<number, { name: string; parentId: number | null }>,
  zip: JSZip,
  updateFile: (docId: number, update: Partial<FileProgress>) => void,
  cancelledRef: React.RefObject<boolean>
) {
  let active = 0;
  let index = 0;

  return new Promise<void>((resolve) => {
    function next() {
      if (cancelledRef.current) {
        if (active === 0) resolve();
        return;
      }

      while (active < DOWNLOAD_CONCURRENCY && index < docs.length) {
        const doc = docs[index++];
        active++;
        downloadSingleFile(doc, folderFlatMap, zip, updateFile).finally(() => {
          active--;
          if (index >= docs.length && active === 0) {
            resolve();
          } else {
            next();
          }
        });
      }

      if (index >= docs.length && active === 0) {
        resolve();
      }
    }

    next();
  });
}

async function downloadSingleFile(
  doc: DocumentItem,
  folderFlatMap: Record<number, { name: string; parentId: number | null }>,
  zip: JSZip,
  updateFile: (docId: number, update: Partial<FileProgress>) => void
) {
  updateFile(doc.documentId, { status: "downloading" });

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      // Download via our server-side proxy (bypasses S3 CORS)
      const arrayBuffer = await downloadFileViaProxy(doc.documentId);
      const folderPath = buildFolderPath(doc.folderId, folderFlatMap);
      const zipPath = folderPath ? `${folderPath}/${doc.filename}` : doc.filename;

      zip.file(zipPath, arrayBuffer);
      updateFile(doc.documentId, { status: "complete" });
      return;
    } catch (err) {
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
}
