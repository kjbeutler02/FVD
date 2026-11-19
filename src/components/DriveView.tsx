"use client";

import { useState, useMemo, useCallback, useRef, useImperativeHandle } from "react";
import {
  AlertTriangle,
  ArrowLeftRight,
  ChevronRight,
  ChevronDown,
  ChevronLeft,
  File,
  Folder,
  FolderOpen,
  Folders,
  Download,
  Search,
  LayoutGrid,
  List as ListIcon,
  X,
  Upload,
} from "lucide-react";
import { fetchDocumentsForFolder } from "@/lib/api";
import { filesFromDrop, formatBytes } from "@/lib/localFiles";
import {
  Button,
  Checkbox,
  Eyebrow,
  IconButton,
  Spinner,
  StatusBand,
  Switch,
  type CheckState,
} from "@/components/ui";
import type { DocumentItem, FolderNode } from "@/types/filevine";
import type { DownloadSelection } from "@/types/download";
import type { LocalFile, UploadDestination } from "@/types/upload";

type ViewMode = "list" | "grid";

interface Props {
  tree: FolderNode[];
  projectId: number;
  /** The project's root document folder, for uploads made from "All Folders". */
  rootFolderId: number | null;
  onDownload: (selection: DownloadSelection) => void;
  /** Open the upload drawer for a destination, with any files already dropped. */
  onUpload: (destination: UploadDestination, files: LocalFile[]) => void;
  /** Leave this project and return to the project-entry screen. */
  onChangeProject: () => void;
  ref?: React.Ref<DriveViewHandle>;
}

/** Imperative surface for the parent: refresh listings after uploads change them. */
export interface DriveViewHandle {
  invalidateFolders: (folderIds: number[]) => void;
}

/* ---------------------------------------------------------------- helpers */

function flatten(nodes: FolderNode[]): FolderNode[] {
  const out: FolderNode[] = [];
  const walk = (n: FolderNode) => {
    out.push(n);
    n.children.forEach(walk);
  };
  nodes.forEach(walk);
  return out;
}

function getDescendantIds(node: FolderNode): Set<number> {
  const ids = new Set<number>();
  const walk = (n: FolderNode) => {
    ids.add(n.id);
    n.children.forEach(walk);
  };
  walk(node);
  return ids;
}

function checkState(node: FolderNode, selected: Set<number>): CheckState {
  const descendants = getDescendantIds(node);
  let count = 0;
  for (const id of descendants) if (selected.has(id)) count++;
  if (count === 0) return "unchecked";
  if (count === descendants.size) return "checked";
  return "indeterminate";
}

/** Drop override entries for documents living in any of the given folders. */
function pruneOverrides(
  prev: Map<number, DocumentItem>,
  folderIds: Set<number>
): Map<number, DocumentItem> {
  let changed = false;
  const next = new Map(prev);
  for (const [id, doc] of prev) {
    if (folderIds.has(doc.folderId)) {
      next.delete(id);
      changed = true;
    }
  }
  return changed ? next : prev;
}

/* ---------------------------------------------------------------- view */

export default function DriveView({
  tree,
  projectId,
  rootFolderId,
  onDownload,
  onUpload,
  onChangeProject,
  ref,
}: Props) {
  const { byId, parentById, allIds } = useMemo(() => {
    const byId = new Map<number, FolderNode>();
    const parentById = new Map<number, number | null>();
    const walk = (n: FolderNode, parent: number | null) => {
      byId.set(n.id, n);
      parentById.set(n.id, parent);
      n.children.forEach((c) => walk(c, n.id));
    };
    tree.forEach((n) => walk(n, null));
    return { byId, parentById, allIds: new Set(byId.keys()) };
  }, [tree]);

  const [currentFolderId, setCurrentFolderId] = useState<number | null>(null);
  const [selected, setSelected] = useState<Set<number>>(() => new Set(allIds));
  const [expanded, setExpanded] = useState<Set<number>>(
    () => new Set(tree.map((n) => n.id))
  );
  const [view, setView] = useState<ViewMode>("list");
  const [query, setQuery] = useState("");

  // Documents loaded per folder (fetched when a folder is opened), plus the
  // per-document overrides on top of the folder-level selection.
  const [docsByFolder, setDocsByFolder] = useState<Map<number, DocumentItem[]>>(
    () => new Map()
  );
  const [docsLoading, setDocsLoading] = useState<Set<number>>(() => new Set());
  const [docsError, setDocsError] = useState<string | null>(null);
  const [extraDocs, setExtraDocs] = useState<Map<number, DocumentItem>>(
    () => new Map()
  );
  const [excludedDocs, setExcludedDocs] = useState<Map<number, DocumentItem>>(
    () => new Map()
  );
  const [convertDocs, setConvertDocs] = useState(false);

  const searching = query.trim().length > 0;

  // Load a folder's documents once, on first visit. A ref (not state) tracks
  // requested folders so the effect never re-fires for its own state updates.
  const requestedDocsRef = useRef<Set<number>>(new Set());
  const loadDocs = useCallback(
    (fid: number) => {
      if (requestedDocsRef.current.has(fid)) return;
      requestedDocsRef.current.add(fid);

      setDocsLoading((prev) => new Set(prev).add(fid));
      setDocsError(null);

      fetchDocumentsForFolder(projectId, fid)
        .then((docs) => {
          setDocsByFolder((prev) => new Map(prev).set(fid, docs));
        })
        .catch((err) => {
          requestedDocsRef.current.delete(fid); // allow retry
          setDocsError(
            err instanceof Error ? err.message : "Failed to load documents"
          );
        })
        .finally(() => {
          setDocsLoading((prev) => {
            const next = new Set(prev);
            next.delete(fid);
            return next;
          });
        });
    },
    [projectId]
  );

  // Uploads changed a folder's contents: drop the cached listing and reload
  // it if it is the one on screen.
  const invalidateFolders = useCallback(
    (folderIds: number[]) => {
      const ids = new Set(folderIds);
      for (const id of ids) requestedDocsRef.current.delete(id);
      setDocsByFolder((prev) => {
        const next = new Map(prev);
        for (const id of ids) next.delete(id);
        return next;
      });
      if (currentFolderId != null && ids.has(currentFolderId)) loadDocs(currentFolderId);
    },
    [loadDocs, currentFolderId]
  );
  useImperativeHandle(ref, () => ({ invalidateFolders }), [invalidateFolders]);

  const childrenOf = useCallback(
    (id: number | null): FolderNode[] =>
      id == null ? tree : byId.get(id)?.children ?? [],
    [tree, byId]
  );

  // Breadcrumb chain: top-level -> current
  const crumbs = useMemo(() => {
    const chain: FolderNode[] = [];
    let cur = currentFolderId;
    while (cur != null) {
      const node = byId.get(cur);
      if (!node) break;
      chain.unshift(node);
      cur = parentById.get(cur) ?? null;
    }
    return chain;
  }, [currentFolderId, byId, parentById]);

  // Items shown in the main area
  const items = useMemo(() => {
    if (searching) {
      const q = query.trim().toLowerCase();
      return flatten(tree).filter((n) => n.name.toLowerCase().includes(q));
    }
    return childrenOf(currentFolderId);
  }, [searching, query, tree, childrenOf, currentFolderId]);

  const allFoldersSelected = selected.size === allIds.size && allIds.size > 0;
  const allSelected = allFoldersSelected && excludedDocs.size === 0;
  const noneSelected = selected.size === 0 && extraDocs.size === 0;

  const navigate = useCallback(
    (id: number | null) => {
      setCurrentFolderId(id);
      setQuery("");
      if (id != null) loadDocs(id);
    },
    [loadDocs]
  );

  const toggleExpand = useCallback((id: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  /** Folder check state including per-document overrides in its subtree. */
  const nodeState = useCallback(
    (node: FolderNode): CheckState => {
      const base = checkState(node, selected);
      const descendants = getDescendantIds(node);
      if (base === "checked") {
        for (const doc of excludedDocs.values()) {
          if (descendants.has(doc.folderId)) return "indeterminate";
        }
        return "checked";
      }
      if (base === "unchecked") {
        for (const doc of extraDocs.values()) {
          if (descendants.has(doc.folderId)) return "indeterminate";
        }
        return "unchecked";
      }
      return "indeterminate";
    },
    [selected, extraDocs, excludedDocs]
  );

  /** Select or clear whole subtrees, documents included. */
  const setSubtrees = useCallback((nodes: FolderNode[], on: boolean) => {
    const ids = new Set<number>();
    for (const node of nodes) for (const id of getDescendantIds(node)) ids.add(id);
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });
    // The folder-level action wins over any per-document overrides beneath it.
    setExtraDocs((prev) => pruneOverrides(prev, ids));
    setExcludedDocs((prev) => pruneOverrides(prev, ids));
  }, []);

  const toggleSelect = useCallback(
    (node: FolderNode) => setSubtrees([node], nodeState(node) !== "checked"),
    [nodeState, setSubtrees]
  );

  // "Select all" for what is on screen: the open folder's whole contents, or
  // every filter match. At the top level that is every top-level folder.
  const viewNodes = useMemo(() => {
    if (searching || currentFolderId == null) return items;
    const node = byId.get(currentFolderId);
    return node ? [node] : [];
  }, [searching, currentFolderId, items, byId]);

  const viewState = useMemo((): CheckState => {
    let checked = 0;
    for (const node of viewNodes) {
      const s = nodeState(node);
      if (s === "indeterminate") return "indeterminate";
      if (s === "checked") checked++;
    }
    if (checked === 0) return "unchecked";
    return checked === viewNodes.length ? "checked" : "indeterminate";
  }, [viewNodes, nodeState]);

  const toggleView = () => setSubtrees(viewNodes, viewState !== "checked");

  const isDocChecked = useCallback(
    (doc: DocumentItem): boolean =>
      selected.has(doc.folderId)
        ? !excludedDocs.has(doc.documentId)
        : extraDocs.has(doc.documentId),
    [selected, extraDocs, excludedDocs]
  );

  const toggleDoc = useCallback(
    (doc: DocumentItem) => {
      const setter = selected.has(doc.folderId) ? setExcludedDocs : setExtraDocs;
      setter((prev) => {
        const next = new Map(prev);
        if (next.has(doc.documentId)) next.delete(doc.documentId);
        else next.set(doc.documentId, doc);
        return next;
      });
    },
    [selected]
  );

  const selectAll = () => {
    setSelected(new Set(allIds));
    setExtraDocs(new Map());
    setExcludedDocs(new Map());
  };
  const clearAll = () => {
    setSelected(new Set());
    setExtraDocs(new Map());
    setExcludedDocs(new Map());
  };

  const handleDownload = () => {
    // Every folder selected means the whole project: scan it project-wide so
    // documents in archived folders and in the project root (neither is in
    // the tree) come too. Deselecting individual documents must not quietly
    // narrow that to the listed folders, so they are passed as exclusions.
    if (allIds.size === 0 || allFoldersSelected) {
      onDownload({
        folderIds: null,
        extraDocs: [],
        excludedDocIds: new Set(excludedDocs.keys()),
        convertToMd: convertDocs,
      });
      return;
    }
    onDownload({
      folderIds: new Set(selected),
      extraDocs: [...extraDocs.values()].filter((d) => !selected.has(d.folderId)),
      excludedDocIds: new Set(
        [...excludedDocs.values()]
          .filter((d) => selected.has(d.folderId))
          .map((d) => d.documentId)
      ),
      convertToMd: convertDocs,
    });
  };

  const pathLabel = (node: FolderNode): string => {
    const parts: string[] = [];
    let cur: number | null = parentById.get(node.id) ?? null;
    while (cur != null) {
      const p = byId.get(cur);
      if (!p) break;
      parts.unshift(p.name);
      cur = parentById.get(cur) ?? null;
    }
    return parts.length ? parts.join(" / ") : "All Folders";
  };

  const canDownload = allIds.size === 0 || selected.size > 0 || extraDocs.size > 0;

  // Where an upload from this screen lands: the open folder, or the project root.
  const uploadDest: UploadDestination | null =
    currentFolderId != null
      ? { projectId, folderId: currentFolderId, folderPath: crumbs.map((c) => c.name).join("/") }
      : rootFolderId != null
      ? { projectId, folderId: rootFolderId, folderPath: "" }
      : null;
  const uploadTargetName =
    currentFolderId != null ? crumbs[crumbs.length - 1]?.name ?? "this folder" : "project root";

  // Drag files anywhere over the folder area to upload into the open folder.
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);
  const hasFiles = (e: React.DragEvent) => Array.from(e.dataTransfer.types).includes("Files");
  const onDragEnter = (e: React.DragEvent) => {
    if (!hasFiles(e) || !uploadDest) return;
    e.preventDefault();
    dragDepth.current++;
    setDragging(true);
  };
  const onDragOver = (e: React.DragEvent) => {
    if (!hasFiles(e) || !uploadDest) return;
    e.preventDefault();
  };
  const onDragLeave = () => {
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragging(false);
  };
  const onDrop = async (e: React.DragEvent) => {
    if (!hasFiles(e) || !uploadDest) return;
    e.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    const files = await filesFromDrop(e.dataTransfer);
    if (files.length > 0) onUpload(uploadDest, files);
  };

  // Documents of the folder currently open in the main area.
  const currentDocs =
    currentFolderId != null ? docsByFolder.get(currentFolderId) : undefined;
  const loadingDocs =
    currentFolderId != null && docsLoading.has(currentFolderId);

  const selectionSummary =
    allIds.size === 0
      ? "Whole project"
      : allSelected
      ? "All folders selected"
      : `${selected.size} of ${allIds.size} folders${
          extraDocs.size > 0 ? ` +${extraDocs.size} ${extraDocs.size === 1 ? "file" : "files"}` : ""
        }${
          excludedDocs.size > 0 ? ` −${excludedDocs.size} ${excludedDocs.size === 1 ? "file" : "files"}` : ""
        }`;

  return (
    <div className="mx-auto flex min-h-0 w-full max-w-[1180px] flex-1 flex-col gap-3 px-3 pb-3 pt-3 lg:flex-row lg:gap-5 lg:pt-4">
      {/* Navy anchor: the current project. A strip on small screens, a panel
          above the folder tree from lg up. */}
      <aside className="flex shrink-0 flex-col gap-4 lg:w-[272px]">
        <section className="sh-anchor-surface flex items-center justify-between gap-4 px-6 py-4 max-lg:rounded-[28px_14px_28px_14px] lg:block lg:p-7">
          <div className="min-w-0">
            <Eyebrow>Current project</Eyebrow>
            <p className="mt-1 truncate font-mono text-2xl font-medium leading-tight text-white lg:mt-2 lg:text-3xl">
              #{projectId}
            </p>
            <p className="mt-1 hidden text-sm text-on-navy-soft lg:block">
              {allIds.size.toLocaleString()} {allIds.size === 1 ? "folder" : "folders"}
            </p>
          </div>
          <div className="shrink-0 lg:mt-6 lg:border-t lg:border-line-on-navy lg:pt-2">
            <button
              type="button"
              onClick={onChangeProject}
              className="inline-flex min-h-11 items-center gap-2 rounded-full text-sm font-semibold text-white transition-colors duration-[180ms] ease-sh hover:text-on-navy-soft focus-visible:outline-white"
            >
              <ArrowLeftRight size={15} />
              <span className="max-sm:sr-only">Open another project</span>
            </button>
          </div>
        </section>

        <nav aria-label="Folders" className="hidden min-h-0 flex-1 flex-col lg:flex">
          <Eyebrow className="px-4 pb-2">Folders</Eyebrow>
          <div className="min-h-0 flex-1 overflow-y-auto pb-2 pr-1">
            <SidebarItem
              label="All Folders"
              icon={<Folders size={16} strokeWidth={1.75} />}
              depth={0}
              active={currentFolderId == null && !searching}
              onClick={() => navigate(null)}
            />
            {tree.map((node) => (
              <SidebarNode
                key={node.id}
                node={node}
                depth={1}
                currentFolderId={searching ? -1 : currentFolderId}
                expanded={expanded}
                onNavigate={navigate}
                onToggleExpand={toggleExpand}
              />
            ))}
          </div>
        </nav>
      </aside>

      {/* The one content surface: path, tools, listing and actions. */}
      <section
        className="sh-content-surface relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
        onDragEnter={onDragEnter}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        {dragging && uploadDest && (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-ice/85 backdrop-blur-[2px]">
            <div className="flex max-w-sm flex-col items-center gap-2 rounded-panel bg-solid px-8 py-7 text-center shadow-raised">
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-ice text-navy">
                <Upload size={22} strokeWidth={1.75} />
              </span>
              <p className="mt-1 text-base font-semibold text-ink">
                Drop to upload into {currentFolderId != null ? uploadTargetName : "the project root"}
              </p>
              <p className="text-sm text-secondary">You will review the list before anything is sent.</p>
            </div>
          </div>
        )}

        {/* Path and tools */}
        <div className="flex flex-col gap-4 px-5 pb-4 pt-5 sm:px-7 sm:pt-6">
          <div className="flex min-h-11 items-center gap-1">
            {currentFolderId != null && !searching && (
              <IconButton
                label="Go up one level"
                className="-ml-2"
                onClick={() => navigate(parentById.get(currentFolderId) ?? null)}
              >
                <ChevronLeft size={18} />
              </IconButton>
            )}
            <Breadcrumb crumbs={crumbs} searching={searching} onNavigate={navigate} />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
            <div className="flex min-w-0 items-center gap-3 pl-3">
              {viewNodes.length > 0 && (
                <Checkbox
                  state={viewState}
                  onToggle={toggleView}
                  label={
                    searching
                      ? "Select all matching folders"
                      : currentFolderId != null
                      ? "Select everything in this folder"
                      : "Select all folders"
                  }
                />
              )}
              <p className="truncate text-sm text-secondary">
                {searching
                  ? `${items.length} ${items.length === 1 ? "match" : "matches"}`
                  : `${items.length} ${items.length === 1 ? "folder" : "folders"}${
                      currentFolderId != null && currentDocs
                        ? ` · ${currentDocs.length} ${
                            currentDocs.length === 1 ? "document" : "documents"
                          }`
                        : ""
                    }`}
              </p>
            </div>

            <div className="flex items-center gap-2">
              <div className="relative">
                <Search
                  size={15}
                  className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-tertiary"
                />
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Filter folders"
                  aria-label="Filter folders"
                  className="h-11 w-40 rounded-full border border-line bg-solid pl-10 pr-10 text-sm text-ink placeholder:text-tertiary transition-[border-color,box-shadow] duration-[180ms] ease-sh focus:border-blue focus:outline-none focus:ring-[3px] focus:ring-focus sm:w-56"
                />
                {searching && (
                  <IconButton
                    label="Clear filter"
                    size="sm"
                    className="absolute right-1 top-1/2 -translate-y-1/2"
                    onClick={() => setQuery("")}
                  >
                    <X size={14} />
                  </IconButton>
                )}
              </div>

              <div className="flex items-center rounded-full bg-ice p-1" role="group" aria-label="View">
                <ViewToggle active={view === "list"} onClick={() => setView("list")} label="List view">
                  <ListIcon size={16} />
                </ViewToggle>
                <ViewToggle active={view === "grid"} onClick={() => setView("grid")} label="Grid view">
                  <LayoutGrid size={16} />
                </ViewToggle>
              </div>
            </div>
          </div>
        </div>

        {/* Listing */}
        <div className="min-h-0 flex-1 overflow-y-auto border-t border-line px-5 pb-6 sm:px-7">
          {items.length > 0 &&
            (view === "grid" ? (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3 pt-5">
                {items.map((node) => (
                  <FolderCard
                    key={node.id}
                    node={node}
                    state={nodeState(node)}
                    subtitle={searching ? pathLabel(node) : undefined}
                    onOpen={() => navigate(node.id)}
                    onToggle={() => toggleSelect(node)}
                  />
                ))}
              </div>
            ) : (
              <div role="list">
                <ListHeading left={searching ? "Matching folders" : "Folders"} right="Contains" />
                {items.map((node) => (
                  <FolderRow
                    key={node.id}
                    node={node}
                    state={nodeState(node)}
                    subtitle={searching ? pathLabel(node) : undefined}
                    onOpen={() => navigate(node.id)}
                    onToggle={() => toggleSelect(node)}
                  />
                ))}
              </div>
            ))}

          {/* Documents in the open folder */}
          {!searching && currentFolderId != null && (
            <div className={items.length > 0 ? "mt-4" : ""}>
              {loadingDocs ? (
                <div className="flex items-center gap-2.5 px-3 py-5 text-sm text-secondary">
                  <Spinner size={15} />
                  Loading documents…
                </div>
              ) : docsError ? (
                <StatusBand
                  tone="error"
                  className="mt-5"
                  icon={<AlertTriangle size={16} />}
                  action={
                    <Button variant="secondary" size="sm" onClick={() => loadDocs(currentFolderId)}>
                      Retry
                    </Button>
                  }
                >
                  <p>{docsError}</p>
                </StatusBand>
              ) : currentDocs && currentDocs.length > 0 ? (
                <div role="list">
                  <ListHeading left="Documents" right="Size" />
                  {currentDocs.map((doc) => (
                    <DocRow
                      key={doc.documentId}
                      doc={doc}
                      checked={isDocChecked(doc)}
                      onToggle={() => toggleDoc(doc)}
                    />
                  ))}
                </div>
              ) : null}
            </div>
          )}

          {/* Empty states */}
          {searching && items.length === 0 && (
            <EmptyState searching query={query} hasFolders={allIds.size > 0} />
          )}
          {!searching &&
            items.length === 0 &&
            (currentFolderId == null ? (
              allIds.size === 0 && (
                <EmptyState searching={false} query="" hasFolders={false} />
              )
            ) : (
              !loadingDocs &&
              !docsError &&
              (currentDocs?.length ?? 0) === 0 && (
                <EmptyState searching={false} query="" hasFolders={allIds.size > 0} />
              )
            ))}
        </div>

        {/* Selection and actions */}
        <div className="flex flex-col gap-x-6 gap-y-3 border-t border-line bg-paper/70 px-5 py-4 sm:px-7 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-1">
              <span className="mr-2 text-sm font-semibold text-ink">{selectionSummary}</span>
              {allIds.size > 0 && (
                <>
                  <Button variant="ghost" size="sm" onClick={selectAll} disabled={allSelected}>
                    Select all
                  </Button>
                  <Button variant="ghost" size="sm" onClick={clearAll} disabled={noneSelected}>
                    Clear
                  </Button>
                </>
              )}
            </div>
            <Switch
              checked={convertDocs}
              onChange={setConvertDocs}
              label="Convert documents to Markdown"
            />
          </div>

          <div className="flex shrink-0 items-center gap-3">
            <Button
              variant="secondary"
              onClick={() => uploadDest && onUpload(uploadDest, [])}
              disabled={!uploadDest}
              title={uploadDest ? `Upload files into ${uploadTargetName}` : "Open a folder to upload into it"}
              icon={<Upload size={16} />}
              className="min-w-0 max-sm:px-4"
            >
              <span className="max-w-[12rem] truncate">
                Upload<span className="max-sm:hidden"> to {uploadTargetName}</span>
              </span>
            </Button>

            <Button
              onClick={handleDownload}
              disabled={!canDownload}
              icon={<Download size={16} />}
              className="max-sm:flex-1 max-sm:px-4"
            >
              Review &amp; Download
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}

/* ---------------------------------------------------------------- pieces */

/** Register-table heading: uppercase micro-labels over a hairline. */
function ListHeading({ left, right }: { left: string; right: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-line px-3 pb-2 pt-5">
      <Eyebrow as="span" className="pl-8">
        {left}
      </Eyebrow>
      <Eyebrow as="span" className="hidden pr-8 sm:block">
        {right}
      </Eyebrow>
    </div>
  );
}

const ROW =
  "group flex min-h-12 items-center gap-3 border-b border-line px-3 transition-colors duration-[120ms] ease-sh";

function FolderRow({
  node,
  state,
  subtitle,
  onOpen,
  onToggle,
}: {
  node: FolderNode;
  state: CheckState;
  subtitle?: string;
  onOpen: () => void;
  onToggle: () => void;
}) {
  const selected = state !== "unchecked";
  const count = node.children.length;
  return (
    <div role="listitem" className={`${ROW} ${selected ? "bg-ice/60 hover:bg-ice" : "hover:bg-ice"}`}>
      <Checkbox state={state} onToggle={onToggle} label={`Select ${node.name}`} />
      <button
        type="button"
        onClick={onOpen}
        className="flex min-h-12 min-w-0 flex-1 items-center gap-3 py-2 text-left"
      >
        <Folder
          size={18}
          strokeWidth={1.75}
          className={selected ? "shrink-0 text-navy" : "shrink-0 text-blue-soft"}
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-ink">{node.name}</span>
          {subtitle && <span className="block truncate text-xs text-secondary">{subtitle}</span>}
        </span>
        <span className="hidden shrink-0 text-xs text-secondary sm:block">
          {count === 0 ? "No subfolders" : `${count} ${count === 1 ? "subfolder" : "subfolders"}`}
        </span>
        <ChevronRight
          size={16}
          className="shrink-0 text-line-strong transition-colors group-hover:text-blue"
        />
      </button>
    </div>
  );
}

function DocRow({
  doc,
  checked,
  onToggle,
}: {
  doc: DocumentItem;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <div role="listitem" className={`${ROW} ${checked ? "bg-ice/60 hover:bg-ice" : "hover:bg-ice"}`}>
      <Checkbox
        state={checked ? "checked" : "unchecked"}
        onToggle={onToggle}
        label={`Select ${doc.filename}`}
      />
      <button
        type="button"
        onClick={onToggle}
        className="flex min-h-12 min-w-0 flex-1 items-center gap-3 py-2 text-left"
      >
        <File
          size={18}
          strokeWidth={1.75}
          className={checked ? "shrink-0 text-navy" : "shrink-0 text-tertiary"}
        />
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">{doc.filename}</span>
        {doc.size != null && (
          <span className="hidden shrink-0 pr-7 font-mono text-xs text-secondary sm:block">
            {formatBytes(doc.size)}
          </span>
        )}
      </button>
    </div>
  );
}

function FolderCard({
  node,
  state,
  subtitle,
  onOpen,
  onToggle,
}: {
  node: FolderNode;
  state: CheckState;
  subtitle?: string;
  onOpen: () => void;
  onToggle: () => void;
}) {
  const selected = state !== "unchecked";
  const count = node.children.length;
  return (
    <div
      className={`group relative rounded-panel border transition-colors duration-[180ms] ease-sh ${
        selected ? "border-blue-soft bg-ice" : "border-line bg-paper hover:border-line-strong hover:bg-ice"
      }`}
    >
      <Checkbox
        state={state}
        onToggle={onToggle}
        label={`Select ${node.name}`}
        className="absolute right-4 top-4 z-10"
      />
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full flex-col items-start gap-4 rounded-panel p-4 text-left"
      >
        {selected ? (
          <FolderOpen size={28} strokeWidth={1.5} className="text-navy" />
        ) : (
          <Folder size={28} strokeWidth={1.5} className="text-blue-soft" />
        )}
        <span className="w-full">
          <span className="block truncate text-sm font-semibold text-ink">{node.name}</span>
          <span className="mt-0.5 block truncate text-xs text-secondary">
            {subtitle ?? (count === 0 ? "No subfolders" : `${count} ${count === 1 ? "subfolder" : "subfolders"}`)}
          </span>
        </span>
      </button>
    </div>
  );
}

function Breadcrumb({
  crumbs,
  searching,
  onNavigate,
}: {
  crumbs: FolderNode[];
  searching: boolean;
  onNavigate: (id: number | null) => void;
}) {
  const atRoot = crumbs.length === 0 && !searching;
  const link =
    "shrink-0 rounded-full py-2 font-medium text-secondary transition-colors duration-[120ms] ease-sh hover:text-navy";
  return (
    <nav
      aria-label="Folder path"
      className="flex min-w-0 items-center gap-1.5 overflow-x-auto overflow-y-hidden whitespace-nowrap py-1 text-sm"
    >
      {atRoot ? (
        <h1 className="shrink-0 text-xl text-ink">All Folders</h1>
      ) : (
        <button type="button" onClick={() => onNavigate(null)} className={link}>
          All Folders
        </button>
      )}

      {searching && (
        <>
          <ChevronRight size={14} className="shrink-0 text-line-strong" />
          <h1 className="shrink-0 text-xl text-ink">Search results</h1>
        </>
      )}

      {!searching &&
        crumbs.map((node, i) => {
          const isLast = i === crumbs.length - 1;
          return (
            <span key={node.id} className="flex shrink-0 items-center gap-1.5">
              <ChevronRight size={14} className="text-line-strong" />
              {isLast ? (
                <h1 className="max-w-[46vw] truncate text-xl text-ink sm:max-w-sm">{node.name}</h1>
              ) : (
                <button
                  type="button"
                  onClick={() => onNavigate(node.id)}
                  className={`${link} max-w-[28vw] truncate sm:max-w-[12rem]`}
                >
                  {node.name}
                </button>
              )}
            </span>
          );
        })}
    </nav>
  );
}

function ViewToggle({
  active,
  onClick,
  label,
  children,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      aria-pressed={active}
      className={`sh-hit-sm flex h-9 w-10 items-center justify-center rounded-full transition-colors duration-[180ms] ease-sh ${
        active ? "bg-solid text-navy shadow-raised" : "text-secondary hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}

function EmptyState({
  searching,
  query,
  hasFolders,
}: {
  searching: boolean;
  query: string;
  hasFolders: boolean;
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-20 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-ice text-navy">
        {searching ? <Search size={22} strokeWidth={1.75} /> : <FolderOpen size={24} strokeWidth={1.75} />}
      </span>
      {searching ? (
        <>
          <p className="mt-5 text-lg font-semibold text-ink">No matching folders</p>
          <p className="mt-1 max-w-sm text-sm text-secondary">
            No folders match &ldquo;{query.trim()}&rdquo;. Try a different term.
          </p>
        </>
      ) : !hasFolders ? (
        <>
          <p className="mt-5 text-lg font-semibold text-ink">No folders in this project</p>
          <p className="mt-1 max-w-sm text-sm text-secondary">
            All documents in the project will be included in the download.
          </p>
        </>
      ) : (
        <>
          <p className="mt-5 text-lg font-semibold text-ink">This folder is empty</p>
          <p className="mt-1 max-w-sm text-sm text-secondary">No documents or subfolders here.</p>
        </>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- sidebar */

function SidebarItem({
  label,
  icon,
  depth,
  active,
  hasChildren,
  expanded,
  onToggleExpand,
  onClick,
}: {
  label: string;
  icon: React.ReactNode;
  depth: number;
  active: boolean;
  hasChildren?: boolean;
  expanded?: boolean;
  onToggleExpand?: () => void;
  onClick: () => void;
}) {
  return (
    <div
      className={`group flex items-center rounded-full transition-colors duration-[120ms] ease-sh ${
        active ? "bg-solid shadow-raised" : "hover:bg-solid/70"
      }`}
      style={{ marginLeft: `${depth * 14}px` }}
    >
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onToggleExpand?.();
        }}
        tabIndex={hasChildren ? 0 : -1}
        aria-label={expanded ? "Collapse" : "Expand"}
        aria-hidden={hasChildren ? undefined : true}
        className={`flex h-10 w-8 shrink-0 items-center justify-center rounded-full text-secondary ${
          hasChildren ? "hover:text-navy" : "invisible"
        }`}
      >
        {expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
      </button>
      <button
        type="button"
        onClick={onClick}
        aria-current={active ? "page" : undefined}
        className={`flex min-h-10 min-w-0 flex-1 items-center gap-2 rounded-full py-1.5 pr-4 text-left ${
          active ? "text-navy" : "text-ink"
        }`}
      >
        <span className={active ? "shrink-0 text-navy" : "shrink-0 text-blue-soft"}>{icon}</span>
        <span className={`min-w-0 flex-1 truncate text-sm ${active ? "font-semibold" : "font-medium"}`}>
          {label}
        </span>
      </button>
    </div>
  );
}

function SidebarNode({
  node,
  depth,
  currentFolderId,
  expanded,
  onNavigate,
  onToggleExpand,
}: {
  node: FolderNode;
  depth: number;
  currentFolderId: number | null;
  expanded: Set<number>;
  onNavigate: (id: number) => void;
  onToggleExpand: (id: number) => void;
}) {
  const isExpanded = expanded.has(node.id);
  const hasChildren = node.children.length > 0;

  return (
    <div>
      <SidebarItem
        label={node.name}
        icon={
          isExpanded && hasChildren ? (
            <FolderOpen size={16} strokeWidth={1.75} />
          ) : (
            <Folder size={16} strokeWidth={1.75} />
          )
        }
        depth={depth}
        active={currentFolderId === node.id}
        hasChildren={hasChildren}
        expanded={isExpanded}
        onToggleExpand={() => onToggleExpand(node.id)}
        onClick={() => onNavigate(node.id)}
      />
      {isExpanded &&
        hasChildren &&
        node.children.map((child) => (
          <SidebarNode
            key={child.id}
            node={child}
            depth={depth + 1}
            currentFolderId={currentFolderId}
            expanded={expanded}
            onNavigate={onNavigate}
            onToggleExpand={onToggleExpand}
          />
        ))}
    </div>
  );
}
