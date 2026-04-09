"use client";

import {
  CheckCircle2,
  XCircle,
  Loader2,
  Clock,
  Package,
  AlertTriangle,
  RotateCcw,
  ArrowLeft,
} from "lucide-react";
import type { DownloadProgress, FileProgress } from "@/types/download";

interface Props {
  progress: DownloadProgress;
  onCancel: () => void;
  onReset: () => void;
}

export default function ProgressPanel({ progress, onCancel, onReset }: Props) {
  const { totalFiles, completedFiles, failedFiles, phase, files, errorMessage, scanProgress } = progress;
  const percent = totalFiles > 0 ? Math.round((completedFiles / totalFiles) * 100) : 0;
  const isActive = phase === "scanning" || phase === "downloading" || phase === "zipping";

  // Sort files: downloading first, then pending, then complete, then error
  const sortedFiles = Array.from(files.values()).sort((a, b) => {
    const order = { downloading: 0, "fetching-url": 0, pending: 1, complete: 2, error: 3 };
    return order[a.status] - order[b.status];
  });

  return (
    <div className="mx-auto max-w-2xl">
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
        {/* Header */}
        <div className="p-6 border-b border-gray-200">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-900">
              {phase === "scanning" && "Scanning for Documents"}
              {phase === "downloading" && "Downloading Files"}
              {phase === "zipping" && "Creating ZIP Archive"}
              {phase === "complete" && "Download Complete"}
              {phase === "error" && "Download Failed"}
            </h2>
            {isActive && (
              <button
                onClick={onCancel}
                className="text-sm text-gray-500 hover:text-red-600 font-medium"
              >
                Cancel
              </button>
            )}
          </div>

          {/* Scanning phase */}
          {phase === "scanning" && (
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <Loader2 size={16} className="animate-spin text-blue-500" />
              <span>
                Scanning for documents... {scanProgress != null && scanProgress > 0 && `(${scanProgress} found so far)`}
              </span>
            </div>
          )}

          {/* Progress bar (downloading / zipping / complete / error) */}
          {phase !== "scanning" && (
            <>
              <div className="w-full h-3 bg-gray-100 rounded-full overflow-hidden mb-2">
                <div
                  className={`h-full rounded-full transition-all duration-300 ${
                    phase === "error"
                      ? "bg-red-500"
                      : phase === "complete"
                      ? "bg-green-500"
                      : "bg-blue-600"
                  }`}
                  style={{
                    width: phase === "zipping" ? "100%" : `${percent}%`,
                  }}
                />
              </div>

              {/* Stats row */}
              <div className="flex items-center justify-between text-sm text-gray-500">
                <span>
                  {phase === "zipping" ? (
                    <span className="flex items-center gap-1">
                      <Package size={14} className="animate-pulse" />
                      Generating ZIP file...
                    </span>
                  ) : (
                    `${completedFiles} of ${totalFiles} files`
                  )}
                </span>
                {failedFiles > 0 && (
                  <span className="text-red-500 flex items-center gap-1">
                    <AlertTriangle size={14} />
                    {failedFiles} failed
                  </span>
                )}
                {phase === "downloading" && <span>{percent}%</span>}
              </div>
            </>
          )}
        </div>

        {/* Error message */}
        {phase === "error" && errorMessage && (
          <div className="p-4 bg-red-50 border-b border-red-200">
            <p className="text-sm text-red-700">{errorMessage}</p>
          </div>
        )}

        {/* Completion message */}
        {phase === "complete" && (
          <div className="p-4 bg-green-50 border-b border-green-200">
            <div className="flex items-center gap-2">
              <CheckCircle2 size={18} className="text-green-600" />
              <p className="text-sm text-green-700">
                Successfully downloaded {completedFiles} files.
                {failedFiles > 0 && ` ${failedFiles} files failed.`}
                {" "}Your ZIP file should be downloading now.
              </p>
            </div>
          </div>
        )}

        {/* File list */}
        <div className="max-h-80 overflow-y-auto divide-y divide-gray-100">
          {sortedFiles.map((file) => (
            <FileRow key={file.documentId} file={file} />
          ))}
        </div>

        {/* Footer */}
        {(phase === "complete" || phase === "error") && (
          <div className="p-4 border-t border-gray-200">
            <button
              onClick={onReset}
              className="flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-300 text-gray-700 font-medium text-sm hover:bg-gray-50 transition-colors"
            >
              <ArrowLeft size={16} />
              Download Another Project
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function FileRow({ file }: { file: FileProgress }) {
  return (
    <div className="flex items-center gap-3 px-6 py-2.5">
      <StatusIcon status={file.status} />
      <div className="flex-1 min-w-0">
        <p className="text-sm text-gray-800 truncate">{file.filename}</p>
        {file.folderPath && (
          <p className="text-xs text-gray-400 truncate">{file.folderPath}</p>
        )}
        {file.error && (
          <p className="text-xs text-red-500 truncate">{file.error}</p>
        )}
      </div>
    </div>
  );
}

function StatusIcon({ status }: { status: FileProgress["status"] }) {
  switch (status) {
    case "complete":
      return <CheckCircle2 size={16} className="text-green-500 shrink-0" />;
    case "error":
      return <XCircle size={16} className="text-red-500 shrink-0" />;
    case "downloading":
    case "fetching-url":
      return <Loader2 size={16} className="text-blue-500 shrink-0 animate-spin" />;
    case "pending":
      return <Clock size={16} className="text-gray-300 shrink-0" />;
  }
}
