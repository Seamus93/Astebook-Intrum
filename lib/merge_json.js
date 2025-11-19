// lib/merge_json.js
// lib/merge_json.js
export function mergeAnnuncioProposta(annuncio, proposta) {
  // helper safe getter
  const get = (o, p, d=null) => p.split('.').reduce((a,k)=> (a && a[k]!==undefined ? a[k] : undefined), o) ?? d;

  const merged = {
    descrizione: get(annuncio, 'descrizione', null),
    fonte: {
      annuncio_file: get(annuncio, 'file_pdf', null),
      proposta_file: get(proposta, 'file_pdf', null),
    },
    immobile: {
      // indirizzo: priorità annuncio, fallback proposta.indirizzo_immobile
      indirizzo: get(annuncio, 'indirizzo', null) || get(proposta, 'indirizzo_immobile', null),
    },
    gara: {
      tipo_vendita:   get(annuncio, 'tipo_vendita', null),
      data:           get(annuncio, 'data_vendita', null),
      ora:            get(annuncio, 'ora_vendita', null),
      offerta_minima: get(annuncio, 'offerta_minima', null),

      // nuovi orari di gara se presenti
      ora_inizio:     get(annuncio, 'ora_gara_inizio', null) || get(annuncio, 'ora_vendita', null) || null,
      ora_fine:       get(annuncio, 'ora_gara_fine', null),
    },
    visite: {
      // nuova sezione per termine richieste visite
      termine_data: get(annuncio, 'termine_richieste_visite_data', null),
      termine_ora:  get(annuncio, 'termine_richieste_visite_ora',  null),
    },
    caratteristiche: {
      superficie_mq: get(annuncio, 'superficie_mq', null),
      piano:         get(annuncio, 'piano_numero', null),
      ascensore:     get(annuncio, 'ascensore', null),
      stato:         get(annuncio, 'stato', null),
      categoria_macro: get(annuncio, 'categoria_macro', null),
      aggiornato_il:   get(annuncio, 'aggiornato_il', null),
    },
    catasto: {
      // dalla proposta tipicamente, con riempimenti
      foglio:     get(proposta, 'catasto.foglio',     null),
      particella: get(proposta, 'catasto.particella', null),
      mappale:    get(proposta, 'catasto.mappale',    null) || get(proposta, 'catasto.particella', null),
      subalterno: get(proposta, 'catasto.subalterno', null),
      categoria:  get(proposta, 'catasto.categoria',  null),
    },
    pagamenti: {
      deposito_cauzionale: get(proposta, 'deposito_cauzionale', null),
      iban_beneficiario:    get(proposta, 'iban_beneficiario',  null),
    },
    termini: {
      irrevocabile_giorni: get(proposta, 'irrevocabile_giorni', null),
      rogito_entro_giorni: get(proposta, 'rogito_entro_giorni', null),
    },
    redazione: {
      // nuova sezione
      luogo: get(proposta, 'luogo_redazione', null),
      data:  get(proposta, 'data_redazione',  null),
      anno:  get(proposta, 'anno_redazione',  null),
    }
  };

  return merged;
}
