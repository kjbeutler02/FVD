"use client";

import { useState, useMemo, useCallback } from "react";
import {
  ChevronRight,
  ChevronDown,
  Folder,
  FolderOpen,
  Check,
  Minus,
  Download,
} from "lucide-react";
import type { FolderNode } from "@/types/filevine";

interface Props {
  tree: FolderNode[];
  onDownload: (selectedFolderIds: Set<number> | null) => void;
}

type CheckState = "checked" | "unchecked" | "indeterminate";

function getAllFolderIds(nodes: FolderNode[]): Set<number> {
  const ids = new Set<number>();
  function walk(node: FolderNode) {
    ids.add(node.id);
    node.children.forEach(walk);
  }
  nodes.forEach(walk);
  return ids;
}

function getDescendantIds(node: FolderNode): Set<number> {
  const ids = new Set<number>();
  function walk(n: FolderNode) {
    ids.add(n.id);
    n.children.forEach(walk);
  }
  walk(node);
  return ids;
}

export default function FolderTree({ tree, onDownload }: Props) {
  const allIds = useMemo(() => getAllFolderIds(tree), [tree]);
  const [selected, setSelected] = useState<Set<number>>(() => new Set(allIds));
  const [expanded, setExpanded] = useState<Set<number>>(() => {
    // Auto-expand root nodes
    return new Set(tree.map((n) => n.id));
  });

  const allSelected = selected.size === allIds.size;
  const selectedFolderCount = selected.size;

  function toggleExpand(id: number) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function getCheckState(node: FolderNode): CheckState {
    const descendants = getDescendantIds(node);
    let checkedCount = 0;
    for (const id of descendants) {
      if (selected.has(id)) checkedCount++;
    }
    if (checkedCount === 0) return "unchecked";
    if (checkedCount === descendants.size) return "checked";
    return "indeterminate";
  }

  const toggleNode = useCallback(
    (node: FolderNode) => {
      const descendants = getDescendantIds(node);
      setSelected((prev) => {
        const next = new Set(prev);
        const state = getCheckStateFromSet(node, prev, allIds);
        if (state === "checked") {
          for (const id of descendants) next.delete(id);
        } else {
          for (const id of descendants) next.add(id);
        }
        return next;
      });
    },
    [allIds]
  );

  function handleSelectAll() {
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(allIds));
    }
  }

  function handleDownload() {
    if (selected.size === allIds.size) {
      onDownload(null); // All folders = no filter
    } else {
      onDownload(selected);
    }
  }

  return (
    <div className="mx-auto max-w-2xl">
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
        <div className="p-6 border-b border-gray-200">
          <div className="flex items-center justify-between mb-1">
            <h2 className="text-lg font-semibold text-gray-900">Project Folders</h2>
            <button
              onClick={handleSelectAll}
              className="text-sm text-blue-600 hover:text-blue-700 font-medium"
            >
              {allSelected ? "Deselect All" : "Select All"}
            </button>
          </div>
          <p className="text-sm text-gray-500">
            {allIds.size} folders &middot; {selectedFolderCount} selected
          </p>
        </div>

        <div className="max-h-96 overflow-y-auto p-4">
          {tree.map((node) => (
            <TreeNode
              key={node.id}
              node={node}
              depth={0}
              expanded={expanded}
              selected={selected}
              allIds={allIds}
              onToggleExpand={toggleExpand}
              onToggleSelect={toggleNode}
              getCheckState={getCheckState}
            />
          ))}
        </div>

        <div className="p-4 border-t border-gray-200">
          <button
            onClick={handleDownload}
            disabled={selectedFolderCount === 0}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg bg-blue-600 text-white font-medium text-sm hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <Download size={18} />
            Download Selected Folders as ZIP
          </button>
        </div>
      </div>
    </div>
  );
}

function getCheckStateFromSet(
  node: FolderNode,
  selected: Set<number>,
  _allIds: Set<number>
): CheckState {
  const descendants = getDescendantIds(node);
  let checkedCount = 0;
  for (const id of descendants) {
    if (selected.has(id)) checkedCount++;
  }
  if (checkedCount === 0) return "unchecked";
  if (checkedCount === descendants.size) return "checked";
  return "indeterminate";
}

interface TreeNodeProps {
  node: FolderNode;
  depth: number;
  expanded: Set<number>;
  selected: Set<number>;
  allIds: Set<number>;
  onToggleExpand: (id: number) => void;
  onToggleSelect: (node: FolderNode) => void;
  getCheckState: (node: FolderNode) => CheckState;
}

function TreeNode({
  node,
  depth,
  expanded,
  selected,
  allIds,
  onToggleExpand,
  onToggleSelect,
  getCheckState,
}: TreeNodeProps) {
  const isExpanded = expanded.has(node.id);
  const hasChildren = node.children.length > 0;
  const checkState = getCheckState(node);

  return (
    <div>
      <div
        className="flex items-center gap-1 py-1 px-2 rounded hover:bg-gray-50 cursor-pointer group"
        style={{ paddingLeft: `${depth * 20 + 8}px` }}
      >
        {/* Expand toggle */}
        <button
          onClick={() => hasChildren && onToggleExpand(node.id)}
          className={`p-0.5 ${hasChildren ? "text-gray-400" : "invisible"}`}
        >
          {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </button>

        {/* Checkbox */}
        <button
          onClick={() => onToggleSelect(node)}
          className={`
            flex items-center justify-center w-4 h-4 rounded border transition-colors mr-1
            ${checkState === "checked" ? "bg-blue-600 border-blue-600 text-white" : ""}
            ${checkState === "indeterminate" ? "bg-blue-600 border-blue-600 text-white" : ""}
            ${checkState === "unchecked" ? "border-gray-300 hover:border-blue-400" : ""}
          `}
        >
          {checkState === "checked" && <Check size={12} />}
          {checkState === "indeterminate" && <Minus size={12} />}
        </button>

        {/* Folder icon */}
        {isExpanded ? (
          <FolderOpen size={16} className="text-blue-500 shrink-0" />
        ) : (
          <Folder size={16} className="text-gray-400 shrink-0" />
        )}

        {/* Name */}
        <span
          className="text-sm text-gray-700 truncate ml-1"
          onClick={() => hasChildren && onToggleExpand(node.id)}
        >
          {node.name}
        </span>

      </div>

      {/* Children */}
      {isExpanded &&
        hasChildren &&
        node.children.map((child) => (
          <TreeNode
            key={child.id}
            node={child}
            depth={depth + 1}
            expanded={expanded}
            selected={selected}
            allIds={allIds}
            onToggleExpand={onToggleExpand}
            onToggleSelect={onToggleSelect}
            getCheckState={getCheckState}
          />
        ))}
    </div>
  );
}
