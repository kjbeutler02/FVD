import { fetchWithAuth, errorFromResponse, HttpError, withRetry } from "@/lib/api";
import { SCAN_RETRIES } from "@/lib/constants";

/** The storage PUT failed. status 0 = network/CORS failure; 403 usually = expired URL. */
export class StorageError extends Error {
  constructor(
    message: string,
    public readonly status: number
  ) {
    super(message);
    this.name = "StorageError";
  }
}

export interface UploadSlotResponse {
  documentId: number;
  url: string;
  contentType: string | null;
  /** Whether Filevine will record the signed-in user (not the shared credential) as uploader. */
  attributed: boolean;
}

export async function requestUploadSlot(
  params: { projectId: number; folderId: number; filename: string; size: number },
  signal?: AbortSignal
): Promise<UploadSlotResponse> {
  const res = await fetchWithAuth("/api/upload/slot", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
    signal,
  });
  if (!res.ok) throw await errorFromResponse(res, "Filevine did not accept the upload request");
  return res.json();
}

export async function commitUpload(
  params: { projectId: number; folderId: number; documentId: number },
  signal?: AbortSignal
): Promise<{ documentId: number; filename: string }> {
  const res = await fetchWithAuth("/api/upload/commit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
    signal,
  });
  if (!res.ok) throw await errorFromResponse(res, "Filevine did not file the uploaded document");
  return res.json();
}

export async function createFolderApi(
  params: { projectId: number; parentId: number; name: string },
  signal?: AbortSignal
): Promise<{ folderId: number; name: string; parentId: number }> {
  return withRetry(
    async () => {
      const res = await fetchWithAuth("/api/folders/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
        signal,
      });
      if (!res.ok) throw await errorFromResponse(res, `Could not create folder "${params.name}"`);
      return res.json();
    },
    SCAN_RETRIES,
    signal
  );
}

/**
 * Send the file bytes straight to Filevine's storage URL. XHR rather than
 * fetch so upload progress is observable. Resolves when storage has the
 * whole file.
 */
export function putToStorage(
  url: string,
  file: Blob,
  contentType: string,
  onProgress: (loadedBytes: number) => void,
  signal?: AbortSignal
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException("Aborted", "AbortError"));
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", contentType);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else if (xhr.status === 403) {
        reject(new StorageError("The upload link expired before the file finished sending", 403));
      } else reject(new StorageError(`Storage rejected the file (HTTP ${xhr.status})`, xhr.status));
    };
    xhr.onerror = () =>
      reject(
        new StorageError(
          "The file could not be sent to Filevine storage (network error or the browser was blocked from reaching it)",
          0
        )
      );
    xhr.ontimeout = () => reject(new StorageError("Sending the file timed out", 408));
    xhr.onabort = () => reject(new DOMException("Aborted", "AbortError"));
    const onAbort = () => xhr.abort();
    signal?.addEventListener("abort", onAbort, { once: true });
    xhr.send(file);
  });
}

/** Whether an upload step is worth retrying (throttling, server or network trouble, expired link). */
export function isUploadRetryable(err: unknown): boolean {
  if (err instanceof DOMException && err.name === "AbortError") return false;
  if (err instanceof StorageError) return err.status === 0 || err.status === 403 || err.status === 408 || err.status >= 500;
  if (err instanceof HttpError) return err.status === 408 || err.status === 429 || err.status >= 500;
  return err instanceof TypeError;
}
