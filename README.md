# Lumen

Local-first study notebook + personal blog. You write lessons in Markdown (math, Mermaid, code, callouts), organize them in **spaces → folders → notes**, follow course **roadmaps**, review **flashcards**, think on a **canvas** or a **whiteboard**, present notes as **slides**, and publish chosen notes to a public **blog**.

- **Live:** https://lumen-notes.workingshady.workers.dev (blog at `/blog`, RSS at `/rss.xml`)
- **Stack:** Vite + React 19 + TypeScript + Tailwind v4 · Cloudflare Workers (Hono) + D1 (+ R2 when enabled) + Workers AI · Dexie (IndexedDB) · CodeMirror 6 · markdown-it + KaTeX + Mermaid · React Flow (canvas) · Excalidraw (whiteboard) · d3-force (graph) · Capacitor (Android)
- **Docs:** [features](docs/FEATURES.md) · [design docs for Claude Design (order + index)](docs/design/README.md)

## How data works
Every write goes to IndexedDB first, so the app works offline. With sync unlocked (Settings → Sync, owner passphrase) changes are pushed to D1 within a few seconds and pulled on focus, reconnect, and every minute. Each record is last-write-wins by `updatedAt`, and the sync cursor is a server-side revision counter, so device clocks don't matter.

## Formats & protocols (everything is plain files)
| Thing | Format | REST (Bearer token) |
|---|---|---|
| Note | Markdown + YAML front-matter | `GET /api/notes?q=&type=` · `GET/PUT /api/notes/:id` |
| Canvas | [JSON Canvas 1.0](https://jsoncanvas.org/spec/1.0/) `.canvas` | `GET/PUT /api/canvas/:id` |
| Whiteboard | Excalidraw `.excalidraw` | `GET/PUT /api/whiteboard/:id` · `POST /api/whiteboard/:id/elements {skeleton:[…]}` |
| Roadmap | Markdown: `## Module`, `- [ ] / [/] / [x] / [-] Topic (needs: X) 📅 date → [[Note]]` | same as notes |
| Flashcards | `Question :: Answer` or `Question` / `?` / answer lines | same as notes |
| Query block | ```` ```query tag:ml type:lesson sort:title view:table ```` | — |
| Share link | `/s/<token>` (note) or `/s/<token>/<noteId>` (inside a shared space) | `GET /api/share/:token` · `GET /api/share/:token/note/:id` (public, read-only) |
| Vault | `.zip` of `<Space>/<folders>/<note>.md` (Obsidian-compatible) | — |

Get a token: `curl -X POST $HOST/api/login -d '{"passcode":"…"}' -H 'content-type: application/json'`.

## Develop
```bash
npm install
npm run db:migrate      # local D1
npm run dev             # http://localhost:5173 (local passphrase: dev-passcode, from .dev.vars)
npm run build           # type-check + production build
npm run deploy          # build + wrangler deploy
npm run db:migrate:remote
```

## Android (APK)
**Download:** [latest Lumen.apk](https://github.com/workingshady/lumen-notes/releases/latest/download/Lumen.apk) (see [Releases](https://github.com/workingshady/lumen-notes/releases)). Build it yourself:
```bash
npm run android:sync    # static build with VITE_API_BASE from .env.app → android/
cd android && gradlew assembleDebug   # Capacitor 6: JDK 17 (JAVA_HOME) + Android SDK
# → android/app/build/outputs/apk/debug/app-debug.apk
```

## Files (free tier)
Attachments are split into 1.5 MB parts and stored in D1 (`file_parts` + `file_meta`), streamed back with HTTP Range support, so videos can seek. Limits: 100 MB per file, 5 GB of D1 storage on the free plan (shared with notes). Big photos are compressed on the device first. For long videos, use an unlisted YouTube link (free, unlimited, embeds inline). R2 is optional and needs a card on the account.
