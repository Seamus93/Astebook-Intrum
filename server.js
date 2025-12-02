import express from "express";
import multer from "multer";
import dotenv from "dotenv";
import fs from "fs";

import { mergeAnnuncioProposta } from "./lib/merge_json.js";
import { aiExtractAnnuncio, aiExtractProposta } from "./lib/ai.js";
import { parsePdfBuffer } from "./lib/pdf.js";

dotenv.config();

const app = express();
app.use(express.json({ limit: "20mb" }));

// Upload in memoria; accetta qualsiasi field (Zapier può chiamarlo diversamente)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
}).any();

app.get("/health", (_req, res) => res.json({ ok: true }));

function formatLocalISODate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function addDaysToISODate(isoDate, days) {
  const m = typeof isoDate === "string" && isoDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  d.setUTCDate(d.getUTCDate() + Number(days || 0));
  return d.toISOString().slice(0, 10);
}

function computeDataAperturaPubblicazione() {
  const now = new Date();
  const cutoff = new Date(now);
  cutoff.setHours(15, 30, 0, 0); // 15:30 locale
  const base = now >= cutoff ? new Date(now.getTime() + 24 * 60 * 60 * 1000) : now;
  return formatLocalISODate(base);
}

function fileByField(files, name) {
  return Array.isArray(files) ? files.find((f) => f.fieldname === name) || null : null;
}

function firstFile(files) {
  return Array.isArray(files) && files.length > 0 ? files[0] : null;
}

async function fetchIbanInfo(iban) {
  if (!iban || typeof iban !== "string") return { bic: null, bank: null };
  const clean = iban.replace(/\s+/g, "").trim();
  if (!clean) return { bic: null, bank: null };
  try {
    const resp = await fetch(
      `https://openiban.com/validate/${encodeURIComponent(clean)}?getBIC=true`
    );
    if (!resp.ok) throw new Error(`openiban status ${resp.status}`);
    const data = await resp.json();
    const bic = data?.bankData?.bic || null;
    const bank = data?.bankData?.name || null;
    return { bic, bank };
  } catch {
    return { bic: null, bank: null };
  }
}

app.post("/callAI", upload, async (req, res) => {
  try {
    const body = Array.isArray(req.body) ? req.body[0] || {} : req.body || {};
    const rawEmailBody = typeof body.email_body_text === "string" ? body.email_body_text : "";
    const files = Array.isArray(req.files) ? req.files : [];

    const propostaUploadFile = fileByField(files, "proposta") || firstFile(files);

    const hasAnnuncioEmail = rawEmailBody.trim().length > 0;
    if (!hasAnnuncioEmail) {
      throw new Error("Manca annuncio: popola 'email_body_text' con il testo dell'annuncio.");
    }

    const annuncioFileName = body.annuncio_name || "AnnuncioEmail.txt";
    const annuncioText = rawEmailBody;

    // Proposta: OCR testo prioritario; PDF come fallback (upload/base64/url).
    let proBuf = null;
    let proName = body.proposta_name || "Proposta.txt";
    if (propostaUploadFile?.buffer) {
      proBuf = propostaUploadFile.buffer;
      proName = propostaUploadFile.originalname || body.proposta_name || "Proposta.pdf";
    } else if (body.proposta_base64) {
      const parts = String(body.proposta_base64).split(",");
      const payload = parts.length > 1 ? parts[1] : parts[0];
      proBuf = Buffer.from(payload, "base64");
      proName = body.proposta_name || "Proposta.pdf";
    } else if (body.proposta_url) {
      const url = String(body.proposta_url).trim();
      if (url) {
        const resp = await fetch(url);
        if (!resp.ok)
          throw new Error(`Download proposta fallito: ${resp.status} ${resp.statusText}`);
        const arrayBuf = await resp.arrayBuffer();
        proBuf = Buffer.from(arrayBuf);
        proName = body.proposta_name || "Proposta.pdf";
      }
    }

    // testo proposta: OCR sempre usato se presente
    const propostaTextBody =
      typeof body.proposta_ocr === "string"
        ? body.proposta_ocr
        : typeof body.proposta_text === "string"
        ? body.proposta_text
        : typeof body.proposta_ocr_text === "string"
        ? body.proposta_ocr_text
        : typeof body.ocr_text === "string"
        ? body.ocr_text
        : "";

    let combinedProText = propostaTextBody;
    if (!combinedProText.trim()) {
      if (!proBuf) {
        throw new Error("Manca testo OCR della proposta (proposta_ocr) e nessun PDF fornito.");
      }
      const parsedPro = await parsePdfBuffer(proBuf);
      combinedProText = parsedPro?.text || "";
    }
    try { fs.writeFileSync("proposta_debug.txt", combinedProText || "", "utf8"); } catch {}

    const aiAnnuncio = await aiExtractAnnuncio({
      text: annuncioText,
      fileName: annuncioFileName,
      mode: "email",
    });

    let aiProposta = await aiExtractProposta({ text: combinedProText, fileName: proName });

    // BIC lookup da IBAN (se presente)
    if (aiProposta.iban_beneficiario) {
      const { bic, bank } = await fetchIbanInfo(aiProposta.iban_beneficiario);
      if (!aiProposta.bic_cauzione) aiProposta.bic_cauzione = bic;
      if (!aiProposta.beneficiario_cauzione) aiProposta.beneficiario_cauzione = bank;
    }

    const data_apertura_pubblicazione = computeDataAperturaPubblicazione();
    const data_termine_deposito = aiAnnuncio.data_termine_deposito || null;
    const ora_termine_deposito = aiAnnuncio.ora_termine_deposito || null;
    const data_gara = data_termine_deposito
      ? addDaysToISODate(data_termine_deposito, 2)
      : null;
    const ora_gara_inizio = aiAnnuncio.ora_gara_inizio || "09:00";
    const ora_gara_fine = aiAnnuncio.ora_gara_fine || "12:00";

    const merged = mergeAnnuncioProposta(
      {
        file_pdf: aiAnnuncio.file_pdf,
        indirizzo: aiAnnuncio.indirizzo,
        tipo_vendita: aiAnnuncio.tipo_vendita,
        data_vendita: aiAnnuncio.data_vendita,
        ora_vendita: aiAnnuncio.ora_vendita,
        offerta_minima: aiAnnuncio.offerta_minima,
        superficie_mq: aiAnnuncio.superficie_mq,
        piano_numero: aiAnnuncio.piano_numero,
        ascensore: aiAnnuncio.ascensore,
        stato_occupazione: aiAnnuncio.stato_occupazione,
        categoria_macro: aiAnnuncio.categoria_macro,
        aggiornato_il: aiAnnuncio.aggiornato_il,
        ora_gara_inizio: aiAnnuncio.ora_gara_inizio,
        ora_gara_fine: aiAnnuncio.ora_gara_fine,
        termine_richieste_visite_data: aiAnnuncio.termine_richieste_visite_data,
        termine_richieste_visite_ora: aiAnnuncio.termine_richieste_visite_ora,
        data_termine_deposito: aiAnnuncio.data_termine_deposito,
        ora_termine_deposito: aiAnnuncio.ora_termine_deposito,
        descrizione: aiAnnuncio.descrizione,
      },
      {
        file_pdf: aiProposta.file_pdf,
        proponente: aiProposta.proponente,
        indirizzo_immobile: aiProposta.indirizzo_immobile,
        descrizione_immobile: aiProposta.descrizione_immobile,
        prezzo_offerto: aiProposta.prezzo_offerto,
        deposito_cauzionale: aiProposta.deposito_cauzionale,
        cauzione_percentuale: aiProposta.cauzione_percentuale,
        iban_beneficiario: aiProposta.iban_beneficiario,
        bic_cauzione: aiProposta.bic_cauzione,
        beneficiario_cauzione: aiProposta.beneficiario_cauzione,
        irrevocabile_giorni: aiProposta.irrevocabile_giorni,
        rogito_entro_giorni: aiProposta.rogito_entro_giorni,
        catasto: aiProposta.catasto,
        luogo_redazione: aiProposta.luogo_redazione,
        data_redazione: aiProposta.data_redazione,
        anno_redazione: aiProposta.anno_redazione,
      }
    );

    merged.gara.data_termine_deposito =
      merged.gara.data_termine_deposito ?? data_termine_deposito;
    merged.gara.ora_termine_deposito =
      merged.gara.ora_termine_deposito ?? ora_termine_deposito;
    merged.gara.data_gara = data_gara;
    merged.gara.ora_inizio = merged.gara.ora_inizio || ora_gara_inizio;
    merged.gara.ora_fine = merged.gara.ora_fine || ora_gara_fine;
    merged.data_apertura_pubblicazione = data_apertura_pubblicazione;

    res.json({
      ok: true,
      ai: { annuncio: aiAnnuncio, proposta: aiProposta },
      merged,
    });
  } catch (error) {
    console.error("[callAI] error", error);
    res.status(500).json({ ok: false, error: error.message || String(error) });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server up on http://localhost:${PORT}`));

