// lib/pdf.js
import { PDFParse } from "pdf-parse";
import Tesseract from "tesseract.js";
import pdfImgConvert from "pdf-img-convert";

/** Estrae testo da un Buffer PDF usando pdf-parse v2 */
export async function parsePdfBuffer(buffer, opts = {}) {
  const parser = new PDFParse({ data: buffer });
  try {
    return await parser.getText(opts); // { text, ... }
  } finally {
    await parser.destroy();
  }
}

/** OCR su PDF scannerizzati: converte pagine in immagini e lancia tesseract */
export async function ocrPdfBuffer(buffer, { lang = "ita+eng" } = {}) {
  try {
    // converte ogni pagina in PNG
    const images = await pdfImgConvert.convert(buffer, { type: "png", density: 200 });
    let text = "";
    const pageErrors = [];

    for (let i = 0; i < images.length; i++) {
      try {
        const imgBuf = Buffer.from(images[i]); // Uint8Array -> Buffer
        const { data: { text: t } } = await Tesseract.recognize(imgBuf, lang);
        text += `\n${t || ""}`;
      } catch (e) {
        pageErrors.push(`page ${i + 1}: ${e?.message || e}`);
      }
    }
    const error = pageErrors.length ? pageErrors.join(" | ") : null;
    return { text: text.trim(), error };
  } catch (err) {
    return { text: "", error: err?.message || String(err) };
  }
}
