import { fetchWithAuth, errorFromResponse, currentAuthHeader, HttpError, withRetry } from "@/lib/api";
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
  contentType: string;
  /** Signed pass for sending this file's bytes through our server. */
  ticket: string;
  /** Whether Filevine will record the signed-in user (not the shared credential) as uploader. */
  attributed: boolean;
}

export interface UploadConfig {
  relayMaxBytes: number;
  largeFiles: boolean;
  largeFileMaxBytes: number;
}

export async function fetchUploadConfig(): Promise<UploadConfig> {
  const res = await fetchWithAuth("/api/upload/config");
  if (!res.ok) throw await errorFromResponse(res, "Could not read upload settings");
  return res.json();
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
 * Small files: send the bytes to our server, which pushes them on to Filevine
 * storage (the bucket allows no cross-origin requests, so the browser cannot
 * PUT there itself). XHR rather than fetch so upload progress is observable.
 */
export async function sendViaRelay(
  ticket: string,
  file: Blob,
  contentType: string,
  onProgress: (loadedBytes: number) => void,
  signal?: AbortSignal
): Promise<void> {
  const authHeader = await currentAuthHeader();
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException("Aborted", "AbortError"));
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/upload/put");
    xhr.setRequestHeader("Authorization", authHeader);
    xhr.setRequestHeader("x-upload-ticket", ticket);
    xhr.setRequestHeader("Content-Type", contentType);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) return resolve();
      let detail = "";
      try {
        detail = JSON.parse(xhr.responseText).error ?? "";
      } catch {
        /* not JSON */
      }
      if (xhr.status === 401) reject(new HttpError(detail || "Session expired", 401));
      else if (xhr.status === 403) reject(new StorageError(detail || "The upload link expired", 403));
      else reject(new StorageError(detail || `The server could not send the file (HTTP ${xhr.status})`, xhr.status));
    };
    xhr.onerror = () => reject(new StorageError("Network error while sending the file", 0));
    xhr.ontimeout = () => reject(new StorageError("Sending the file timed out", 408));
    xhr.onabort = () => reject(new DOMException("Aborted", "AbortError"));
    signal?.addEventListener("abort", () => xhr.abort(), { once: true });
    xhr.send(file);
  });
}

/**
 * Large files: stage the file in Vercel Blob straight from the browser (any
 * size, resumable parts), then ask our server to stream it on to Filevine.
 */
export async function sendViaBlob(
  ticket: string,
  file: Blob,
  filename: string,
  onProgress: (loadedBytes: number) => void,
  signal?: AbortSignal
): Promise<void> {
  const { upload } = await import("@vercel/blob/client");
  const staged = await upload(`fvd-staging/${Date.now()}-${filename}`, file, {
    access: "private",
    handleUploadUrl: "/api/upload/blob-token",
    multipart: true,
    abortSignal: signal,
    onUploadProgress: ({ loaded }) => onProgress(loaded),
  });
  // The relay route deletes the staged copy whether or not the hand-off to
  // Filevine succeeds.
  const res = await fetchWithAuth("/api/upload/relay", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ticket, blobUrl: staged.url }),
    signal,
  });
  if (!res.ok) {
    const err = await errorFromResponse(res, "The server could not send the staged file to Filevine");
    throw err.status === 403 ? new StorageError(err.message, 403) : err;
  }
}

/** Whether an upload step is worth retrying (throttling, server or network trouble, expired link). */
export function isUploadRetryable(err: unknown): boolean {
  if (err instanceof DOMException && err.name === "AbortError") return false;
  if (err instanceof StorageError) return err.status === 0 || err.status === 403 || err.status === 408 || err.status >= 500;
  if (err instanceof HttpError) return err.status === 408 || err.status === 429 || err.status >= 500;
  return err instanceof TypeError;
}
