"use client";

import { useState, useCallback, useRef } from "react";
import Header from "@/components/Header";
import ProjectInput from "@/components/ProjectInput";
import DriveView, { type DriveViewHandle } from "@/components/DriveView";
import ProgressPanel from "@/components/ProgressPanel";
import UploadPanel from "@/components/UploadPanel";
import WatchBar from "@/components/WatchBar";
import { useDownloadOrchestrator } from "@/hooks/useDownloadOrchestrator";
import { useUploadOrchestrator } from "@/hooks/useUploadOrchestrator";
import { fetchFolders, type FolderResponse } from "@/lib/api";
import type { FolderNode } from "@/types/filevine";
import type { DownloadSelection } from "@/types/download";
import type { LocalFile, UploadDestination } from "@/types/upload";

export default function HomeClient() {
  const [projectId, setProjectId] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Folder data
  const [folderTree, setFolderTree] = useState<FolderNode[]>([]);
  const [folderFlatMap, setFolderFlatMap] = useState<FolderResponse["flatMap"]>({});
  const [rootFolderId, setRootFolderId] = useState<number | null>(null);
  const driveRef = useRef<DriveViewHandle>(null);

  const {
    progress,
    startDownload,
    confirmDownload,
    resumeDownload,
    retryFailed,
    cancel,
    reset,
  } = useDownloadOrchestrator();

  const loadFolders = useCallback(async (pid: number) => {
    const data = await fetchFolders(pid);
    setFolderTree(data.tree);
    setFolderFlatMap(data.flatMap);
    setRootFolderId(data.rootFolderId);
  }, []);

  const uploader = useUploadOrchestrator({
    folderFlatMap,
    // New Filevine folders: refresh the tree so they show up and can be browsed.
    onFoldersCreated: () => {
      if (projectId != null) void loadFolders(projectId).catch(() => {});
    },
    // Uploaded documents: refresh the listings of the folders that received them.
    onFilesUploaded: (folderIds) => driveRef.current?.invalidateFolders(folderIds),
  });

  const handleProjectSubmit = useCallback(
    async (pid: number) => {
      setLoading(true);
      setError(null);
      setProjectId(pid);
      try {
        await loadFolders(pid);
      } catch (err) {
        setProjectId(null);
        setError(err instanceof Error ? err.message : "Failed to load project");
      } finally {
        setLoading(false);
      }
    },
    [loadFolders]
  );

  const handleDownload = useCallback(
    (selection: DownloadSelection) => {
      if (!projectId) return;
      startDownload(folderFlatMap, selection, projectId);
    },
    [projectId, folderFlatMap, startDownload]
  );

  const handleUpload = useCallback(
    (destination: UploadDestination, files: LocalFile[]) => {
      uploader.beginBatch(destination, files);
    },
    [uploader]
  );

  const handleStartWatch = useCallback(() => {
    const dest = uploader.progress.destination;
    if (!dest) return;
    void uploader.startWatch(dest).then((started) => {
      if (started) uploader.discardBatch(); // the batch review gives way to the watch view
    });
  }, [uploader]);

  // Close the progress drawer but stay in the current project.
  const handleCloseDrawer = useCallback(() => reset(), [reset]);

  // Return to the project-entry screen.
  const handleNewProject = useCallback(() => {
    reset();
    setProjectId(null);
    setFolderTree([]);
    setFolderFlatMap({});
    setRootFolderId(null);
    setError(null);
  }, [reset]);

  const showUploadPanel =
    uploader.panelOpen && (uploader.progress.phase !== "idle" || uploader.watch?.active);

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-canvas">
      <Header />
      <WatchBar
        watch={uploader.watch}
        savedWatch={uploader.savedWatch}
        onOpen={uploader.openPanel}
        onStop={() => uploader.stopWatch(true)}
        onResume={() => void uploader.resumeWatch()}
        onDismissSaved={uploader.dismissSavedWatch}
      />

      {projectId == null ? (
        <main className="flex-1 overflow-y-auto">
          <ProjectInput
            onSubmit={handleProjectSubmit}
            loading={loading}
            error={error}
          />
        </main>
      ) : (
        <main className="flex min-h-0 flex-1 flex-col">
          <DriveView
            tree={folderTree}
            projectId={projectId}
            rootFolderId={rootFolderId}
            onDownload={handleDownload}
            onUpload={handleUpload}
            ref={driveRef}
          />
        </main>
      )}

      {progress.phase !== "idle" && (
        <ProgressPanel
          progress={progress}
          onCancel={cancel}
          onConfirm={confirmDownload}
          onResume={resumeDownload}
          onRetryFailed={retryFailed}
          onClose={handleCloseDrawer}
          onNewProject={handleNewProject}
        />
      )}

      {showUploadPanel && (
        <UploadPanel
          progress={uploader.progress}
          watch={uploader.watch}
          canWatch={uploader.canWatch}
          onAddFiles={uploader.addFiles}
          onRemoveFile={uploader.removeFile}
          onToggleDuplicates={uploader.setUploadDuplicates}
          onConfirm={uploader.confirmBatch}
          onRetryFailed={uploader.retryFailed}
          onCancel={uploader.cancelBatch}
          onClose={uploader.closePanel}
          onStartWatch={handleStartWatch}
          onStopWatch={() => uploader.stopWatch(true)}
        />
      )}
    </div>
  );
}
