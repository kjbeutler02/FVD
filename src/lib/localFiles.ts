import type { LocalFile } from "@/types/upload";

// Files other programs leave behind while writing, or that never belong in a matter.
const IGNORED_NAMES = /^(\.|~\$|Thumbs\.db$|desktop\.ini$|\.DS_Store$)/i;
const IGNORED_EXT = /\.(tmp|temp|crdownload|part|partial|download|lnk)$/i;

export function isIgnoredFile(name: string): boolean {
  return IGNORED_NAMES.test(name) || IGNORED_EXT.test(name);
}

let nextId = 0;
function makeId(): string {
  nextId += 1;
  return `f${Date.now().toString(36)}-${nextId}`;
}

function fromFile(file: File, relDir: string[], extra: Partial<LocalFile> = {}): LocalFile {
  return {
    id: makeId(),
    file,
    name: file.name,
    size: file.size,
    lastModified: file.lastModified,
    relDir,
    ...extra,
  };
}

/** Files from an <input type="file"> (with or without webkitdirectory). */
export function filesFromInput(list: FileList | null): LocalFile[] {
  if (!list) return [];
  const out: LocalFile[] = [];
  for (const file of Array.from(list)) {
    if (isIgnoredFile(file.name)) continue;
    // webkitRelativePath is "Picked/sub/file.ext" for directory picks, "" otherwise.
    const rel = (file as File & { webkitRelativePath?: string }).webkitRelativePath || "";
    const parts = rel.split("/").filter(Boolean);
    // Keep the picked folder's own name so the Filevine folder mirrors it.
    const relDir = parts.length > 1 ? parts.slice(0, -1) : [];
    out.push(fromFile(file, relDir));
  }
  return out;
}

// The drag-and-drop entry API (webkitGetAsEntry) predates promises.
async function walkEntry(entry: FileSystemEntry, relDir: string[], out: LocalFile[]): Promise<void> {
  if (entry.isFile) {
    if (isIgnoredFile(entry.name)) return;
    const file = await new Promise<File>((ok, err) => (entry as FileSystemFileEntry).file(ok, err));
    out.push(fromFile(file, relDir));
    return;
  }
  if (entry.isDirectory) {
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    const dir = [...relDir, entry.name];
    // readEntries returns in batches (of ~100) until an empty array.
    for (;;) {
      const batch = await new Promise<FileSystemEntry[]>((ok, err) => reader.readEntries(ok, err));
      if (batch.length === 0) break;
      for (const child of batch) await walkEntry(child, dir, out);
    }
  }
}

/** Files (recursing into dropped folders) from a drop event. */
export async function filesFromDrop(dt: DataTransfer): Promise<LocalFile[]> {
  const out: LocalFile[] = [];
  const items = Array.from(dt.items ?? []);
  const entries = items
    .map((it) => it.webkitGetAsEntry())
    .filter((e): e is FileSystemEntry => e != null);
  if (entries.length > 0) {
    for (const entry of entries) await walkEntry(entry, [], out);
    return out;
  }
  // Browsers without the entry API: loose files only.
  for (const file of Array.from(dt.files ?? [])) {
    if (!isIgnoredFile(file.name)) out.push(fromFile(file, []));
  }
  return out;
}

/**
 * Every file under a directory handle (File System Access API), with handles
 * kept so the file can be moved once uploaded. `skipDir` names are not entered.
 */
export async function filesFromDirectoryHandle(
  root: FileSystemDirectoryHandle,
  skipDir: Set<string>,
  signal?: AbortSignal
): Promise<LocalFile[]> {
  const out: LocalFile[] = [];
  async function walk(dir: FileSystemDirectoryHandle, relDir: string[]) {
    // `entries()` is in Chromium but not yet in lib.dom's type for the handle.
    const iter = (dir as FileSystemDirectoryHandle & {
      entries(): AsyncIterableIterator<[string, FileSystemHandle]>;
    }).entries();
    for await (const [name, handle] of iter) {
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      if (handle.kind === "directory") {
        if (relDir.length === 0 && skipDir.has(name)) continue;
        await walk(handle as FileSystemDirectoryHandle, [...relDir, name]);
      } else {
        if (isIgnoredFile(name)) continue;
        const fh = handle as FileSystemFileHandle;
        const file = await fh.getFile();
        out.push(fromFile(file, relDir, { handle: fh, parentHandle: dir }));
      }
    }
  }
  await walk(root, []);
  return out;
}

/**
 * Move an uploaded file into `doneRoot/<relDir>/name`, creating folders as
 * needed and suffixing on collision. Copy-then-delete: `move()` is not yet
 * available for handles outside the origin-private file system.
 */
export async function moveToDone(
  lf: LocalFile,
  doneRoot: FileSystemDirectoryHandle
): Promise<void> {
  if (!lf.handle || !lf.parentHandle) throw new Error("File has no handle to move");
  let dir = doneRoot;
  for (const part of lf.relDir) dir = await dir.getDirectoryHandle(part, { create: true });

  let target = lf.name;
  for (let n = 2; ; n++) {
    try {
      await dir.getFileHandle(target); // exists → try next name
      const dot = lf.name.lastIndexOf(".");
      target = dot > 0 ? `${lf.name.slice(0, dot)} (${n})${lf.name.slice(dot)}` : `${lf.name} (${n})`;
    } catch {
      break; // not found → free
    }
  }
  const dest = await dir.getFileHandle(target, { create: true });
  const writable = await dest.createWritable();
  const src = await lf.handle.getFile();
  await src.stream().pipeTo(writable);
  await lf.parentHandle.removeEntry(lf.name);
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}
