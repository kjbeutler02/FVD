# FVD — Filevine Document Downloader

Internal Strong & Hanni tool. Browse a Filevine project's folders, select
folders and/or individual documents, and download them as a ZIP — optionally
converting documents (PDF, Word, text, CSV, …) to Markdown on the way.

## Download flow

1. **Review & Download** builds the document list for the selection (nothing is
   fetched yet) and shows it grouped by folder, with counts and which files
   will be converted to Markdown.
2. **Save ZIP** asks where to save (Chromium) and streams the archive to disk;
   other browsers fall back to an in-memory Blob save.
3. Files are fetched four at a time with retries (throttling backs off longer).
   Folder and file names are sanitised so the ZIP extracts cleanly on Windows;
   duplicates are suffixed ` (2)`, ` (3)`, ….
4. If anything fails, the missing files are listed in the drawer and in
   `_DOWNLOAD REPORT.txt` inside the archive, and **Retry failed files** fetches
   just those into a second ZIP.

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
