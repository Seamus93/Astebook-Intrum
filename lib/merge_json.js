// lib/merge_json.js
export function mergeAnnuncioProposta(annuncio, proposta) {
  // helper safe getter
  const get = (o, p, d = null) =>
    p.split(".").reduce((a, k) => (a && a[k] !== undefined ? a[k] : undefined), o) ?? d;

  // prova a separare indirizzo e comune
  const splitIndirizzoComune = (val) => {
    if (!val || typeof val !== "string") return { indirizzo: null, comune: null };
    const raw = val.trim();
    const commaParts = raw.split(",").map((s) => s.trim()).filter(Boolean);
    if (commaParts.length >= 2) {
      const comune = commaParts.pop();
      const indirizzo = commaParts.join(", ");
      return { indirizzo: indirizzo || null, comune: comune || null };
    }
    const m = raw.match(/^([A-ZÀ-ÖØ-Ý][\w'’\.À-ÖØ-öø-ÿ ]{2,})\s+in\s+(.*)$/i);
    if (m) return { comune: m[1].trim() || null, indirizzo: m[2].trim() || null };
    return { indirizzo: raw || null, comune: null };
  };

  const indirizzoAnnuncio = get(annuncio, "indirizzo", null);
  const indirizzoProposta = get(proposta, "indirizzo_immobile", null);
  const chosenIndirizzo = indirizzoAnnuncio || indirizzoProposta || null;
  const split = splitIndirizzoComune(chosenIndirizzo);

  const merged = {
    descrizione: get(annuncio, "descrizione", null),
    fonte: {
      annuncio_file: get(annuncio, "file_pdf", null),
      proposta_file: get(proposta, "file_pdf", null),
    },
    immobile: {
      indirizzo: split.indirizzo,
      comune: split.comune,
    },
    gara: {
      tipo_vendita: get(annuncio, "tipo_vendita", null),
      data: get(annuncio, "data_vendita", null),
      ora: get(annuncio, "ora_vendita", null),
      offerta_minima: get(annuncio, "offerta_minima", null),
      ora_inizio: get(annuncio, "ora_gara_inizio", null) || get(annuncio, "ora_vendita", null) || null,
      ora_fine: get(annuncio, "ora_gara_fine", null),
    },
    visite: {
      termine_data: get(annuncio, "termine_richieste_visite_data", null),
      termine_ora: get(annuncio, "termine_richieste_visite_ora", null),
    },
    caratteristiche: {
      superficie_mq: get(annuncio, "superficie_mq", null),
      piano: get(annuncio, "piano_numero", null),
      ascensore: get(annuncio, "ascensore", null),
      stato: get(annuncio, "stato", null),
      categoria_macro: get(annuncio, "categoria_macro", null),
      aggiornato_il: get(annuncio, "aggiornato_il", null),
    },
    catasto: {
      foglio: get(proposta, "catasto.foglio", null),
      particella: get(proposta, "catasto.particella", null),
      mappale: get(proposta, "catasto.mappale", null) || get(proposta, "catasto.particella", null),
      subalterno: get(proposta, "catasto.subalterno", null),
      categoria: get(proposta, "catasto.categoria", null),
    },
    pagamenti: {
      deposito_cauzionale: get(proposta, "deposito_cauzionale", null),
      iban_beneficiario: get(proposta, "iban_beneficiario", null),
    },
    termini: {
      irrevocabile_giorni: get(proposta, "irrevocabile_giorni", null),
      rogito_entro_giorni: get(proposta, "rogito_entro_giorni", null),
    },
    redazione: {
      luogo: get(proposta, "luogo_redazione", null),
      data: get(proposta, "data_redazione", null),
      anno: get(proposta, "anno_redazione", null),
    },
  };

  return merged;
}
