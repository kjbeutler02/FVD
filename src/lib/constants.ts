export const API_ROOT = "https://api.filevineapp.com/fv-app/v2";
export const IDENTITY_URL = "https://identity.filevine.com/connect/token";
export const LOCATOR_BATCH_SIZE = 10;
export const DOWNLOAD_CONCURRENCY = 4;
export const SESSION_TTL_SECONDS = 15 * 60; // 15 minutes
// The client mints a new session token this long before the current one
// expires, so a long download never hits the expiry mid-run.
export const SESSION_REFRESH_MARGIN_SECONDS = 90;
// Per-file download attempts (the proxy route already fails fast on bad input).
export const MAX_RETRIES = 4;
// Attempts per document-list page during the scan; one throttled page must
// not abort the whole run.
export const SCAN_RETRIES = 4;
// Name of the failure report written into the ZIP when some files could not
// be downloaded. Prefixed so it sorts first and is obviously not a case file.
export const REPORT_FILENAME = "_DOWNLOAD REPORT.txt";

// Folder-scoped document scan: how many selected folders to query in parallel,
// and the max number of selected folders before we fall back to a single
// project-wide scan (cheaper than thousands of per-folder requests).
export const FOLDER_SCAN_CONCURRENCY = 6;
export const FOLDER_SCOPED_MAX = 100;

// Large downloads are split into several ZIP files ("parts") of at most this
// many files each, saved into a folder the user picks. Each finished part is
// safely on disk before the next begins, so a failure late in a 12,000-file
// run costs one part instead of everything.
export const PART_MAX_FILES = 1000;
// Name of the folder-level summary written next to the parts of a split run.
export const RUN_REPORT_FILENAME = "_DOWNLOAD REPORT.txt";

// Folder list paging: Filevine returns at most this many folders per page.
// Every page is fetched so projects with thousands of folders keep their paths.
export const FOLDER_PAGE_SIZE = 1000;
// Documents in folders the list did not cover (deleted, moved, permissions)
// are resolved one folder at a time: ids per request, and upstream fetches
// in flight per request.
export const FOLDER_RESOLVE_BATCH = 25;
export const FOLDER_RESOLVE_CONCURRENCY = 4;
// Archive folder for documents whose Filevine folder could not be identified.
export const UNKNOWN_FOLDER_PREFIX = "_Unknown folder";

// Uploads: files sent to Filevine at once, attempts per file, and the
// interval at which a watched local folder is rescanned for new files.
export const UPLOAD_CONCURRENCY = 3;
export const UPLOAD_MAX_RETRIES = 4;
export const WATCH_SCAN_INTERVAL_MS = 5000;
// A file whose size is still changing between two scans is being written by
// another program; leave it until it has been stable for this long.
export const WATCH_STABLE_MS = 4000;
// Folder inside a watched folder where uploaded files are moved.
export const WATCH_DONE_DIRNAME = "_Uploaded to Filevine";
// Report written next to a batch's files (in-browser download) summarising an upload run.
export const UPLOAD_REPORT_FILENAME = "_UPLOAD REPORT.txt";

// Filevine's storage bucket allows no cross-origin requests, so file bytes
// must pass through our server. Vercel caps a function's request body at
// 4.5 MB: files up to this size are relayed in one request; larger files are
// staged in Vercel Blob (browser → Blob directly, then server → Filevine).
export const RELAY_MAX_BYTES = 4 * 1024 * 1024;
// Largest single file the Blob path accepts.
export const LARGE_FILE_MAX_BYTES = 5 * 1024 * 1024 * 1024;
