import { parsePdfBuffer } from "../lib/pdf.js";
import { norm, splitLines, moneyNum, toISODate, pickNear, pickLabelLine, yesNoNormalize } from "../lib/text.js";

/* ---------------- Indirizzo ---------------- */
function extractIndirizzoLine(text) {
  const lines = splitLines(text);
  const addrRe = /\b(via|viale|piazza|corso|largo|vicolo|contrada|strada|piazzale|vico|borgo)\b/i;
  // scarta righe che iniziano con timestamp tipo "20/10/25, 12:37 ..."
  const clean = lines.filter(l => !/^\d{1,2}\/\d{1,2}\/\d{2,4}[,\s]/.test(l));

  // preferisci: riga con "all'asta" + via + virgola
  const pref = clean.find(l => /all['’]asta/i.test(l) && addrRe.test(l) && /,/.test(l));
  if (pref) return pref;

  // fallback: riga con via e numero/comma
  const candidates = clean.filter(l => addrRe.test(l) && (/\d/.test(l) || /,/.test(l)));
  if (candidates.length) return candidates.sort((a,b)=>b.length-a.length)[0];

  // ultimo fallback: un titolo sensato
  return lines.find(l => /^Appartamento all'asta/i.test(l)) || null;
}

// helper: compone "Via …, N, Città" evitando buchi e "Italia"
function formatAddress(via, civico, citta) {
  const parts = [];
  if (via) parts.push(via.trim());
  if (civico) parts.push(String(civico).trim());
  if (citta) parts.push(citta.replace(/\bItalia\b/gi, "").trim());
  return parts.length ? parts.join(", ") : null;
}

// NUOVO: costruisce direttamente una STRINGA indirizzo pulita
function buildAddressFromRaw(indirizzoRaw) {
  if (!indirizzoRaw) return null;

  // 1) pulizia rumore
  let s = indirizzoRaw
    .replace(/^Appartamento all['’]asta\s*/i, "")
    .replace(/\bItalia\b/gi, "")
    .replace(/\s*-\s*/g, ", ")
    .replace(/\s*,\s*,/g, ",")
    .replace(/\s{2,}/g, " ")
    .trim();

  // 2) pattern principali (via prima, poi civico, poi CAP opzionale e città)
  const patterns = [
    // "Via Nome 18, 20123 Milano" | "Via Nome 18, Milano"
    /(via|viale|corso|piazza|largo|vicolo|strada|piazzale|vico|borgo)\s+([A-Za-zÀ-ÖØ-öø-ÿ'’.\- ]+?)\s*,?\s*([0-9A-Z]+)\s*,?\s*(?:\b\d{5}\b\s*)?([A-Za-zÀ-ÖØ-öø-ÿ'’.\- ]+)$/i,
    // "Corso Nome, 18, 20123 Milano"
    /(via|viale|corso|piazza|largo|vicolo|strada|piazzale|vico|borgo)\s+([A-Za-zÀ-ÖØ-öø-ÿ'’.\- ]+?)\s*,\s*([0-9A-Z]+)\s*,?\s*(?:\b\d{5}\b\s*)?([A-Za-zÀ-ÖØ-öø-ÿ'’.\- ]+)$/i,
  ];

  for (const re of patterns) {
    const m = s.match(re);
    if (m) {
      let civico = (m[3] || "").trim();
      // se è CAP (5 cifre), non è un civico valido
      if (/^\d{5}$/.test(civico)) civico = null;

      let citta = (m[4] || "").trim();
      // togli eventuale CAP e scarti dopo virgole extra
      citta = citta.replace(/\b\d{5}\b/g, "").replace(/\s*,.*$/, "").trim();

      const via = `${m[1][0].toUpperCase()}${m[1].slice(1).toLowerCase()} ${m[2].trim()}`;
      return formatAddress(via, civico, citta || null);
    }
  }

  // 3) caso anomalo: "Corso Garibaldi, 20121 Milano 16," (civico dopo la città)
  const weird = s.match(
    /(via|viale|corso|piazza|largo|vicolo|strada|piazzale|vico|borgo)\s+([A-Za-zÀ-ÖØ-öø-ÿ'’.\- ]+).*?\b(\d{5})\b\s+([A-Za-zÀ-ÖØ-öø-ÿ'’\- ]+?)\s+([0-9A-Z]+)\b/i
  );
  if (weird) {
    const via = `${weird[1][0].toUpperCase()}${weird[1].slice(1).toLowerCase()} ${weird[2].trim()}`;
    let citta = weird[4].trim().replace(/\s*,.*$/, "");
    let civico = weird[5].trim();
    return formatAddress(via, civico, citta);
  }

  // 4) fallback prudente: prova a estrarre almeno via + (civico?) + città
  const tail = s.split(",").map(t => t.trim()).filter(Boolean);
  let citta = null;
  if (tail.length >= 2) {
    citta = tail[tail.length - 1].replace(/\b\d{5}\b/g, "").trim() || null;
  }

  const mBare = s.match(/(via|viale|corso|piazza|largo|vicolo|strada|piazzale|vico|borgo)\s+([A-Za-zÀ-ÖØ-öø-ÿ'’.\- ]+)/i);
  const via = mBare ? `${mBare[1][0].toUpperCase()}${mBare[1].slice(1).toLowerCase()} ${mBare[2].trim()}` : null;

  let civico = null;
  if (via) {
    const after = s.slice(s.toLowerCase().indexOf(mBare[0].toLowerCase()) + mBare[0].length);
    const n = after.match(/\b([0-9]{1,4}[A-Z]?)\b/);
    civico = n && !/^\d{5}$/.test(n[1]) ? n[1] : null;
  }

  return formatAddress(via, civico, citta);
}

/* ---------------- Altri campi ---------------- */
function extractSuperficie(text) {
  const v = pickNear(text, /Superficie/i, /[\d\.,]+\s*m[²2]/i, 80) || pickLabelLine(splitLines(text), /Superficie/i);
  if (!v) return null;
  const n = (v.match(/([\d\.,]+)\s*m[²2]/i) || [])[1] || v.match(/([\d\.,]+)/)?.[1];
  return moneyNum(n);
}
function extractPiano(text) {
  const lines = splitLines(text);
  const v = pickLabelLine(lines, /^Piano$/i) || pickNear(text, /Piano/i, /[0-9]+/i, 30);
  const n = v && (v.match(/([0-9]+)/) || [])[1];
  return n ? parseInt(n,10) : null;
}
function extractAscensore(text) {
  const lines = splitLines(text);
  const v = pickLabelLine(lines, /^Ascensore$/i) || pickNear(text, /Ascensore/i, /(Sì|Si|No)/i, 20);
  return yesNoNormalize(v);
}
function extractStato(text) {
  const lines = splitLines(text);
  const v = pickLabelLine(lines, /^Stato$/i) || pickNear(text, /Stato/i, /[A-Za-zÀ-ÖØ-öø-ÿ]+/i, 40);
  return v ? v.replace(/[,;]+.*/,"").trim() : null;
}
function extractCategoria(text) {
  const lines = splitLines(text);
  const v = pickLabelLine(lines, /^Categoria$/i) || pickNear(text, /Categoria/i, /[A-ZÀ-ÖØ-öø-ÿ\s]+/i, 80);
  return v ? v.toUpperCase().replace(/\s+/g," ").trim() : null;
}
function extractAggiornatoIl(text) {
  const v = pickNear(text, /Aggiornato\s+il/i, /[0-3]?\d[\/\.-][0-1]?\d[\/\.-]\d{4}|\d{1,2}\s+[A-Za-zÀ-ÖØ-öø-ÿ]+\s+\d{4}/i, 40);
  return toISODate(v);
}
function extractTipoVendita(text) {
  const lines = splitLines(text);
  const v = pickLabelLine(lines, /Tipo\s+vendita/i) || pickNear(text, /Tipo\s+vendita/i, /[A-Za-zÀ-ÖØ-öø-ÿ\s]+/i, 60);
  if (!v) return null;
  const t = v.toLowerCase();
  if (/senza.*incanto/.test(t)) return "Senza incanto";
  if (/competitiva/.test(t)) return "Competitiva";
  if (/sincrona.*mista/.test(t)) return "Sincrona mista";
  if (/telematica.*asincrona/.test(t)) return "Telematica asincrona";
  return v.trim();
}
function extractOffertaMinima(text) {
  const v = pickNear(text, /Offerta\s*minima/i, /(?:€|EUR)\s*[\d\.\,]+/i, 80);
  return v ? moneyNum(v) : null;
}

// data/ora legandoci al contesto "Data vendita/gara" per non prendere l'ora del timestamp pagina
function extractDataOra(text) {
  const data = pickNear(
    text,
    /Data\s+(?:vendita|gara)/i,
    /[0-3]?\d[\/\.-][0-1]?\d[\/\.-]\d{4}|\d{1,2}\s+[A-Za-zÀ-ÖØ-öø-ÿ]+\s+\d{4}/i,
    120
  );
  // cerca un orario SOLO entro 160 char dal label (stessa finestra)
  const ctx = text.match(new RegExp(`(?:Data\\s+(?:vendita|gara))[\\s\\S]{0,160}`, "i"))?.[0] || "";
  const tm  = ctx.match(/([01]?\d|2[0-3])[:\.]([0-5]\d)/);
  const ora = tm ? `${String(tm[1]).padStart(2,"0")}:${tm[2]}` : null;

  return { data: toISODate(data || null), ora };
}

/* ---------------- Export principale ---------------- */
export async function scrapeAnnuncioFromBuffer(buffer, fileName = "annuncio.pdf") {
  const { text } = await parsePdfBuffer(buffer);
  const T = norm(text || "");

  // indirizzo
  const indirizzo_raw = extractIndirizzoLine(T);
  const indirizzo = buildAddressFromRaw(indirizzo_raw);

  // altri campi
  const { data, ora } = extractDataOra(T);

  return {
    file_pdf: fileName,
    indirizzo_raw,
    indirizzo,             // <--- ora è una STRINGA pulita
    tipo_vendita:    extractTipoVendita(T),
    data_vendita:    data,
    ora_vendita:     ora,
    offerta_minima:  extractOffertaMinima(T),
    superficie_mq:   extractSuperficie(T),
    piano_numero:    extractPiano(T),
    ascensore:       extractAscensore(T),
    stato:           extractStato(T),
    categoria_macro: extractCategoria(T),
    aggiornato_il:   extractAggiornatoIl(T),
    raw_length:      T.length
  };
}