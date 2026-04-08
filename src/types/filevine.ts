export interface FolderNode {
  id: number;
  name: string;
  parentId: number | null;
  children: FolderNode[];
}

export interface DocumentItem {
  documentId: number;
  filename: string;
  folderId: number;
}

export interface DocumentPage {
  items: DocumentItem[];
  hasMore: boolean;
  lastId: number | null;
}

export interface LocatorResult {
  documentId: number;
  url?: string;
  error?: string;
}
