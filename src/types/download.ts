export type FileStatus = "pending" | "fetching-url" | "downloading" | "complete" | "error";

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
  phase: "idle" | "downloading" | "zipping" | "complete" | "error";
  errorMessage?: string;
}
