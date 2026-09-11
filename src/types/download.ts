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
  /** 1-based index of the ZIP part this file belongs to. */
  part: number;
  /** Final path inside the archive once the file has been written. */
  zipPath?: string;
  outcome?: FileOutcome;
  error?: string;
}

export type PartStatus = "pending" | "writing" | "complete" | "error";

/** One ZIP file of a run. Single-ZIP runs have exactly one part. */
export interface PartProgress {
  /** 1-based. */
  index: number;
  zipName: string;
  fileCount: number;
  status: PartStatus;
}

/**
 * Where the archive(s) go. "file": one ZIP via the save-file picker.
 * "directory": several ZIPs written into a folder the user picked.
 * "blob": browsers without the File System Access API; each ZIP is built in
 * memory and handed to the browser's normal download.
 */
export type SaveMode = "file" | "directory" | "blob";

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
  /** Name of the archive being written (single-ZIP runs) or the base name (split runs). */
  zipName?: string;
  /** The ZIP file(s) this run writes, in order. */
  parts: PartProgress[];
  /** 1-based index of the part currently being written. */
  currentPart?: number;
  /** How the archive(s) are being saved; known once the user has confirmed. */
  saveMode?: SaveMode;
  /** Name of the folder the parts are written into (directory mode). */
  saveFolder?: string;
  /**
   * After a failure in a split run: parts before `currentPart` are safely on
   * disk and the run can pick up again from the failed part.
   */
  canResume: boolean;
  /** Whether a failure report was written into an archive. */
  reportIncluded: boolean;
  scanProgress?: number; // documents matching the selection so far during scanning
  scanTotal?: number; // total documents inspected so far (project-wide scan)
  scanFoldersDone?: number; // folders searched so far (folder-scoped scan)
  scanFoldersTotal?: number; // total selected folders to search (folder-scoped scan)
  errorMessage?: string;
}
