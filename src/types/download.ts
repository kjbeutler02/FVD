import type { DocumentItem } from "./filevine";

export type FileStatus = "pending" | "fetching-url" | "downloading" | "complete" | "error";

export interface DownloadSelection {
  /** Folders whose entire contents are included; null means the whole project. */
  folderIds: Set<number> | null;
  /** Individually selected documents in folders that are not fully selected. */
  extraDocs: DocumentItem[];
  /** Individually deselected documents inside selected folders. */
  excludedDocIds: Set<number>;
  /** Convert each PDF's text layer to a .md file in the ZIP. */
  convertPdfToMd: boolean;
}

export interface FileProgress {
  documentId: number;
  filename: string;
  folderPath: string;
  status: FileStatus;
  error?: string;
}

export interface DownloadProgress {
  totalFiles: number;
  completedFiles: number;
  failedFiles: number;
  currentFile: string | null;
  files: Map<number, FileProgress>;
  phase: "idle" | "scanning" | "downloading" | "zipping" | "complete" | "error";
  scanProgress?: number; // documents matching the selection so far during scanning
  scanTotal?: number; // total documents inspected so far (project-wide scan)
  scanFoldersDone?: number; // folders searched so far (folder-scoped scan)
  scanFoldersTotal?: number; // total selected folders to search (folder-scoped scan)
  errorMessage?: string;
}
