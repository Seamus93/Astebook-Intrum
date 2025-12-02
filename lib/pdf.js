// lib/pdf.js
import { PDFParse } from "pdf-parse";

/** Estrae testo da un Buffer PDF usando pdf-parse v2 */
export async function parsePdfBuffer(buffer, opts = {}) {
  const parser = new PDFParse({ data: buffer });
  try {
    return await parser.getText(opts); // { text, ... }
  } finally {
    await parser.destroy();
  }
}
