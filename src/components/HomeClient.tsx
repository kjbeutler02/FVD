"use client";

import { useState, useCallback } from "react";
import Header from "@/components/Header";
import ProjectInput from "@/components/ProjectInput";
import DriveView from "@/components/DriveView";
import ProgressPanel from "@/components/ProgressPanel";
import { useDownloadOrchestrator } from "@/hooks/useDownloadOrchestrator";
import { fetchFolders, type FolderResponse } from "@/lib/api";
import type { FolderNode } from "@/types/filevine";
import type { DownloadSelection } from "@/types/download";

export default function HomeClient() {
  const [projectId, setProjectId] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Folder data
  const [folderTree, setFolderTree] = useState<FolderNode[]>([]);
  const [folderFlatMap, setFolderFlatMap] = useState<FolderResponse["flatMap"]>({});

  const { progress, startDownload, cancel, reset } = useDownloadOrchestrator();

  const handleProjectSubmit = useCallback(async (pid: number) => {
    setLoading(true);
    setError(null);
    setProjectId(pid);

    try {
      const data = await fetchFolders(pid);
      setFolderTree(data.tree);
      setFolderFlatMap(data.flatMap);
    } catch (err) {
      setProjectId(null);
      setError(err instanceof Error ? err.message : "Failed to load project");
    } finally {
      setLoading(false);
    }
  }, []);

  const handleDownload = useCallback(
    (selection: DownloadSelection) => {
      if (!projectId) return;
      startDownload(folderFlatMap, selection, projectId);
    },
    [projectId, folderFlatMap, startDownload]
  );

  // Close the progress drawer but stay in the current project.
  const handleCloseDrawer = useCallback(() => reset(), [reset]);

  // Return to the project-entry screen.
  const handleNewProject = useCallback(() => {
    reset();
    setProjectId(null);
    setFolderTree([]);
    setFolderFlatMap({});
    setError(null);
  }, [reset]);

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-canvas">
      <Header />

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
            onDownload={handleDownload}
          />
        </main>
      )}

      {progress.phase !== "idle" && (
        <ProgressPanel
          progress={progress}
          onCancel={cancel}
          onClose={handleCloseDrawer}
          onNewProject={handleNewProject}
        />
      )}
    </div>
  );
}
