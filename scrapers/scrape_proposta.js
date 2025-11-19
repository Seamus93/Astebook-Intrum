// scrapers/scrape_proposta.js
import { parsePdfBuffer } from "../lib/pdf.js";
import { norm, splitLines, moneyNum } from "../lib/text.js";

/* ============ HELPERS ============ */

// Testo subito dopo un’etichetta, fino a separatori forti
function grabAfterLabel(text, labelRes, maxWindow = 160) {
  for (const labelRe of labelRes) {
    const m = text.match(new RegExp(
      `${labelRe.source}[\\s\\:]*([\\s\\S]{1,${maxWindow}}?)` +
      `($|[,;\\n]|\\bnato\\b|\\bnata\\b|\\bn\\.?\\s*a\\b|\\bil\\b)`,
      "i"
    ));
    if (m?.[1]) return m[1].trim();
  }
  return null;
}

// Importo SOLO se compare € o “euro” vicino (evita falsi positivi tipo “51”)
function grabAmountStrict(text, labelRes, maxWindow = 200) {
  for (const labelRe of labelRes) {
    const m = text.match(new RegExp(
      `${labelRe.source}[\\s\\S]{0,${maxWindow}}?` +
      `(?:€\\s*|euro\\s*)` +
      `([\\d\\.,]{1,15})`,
      "i"
    ));
    if (m?.[1]) return moneyNum(m[1]);
  }
  return null;
}

// Percentuale vicino a etichetta (es. “10%”)
function grabPercent(text, labelRes, maxWindow = 120) {
  for (const labelRe of labelRes) {
    const m = text.match(new RegExp(
      `${labelRe.source}[\\s\\S]{0,${maxWindow}}?\\b(\\d{1,2})\\s*%`,
      "i"
    ));
    if (m?.[1]) return parseInt(m[1], 10);
  }
  return null;
}

// IBAN Italia (27 char) con o senza spazi
function grabIban(text) {
  const m = text.match(/\bIT[0-9A-Z]{2}\s?(?:[0-9A-Z]{4}\s?){5}[0-9A-Z]{3}\b/gi);
  return m ? m[0].replace(/\s+/g, "") : null;
}

// Giorni interi dopo etichetta
function grabDays(text, labelRes, maxWindow = 120) {
  for (const labelRe of labelRes) {
    const m = text.match(new RegExp(
      `${labelRe.source}[\\s\\S]{0,${maxWindow}}?\\b(\\d{1,3})\\b`,
      "i"
    ));
    if (m?.[1]) return parseInt(m[1], 10);
  }
  return null;
}

// Indirizzo immobile: tenta varie formulazioni + via/corso/piazza + civico
function grabIndirizzo(text) {
  const addrCore =
    `(via|viale|corso|piazza|largo|vicolo|strada|piazzale|vico|borgo)` +
    `\\s+[A-Za-zÀ-ÖØ-öø-ÿ'’.\\- ]+\\s*,?\\s*\\d+[A-Z]?`;
  const reList = [
    new RegExp(`(?:immobile|bene|lotto)\\s+(?:sito|posto|in)\\s+(${addrCore}.*?)(?:\\n|$|\\.|,)`, "i"),
    new RegExp(`(?:oggetto\\s+dell'?offerta|ad\\s+oggetto)\\s+(${addrCore}.*?)(?:\\n|$|\\.|,)`, "i"),
    new RegExp(`\\b(${addrCore})(?:\\s*,\\s*[A-Za-zÀ-ÖØ-öø-ÿ'’.\\- ]+)?`, "i"),
  ];
  for (const re of reList) {
    const m = text.match(re);
    if (m?.[1]) return m[1].trim().replace(/\s{2,}/g, " ");
  }
  return null;
}

// Nominativo/denominazione proponente ripulito
function grabProponente(text) {
  let s = grabAfterLabel(text, [
    /il\/la\s+sottoscritt[oa]/i,
    /il\s+sottoscritto/i,
    /la\s+sottoscritta/i,
    /proponente/i,
    /sig\.?ra?\.?/i,
    /societ[aà]\s+|ditta\s+|azienda\s+/i
  ], 200);

  if (s) {
    // taglia a separatori e rimuovi doc/CF immediatamente dopo
    s = s
      .replace(/\s*(?:,|;|\bnato\b|\bnata\b|\bn\.\s*a\b|\bdomiciliat[oa]\b|\bresident[ea]\b).*$/i, "")
      .replace(/\b(?:c\.?i\.?|ci|carta d'identit[aà]|passaporto|p\.?iva|piv[ae]|codice fiscale|c\.?f\.?)\b.*$/i, "")
      .replace(/^\s*\/?\s*a\s+/i, "") // rimuove prefisso “/a ” o “a ”
      .trim();
    if (s) return s;
  }

  // fallback: riga con Sig./Sig.ra/Società/Ditta
  const line = splitLines(text).find(l => /\b(sig\.?ra?|societ[aà]|ditta|azienda)\b/i.test(l));
  if (line) {
    let v = line
      .replace(/^.*?\b(sig\.?ra?|societ[aà]|ditta|azienda)\b[\s:,-]*/i, "")
      .replace(/\s*(?:,|;|\bnato\b|\bnata\b).*$/i, "")
      .replace(/^\s*\/?\s*a\s+/i, "")
      .trim();
    if (v) return v;
  }
  return null;
}

// Catasto: Foglio/Particella(Sub/Mappale)/Sub/Sezione
function grabCatasto(text) {
  const t = norm(text);
  const foglio     = (t.match(/\bFoglio\b\s*([0-9A-Za-z]+)/i) || [])[1] || null;
  const particella = (t.match(/\b(?:Particella|Mappale|Part\.)\b\s*([0-9A-Za-z]+)/i) || [])[1] || null;
  const subalterno = (t.match(/\b(?:Subalterno|Sub)\b\s*([0-9A-Za-z]+)/i) || [])[1] || null;
  let sezione      = (t.match(/\bSezione\b\s*([A-Z0-9]{1,3})/i) || [])[1] || null;
  if (sezione && /^[0-9]+$/.test(sezione)) sezione = null;
  return { foglio, particella, subalterno, sezione };
}

/* ============ EXTRACTOR PRINCIPALE ============ */

export async function scrapePropostaFromBuffer(buffer, fileName = "proposta.pdf") {
  const { text } = await parsePdfBuffer(buffer);
  const T = norm(text || "");

  const proponenteRaw = grabProponente(T);
  const indirizzoImm  = grabIndirizzo(T);

  // Prezzo offerto (richiede €/euro)
  const prezzoOfferto = grabAmountStrict(T, [
    /prezzo\s+offert[oa]/i,
    /offre\s+il\s+prezzo\s+di/i,
    /offerta\s+di/i,
    /importo\s+pari\s+ad/i
  ]);

  // Deposito cauzionale: prima importo (€), altrimenti percentuale
  const depositoImporto = grabAmountStrict(T, [
    /deposito\s+cauzion[ae]le/i,
    /cauzion[ae]/i,
    /assegno\s+circolare/i,
    /caparra/i
  ]);
  const depositoPercent = depositoImporto == null ? grabPercent(T, [
    /deposito\s+cauzion[ae]le/i,
    /cauzion[ae]/i,
    /caparra/i
  ]) : null;

  // IBAN
  const iban = grabIban(T);

  // Giorni: irrevocabilità e rogito
  const irrevGG = grabDays(T, [
    /irrevocabil[ei]\s+dell'?\s*offerta/i,
    /l'offerta\s+rimarr[aà]\s+irrevocabile/i,
    /validit[aà]\s+dell'?\s*offerta/i
  ]);
  const rogitoGG = grabDays(T, [
    /rogito\s+(?:entro|da\s+stipularsi\s+entro)/i,
    /stipula\s+entro/i
  ]);

  // Catasto
  const catasto = grabCatasto(T);

  // Contatti/documento (utili per merge)
  const telMatch  = T.match(/\b(?:tel\.?|telefono)\s*[:\-]?\s*(\+?\d[\d\s\/\-]{5,})/i);
  const cellMatch = T.match(/\b(?:cell\.?|mobile)\s*[:\-]?\s*(\+?\d[\d\s\/\-]{5,})/i);
  const docMatch  = T.match(/\b(?:c\.?i\.?|ci|carta d'identit[aà]|passaporto)\b.*?(?:n[°o]\s*[:\-]?\s*([A-Z0-9]{5,15}))/i);

  return {
    file_pdf: fileName,
    proponente: {
      nominativo: proponenteRaw || null,
      telefono: telMatch?.[1]?.trim() || null,
      cellulare: cellMatch?.[1]?.trim() || null,
      documento: docMatch?.[1]?.trim() || null,
    },
    indirizzo_immobile: indirizzoImm || null,
    prezzo_offerto: prezzoOfferto,
    deposito_cauzionale: depositoImporto,               // importo in €
    deposito_cauzionale_percentuale: depositoPercent,   // solo se non c’è importo
    iban_beneficiario: iban,
    irrevocabile_giorni: irrevGG,
    rogito_entro_giorni: rogitoGG,
    catasto,
    raw_length: T.length
  };
}
