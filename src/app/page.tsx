"use client";

import { useState, useCallback } from "react";
import Header from "@/components/Header";
import StepIndicator from "@/components/StepIndicator";
import ProjectInput from "@/components/ProjectInput";
import FolderTree from "@/components/FolderTree";
import ProgressPanel from "@/components/ProgressPanel";
import { useDownloadOrchestrator } from "@/hooks/useDownloadOrchestrator";
import { fetchFolders, fetchAllDocuments, type FolderResponse } from "@/lib/api";
import type { FolderNode, DocumentItem } from "@/types/filevine";

type Step = 1 | 2 | 3;

export default function Home() {
  const [step, setStep] = useState<Step>(1);
  const [projectId, setProjectId] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Folder data
  const [folderTree, setFolderTree] = useState<FolderNode[]>([]);
  const [folderFlatMap, setFolderFlatMap] = useState<FolderResponse["flatMap"]>({});

  // Document data
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [loadingDocs, setLoadingDocs] = useState(false);
  const [docCount, setDocCount] = useState(0);

  const { progress, startDownload, cancel, reset } = useDownloadOrchestrator();

  const handleProjectSubmit = useCallback(async (pid: number) => {
    setLoading(true);
    setError(null);
    setProjectId(pid);

    try {
      const data = await fetchFolders(pid);
      setFolderTree(data.tree);
      setFolderFlatMap(data.flatMap);
      setStep(2);

      // Start loading documents in background
      setLoadingDocs(true);
      setDocCount(0);
      const docs = await fetchAllDocuments(pid, (count) => setDocCount(count));
      setDocuments(docs);
      setLoadingDocs(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load project");
    } finally {
      setLoading(false);
    }
  }, []);

  const handleDownload = useCallback(
    (selectedFolderIds: Set<number> | null) => {
      if (!projectId) return;
      setStep(3);
      startDownload(documents, folderFlatMap, selectedFolderIds, projectId);
    },
    [projectId, documents, folderFlatMap, startDownload]
  );

  const handleReset = useCallback(() => {
    reset();
    setStep(1);
    setProjectId(null);
    setFolderTree([]);
    setFolderFlatMap({});
    setDocuments([]);
    setDocCount(0);
    setError(null);
  }, [reset]);

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <Header />
      <main className="flex-1 px-4 pb-12">
        <StepIndicator currentStep={step} />

        {step === 1 && (
          <ProjectInput
            onSubmit={handleProjectSubmit}
            loading={loading}
            error={error}
          />
        )}

        {step === 2 && (
          <FolderTree
            tree={folderTree}
            documents={documents}
            loadingDocs={loadingDocs}
            docCount={docCount}
            onDownload={handleDownload}
          />
        )}

        {step === 3 && (
          <ProgressPanel
            progress={progress}
            onCancel={cancel}
            onReset={handleReset}
          />
        )}
      </main>
    </div>
  );
}
