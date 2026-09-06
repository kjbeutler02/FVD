/**
 * Archive path helpers. Filevine folder and file names are free text and can
 * contain characters that are illegal on Windows (`: * ? " < > |`), path
 * separators, control characters, or reserved device names. Left as-is they
 * produce ZIPs that Explorer refuses to extract, or files that land in the
 * wrong folder. Every path component is normalised before it enters the ZIP.
 */

const ILLEGAL_CHARS = /[<>:"/\\|?*\x00-\x1f]/g;
const RESERVED_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

// Windows caps a full path at 260 characters; keep each component short
// enough that reasonably deep trees still extract.
const MAX_SEGMENT_LENGTH = 120;

/** Make a single folder or file name safe to use as a path component. */
export function sanitizeSegment(name: string): string {
  let out = name.replace(ILLEGAL_CHARS, "_").trim();
  // Trailing dots and spaces are stripped by Windows, which would rename the
  // entry (or collide with a sibling).
  out = out.replace(/[. ]+$/g, "");
  if (out === "" || out === "." || out === "..") out = "_";
  if (RESERVED_NAMES.test(out)) out = `_${out}`;
  if (out.length > MAX_SEGMENT_LENGTH) {
    const dot = out.lastIndexOf(".");
    const ext = dot > 0 ? out.slice(dot) : "";
    const stem = dot > 0 ? out.slice(0, dot) : out;
    out = stem.slice(0, Math.max(1, MAX_SEGMENT_LENGTH - ext.length)) + ext;
  }
  return out;
}

/** Folder path components (top-level first) for a document's folder. */
export function folderPathParts(
  folderId: number,
  flatMap: Record<number, { name: string; parentId: number | null }>
): string[] {
  const parts: string[] = [];
  let cur: number | null = folderId;
  const visited = new Set<number>();

  while (cur != null && !visited.has(cur) && flatMap[cur]) {
    visited.add(cur);
    parts.push(flatMap[cur].name);
    cur = flatMap[cur].parentId;
  }

  return parts.reverse();
}

/** Human-readable folder path, used for display only. */
export function displayFolderPath(
  folderId: number,
  flatMap: Record<number, { name: string; parentId: number | null }>
): string {
  return folderPathParts(folderId, flatMap).join("/");
}

/**
 * Archive path for a file: sanitised folder components + sanitised filename.
 * Duplicate paths (same name in the same folder, or two documents that both
 * convert to the same `.md`) are suffixed " (2)", " (3)", … instead of
 * silently overwriting each other.
 */
export function archivePath(
  folderParts: string[],
  filename: string,
  usedPaths: Set<string>
): string {
  const dir = folderParts.map(sanitizeSegment).join("/");
  const base = sanitizeSegment(filename);
  return uniquePath(dir ? `${dir}/${base}` : base, usedPaths);
}

function uniquePath(path: string, usedPaths: Set<string>): string {
  if (!usedPaths.has(path)) {
    usedPaths.add(path);
    return path;
  }
  const slash = path.lastIndexOf("/");
  const dot = path.lastIndexOf(".");
  const hasExt = dot > slash + 1;
  const stem = hasExt ? path.slice(0, dot) : path;
  const ext = hasExt ? path.slice(dot) : "";
  for (let n = 2; ; n++) {
    const candidate = `${stem} (${n})${ext}`;
    if (!usedPaths.has(candidate)) {
      usedPaths.add(candidate);
      return candidate;
    }
  }
}
