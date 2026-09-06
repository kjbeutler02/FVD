import type { DocumentItem } from "./filevine";

export type FileStatus = "pending" | "downloading" | "complete" | "error";

/** What happened to a file when the Markdown conversion option was on. */
export type FileOutcome =
  | "converted" // replaced by extracted Markdown
  | "kept-original"; // convertible type, but no usable text (scanned/encrypted)

export interface DownloadSelection {
  /** Folders whose entire contents are included; null means the whole project. */
  folderIds: Set<number> | null;
  /** Individually selected documents in folders that are not fully selected. */
  extraDocs: DocumentItem[];
  /** Individually deselected documents inside selected folders. */
  excludedDocIds: Set<number>;
  /** Convert each supported document (PDF, Word, text, …) to .md in the ZIP. */
  convertToMd: boolean;
}

export interface FileProgress {
  documentId: number;
  filename: string;
  /** Human-readable folder path ("" for documents outside any known folder). */
  folderPath: string;
  status: FileStatus;
  /** Whether this file will be converted to Markdown if conversion is on. */
  convertible: boolean;
  /** Final path inside the archive once the file has been written. */
  zipPath?: string;
  outcome?: FileOutcome;
  error?: string;
}

export type DownloadPhase =
  | "idle"
  | "scanning" // building the document list
  | "review" // list is ready; waiting for the user to confirm and pick a save location
  | "downloading"
  | "zipping" // in-memory fallback only: finalizing the Blob
  | "complete"
  | "error";

export interface DownloadProgress {
  phase: DownloadPhase;
  totalFiles: number;
  completedFiles: number;
  failedFiles: number;
  /** Files being fetched right now (bounded by the concurrency limit). */
  activeFiles: string[];
  files: Map<number, FileProgress>;
  /** Documents the user deselected individually and that were dropped from the list. */
  excludedCount: number;
  /** Whether the run converts documents to Markdown. */
  convertToMd: boolean;
  /** True for a follow-up run that retries only previously failed files. */
  isRetry: boolean;
  /** Name of the archive being written (or written). */
  zipName?: string;
  /** Whether a failure report was written into the archive. */
  reportIncluded: boolean;
  scanProgress?: number; // documents matching the selection so far during scanning
  scanTotal?: number; // total documents inspected so far (project-wide scan)
  scanFoldersDone?: number; // folders searched so far (folder-scoped scan)
  scanFoldersTotal?: number; // total selected folders to search (folder-scoped scan)
  errorMessage?: string;
}
