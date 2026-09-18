import { FilevineError } from "./filevine";

/**
 * Push file bytes to Filevine's pre-signed storage URL from the server.
 * `body` may be a Buffer/Blob (small relay) or a ReadableStream (Blob path);
 * `size` must be the exact byte count because S3 requires Content-Length.
 */
export async function putToFilevineStorage(
  url: string,
  body: Blob | Uint8Array | ReadableStream<Uint8Array>,
  size: number,
  contentType: string
): Promise<void> {
  const init: RequestInit & { duplex?: "half" } = {
    method: "PUT",
    headers: { "Content-Type": contentType, "Content-Length": String(size) },
    body: body as BodyInit,
  };
  if (body instanceof ReadableStream) init.duplex = "half";
  const res = await fetch(url, init);
  if (!res.ok) {
    const status = res.status === 403 ? 403 : res.status;
    throw new FilevineError(
      res.status === 403
        ? "The Filevine upload link expired before the file finished sending"
        : `Filevine storage rejected the file (HTTP ${res.status})`,
      status
    );
  }
}
