# Astebook Intrum Zapier

Pipeline Node/Express per estrazione/merge annuncio e proposta via OpenAI. Endpoint principale: `POST /callAI`.

## Setup
- Requisiti: Node.js 18+, npm.
- Clona o copia il repo sul server (senza `node_modules`).
- Installa: `npm install`.
- Configura `.env` (esempio):
  ```
  OPENAI_API_KEY=xxx
  PORT=4000
  ```

## Avvio rapido
- Semplice: `npm run start:4000` (o `npm start` per porta di default 3000).
- Tunnel opzionale: `npm run all` (server su 4000 + ngrok http 4000) se vuoi un URL pubblico temporaneo.

## Produzione consigliata
Usa un process manager (pm2) e un reverse proxy HTTPS.
- Installa pm2 (una volta): `npm install -g pm2`.
- Avvia: `pm2 start server.js --name aste --env production -- --port 4000`.
- Proxy (nginx/Caddy) che espone 443→localhost:4000. Blocca l’accesso diretto alla porta interna nel firewall.

## Endpoint principali
- `GET /health` → `{ ok: true }`.
- `POST /callAI` (JSON o multipart):
  - `email_body_text` (testo annuncio, obbligatorio).
  - Proposta via `proposta_ocr` (testo) oppure PDF: `proposta_url` (https), `proposta_base64`, o upload file `proposta`.
  - Opzionali: `proposta_name`, `annuncio_name`, altri campi già supportati.

La risposta contiene `ai.annuncio`, `ai.proposta` e `merged` con campi normalizzati; data gara viene calcolata a +2 giorni dal termine deposito se mancante.

## Note
- Mantieni aggiornata la chiave OpenAI e verifica i limiti di costo.
- `ngrok` è incluso come script, assicurati che il binario sia nel PATH sul server se vuoi usarlo.
