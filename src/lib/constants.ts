export const API_ROOT = "https://api.filevineapp.com/fv-app/v2";
export const IDENTITY_URL = "https://identity.filevine.com/connect/token";
export const LOCATOR_BATCH_SIZE = 10;
export const DOWNLOAD_CONCURRENCY = 4;
export const SESSION_TTL_SECONDS = 15 * 60; // 15 minutes
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
