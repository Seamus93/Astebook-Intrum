// lib/ai.js
import OpenAI from "openai";
import dotenv from "dotenv";
dotenv.config();

const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) {
  throw new Error("OPENAI_API_KEY mancante. Imposta la variabile d'ambiente o il file .env.");
}

export const openai = new OpenAI({ apiKey });

// taglia testo se enorme (per sicurezza token)
function clampText(t, maxChars = 120_000) {
  if (!t) return "";
  return t.length > maxChars ? t.slice(0, maxChars) : t;
}

/* ---------------- SCHEMI ---------------- */

export const schemaAnnuncio = {
  name: "AnnuncioSchema",
  schema: {
    type: "object",
    required: [
      "file_pdf","indirizzo","data_vendita","ora_vendita",
      "offerta_minima",
      "stato","aggiornato_il","ora_gara_inizio",
      "ora_gara_fine","termine_richieste_visite_data",
      "termine_richieste_visite_ora","data_termine_deposito",
      "ora_termine_deposito","descrizione","raw_length"
    ],
    properties: {
      file_pdf:        { type: ["string","null"] },
      indirizzo:       { type: ["string","null"] },
      data_vendita:    { type: ["string","null"] },
      ora_vendita:     { type: ["string","null"] },
      offerta_minima:  { type: ["number","null"] },
      stato:           { type: ["string","null"] },
      aggiornato_il:   { type: ["string","null"] },
      ora_gara_inizio: { type: ["string","null"] }, // HH:MM
      ora_gara_fine:   { type: ["string","null"] }, // HH:MM
      termine_richieste_visite_data: { type: ["string","null"] }, // ISO YYYY-MM-DD
      termine_richieste_visite_ora:  { type: ["string","null"] },
      data_termine_deposito: { type: ["string","null"] }, // ISO YYYY-MM-DD
      ora_termine_deposito:  { type: ["string","null"] }, // HH:MM
      descrizione:     { type: ["string","null"] },
      raw_length:      { type: ["integer","null"] }
    },
    additionalProperties: false
  },
  strict: true,
};

export const schemaProposta = {
  name: "PropostaSchema",
  schema: {
    type: "object",
    required: [
      "file_pdf","proponente","indirizzo_immobile","prezzo_offerto",
      "deposito_cauzionale","cauzione_percentuale",
      "iban_beneficiario","beneficiario_cauzione","bic_cauzione",
      "irrevocabile_giorni","rogito_entro_giorni",
      "catasto","catasto_voci","luogo_redazione","data_redazione","anno_redazione",
      "raw_length",
    ],
    properties: {
      file_pdf: { type: ["string","null"] },
      proponente: {
        type: "object",
        required: ["nominativo","telefono","cellulare","documento"],
        properties: {
          nominativo: { type: ["string","null"] },
          telefono:   { type: ["string","null"] },
          cellulare:  { type: ["string","null"] },
          documento:  { type: ["string","null"] }
        },
        additionalProperties: false
      },
      indirizzo_immobile:               { type: ["string","null"] },
      prezzo_offerto:                   { type: ["number","null"] },
      deposito_cauzionale:              { type: ["number","null"] },
      cauzione_percentuale:  { type: ["integer","null"] },
      iban_beneficiario:                { type: ["string","null"] },
      beneficiario_cauzione:            { type: ["string","null"] },
      bic_cauzione:                     { type: ["string","null"] },
      irrevocabile_giorni:              { type: ["integer","null"] },
      rogito_entro_giorni:              { type: ["integer","null"] },
      catasto: {
        type: "object",
        required: ["foglio","particella","mappale","subalterno","categoria"],
        properties: {
          foglio:      { type: ["string","null"] },
          particella:  { type: ["string","null"] },
          mappale:     { type: ["string","null"] },
          subalterno:  { type: ["string","null"] },
          categoria:   { type: ["string","null"] }
        },
        additionalProperties: false
      },
      catasto_voci: {
        type: ["array","null"],
        items: {
          type: "object",
          required: ["foglio","particella","mappale","subalterno","categoria"],
          properties: {
            foglio:      { type: ["string","null"] },
            particella:  { type: ["string","null"] },
            mappale:     { type: ["string","null"] },
            subalterno:  { type: ["string","null"] },
            categoria:   { type: ["string","null"] }
          },
          additionalProperties: false
        }
      },
      luogo_redazione: { type: ["string","null"] },
      data_redazione:  { type: ["string","null"] },
      anno_redazione:  { type: ["integer","null"] },
      raw_length: { type: ["integer","null"] }
    },
    additionalProperties: false
  },
  strict: true,
};


/* --------------- PROMPT --------------- */

const PROMPT_ANNUNCIO = `
Sei uno scraper documentale. Questo e il testo di una scheda "ANNUNCIO" da portale immobiliare d'asta.
Estrai i campi richiesti e restituisci SOLO JSON conforme allo schema. NON inventare valori: se mancano -> null.
Normalizza:
- importi come numeri ma formattati come stringhe "00.000,00" (punto ogni 3 cifre, virgola per i centesimi),
- date in formato "gg/mm/aa",
- orari HH:MM cercati vicino a "Data vendita/gara",
- SI/NO in "SI" | "NO".
- ora_gara_inizio / ora_gara_fine (da formule "gara dalle HH:MM alle HH:MM").
- data_termine_deposito / ora_termine_deposito se trovi frasi tipo "offerta/proposta deve pervenire entro il DD/MM/YYYY ore HH:MM".
- termine_richieste_visite_data (ISO) e termine_richieste_visite_ora (da frasi "Termine richieste visite...").
- Se non c'e data gara esplicita, lascia null: verra calcolata a valle (+2 giorni dal termine deposito).
Per l'indirizzo, formatta "Via/viale/corso/piazza ..., Civico, Citta" senza CAP e senza parole come "Appartamento all'asta".
Per "descrizione", restituisci il blocco testuale sotto l'intestazione "Descrizione" (se presente), pulito da URL/contatti/pubblicita. Se non presente -> null.
`;


const PROMPT_PROPOSTA = `
Sei uno scraper documentale. Questo è il testo di una "PROPOSTA" compilata dall'agente.
Estrai i campi richiesti e restituisci SOLO JSON conforme allo schema. NON inventare valori: se mancano → null.
Se trovi in fondo al documento le etichette "Luogo:" e "Data:", estrai:
- luogo_redazione (stringa pulita)
- data_redazione (ISO YYYY-MM-DD)
- anno_redazione (intero, di solito l'anno della data)
Regole: importi numerici; SI/NO in "SI"/"NO"; IBAN solo formati italiani (IT...).
IBAN e beneficiario: se trovi indicazioni di conto/iban, estrai sempre iban_beneficiario; se è specificato un intestatario/beneficiario (anche azienda, es. "SAVOY REOCO S.r.l."), valorizza beneficiario_cauzione; se trovi un BIC, valorizza bic_cauzione.
Catasto: se trovi più unità, inserisci tutte in catasto_voci (array di oggetti con foglio/particella/mappale/subalterno/categoria). Compila comunque il campo catasto principale con la prima unità.
`;



/* --------------- CALLERS (Responses API corretto) --------------- */

async function callJsonSchema({ prompt, content, fileName, schema }) {
  // schema: oggetto con { name, schema, strict }
  const resp = await openai.responses.create({
    model: "gpt-4o-mini",
    temperature: 0,
    text: {
      format: {
        type: "json_schema",
        // <-- QUI servono questi campi a livello di format:
        name: schema.name,
        schema: schema.schema,
        strict: schema.strict ?? true,
      },
    },
    input: [
      { role: "system", content: "Restituisci solo JSON valido che rispetta lo schema." },
      { role: "user", content: `${prompt}\n\n[file_pdf=${fileName ?? "file.pdf"}]\n\n${content}` },
    ],
  });

  const raw = resp.output_text ?? "";
  let json;
  try {
    json = JSON.parse(raw);
  } catch {
    const m = raw.match(/\{[\s\S]*\}$/);
    json = m ? JSON.parse(m[0]) : {};
  }
  return json;
}

export async function aiExtractProposta({ text, fileName }) {
  const content = clampText(text || "");
  const red = preExtractRedazione(content);
  const ibanGuess = preExtractIban(content);
  const catastoGuess = preExtractPropostaCatasto(content);

  const json = await callJsonSchema({
    prompt: PROMPT_PROPOSTA,
    content,
    fileName: fileName || "proposta.pdf",
    schema: schemaProposta
  });

  json.raw_length = content.length;
  if (!json.file_pdf) json.file_pdf = fileName || null;

  // Fallback ai deterministici se mancanti
  if (json.luogo_redazione == null) json.luogo_redazione = red.luogo;
  if (json.data_redazione  == null) json.data_redazione  = red.data;
  if (json.anno_redazione  == null) json.anno_redazione  = red.anno;
  if (json.iban_beneficiario == null) json.iban_beneficiario = ibanGuess;
  if (!json.catasto) json.catasto = {};
  if (json.catasto.foglio == null) json.catasto.foglio = catastoGuess.foglio;
  if (json.catasto.particella == null) json.catasto.particella = catastoGuess.particella;
  if (json.catasto.mappale == null) json.catasto.mappale = catastoGuess.mappale;
  if (json.catasto.subalterno == null) json.catasto.subalterno = catastoGuess.subalterno;
  if (json.catasto.categoria == null) json.catasto.categoria = catastoGuess.categoria;

  return json;
}

export async function aiExtractPropostaVision({ imageUrl, imageData, fileName }) {
  const payloadUrl = imageUrl || (imageData ? `data:application/pdf;base64,${imageData}` : null);
  if (!payloadUrl) return null;
  const resp = await openai.responses.create({
    model: "gpt-4o-mini",
    temperature: 0,
    text: {
      format: {
        type: "json_schema",
        name: schemaProposta.name,
        schema: schemaProposta.schema,
        strict: schemaProposta.strict ?? true,
      },
    },
    input: [
      { role: "system", content: "Restituisci solo JSON valido che rispetta lo schema." },
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: `${PROMPT_PROPOSTA}\n\n[file_pdf=${fileName ?? "proposta.pdf"}]\nIl documento Ã¨ scannerizzato; leggi il contenuto dell'immagine e estrai i campi dello schema.`,
          },
          { type: "input_image", image_url: payloadUrl },
        ],
      },
    ],
  });

  const raw = resp.output_text ?? "";
  try {
    const json = JSON.parse(raw);
    json.raw_length = json.raw_length ?? null;
    if (!json.file_pdf) json.file_pdf = fileName || null;
    return json;
  } catch {
    return null;
  }
}

export async function aiExtractAnnuncio({ text, fileName }) {
  const content = clampText(text || "");
  const extras = preExtractAnnuncioGara(content);
  const descrFB = preExtractAnnuncioDescrizione(content);

  const json = await callJsonSchema({
    prompt: PROMPT_ANNUNCIO,
    content,
    fileName: fileName || "annuncio.pdf",
    schema: schemaAnnuncio
  });

  json.raw_length = content.length;
  if (!json.file_pdf) json.file_pdf = fileName || null;

  // Fallback ai deterministici se mancanti
  for (const k of Object.keys(extras)) if (json[k] == null) json[k] = extras[k];
  if (json.descrizione == null) json.descrizione = descrFB || null;

  return json;
}


function toISODateFromIt(s) {
  if (!s) return null;
  const m = String(s).match(/\b([0-3]?\d)[\/\.\-]([0-1]?\d)[\/\.\-](\d{4})\b/);
  if (!m) return null;
  const [ , d, mo, y ] = m;
  return `${y}-${String(mo).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
}

const s2 = (x)=>String(x).padStart(2,"0");

function cleanTextBlock(t) {
  // compatta spazi, rimuove spazi doppi e punti spaziati "â‚¬ 125.000, 00" -> "â‚¬ 125.000,00"
  let x = (t || "").replace(/\r/g, "");
  x = x.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n");
  x = x.replace(/,\s+00\b/g, ",00"); // piccola pulizia comune negli importi
  x = x.trim();
  return x || null;
}

function preExtractRedazione(text) {
  const tail = (text || "").replace(/\r/g,"").slice(-1500); // coda documento
  const luogo = tail.match(/(?:^|\n)\s*Luogo\s*[:\-–]?\s*([^\n]+)/im)?.[1]?.trim() || null;
  const md = tail.match(/(?:^|\n)\s*Data\s*[:\-–]\s*([0-3]?\d[\/\.\-][0-1]?\d[\/\.\-]\d{4})/im);
  const dataISO = md ? toISODateFromIt(md[1]) : null;
  const anno = dataISO ? parseInt(dataISO.slice(0,4),10) : null;
  return { luogo, data: dataISO, anno };
}

function preExtractIban(text) {
  if (!text) return null;
  const m = text.match(/\bIT[0-9A-Z]{2}\s?(?:[0-9A-Z]{4}\s?){4}[0-9A-Z]{0,12}\b/i);
  if (!m) return null;
  return m[0].replace(/\s+/g, "").toUpperCase();
}

function preExtractPropostaCatasto(text) {
  const result = { foglio: null, particella: null, mappale: null, subalterno: null, categoria: null };
  if (!text) return result;
  const T = text.replace(/\r/g, "");
  const m = T.match(/foglio\s*([0-9A-Za-z\/]+)[\s\S]{0,80}?part\.?\s*([0-9A-Za-z\/]+)[\s\S]{0,80}?sub\.?\s*([0-9A-Za-z\/]+)[\s\S]{0,80}?cat\.?\s*([A-Za-z0-9\/]+)/i);
  if (m) {
    result.foglio = m[1] || null;
    result.particella = m[2] || null;
    result.mappale = m[2] || null;
    result.subalterno = m[3] || null;
    result.categoria = m[4] || null;
  }
  return result;
}

function preExtractAnnuncioGara(text) {
  const T = text || "";
  let ora_gara_inizio = null, ora_gara_fine = null;
  const m1 = T.match(/gar[ao][\s\w]{0,50}?dalle\s*([01]?\d|2[0-3])[:\.]([0-5]\d)\s*(?:alle|fino\s+alle)\s*([01]?\d|2[0-3])[:\.]([0-5]\d)/i);
  if (m1) { ora_gara_inizio = `${s2(m1[1])}:${s2(m1[2])}`; ora_gara_fine = `${s2(m1[3])}:${s2(m1[4])}`; }

  let termine_richieste_visite_data = null, termine_richieste_visite_ora = null;
  const m2 = T.match(/termine\s+richiest[ea]?\s+visite[\s\w,:]*?(?:il|entro\s+il)?\s*([0-3]?\d[\/\.\-][0-1]?\d[\/\.\-]\d{4})[\s\w,:]*?(?:ore|h)\s*([01]?\d|2[0-3])[:\.]([0-5]\d)/i);
  if (m2) { termine_richieste_visite_data = toISODateFromIt(m2[1]); termine_richieste_visite_ora = `${s2(m2[2])}:${s2(m2[3])}`; }

  return { ora_gara_inizio, ora_gara_fine, termine_richieste_visite_data, termine_richieste_visite_ora };
}

function preExtractAnnuncioDescrizione(text) {
  if (!text) return null;
  const T = text.replace(/\r/g, "");

  // start: intestazione "Descrizione" con o senza ":" e con eventuale newline
  const startRe = /(?:^|\n)\s*Descrizione\s*:?\s*(?:\n+| )/i;
  const mStart = T.match(startRe);
  if (!mStart) return null;

  // posizione d'inizio blocco
  const startIdx = (mStart.index ?? 0) + mStart[0].length;
  const after = T.slice(startIdx);

  // stop markers (linee che tipicamente NON fanno parte della descrizione)
  const stopRe = new RegExp([
    String.raw`(?:^|\n)\s*https?:\/\/\S+`,                 // URL/â€œfonteâ€ con link
    String.raw`(?:^|\n)\s*se vuoi saperne`,                // call-to-action portale
    String.raw`(?:^|\n)\s*invia messaggio`,                // CTA
    String.raw`(?:^|\n)\s*il nostro servizio`,             // promo
    String.raw`(?:^|\n)\s*possibilita'? di mutuo`,         // promo finanziamento
    String.raw`(?:^|\n)\s*per la partecipazione`,          // info procedurali
    String.raw`(?:^|\n)\s*risparmia acquistando`,          // promo
    String.raw`(?:^|\n)\s*compera all'?asta`,              // promo
    String.raw`(?:^|\n)\s*descrizione\s*\b`,               // nuova â€œDescrizioneâ€ ripetuta (evasione ciclo)
    String.raw`(?:^|\n)\s*\d{1,2}\/\d{1,2}\/\d{2,4}[^\n]*`,// righe data/orario di portale
    String.raw`(?:^|\n)\s*\d+\/\d+\s*$`                    // paginazione "2/8"
  ].join("|"), "i");

  const mStop = after.match(stopRe);
  const rawBlock = mStop ? after.slice(0, mStop.index) : after;

  // ripulisci righe troppo promozionali finali se sfuggite
  const pruned = rawBlock
    .split("\n")
    .filter(line => !/^www\.|https?:\/\//i.test(line.trim()))
    .join("\n");

  // taglio massimo per sicurezza
  const clipped = pruned.slice(0, 4000);
  return cleanTextBlock(clipped);
}







