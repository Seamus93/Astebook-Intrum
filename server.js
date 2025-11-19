// server.js — orchestratore modulare annuncio/proposta + merge
import express from "express";
import multer from "multer";
import fssync from "fs";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

import { scrapeAnnuncioFromBuffer } from "./scrapers/scrape_annuncio.js";
import { scrapePropostaFromBuffer } from "./scrapers/scrape_proposta.js";
import { mergeAnnuncioProposta } from "./lib/merge_json.js";
import { aiExtractAnnuncio, aiExtractProposta } from "./lib/ai.js";
import { parsePdfBuffer } from "./lib/pdf.js";
import { slug } from "./lib/text.js";

/* ──────────────────────────────────────────────────────────
   Setup base
   ────────────────────────────────────────────────────────── */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json({ limit: "20mb" }));

// Upload in memoria (comodo per Zapier / multipart)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
});

// Directory di lavoro
const DIR_ANNUNCI  = path.join(__dirname, "pdf", "annunci");
const DIR_PROPOSTE = path.join(__dirname, "pdf", "proposte");
const DIR_OUT      = path.join(__dirname, "out");
[DIR_ANNUNCI, DIR_PROPOSTE, DIR_OUT].forEach((d) => {
  if (!fssync.existsSync(d)) fssync.mkdirSync(d, { recursive: true });
});

/* ──────────────────────────────────────────────────────────
   Helpers
   ────────────────────────────────────────────────────────── */
async function readPdfFromDiskOrThrow(dir, fileName) {
  if (!fileName) throw new Error("Nome file mancante.");
  const full = path.join(dir, fileName);
  await fs.access(full);
  return fs.readFile(full);
}

async function downloadBuffer(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Download failed: ${r.status} ${r.statusText}`);
  return Buffer.from(await r.arrayBuffer());
}

function bufferFromBase64(input, fallbackName) {
  if (!input) return null;
  const [, payload = input] = input.split(",");
  try {
    return {
      buffer: Buffer.from(payload, "base64"),
      filename: fallbackName || "file.pdf",
    };
  } catch (err) {
    throw new Error(`Base64 non valido per ${fallbackName}: ${err.message}`);
  }
}

async function getBufferFromUploadOrDisk(fieldName, req, folder) {
  // 1) upload multipart (campo file)
  if (req.files?.[fieldName]?.[0]?.buffer) {
    const f = req.files[fieldName][0];
    return { buffer: f.buffer, filename: f.originalname || `${fieldName}.pdf` };
  }
  if (req.file?.buffer && fieldName === "file") {
    // per gli endpoint single-file come /parse-proposta-upload
    return { buffer: req.file.buffer, filename: req.file.originalname || "file.pdf" };
  }
  // 2) querystring (leggi da disco)
  const name = typeof req.query[fieldName] === "string" ? req.query[fieldName] : null;
  if (!name) throw new Error(`Manca file '${fieldName}' (né upload né query).`);
  const buffer = await readPdfFromDiskOrThrow(folder, name);
  return { buffer, filename: name };
}

async function saveOutJSON(baseName, payload, suffix = "out") {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const out = path.join(DIR_OUT, `${slug(baseName)}__${suffix}__${stamp}.json`);
  await fs.writeFile(out, JSON.stringify(payload, null, 2), "utf8");
  return out;
}

/* ──────────────────────────────────────────────────────────
   Routes base
   ────────────────────────────────────────────────────────── */
app.get("/health", (_req, res) => res.json({ ok: true }));

/**
 * GET /parse-annuncio?file=Asta1.pdf
 * Legge da pdf/annunci e salva il JSON in out/
 */
app.get("/parse-annuncio", async (req, res) => {
  try {
    const file = String(req.query.file || "");
    if (!file) throw new Error("Passa ?file=Nome.pdf in /pdf/annunci");
    const buf = await readPdfFromDiskOrThrow(DIR_ANNUNCI, file);
    const out = await scrapeAnnuncioFromBuffer(buf, file);
    const outPath = await saveOutJSON(file.replace(/\.pdf$/i, ""), out, "annuncio");
    res.json({ ...out, out_json: outPath });
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
});

/**
 * GET /parse-proposta?file=Proposta1.pdf
 * Legge da pdf/proposte e salva il JSON in out/
 */
app.get("/parse-proposta", async (req, res) => {
  try {
    const file = String(req.query.file || "");
    if (!file) throw new Error("Passa ?file=Nome.pdf in /pdf/proposte");
    const buf = await readPdfFromDiskOrThrow(DIR_PROPOSTE, file);
    const out = await scrapePropostaFromBuffer(buf, file);
    const outPath = await saveOutJSON(file.replace(/\.pdf$/i, ""), out, "proposta");
    res.json({ ...out, out_json: outPath });
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
});

/**
 * POST /parse-proposta-upload
 * multipart/form-data con campo file
 */
app.post("/parse-proposta-upload", upload.single("file"), async (req, res) => {
  try {
    if (!req.file?.buffer) throw new Error("Nessun file PDF ricevuto (campo 'file').");
    const out = await scrapePropostaFromBuffer(req.file.buffer, req.file.originalname || "proposta.pdf");
    res.json(out);
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
});

/**
 * POST /merge
 * Body JSON: { annuncio, proposta, out_name? }
 * Unisce due JSON già estratti.
 */
app.post("/merge", async (req, res) => {
  try {
    const {
      annuncio_url,
      proposta_url,
      annuncio_name,
      proposta_name,
      annuncio_base64,
      proposta_base64,
    } = req.body || {};

    if (!annuncio || !proposta) throw new Error("Body deve contenere { annuncio, proposta }");
    const merged = mergeAnnuncioProposta(annuncio, proposta);
    let out_json = null;
    if (out_name) {
      out_json = await saveOutJSON(out_name, merged, "merged");
    }
    
    res.json(out_name ? { ...merged, out_json } : merged);
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
});

app.post("/callAI",
  upload.fields([{ name: "annuncio" }, { name: "proposta" }]),
  async (req, res) => {
    try {
      const { annuncio_url, proposta_url, annuncio_name, proposta_name, codice_procedura, id } = req.body || {};

      // 1) Ottieni buffer (upload o URL)
      let annBuf, proBuf, annName, proName;

      if (req.files?.annuncio?.[0]) {
        annBuf = req.files.annuncio[0].buffer;
        annName = req.files.annuncio[0].originalname || "Annuncio.pdf";
      } else if (annuncio_base64) {
        const decoded = bufferFromBase64(annuncio_base64, annuncio_name || "Annuncio.pdf");
        annBuf = decoded.buffer;
        annName = decoded.filename;
      } else if (annuncio_url) {
        annBuf = await downloadBuffer(annuncio_url);
        annName = annuncio_name || "Annuncio.pdf";
      } else {
        throw new Error("Manca annuncio (upload 'annuncio' o 'annuncio_url').");
      }

      if (req.files?.proposta?.[0]) {
        proBuf = req.files.proposta[0].buffer;
        proName = req.files.proposta[0].originalname || "Proposta.pdf";
      } else if (proposta_base64) {
        const decoded = bufferFromBase64(proposta_base64, proposta_name || "Proposta.pdf");
        proBuf = decoded.buffer;
        proName = decoded.filename;
      } else if (proposta_url) {
        proBuf = await downloadBuffer(proposta_url);
        proName = proposta_name || "Proposta.pdf";
      } else {
        throw new Error("Manca proposta (upload 'proposta' o 'proposta_url').");
      }

      // 2) Estrai testo locali
      const { text: annText } = await parsePdfBuffer(annBuf);
      const { text: proText } = await parsePdfBuffer(proBuf);

      // 3) Chiama OpenAI (due step separati per ridurre allucinazioni)
      const [aiAnnuncio, aiProposta] = await Promise.all([
        aiExtractAnnuncio({ text: annText, fileName: annName }),
        aiExtractProposta({ text: proText, fileName: proName })
      ]);

      // 4) Merge (riusa la tua funzione di merge)
      const merged = mergeAnnuncioProposta(
        // adattiamo i nomi: la tua merge accetta oggetti con questi campi standard
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
          stato: aiAnnuncio.stato,
          categoria_macro: aiAnnuncio.categoria_macro,
          aggiornato_il: aiAnnuncio.aggiornato_il,
          ora_gara_inizio: aiAnnuncio.ora_gara_inizio,
          ora_gara_fine: aiAnnuncio.ora_gara_fine,
          termine_richieste_visite_data: aiAnnuncio.termine_richieste_visite_data,
          termine_richieste_visite_ora: aiAnnuncio.termine_richieste_visite_ora,
          descrizione: aiAnnuncio.descrizione
        },
        {
          file_pdf: aiProposta.file_pdf,
          proponente: aiProposta.proponente,
          indirizzo_immobile: aiProposta.indirizzo_immobile,
          prezzo_offerto: aiProposta.prezzo_offerto,
          deposito_cauzionale: aiProposta.deposito_cauzionale,
          cauzione_percentuale: aiProposta.cauzione_percentuale,
          iban_beneficiario: aiProposta.iban_beneficiario,
          irrevocabile_giorni: aiProposta.irrevocabile_giorni,
          rogito_entro_giorni: aiProposta.rogito_entro_giorni,
          catasto: aiProposta.catasto,
          luogo_redazione: aiProposta.luogo_redazione,
          data_redazione: aiProposta.data_redazione,
          anno_redazione: aiProposta.anno_redazione
        }
      );

      // 5) Risposta
      res.json({
        ok: true,
        meta: { codice_procedura: codice_procedura ?? null, id: id ?? null },
        ai: { annuncio: aiAnnuncio, proposta: aiProposta },
        merged
      });
    } catch (e) {
      res.status(500).json({ ok:false, error: e.message || String(e) });
    }
  }
);

/* ──────────────────────────────────────────────────────────
   Orchestratore one-shot: /process
   - GET  ?annuncio=A.pdf&proposta=B.pdf  (legge entrambi da disco)
   - POST multipart con file "annuncio" e "proposta"
   Output: merged + salvataggio in out/
   ────────────────────────────────────────────────────────── */
async function orchestrateProcess(req, res) {
  const filesConfig = [
    { field: "annuncio", folder: DIR_ANNUNCI },
    { field: "proposta", folder: DIR_PROPOSTE },
  ];
  try {
    // 1) carica i buffer (da upload o disco)
    const [a, p] = await Promise.all(
      filesConfig.map((cfg) => getBufferFromUploadOrDisk(cfg.field, req, cfg.folder))
    );

    // 2) parse
    const annuncio = await scrapeAnnuncioFromBuffer(a.buffer, a.filename);
    const proposta = await scrapePropostaFromBuffer(p.buffer, p.filename);

    // 3) merge (usa la tua logica centralizzata)
    const merged = mergeAnnuncioProposta(annuncio, proposta);

    // 4) salva merge
    const nameHint = `${a.filename.replace(/\.pdf$/i, "")}__${p.filename.replace(/\.pdf$/i, "")}`;
    const outPath = await saveOutJSON(nameHint, merged, "merged");

    res.json({ ok: true, out_json: outPath, merged });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message || String(e) });
  }
}

// GET: nomi file su disco
app.get("/process", orchestrateProcess);

// POST: upload multipart (file fields: annuncio, proposta)
app.post("/process", upload.fields([{ name: "annuncio" }, { name: "proposta" }]), orchestrateProcess);

async function fetchPdfBuffer(url, nameFallback = "file.pdf") {
  if (!url || typeof url !== "string") {
    throw new Error("URL PDF mancante o non valido");
  }
  // rimuovi eventuali spazi/CR accidentalmente incollati da Zapier
  const cleanUrl = url.trim();

  const r = await fetch(cleanUrl);
  if (!r.ok) {
    throw new Error(`Download fallito (${r.status}) per URL: ${cleanUrl}`);
  }
  const ab = await r.arrayBuffer();
  const buffer = Buffer.from(ab);

  // prova a ricavare un nome leggibile dal path dell'URL
  let filename = nameFallback;
  try {
    const u = new URL(cleanUrl);
    const last = u.pathname.split("/").pop() || nameFallback;
    // se Zapier non fornisce il name, rimani con l'hash ma con estensione .pdf se manca
    filename = /\.[Pp][Dd][Ff]$/.test(last) ? last : `${last}.pdf`;
  } catch {
    // resta il fallback
  }

  return { buffer, filename };
}

/* ──────────────────────────────────────────────────────────
   POST /process-urls
   Body JSON:
   {
     "proposta_url": "https://.../proposta.pdf",
     "annuncio_url": "https://.../annuncio.pdf",
     "proposta_name": "Proposta.pdf",   // opzionale
     "annuncio_name": "Annuncio.pdf"    // opzionale
   }
   ────────────────────────────────────────────────────────── */
app.post("/process-urls", async (req, res) => {
  try {
    const {
      proposta_url,
      annuncio_url,
      proposta_name = "proposta.pdf",
      annuncio_name = "annuncio.pdf",
    } = req.body || {};

    if (!proposta_url || !annuncio_url) {
      throw new Error("Body JSON deve contenere 'proposta_url' e 'annuncio_url'.");
    }

    // 1) scarica i due PDF da S3
    const [propostaFile, annuncioFile] = await Promise.all([
      fetchPdfBuffer(proposta_url, proposta_name),
      fetchPdfBuffer(annuncio_url, annuncio_name),
    ]);

    // 2) esegui scrapers
    const proposta = await scrapePropostaFromBuffer(propostaFile.buffer, proposta_name);
    const annuncio = await scrapeAnnuncioFromBuffer(annuncioFile.buffer, annuncio_name);

    // 3) merge finale
    const merged = mergeAnnuncioProposta(annuncio, proposta);

    // 4) salva out JSON (opzionale ma utile)
    const nameHint = `${annuncio_name.replace(/\.pdf$/i,"")}__${proposta_name.replace(/\.pdf$/i,"")}`;
    const out_json = await saveOutJSON(nameHint, merged, "merged");

    res.json({ ok: true, out_json, merged });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message || String(e) });
  }
});

/* ──────────────────────────────────────────────────────────
   Bootstrap
   ────────────────────────────────────────────────────────── */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server up on http://localhost:${PORT}`));
