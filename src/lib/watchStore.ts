import type { UploadDestination } from "@/types/upload";

/**
 * Persistence for watch mode. The directory handle goes in IndexedDB (it is
 * structured-cloneable; localStorage can't hold it) so "Resume watching"
 * works after a reload. The ledger of already-uploaded files lives in
 * localStorage keyed by folder + destination, so a file is never sent twice
 * even if moving it into the done folder failed.
 */

const DB_NAME = "fvd-uploads";
const STORE = "watch";
const KEY = "current";

export interface SavedWatch {
  handle: FileSystemDirectoryHandle;
  folderName: string;
  destination: UploadDestination;
  savedAt: number;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveWatch(watch: SavedWatch): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(watch, KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    /* persistence is a convenience */
  }
}

export async function loadWatch(): Promise<SavedWatch | null> {
  try {
    const db = await openDb();
    return await new Promise<SavedWatch | null>((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(KEY);
      req.onsuccess = () => resolve((req.result as SavedWatch | undefined) ?? null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

export async function clearWatch(): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    /* ignore */
  }
}

/** Ask (or re-ask) for read/write access to a saved handle. Must run from a user gesture. */
export async function ensureHandlePermission(handle: FileSystemDirectoryHandle): Promise<boolean> {
  const h = handle as FileSystemDirectoryHandle & {
    queryPermission?(o: { mode: "readwrite" }): Promise<PermissionState>;
    requestPermission?(o: { mode: "readwrite" }): Promise<PermissionState>;
  };
  try {
    if ((await h.queryPermission?.({ mode: "readwrite" })) === "granted") return true;
    return (await h.requestPermission?.({ mode: "readwrite" })) === "granted";
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------- ledger */

const LEDGER_MAX = 50_000;

export function ledgerKey(folderName: string, dest: UploadDestination): string {
  return `fvd-watch-ledger:${folderName}:${dest.projectId}:${dest.folderId}`;
}

export function fileKey(relDir: string[], name: string, size: number, lastModified: number): string {
  return `${[...relDir, name].join("/")}|${size}|${lastModified}`;
}

export function loadLedger(key: string): Set<string> {
  try {
    const raw = localStorage.getItem(key);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

export function saveLedger(key: string, ledger: Set<string>): void {
  try {
    const arr = [...ledger];
    localStorage.setItem(key, JSON.stringify(arr.slice(Math.max(0, arr.length - LEDGER_MAX))));
  } catch {
    /* quota or private mode: the done-folder move still prevents most repeats */
  }
}
