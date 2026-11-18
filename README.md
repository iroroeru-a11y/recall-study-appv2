# Recall

Recall is a local-first active-recall and spaced-repetition study app. It is a React + Tailwind single-page application with IndexedDB persistence and a serverless Claude integration.

## Requirements

- Node.js 20+
- npm
- A Vercel account (or adapt `api/generate.js` to your serverless host)
- An Anthropic API key for AI card generation. Manual cards, review, scheduling, stats and import/export work without it.

## Run locally

```bash
npm install
npm run dev
```

Open the local URL printed by Vite. Vite serves the frontend; for the AI endpoint locally, use Vercel CLI:

```bash
npm install -g vercel
vercel dev
```

Set `ANTHROPIC_API_KEY` in your local Vercel environment (or in a local `.env` file used by Vercel CLI). Never add the key to `VITE_*` variables or frontend source.

## Deploy to Vercel

1. Push this project to a Git repository and import it into Vercel.
2. Framework preset: Vite. Build command: `npm run build`. Output directory: `dist`.
3. Add `ANTHROPIC_API_KEY` under Project → Settings → Environment Variables. Optionally set `ANTHROPIC_MODEL`.
4. Deploy. The `/api/generate` function is provided by `api/generate.js`.

The API function accepts POST JSON `{ deckName, sections }`, calls Anthropic on the server, validates the JSON array, and returns `{ cards }`. It never exposes the secret to the browser.

## Tests

```bash
npm test
npm run test:watch
```

The SM-2 scheduler is isolated in `src/lib/scheduler.js`; tests live beside it. Run `npm run build` for a production build check.

## Features

- IndexedDB repositories for decks, cards, uploaded-source metadata, settings and review logs.
- Question/answer, cloze (`{{c1::answer}}`) and free-recall cards.
- Reveal-before-rating review with Again / Hard / Good / Easy, desktop shortcuts (Space and 1–4), and overdue-first scheduling.
- SM-2 ease, intervals, repetitions and lapses; exam-date interval caps.
- DOCX (Mammoth), PDF (PDF.js) and PPTX (JSZip/XML) text extraction. Unsupported/legacy formats and files over 25 MB are rejected.
- Editable section preview, chunked AI generation, proposal editing/removal/approval, source labels and duplicate warnings.
- Deck/tag fields, bulk paste, dashboard, 14-day forecast, maturity stats, retention, streak, JSON backup/restore, theme and reminder permission.
- Responsive layout and keyboard-visible focus styles.

## Data and privacy

All study records are stored in IndexedDB on the current browser/device. Clearing browser site data can remove them, so export a JSON backup periodically. The original uploaded file is processed in memory in the browser and is not stored by this app. Extracted text is sent to Anthropic only when the user chooses Generate cards. The app persists selected extracted section text as source metadata so approved cards can link back to their source and section. Do not upload confidential or restricted notes unless you are permitted to send them to the configured AI provider.

## Architecture

- `src/lib/db.js`: IndexedDB repository boundary; replace/extend with an authenticated API repository when introducing a backend.
- `src/lib/scheduler.js`: scheduling engine, independent of persistence and UI; a future FSRS adapter can implement the same scheduling boundary.
- `src/lib/extract.js`: client-side document extraction.
- `src/lib/ai.js`: chunking and frontend API client.
- `api/generate.js`: server-only Anthropic call and response validation.
- `src/App.jsx`: app screens and workflows.

## Known v1 boundaries

- Browser notification permission is opt-in. A reliable notification while the app/browser is fully closed requires a service worker plus push subscription and a server-side scheduler; this project does not pretend a client timer can guarantee that.
- PDF OCR is not included. Scanned/image-only PDFs are detected and explained.
- PPTX notes are extracted from the notes slide XML where present; highly unusual custom slide layouts may need a richer relationship resolver.
- Retention is calculated from available review logs (Good/Easy divided by all ratings in the last 30 days).
- Duplicate detection is a conservative normalized-text match, not semantic embedding similarity.
- Local browser storage is not synchronised across devices in this v1.
