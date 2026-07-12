"use client";

// Minimum extractable characters before we trust a conversion. Scanned PDFs
// with no OCR (and empty documents) yield little or nothing — below this we
// keep the original file.
const MIN_TEXT_CHARS = 32;

// CSVs beyond these bounds render as a fenced block instead of a table.
const CSV_TABLE_MAX_ROWS = 1000;
const CSV_TABLE_MAX_COLS = 24;

function extension(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot > 0 ? filename.slice(dot + 1).toLowerCase() : "";
}

function title(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot > 0 ? filename.slice(0, dot) : filename;
}

/** Documents we can turn into Markdown. Everything else passes through. */
export function isConvertible(filename: string): boolean {
  return [
    "pdf",
    "docx",
    "docm",
    "html",
    "htm",
    "txt",
    "text",
    "log",
    "csv",
    "tsv",
    "json",
  ].includes(extension(filename));
}

export function markdownFilename(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return (dot > 0 ? filename.slice(0, dot) : filename) + ".md";
}

/**
 * Convert a document to Markdown. Returns null when the file type isn't
 * convertible or the conversion produced no usable text (scanned PDF,
 * encrypted or corrupt file) so the caller can keep the original.
 */
export async function convertToMarkdown(
  blob: Blob,
  filename: string
): Promise<string | null> {
  try {
    let body: string | null;
    switch (extension(filename)) {
      case "pdf":
        body = await pdfToText(blob);
        break;
      case "docx":
      case "docm":
        body = await docxToMarkdown(blob);
        break;
      case "html":
      case "htm":
        body = await htmlToMarkdown(await blob.text());
        break;
      case "txt":
      case "text":
      case "log":
        body = await blob.text();
        break;
      case "csv":
        body = csvToMarkdown(await blob.text(), ",");
        break;
      case "tsv":
        body = csvToMarkdown(await blob.text(), "\t");
        break;
      case "json":
        body = "```json\n" + (await blob.text()).trim() + "\n```";
        break;
      default:
        return null;
    }

    if (body == null) return null;
    body = body.trim();
    if (body.replace(/\s/g, "").length < MIN_TEXT_CHARS) return null;

    return `# ${title(filename)}\n\n${body}\n`;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------- pdf */

type PdfJs = typeof import("pdfjs-dist");

let pdfjsPromise: Promise<PdfJs> | null = null;

function loadPdfjs(): Promise<PdfJs> {
  if (!pdfjsPromise) {
    pdfjsPromise = import("pdfjs-dist").then((pdfjs) => {
      pdfjs.GlobalWorkerOptions.workerSrc = new URL(
        "pdfjs-dist/build/pdf.worker.min.mjs",
        import.meta.url
      ).toString();
      return pdfjs;
    });
  }
  return pdfjsPromise;
}

/** Extract a PDF's text layer, with `## Page N` headings for multi-page files. */
async function pdfToText(blob: Blob): Promise<string | null> {
  const pdfjs = await loadPdfjs();
  const data = await blob.arrayBuffer();
  const doc = await pdfjs.getDocument({ data }).promise;

  const pages: string[] = [];
  try {
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      let text = "";
      for (const item of content.items) {
        if ("str" in item) {
          text += item.str;
          text += item.hasEOL ? "\n" : " ";
        }
      }
      pages.push(text.replace(/[ \t]+\n/g, "\n").trim());
      page.cleanup();
    }
  } finally {
    await doc.destroy();
  }

  if (pages.length === 1) return pages[0];
  return pages
    .map((text, i) => `## Page ${i + 1}\n\n${text || "*(no text on this page)*"}`)
    .join("\n\n");
}

/* ------------------------------------------------------- docx and html */

async function docxToMarkdown(blob: Blob): Promise<string | null> {
  // The bundler resolves mammoth's browser build ({ arrayBuffer } input);
  // tolerate either named or default CJS interop.
  const mod = await import("mammoth");
  const mammoth = typeof mod.convertToHtml === "function" ? mod : mod.default;
  const arrayBuffer = await blob.arrayBuffer();
  const result = await mammoth.convertToHtml({ arrayBuffer });
  return htmlToMarkdown(result.value);
}

async function htmlToMarkdown(html: string): Promise<string> {
  const { default: TurndownService } = await import("turndown");
  const turndown = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
    bulletListMarker: "-",
  });
  return turndown.turndown(html);
}

/* -------------------------------------------------------------- csv/tsv */

/** Minimal RFC-4180-ish parser: quoted fields, escaped quotes, CRLF. */
function parseDelimited(text: string, delim: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"' && field === "") {
      inQuotes = true;
    } else if (ch === delim) {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      rows.push(row);
      row = [];
    } else {
      field += ch;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function csvToMarkdown(text: string, delim: string): string {
  const rows = parseDelimited(text, delim).filter((r) =>
    r.some((c) => c.trim() !== "")
  );
  if (rows.length === 0) return "";

  const cols = Math.max(...rows.map((r) => r.length));
  if (rows.length > CSV_TABLE_MAX_ROWS || cols > CSV_TABLE_MAX_COLS) {
    return "```\n" + text.trim() + "\n```";
  }

  const escape = (cell: string) =>
    cell.replace(/\|/g, "\\|").replace(/\r?\n/g, " ").trim();
  const line = (cells: string[]) =>
    "| " +
    Array.from({ length: cols }, (_, i) => escape(cells[i] ?? "")).join(" | ") +
    " |";

  const [header, ...body] = rows;
  return [
    line(header),
    "| " + Array.from({ length: cols }, () => "---").join(" | ") + " |",
    ...body.map(line),
  ].join("\n");
}
