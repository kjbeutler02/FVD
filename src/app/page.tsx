"use client";

import { useState, useCallback, useEffect } from "react";
import { Loader2 } from "lucide-react";
import Header from "@/components/Header";
import Wordmark from "@/components/Wordmark";
import ProjectInput from "@/components/ProjectInput";
import DriveView from "@/components/DriveView";
import ProgressPanel from "@/components/ProgressPanel";
import PassphraseGate from "@/components/PassphraseGate";
import { useDownloadOrchestrator } from "@/hooks/useDownloadOrchestrator";
import { fetchFolders, type FolderResponse } from "@/lib/api";
import type { FolderNode } from "@/types/filevine";

export default function Home() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [projectId, setProjectId] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Folder data
  const [folderTree, setFolderTree] = useState<FolderNode[]>([]);
  const [folderFlatMap, setFolderFlatMap] = useState<FolderResponse["flatMap"]>({});

  const { progress, startDownload, cancel, reset } = useDownloadOrchestrator();

  // Check if already authenticated (cookie exists) on mount
  useEffect(() => {
    fetch("/api/auth", { method: "POST" })
      .then((res) => setAuthenticated(res.status !== 401))
      .catch(() => setAuthenticated(false));
  }, []);

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
    (selectedFolderIds: Set<number> | null) => {
      if (!projectId) return;
      startDownload(folderFlatMap, selectedFolderIds, projectId);
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

  const handleSignOut = useCallback(() => {
    reset();
    setProjectId(null);
    setFolderTree([]);
    setFolderFlatMap({});
    setError(null);
    setAuthenticated(false);
  }, [reset]);

  // Checking auth — branded splash
  if (authenticated === null) {
    return (
      <div className="flex h-dvh flex-col items-center justify-center gap-6 bg-canvas">
        <Wordmark variant="on-light" size="lg" />
        <Loader2 size={22} className="animate-spin text-brand" />
      </div>
    );
  }

  if (!authenticated) {
    return <PassphraseGate onAuthenticated={() => setAuthenticated(true)} />;
  }

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-canvas">
      <Header onSignOut={handleSignOut} />

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
