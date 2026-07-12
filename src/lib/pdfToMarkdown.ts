"use client";

// Minimum extractable characters before we trust the text layer. Scanned
// PDFs with no OCR yield little or nothing — below this we keep the PDF.
const MIN_TEXT_CHARS = 32;

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

export function isPdfFilename(filename: string): boolean {
  return /\.pdf$/i.test(filename);
}

export function markdownFilename(pdfFilename: string): string {
  return pdfFilename.replace(/\.pdf$/i, ".md");
}

/**
 * Extract the text layer of a PDF and format it as Markdown. Returns null
 * when the PDF has no usable text layer (scanned image, encrypted, corrupt)
 * so the caller can fall back to the original file.
 */
export async function pdfBlobToMarkdown(
  blob: Blob,
  filename: string
): Promise<string | null> {
  try {
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

    const totalChars = pages.join("").replace(/\s/g, "").length;
    if (totalChars < MIN_TEXT_CHARS) return null;

    const title = filename.replace(/\.pdf$/i, "");
    const body =
      pages.length === 1
        ? pages[0]
        : pages
            .map((text, i) => `## Page ${i + 1}\n\n${text || "*(no text on this page)*"}`)
            .join("\n\n");

    return `# ${title}\n\n${body}\n`;
  } catch {
    return null;
  }
}
