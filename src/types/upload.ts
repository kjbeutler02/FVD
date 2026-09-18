/** A file chosen from the user's machine, with its path relative to what they picked. */
export interface LocalFile {
  /** Stable id within a batch. */
  id: string;
  file: File;
  name: string;
  size: number;
  lastModified: number;
  /** Folder components under the picked folder (empty for a loose file). */
  relDir: string[];
  /** Present when the file came from a directory handle (watch mode), so it can be moved after upload. */
  handle?: FileSystemFileHandle;
  parentHandle?: FileSystemDirectoryHandle;
}

/** Where a batch goes in Filevine. */
export interface UploadDestination {
  projectId: number;
  /** Filevine folder the picked files/folders are placed in. */
  folderId: number;
  /** Human-readable path of that folder ("" for the project root). */
  folderPath: string;
}

export type UploadFileStatus =
  | "pending"
  | "skipped" // duplicate already in Filevine
  | "preparing" // creating folders / requesting the upload slot
  | "uploading"
  | "committing"
  | "complete"
  | "error";

export interface UploadFileProgress {
  id: string;
  name: string;
  size: number;
  relDir: string[];
  /** Filevine folder path the file lands in (destination + relDir). */
  targetPath: string;
  status: UploadFileStatus;
  /** 0..1 while uploading. */
  fraction: number;
  /** Set when the file duplicates one already in the target folder. */
  duplicate?: "identical" | "same-name";
  documentId?: number;
  error?: string;
  attempts: number;
}

export type UploadPhase = "idle" | "review" | "uploading" | "complete" | "error";

export interface UploadProgress {
  phase: UploadPhase;
  destination: UploadDestination | null;
  files: Map<string, UploadFileProgress>;
  totalFiles: number;
  totalBytes: number;
  uploadedBytes: number;
  completedFiles: number;
  failedFiles: number;
  skippedFiles: number;
  /** Files currently in flight (names). */
  activeFiles: string[];
  /** New Filevine folders this batch will create / has created (paths). */
  foldersToCreate: string[];
  /** Whether identical duplicates are uploaded anyway. */
  uploadDuplicates: boolean;
  /** Whether the duplicate check against Filevine is still running. */
  checkingDuplicates: boolean;
  /** Whether Filevine attributed the uploads to the signed-in user (vs. the shared credential). */
  attributed: boolean | null;
  errorMessage?: string;
}

/** A folder on this machine being watched for new files. */
export interface WatchState {
  active: boolean;
  folderName: string;
  destination: UploadDestination;
  /** Files noticed but waiting to be stable / queued. */
  waiting: number;
  /** Uploaded since watching began (this session). */
  uploaded: number;
  failed: number;
  /** Names in flight. */
  activeNames: string[];
  /** Per-file progress for everything the watcher has handled this session. */
  files: Map<string, UploadFileProgress>;
  lastScanAt: number | null;
  scanning: boolean;
  error?: string;
}
