# FVD — Filevine Document Downloader

Internal Strong & Hanni tool. Browse a Filevine project's folders, select
folders and/or individual documents, and download them as a ZIP — optionally
converting documents (PDF, Word, text, CSV, …) to Markdown on the way. Or go
the other way: upload files from this computer into a Filevine folder, either
as a reviewed batch or by watching a local folder.

## Download flow

1. **Review & Download** builds the document list for the selection (nothing is
   fetched yet) and shows it grouped by folder, with counts and which files
   will be converted to Markdown.
2. **Save ZIP** asks where to save (Chromium) and streams the archive to disk;
   other browsers fall back to an in-memory Blob save.
3. **Large runs are split into parts.** Above 1,000 files (`PART_MAX_FILES`)
   the run is divided into ZIPs of at most 1,000 files each, named
   `…-part-01-of-12.zip`. You pick a **folder** once; each part is streamed
   into it and is safely on disk before the next begins. Parts follow the
   folder order, so each covers a contiguous range of Filevine folders. A
   `_DOWNLOAD REPORT.txt` in the folder lists every part and anything missing.
   If a part fails (disk full, network gone), the finished parts stay and
   **Resume from part N** carries on without re-fetching them.
4. **Folder structure is preserved.** The project's folder list is fetched in
   full (Filevine pages it at 1,000 folders; archived folders are included for
   path lookup but hidden from the browser). Any folder a document references
   that the list did not cover is looked up individually, following parent
   chains, before the review step. A folder that still cannot be identified
   is never silently dropped to the root: its documents go under
   `_Unknown folder <id>` and the review screen shows the count.
5. Files are fetched four at a time with retries (throttling backs off longer).
   Folder and file names are sanitised so the ZIP extracts cleanly on Windows;
   duplicates are suffixed ` (2)`, ` (3)`, ….
6. If anything fails, the missing files are listed in the drawer and in
   `_DOWNLOAD REPORT.txt` inside the archive, and **Retry failed files** fetches
   just those into a second ZIP.
7. The internal Filevine session token lives 15 minutes. The client renews it
   90 seconds before expiry, and the API routes answer an expired token with
   `401` (never `500`) so the client refreshes and retries instead of failing
   the file. Long runs are unaffected by the token lifetime.

## Upload flow

1. Open the Filevine folder you want files to land in (or stay at "All
   Folders" for the project root) and click **Upload to …**, or drag files or
   folders onto the folder browser.
2. **Review**: the drawer lists every file grouped by destination. Dropped
   folders keep their structure — missing Filevine subfolders are created.
   Files already in the destination with the same name and size are skipped
   (tick "Upload them anyway" to send copies); same name but different size
   is flagged and uploaded as a new document. Nothing is sent until you confirm.
3. **Upload**: three files at a time with retries. Each file is a three-step
   Filevine exchange — request an upload slot (`POST /Documents`), PUT the
   bytes straight from the browser to Filevine's storage URL (they never pass
   through Vercel), then commit (`POST /Projects/{id}/Documents/{docId}`).
   Filevine records the signed-in person as the uploader when their email
   matches a Filevine user; otherwise the shared API account.
4. Failed files are listed and **Retry failed files** sends only those.

### Watch a folder (Chromium)

From the upload review, **watch a folder on this computer**: pick a local
folder once and, while the tab is open, anything placed in it is uploaded to
the chosen Filevine folder as soon as it has stopped changing for a few
seconds. Uploaded files are moved into `_Uploaded to Filevine` inside the
watched folder; a ledger in the browser prevents re-sending even if that move
fails. The watch is remembered and can be resumed with one click on the next
visit. This is not a background service: close the tab and uploading pauses.

Sign-in uses **Microsoft Entra ID** (the firm's M365 tenant) via Auth.js.

## Development

```bash
npm install
cp .env.local.example .env.local   # fill in the values below
npm run dev
```

## Environment variables

See [.env.local.example](.env.local.example). For production, set the same
variables in **Vercel → Project Settings → Environment Variables**.

| Variable | Purpose |
| --- | --- |
| `AUTH_SECRET` | Auth.js session encryption (`openssl rand -base64 32`) |
| `AUTH_MICROSOFT_ENTRA_ID_ID` | Entra app registration → Application (client) ID |
| `AUTH_MICROSOFT_ENTRA_ID_SECRET` | Entra app registration → client secret value |
| `AUTH_MICROSOFT_ENTRA_ID_ISSUER` | `https://login.microsoftonline.com/<tenant-id>/v2.0` |
| `FILEVINE_PAT` | Filevine personal access token |
| `FILEVINE_CLIENT_ID` / `FILEVINE_CLIENT_SECRET` | Filevine API client |
| `SESSION_SECRET` | Signs the short-lived internal Filevine session JWT |

`AUTH_SECRET` must be set in production or sessions silently fail.

## Entra app registration (one-time setup)

1. Azure Portal → **Microsoft Entra ID** → **App registrations** → **New registration**.
2. Name it (e.g. `FVD — Filevine Downloader`).
3. **Supported account types**: *Accounts in this organizational directory only* (single tenant).
4. **Redirect URI** (type *Web*) — add both under *Authentication*:
   - Dev: `http://localhost:3000/api/auth/callback/microsoft-entra-id`
   - Prod: `https://fvd.sandh.app/api/auth/callback/microsoft-entra-id`
5. Copy the **Application (client) ID** and **Directory (tenant) ID** into the env vars above.
6. **Certificates & secrets** → **New client secret** → copy the secret **Value**
   (shown only once — if lost, create a new one).
7. Optional, to limit access to specific people: in the app's *Enterprise
   application* → *Properties*, set **Assignment required** to *Yes*, then
   assign users/groups under *Users and groups*. No code change needed —
   otherwise anyone in the tenant can sign in.

## Auth architecture

- `src/lib/auth.ts` — Auth.js v5 config (Entra provider, JWT sessions, no DB).
- `src/app/api/auth/[...nextauth]/route.ts` — OAuth callback handlers.
- `src/proxy.ts` — returns 401 for `/api/*` without an Entra session.
- `src/app/page.tsx` — server-side `auth()` check; renders the Microsoft
  sign-in landing or the app.
- `src/app/api/fv-session/route.ts` — exchanges the server's Filevine PAT for
  an access token and returns a short-lived signed JWT to the client; requires
  an Entra session. All other `/api/*` routes verify that JWT.
