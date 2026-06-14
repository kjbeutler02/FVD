"use client";

import { useState, useMemo, useCallback } from "react";
import {
  ChevronRight,
  ChevronDown,
  ChevronLeft,
  Folder,
  FolderOpen,
  Folders,
  Check,
  Minus,
  Download,
  Search,
  LayoutGrid,
  List as ListIcon,
  X,
} from "lucide-react";
import type { FolderNode } from "@/types/filevine";

type CheckState = "checked" | "unchecked" | "indeterminate";
type ViewMode = "list" | "grid";

interface Props {
  tree: FolderNode[];
  projectId: number;
  onDownload: (selectedFolderIds: Set<number> | null) => void;
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

/* ---------------------------------------------------------------- view */

export default function DriveView({ tree, projectId, onDownload }: Props) {
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

  const searching = query.trim().length > 0;

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

  const allSelected = selected.size === allIds.size && allIds.size > 0;
  const noneSelected = selected.size === 0;

  const navigate = useCallback((id: number | null) => {
    setCurrentFolderId(id);
    setQuery("");
  }, []);

  const toggleExpand = useCallback((id: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleSelect = useCallback((node: FolderNode) => {
    setSelected((prev) => {
      const next = new Set(prev);
      const descendants = getDescendantIds(node);
      const state = checkState(node, prev);
      if (state === "checked") {
        for (const id of descendants) next.delete(id);
      } else {
        for (const id of descendants) next.add(id);
      }
      return next;
    });
  }, []);

  const selectAll = () => setSelected(new Set(allIds));
  const clearAll = () => setSelected(new Set());

  const handleDownload = () => {
    if (allIds.size === 0 || allSelected) onDownload(null);
    else onDownload(selected);
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

  const canDownload = allIds.size === 0 || selected.size > 0;

  return (
    <div className="mx-auto flex w-full max-w-[1600px] flex-1 overflow-hidden">
      {/* Sidebar */}
      <aside className="hidden w-72 shrink-0 flex-col border-r border-line bg-surface lg:flex">
        <div className="border-b border-line px-5 py-5">
          <p className="text-[0.65rem] font-semibold uppercase tracking-[0.2em] text-muted">
            Project
          </p>
          <p className="mt-1 text-xl font-bold text-ink">#{projectId}</p>
          <p className="mt-0.5 text-xs font-light text-muted">
            {allIds.size} {allIds.size === 1 ? "folder" : "folders"}
          </p>
        </div>

        <nav className="flex-1 overflow-y-auto px-2.5 py-3">
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
        </nav>
      </aside>

      {/* Main */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Toolbar */}
        <div className="flex flex-col gap-3 border-b border-line bg-surface px-4 py-3 sm:px-6">
          <div className="flex items-center gap-2">
            {currentFolderId != null && !searching && (
              <button
                type="button"
                onClick={() =>
                  navigate(parentById.get(currentFolderId) ?? null)
                }
                aria-label="Go up one level"
                className="-ml-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-sm text-muted transition-colors hover:bg-canvas hover:text-ink"
              >
                <ChevronLeft size={18} />
              </button>
            )}
            <Breadcrumb
              crumbs={crumbs}
              searching={searching}
              onNavigate={navigate}
            />
          </div>

          <div className="flex items-center justify-between gap-3">
            <p className="truncate text-xs font-light text-muted">
              {searching
                ? `${items.length} ${items.length === 1 ? "match" : "matches"}`
                : `${items.length} ${items.length === 1 ? "folder" : "folders"}`}
            </p>

            <div className="flex items-center gap-2">
              <div className="relative">
                <Search
                  size={15}
                  className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted"
                />
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Filter folders"
                  className="w-36 rounded-sm border border-line bg-surface py-1.5 pl-8 pr-7 text-sm text-ink placeholder-muted/70 transition-colors focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand-light/40 sm:w-52"
                />
                {searching && (
                  <button
                    type="button"
                    onClick={() => setQuery("")}
                    aria-label="Clear filter"
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted hover:text-ink"
                  >
                    <X size={14} />
                  </button>
                )}
              </div>

              <div className="flex items-center rounded-sm border border-line p-0.5">
                <ViewToggle
                  active={view === "list"}
                  onClick={() => setView("list")}
                  label="List view"
                >
                  <ListIcon size={16} />
                </ViewToggle>
                <ViewToggle
                  active={view === "grid"}
                  onClick={() => setView("grid")}
                  label="Grid view"
                >
                  <LayoutGrid size={16} />
                </ViewToggle>
              </div>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-6">
          {items.length === 0 ? (
            <EmptyState searching={searching} query={query} hasFolders={allIds.size > 0} />
          ) : view === "grid" ? (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(170px,1fr))] gap-3">
              {items.map((node) => (
                <FolderCard
                  key={node.id}
                  node={node}
                  state={checkState(node, selected)}
                  subtitle={searching ? pathLabel(node) : undefined}
                  onOpen={() => navigate(node.id)}
                  onToggle={() => toggleSelect(node)}
                />
              ))}
            </div>
          ) : (
            <div className="overflow-hidden rounded-md border border-line bg-surface">
              {items.map((node, i) => (
                <FolderRow
                  key={node.id}
                  node={node}
                  state={checkState(node, selected)}
                  subtitle={searching ? pathLabel(node) : undefined}
                  first={i === 0}
                  onOpen={() => navigate(node.id)}
                  onToggle={() => toggleSelect(node)}
                />
              ))}
            </div>
          )}
        </div>

        {/* Selection / download bar */}
        <div className="flex flex-col gap-3 border-t border-line bg-surface px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div className="flex items-center gap-3 text-sm">
            <span className="font-medium text-ink">
              {allIds.size === 0
                ? "Whole project"
                : allSelected
                ? "All folders selected"
                : `${selected.size} of ${allIds.size} selected`}
            </span>
            {allIds.size > 0 && (
              <div className="flex items-center gap-3 text-xs font-medium uppercase tracking-wider">
                <button
                  type="button"
                  onClick={selectAll}
                  disabled={allSelected}
                  className="text-brand transition-colors hover:text-brand-dark disabled:text-muted/50"
                >
                  Select all
                </button>
                <span className="h-3 w-px bg-line" />
                <button
                  type="button"
                  onClick={clearAll}
                  disabled={noneSelected}
                  className="text-brand transition-colors hover:text-brand-dark disabled:text-muted/50"
                >
                  Clear
                </button>
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={handleDownload}
            disabled={!canDownload}
            className="flex items-center justify-center gap-2 rounded-sm bg-brand px-5 py-2.5 text-sm font-semibold uppercase tracking-wider text-white transition-colors hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Download size={17} />
            Download as ZIP
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- pieces */

function Checkbox({
  state,
  onToggle,
  className = "",
}: {
  state: CheckState;
  onToggle: () => void;
  className?: string;
}) {
  const active = state !== "unchecked";
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={state === "indeterminate" ? "mixed" : state === "checked"}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      className={`flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-sm border transition-colors ${
        active
          ? "border-brand bg-brand text-white"
          : "border-line bg-surface hover:border-brand-light"
      } ${className}`}
    >
      {state === "checked" && <Check size={12} strokeWidth={3} />}
      {state === "indeterminate" && <Minus size={12} strokeWidth={3} />}
    </button>
  );
}

function FolderRow({
  node,
  state,
  subtitle,
  first,
  onOpen,
  onToggle,
}: {
  node: FolderNode;
  state: CheckState;
  subtitle?: string;
  first: boolean;
  onOpen: () => void;
  onToggle: () => void;
}) {
  const selected = state !== "unchecked";
  const count = node.children.length;
  return (
    <div
      className={`group flex items-center gap-3 px-3 py-2.5 transition-colors sm:px-4 ${
        first ? "" : "border-t border-line"
      } ${selected ? "bg-brand-tint" : "hover:bg-canvas"}`}
    >
      <Checkbox state={state} onToggle={onToggle} />
      <button
        type="button"
        onClick={onOpen}
        className="flex min-w-0 flex-1 items-center gap-3 text-left"
      >
        <Folder
          size={18}
          strokeWidth={1.75}
          className={selected ? "shrink-0 text-brand" : "shrink-0 text-brand/70"}
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-ink">
            {node.name}
          </span>
          {subtitle && (
            <span className="block truncate text-xs font-light text-muted">
              {subtitle}
            </span>
          )}
        </span>
        <span className="hidden shrink-0 text-xs font-light text-muted sm:block">
          {count === 0 ? "No subfolders" : `${count} ${count === 1 ? "subfolder" : "subfolders"}`}
        </span>
        <ChevronRight
          size={16}
          className="shrink-0 text-muted/50 transition-colors group-hover:text-muted"
        />
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
      className={`group relative rounded-md border transition-all ${
        selected
          ? "border-brand bg-brand-tint"
          : "border-line bg-surface hover:border-brand-light/50 hover:shadow-sm"
      }`}
    >
      <Checkbox
        state={state}
        onToggle={onToggle}
        className={`absolute left-2.5 top-2.5 z-10 ${
          selected ? "" : "opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
        }`}
      />
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full flex-col items-start gap-3 p-4 text-left"
      >
        {selected ? (
          <FolderOpen size={32} strokeWidth={1.5} className="text-brand" />
        ) : (
          <Folder size={32} strokeWidth={1.5} className="text-brand/80" />
        )}
        <span className="w-full">
          <span className="block truncate text-sm font-medium text-ink">
            {node.name}
          </span>
          <span className="mt-0.5 block truncate text-xs font-light text-muted">
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
  return (
    <nav
      aria-label="Folder path"
      className="flex min-w-0 items-center gap-1 overflow-x-auto whitespace-nowrap text-sm"
    >
      <button
        type="button"
        onClick={() => onNavigate(null)}
        className={`shrink-0 transition-colors ${
          crumbs.length === 0 && !searching
            ? "font-semibold text-ink"
            : "font-medium text-muted hover:text-ink"
        }`}
      >
        All Folders
      </button>

      {searching && (
        <>
          <ChevronRight size={14} className="shrink-0 text-muted/60" />
          <span className="shrink-0 font-semibold text-ink">Search results</span>
        </>
      )}

      {!searching &&
        crumbs.map((node, i) => {
          const isLast = i === crumbs.length - 1;
          return (
            <span key={node.id} className="flex shrink-0 items-center gap-1">
              <ChevronRight size={14} className="text-muted/60" />
              {isLast ? (
                <span className="max-w-[40vw] truncate font-semibold text-ink sm:max-w-xs">
                  {node.name}
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => onNavigate(node.id)}
                  className="max-w-[28vw] truncate font-medium text-muted transition-colors hover:text-ink sm:max-w-[12rem]"
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
      aria-pressed={active}
      className={`flex h-7 w-7 items-center justify-center rounded-[3px] transition-colors ${
        active ? "bg-brand-tint text-brand" : "text-muted hover:text-ink"
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
      <div className="flex h-14 w-14 items-center justify-center rounded-md bg-canvas text-muted">
        {searching ? <Search size={24} strokeWidth={1.5} /> : <FolderOpen size={26} strokeWidth={1.5} />}
      </div>
      {searching ? (
        <>
          <p className="mt-4 text-sm font-medium text-ink">No matching folders</p>
          <p className="mt-1 max-w-sm text-sm font-light text-muted">
            No folders match &ldquo;{query.trim()}&rdquo;. Try a different term.
          </p>
        </>
      ) : !hasFolders ? (
        <>
          <p className="mt-4 text-sm font-medium text-ink">No folders in this project</p>
          <p className="mt-1 max-w-sm text-sm font-light text-muted">
            All documents in the project will be included in the download.
          </p>
        </>
      ) : (
        <>
          <p className="mt-4 text-sm font-medium text-ink">No subfolders here</p>
          <p className="mt-1 max-w-sm text-sm font-light text-muted">
            This folder has no subfolders. Its documents are still included when
            the folder is selected.
          </p>
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
      className={`group flex items-center rounded-sm transition-colors ${
        active ? "bg-brand-tint" : "hover:bg-canvas"
      }`}
      style={{ paddingLeft: `${depth * 14}px` }}
    >
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onToggleExpand?.();
        }}
        tabIndex={hasChildren ? 0 : -1}
        aria-label={expanded ? "Collapse" : "Expand"}
        className={`flex h-7 w-6 items-center justify-center text-muted ${
          hasChildren ? "hover:text-ink" : "invisible"
        }`}
      >
        {expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
      </button>
      <button
        type="button"
        onClick={onClick}
        className={`flex min-w-0 flex-1 items-center gap-2 py-1.5 pr-2 text-left ${
          active ? "text-brand" : "text-ink"
        }`}
      >
        <span className={active ? "shrink-0 text-brand" : "shrink-0 text-brand/70"}>
          {icon}
        </span>
        <span
          className={`min-w-0 flex-1 truncate text-sm ${
            active ? "font-semibold" : "font-normal"
          }`}
        >
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
