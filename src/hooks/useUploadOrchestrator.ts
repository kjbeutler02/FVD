"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { fetchDocumentsForFolder } from "@/lib/api";
import { FolderResolver, UploadQueue, type CreatedFolder, type FolderFlatMap } from "@/lib/uploadQueue";
import { filesFromDirectoryHandle, moveToDone } from "@/lib/localFiles";
import {
  saveWatch,
  loadWatch,
  clearWatch,
  ensureHandlePermission,
  ledgerKey,
  fileKey,
  loadLedger,
  saveLedger,
  type SavedWatch,
} from "@/lib/watchStore";
import { WATCH_SCAN_INTERVAL_MS, WATCH_STABLE_MS, WATCH_DONE_DIRNAME } from "@/lib/constants";
import type {
  LocalFile,
  UploadDestination,
  UploadFileProgress,
  UploadProgress,
  WatchState,
} from "@/types/upload";

function initialProgress(): UploadProgress {
  return {
    phase: "idle",
    destination: null,
    files: new Map(),
    totalFiles: 0,
    totalBytes: 0,
    uploadedBytes: 0,
    completedFiles: 0,
    failedFiles: 0,
    skippedFiles: 0,
    activeFiles: [],
    foldersToCreate: [],
    uploadDuplicates: false,
    checkingDuplicates: false,
    checkToken: 0,
    attributed: null,
  };
}

function targetPath(dest: UploadDestination, relDir: string[]): string {
  return [dest.folderPath, ...relDir].filter(Boolean).join("/");
}

function toProgress(lf: LocalFile, dest: UploadDestination): UploadFileProgress {
  return {
    id: lf.id,
    name: lf.name,
    size: lf.size,
    relDir: lf.relDir,
    targetPath: targetPath(dest, lf.relDir),
    status: "pending",
    fraction: 0,
    attempts: 0,
  };
}

/** Roll the per-file map up into the counters the drawer shows. */
function tally(files: Map<string, UploadFileProgress>) {
  let uploadedBytes = 0;
  let completedFiles = 0;
  let failedFiles = 0;
  let skippedFiles = 0;
  const activeFiles: string[] = [];
  for (const f of files.values()) {
    switch (f.status) {
      case "complete":
        completedFiles++;
        uploadedBytes += f.size;
        break;
      case "error":
        failedFiles++;
        break;
      case "skipped":
        skippedFiles++;
        break;
      case "uploading":
      case "committing":
      case "preparing":
        uploadedBytes += f.fraction * f.size;
        activeFiles.push(f.name);
        break;
    }
  }
  return { uploadedBytes, completedFiles, failedFiles, skippedFiles, activeFiles };
}

interface Options {
  folderFlatMap: FolderFlatMap;
  /** Filevine folders created by an upload; the caller refreshes its tree. */
  onFoldersCreated: (folders: CreatedFolder[]) => void;
  /** Filevine folders that received new documents; the caller refreshes their listings. */
  onFilesUploaded: (folderIds: number[]) => void;
}

export function useUploadOrchestrator({ folderFlatMap, onFoldersCreated, onFilesUploaded }: Options) {
  const [progress, setProgress] = useState<UploadProgress>(initialProgress);
  const [watch, setWatch] = useState<WatchState | null>(null);
  const [savedWatch, setSavedWatch] = useState<SavedWatch | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);

  // Batch run
  const batchFilesRef = useRef<Map<string, LocalFile>>(new Map());
  const batchAbortRef = useRef<AbortController | null>(null);
  const batchRunIdRef = useRef(0);

  // Watch run
  const watchAbortRef = useRef<AbortController | null>(null);
  const watchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const watchRef = useRef<{
    handle: FileSystemDirectoryHandle;
    dest: UploadDestination;
    folderName: string;
    ledger: Set<string>;
    ledgerKey: string;
    firstSeen: Map<string, number>;
    queued: Set<string>;
    queue: UploadQueue;
    resolver: FolderResolver;
    files: Map<string, LocalFile>;
  } | null>(null);

  // Latest props for code that runs outside render (queue callbacks, scans).
  const flatMapRef = useRef(folderFlatMap);
  const callbacksRef = useRef({ onFoldersCreated, onFilesUploaded });
  useEffect(() => {
    flatMapRef.current = folderFlatMap;
  }, [folderFlatMap]);
  useEffect(() => {
    callbacksRef.current = { onFoldersCreated, onFilesUploaded };
  }, [onFoldersCreated, onFilesUploaded]);

  // A saved watch from a previous visit can be resumed with one click.
  useEffect(() => {
    let cancelled = false;
    void loadWatch().then((w) => {
      if (!cancelled && w) setSavedWatch(w);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Closing the tab mid-upload loses the files in flight.
  const busy =
    progress.phase === "uploading" || (watch?.active && (watch.activeNames.length > 0 || watch.waiting > 0));
  useEffect(() => {
    if (!busy) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [busy]);

  /* ------------------------------------------------------------ batch */

  const patchFile = useCallback((runId: number, id: string, patch: Partial<UploadFileProgress>) => {
    if (runId !== batchRunIdRef.current) return;
    setProgress((prev) => {
      const existing = prev.files.get(id);
      if (!existing) return prev;
      const files = new Map(prev.files);
      files.set(id, { ...existing, ...patch });
      return { ...prev, files, ...tally(files) };
    });
  }, []);

  /**
   * Compare the batch against what the destination folders already hold.
   * Same name and size → identical (skipped by default); same name, other
   * size → flagged but uploaded as a new document.
   */
  const checkDuplicates = useCallback(
    async (dest: UploadDestination, files: LocalFile[], resolver: FolderResolver, checkId: number) => {
      // Always yield once so the state update below never runs synchronously
      // inside the effect that started us.
      await Promise.resolve();
      const byFolder = new Map<number, LocalFile[]>();
      for (const lf of files) {
        const fid = resolver.lookup(dest.folderId, lf.relDir);
        if (fid == null) continue; // folder doesn't exist yet → nothing to collide with
        if (!byFolder.has(fid)) byFolder.set(fid, []);
        byFolder.get(fid)!.push(lf);
      }
      const marks = new Map<string, "identical" | "same-name">();
      for (const [fid, group] of byFolder) {
        try {
          const existing = await fetchDocumentsForFolder(dest.projectId, fid);
          const byName = new Map<string, Set<number | undefined>>();
          for (const d of existing) {
            const key = d.filename.trim().toLowerCase();
            if (!byName.has(key)) byName.set(key, new Set());
            byName.get(key)!.add(d.size);
          }
          for (const lf of group) {
            const sizes = byName.get(lf.name.trim().toLowerCase());
            if (!sizes) continue;
            marks.set(lf.id, sizes.has(lf.size) ? "identical" : "same-name");
          }
        } catch {
          /* listing failed: treat as no duplicates rather than block the upload */
        }
      }
      setProgress((prev) => {
        // A newer batch or a later "add files" superseded this check.
        if (prev.phase !== "review" || prev.checkToken !== checkId) return prev;
        const next = new Map(prev.files);
        for (const [id, f] of next) {
          const dup = marks.get(id);
          const status = dup === "identical" && !prev.uploadDuplicates ? "skipped" : "pending";
          next.set(id, { ...f, duplicate: dup, status });
        }
        return { ...prev, files: next, checkingDuplicates: false, ...tally(next) };
      });
    },
    []
  );

  /** Open the drawer for a destination, optionally with files already chosen. */
  const beginBatch = useCallback(
    (dest: UploadDestination, files: LocalFile[]) => {
      batchAbortRef.current?.abort();
      batchRunIdRef.current += 1;
      batchFilesRef.current = new Map(files.map((f) => [f.id, f]));
      const resolver = new FolderResolver(dest.projectId, flatMapRef.current);
      const foldersToCreate = [
        ...new Set(
          files
            .filter((f) => f.relDir.length > 0 && !resolver.exists(dest.folderId, f.relDir))
            .map((f) => targetPath(dest, f.relDir))
        ),
      ].sort();
      const map = new Map(files.map((f) => [f.id, toProgress(f, dest)]));
      setPanelOpen(true);
      setProgress((prev) => ({
        ...initialProgress(),
        phase: "review",
        destination: dest,
        files: map,
        totalFiles: files.length,
        totalBytes: files.reduce((n, f) => n + f.size, 0),
        foldersToCreate,
        // The duplicate check runs from an effect keyed on this token.
        checkingDuplicates: files.length > 0,
        checkToken: prev.checkToken + 1,
        ...tally(map),
      }));
    },
    []
  );

  // Run the duplicate check whenever a review batch asks for one. Kicking it
  // off here (not inside a state updater) keeps updaters pure, so React can
  // re-run them freely without losing the "check finished" update.
  const lastCheckRef = useRef(0);
  useEffect(() => {
    if (progress.phase !== "review" || !progress.checkingDuplicates || !progress.destination) return;
    if (progress.checkToken === lastCheckRef.current) return;
    lastCheckRef.current = progress.checkToken;
    const dest = progress.destination;
    const token = progress.checkToken;
    const files = [...batchFilesRef.current.values()];
    const resolver = new FolderResolver(dest.projectId, flatMapRef.current);
    // Deferred so the check (and its eventual state update) runs after this
    // effect, never synchronously inside it.
    queueMicrotask(() => void checkDuplicates(dest, files, resolver, token));
  }, [progress.phase, progress.checkingDuplicates, progress.checkToken, progress.destination, checkDuplicates]);

  /** Add more files to a batch still under review. */
  const addFiles = useCallback((files: LocalFile[]) => {
    // Everything that mutates lives outside the updater: React may run an
    // updater more than once, and a second pass must see the same inputs.
    const existingKeys = new Set(
      [...batchFilesRef.current.values()].map((f) => fileKey(f.relDir, f.name, f.size, f.lastModified))
    );
    const fresh = files.filter((f) => !existingKeys.has(fileKey(f.relDir, f.name, f.size, f.lastModified)));
    if (fresh.length === 0) return;
    for (const f of fresh) batchFilesRef.current.set(f.id, f);
    const all = [...batchFilesRef.current.values()];
    const flatMap = flatMapRef.current;

    setProgress((prev) => {
      if (prev.phase !== "review" || !prev.destination) return prev;
      const dest = prev.destination;
      const resolver = new FolderResolver(dest.projectId, flatMap);
      const foldersToCreate = [
        ...new Set(
          all
            .filter((f) => f.relDir.length > 0 && !resolver.exists(dest.folderId, f.relDir))
            .map((f) => targetPath(dest, f.relDir))
        ),
      ].sort();
      const map = new Map(prev.files);
      for (const f of fresh) map.set(f.id, toProgress(f, dest));
      return {
        ...prev,
        files: map,
        totalFiles: all.length,
        totalBytes: all.reduce((n, f) => n + f.size, 0),
        foldersToCreate,
        checkingDuplicates: true,
        checkToken: prev.checkToken + 1,
        ...tally(map),
      };
    });
  }, []);

  const removeFile = useCallback((id: string) => {
    batchFilesRef.current.delete(id);
    setProgress((prev) => {
      if (prev.phase !== "review") return prev;
      const files = new Map(prev.files);
      files.delete(id);
      const all = [...batchFilesRef.current.values()];
      return {
        ...prev,
        files,
        totalFiles: all.length,
        totalBytes: all.reduce((n, f) => n + f.size, 0),
        ...tally(files),
      };
    });
  }, []);

  const setUploadDuplicates = useCallback((value: boolean) => {
    setProgress((prev) => {
      if (prev.phase !== "review") return prev;
      const files = new Map(prev.files);
      for (const [id, f] of files) {
        if (f.duplicate === "identical") files.set(id, { ...f, status: value ? "pending" : "skipped" });
      }
      return { ...prev, uploadDuplicates: value, files, ...tally(files) };
    });
  }, []);

  const runBatch = useCallback(
    (ids: string[]) => {
      const dest = progress.destination;
      if (!dest) return;
      const controller = new AbortController();
      batchAbortRef.current = controller;
      const runId = ++batchRunIdRef.current;

      const created: CreatedFolder[] = [];
      const resolver = new FolderResolver(dest.projectId, flatMapRef.current, (f) => created.push(f));
      const touched = new Set<number>();

      setProgress((prev) => {
        const files = new Map(prev.files);
        for (const id of ids) {
          const f = files.get(id);
          if (f) files.set(id, { ...f, status: "pending", fraction: 0, error: undefined });
        }
        return { ...prev, phase: "uploading", files, errorMessage: undefined, ...tally(files) };
      });

      const queue = new UploadQueue(resolver, controller.signal, {
        update: (id, patch) => patchFile(runId, id, patch),
        attributed: (a) => {
          if (runId === batchRunIdRef.current) setProgress((prev) => ({ ...prev, attributed: a }));
        },
        settled: (item, result) => {
          if (result.status === "complete") {
            const fid = resolver.lookup(item.dest.folderId, item.lf.relDir);
            if (fid != null) touched.add(fid);
          }
        },
        idle: () => {
          if (runId !== batchRunIdRef.current || controller.signal.aborted) return;
          queue.close();
          if (created.length > 0) callbacksRef.current.onFoldersCreated(created);
          if (touched.size > 0) callbacksRef.current.onFilesUploaded([...touched]);
          setProgress((prev) => ({ ...prev, phase: "complete", activeFiles: [] }));
        },
      });

      const items = ids
        .map((id) => batchFilesRef.current.get(id))
        .filter((lf): lf is LocalFile => !!lf)
        .map((lf) => ({ lf, dest }));
      if (items.length === 0) {
        setProgress((prev) => ({ ...prev, phase: "complete" }));
        return;
      }
      queue.add(items);
    },
    [progress.destination, patchFile]
  );

  /** Upload everything under review that is not skipped. */
  const confirmBatch = useCallback(() => {
    const ids = [...progress.files.values()].filter((f) => f.status !== "skipped").map((f) => f.id);
    if (ids.length === 0) return;
    runBatch(ids);
  }, [progress.files, runBatch]);

  const retryFailed = useCallback(() => {
    const ids = [...progress.files.values()].filter((f) => f.status === "error").map((f) => f.id);
    if (ids.length === 0) return;
    runBatch(ids);
  }, [progress.files, runBatch]);

  /** Drop the current batch (aborting anything in flight) but leave the drawer as it is. */
  const discardBatch = useCallback(() => {
    batchRunIdRef.current += 1;
    batchAbortRef.current?.abort();
    batchAbortRef.current = null;
    batchFilesRef.current = new Map();
    setProgress(initialProgress());
  }, []);

  const cancelBatch = useCallback(() => {
    discardBatch();
    setPanelOpen(false);
  }, [discardBatch]);

  /* ------------------------------------------------------------ watch */

  const updateWatch = useCallback((patch: Partial<WatchState> | ((w: WatchState) => WatchState)) => {
    setWatch((prev) => {
      if (!prev) return prev;
      return typeof patch === "function" ? patch(prev) : { ...prev, ...patch };
    });
  }, []);

  const stopWatch = useCallback(
    (forget = true) => {
      if (watchTimerRef.current) clearTimeout(watchTimerRef.current);
      watchTimerRef.current = null;
      watchAbortRef.current?.abort();
      watchAbortRef.current = null;
      watchRef.current?.queue.close();
      watchRef.current = null;
      setWatch(null);
      if (forget) {
        void clearWatch();
        setSavedWatch(null);
      }
    },
    []
  );

  const beginWatching = useCallback(
    (handle: FileSystemDirectoryHandle, dest: UploadDestination) => {
      stopWatch(false);
      const controller = new AbortController();
      watchAbortRef.current = controller;
      const key = ledgerKey(handle.name, dest);
      const ledger = loadLedger(key);
      const resolver = new FolderResolver(dest.projectId, flatMapRef.current, (f) =>
        callbacksRef.current.onFoldersCreated([f])
      );
      const files = new Map<string, LocalFile>();
      const queued = new Set<string>();

      const queue = new UploadQueue(resolver, controller.signal, {
        update: (id, patch) =>
          updateWatch((w) => {
            const existing = w.files.get(id);
            if (!existing) return w;
            const next = new Map(w.files);
            next.set(id, { ...existing, ...patch });
            return { ...w, files: next, activeNames: tally(next).activeFiles };
          }),
        attributed: () => {},
        settled: (item, result) => {
          const lf = item.lf;
          const k = fileKey(lf.relDir, lf.name, lf.size, lf.lastModified);
          queued.delete(k);
          if (result.status === "complete") {
            ledger.add(k);
            saveLedger(key, ledger);
            const fid = resolver.lookup(dest.folderId, lf.relDir);
            if (fid != null) callbacksRef.current.onFilesUploaded([fid]);
            updateWatch((w) => ({ ...w, uploaded: w.uploaded + 1 }));
            // Best effort: park the file so the folder shows what's left.
            void (async () => {
              try {
                const done = await handle.getDirectoryHandle(WATCH_DONE_DIRNAME, { create: true });
                await moveToDone(lf, done);
              } catch {
                updateWatch((w) => {
                  const f = w.files.get(lf.id);
                  if (!f) return w;
                  const next = new Map(w.files);
                  next.set(lf.id, { ...f, error: `Uploaded, but could not be moved to "${WATCH_DONE_DIRNAME}"` });
                  return { ...w, files: next };
                });
              }
            })();
          } else {
            updateWatch((w) => ({ ...w, failed: w.failed + 1 }));
          }
        },
        idle: () => {},
      });

      watchRef.current = {
        handle,
        dest,
        folderName: handle.name,
        ledger,
        ledgerKey: key,
        firstSeen: new Map(),
        queued,
        queue,
        resolver,
        files,
      };

      setWatch({
        active: true,
        folderName: handle.name,
        destination: dest,
        waiting: 0,
        uploaded: 0,
        failed: 0,
        activeNames: [],
        files: new Map(),
        lastScanAt: null,
        scanning: false,
      });

      const scan = async () => {
        const w = watchRef.current;
        if (!w || controller.signal.aborted) return;
        updateWatch({ scanning: true, error: undefined });
        try {
          const found = await filesFromDirectoryHandle(w.handle, new Set([WATCH_DONE_DIRNAME]), controller.signal);
          const now = Date.now();
          const ready: LocalFile[] = [];
          let waiting = 0;
          const present = new Set<string>();
          for (const lf of found) {
            const k = fileKey(lf.relDir, lf.name, lf.size, lf.lastModified);
            present.add(k);
            if (w.ledger.has(k) || w.queued.has(k)) continue;
            const first = w.firstSeen.get(k);
            if (first == null) {
              w.firstSeen.set(k, now);
              waiting++;
            } else if (now - first >= WATCH_STABLE_MS) {
              ready.push(lf);
            } else {
              waiting++;
            }
          }
          // Forget files that vanished or changed (their key no longer appears).
          for (const k of [...w.firstSeen.keys()]) if (!present.has(k)) w.firstSeen.delete(k);

          if (ready.length > 0) {
            for (const lf of ready) {
              const k = fileKey(lf.relDir, lf.name, lf.size, lf.lastModified);
              w.queued.add(k);
              w.firstSeen.delete(k);
              w.files.set(lf.id, lf);
            }
            updateWatch((prev) => {
              const next = new Map(prev.files);
              for (const lf of ready) next.set(lf.id, toProgress(lf, w.dest));
              return { ...prev, files: next };
            });
            w.queue.add(ready.map((lf) => ({ lf, dest: w.dest })));
          }
          updateWatch({ waiting, lastScanAt: now, scanning: false });
        } catch (err) {
          if (controller.signal.aborted) return;
          updateWatch({
            scanning: false,
            error: err instanceof Error ? err.message : "Could not read the watched folder",
          });
        }
        if (!controller.signal.aborted) {
          watchTimerRef.current = setTimeout(scan, WATCH_SCAN_INTERVAL_MS);
        }
      };
      void scan();
    },
    [stopWatch, updateWatch]
  );

  /** Pick a local folder and start watching it for files to send to `dest`. */
  const startWatch = useCallback(
    async (dest: UploadDestination): Promise<boolean> => {
      if (!window.showDirectoryPicker) return false;
      let handle: FileSystemDirectoryHandle;
      try {
        handle = await window.showDirectoryPicker({ id: "fvd-watch", mode: "readwrite" });
      } catch {
        return false; // dismissed or blocked
      }
      const saved: SavedWatch = { handle, folderName: handle.name, destination: dest, savedAt: Date.now() };
      void saveWatch(saved);
      setSavedWatch(saved);
      beginWatching(handle, dest);
      setPanelOpen(true);
      return true;
    },
    [beginWatching]
  );

  /** Resume the watch saved from a previous visit (needs a click for the permission prompt). */
  const resumeWatch = useCallback(async (): Promise<boolean> => {
    const saved = savedWatch;
    if (!saved) return false;
    const ok = await ensureHandlePermission(saved.handle);
    if (!ok) return false;
    beginWatching(saved.handle, saved.destination);
    return true;
  }, [savedWatch, beginWatching]);

  const dismissSavedWatch = useCallback(() => {
    void clearWatch();
    setSavedWatch(null);
  }, []);

  const openPanel = useCallback(() => setPanelOpen(true), []);
  const closePanel = useCallback(() => {
    // A finished or unstarted batch is discarded on close; a running one, or
    // an active watch, keeps going in the background.
    if (progress.phase === "review" || progress.phase === "complete" || progress.phase === "error") {
      batchFilesRef.current = new Map();
      setProgress(initialProgress());
    }
    setPanelOpen(false);
  }, [progress.phase]);

  const canWatch = typeof window !== "undefined" && typeof window.showDirectoryPicker === "function";

  return {
    progress,
    watch,
    savedWatch,
    panelOpen,
    canWatch,
    beginBatch,
    addFiles,
    removeFile,
    setUploadDuplicates,
    confirmBatch,
    retryFailed,
    cancelBatch,
    discardBatch,
    startWatch,
    resumeWatch,
    stopWatch,
    dismissSavedWatch,
    openPanel,
    closePanel,
  };
}
