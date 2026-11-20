# Lumen REST API (scripts and agents)

Base: `https://<your-lumen>/api` · Auth: `Authorization: Bearer <token>` (Settings › Developer › Create token; read-only tokens
can only GET). Machine-readable description: `GET /api/openapi.json` (OpenAPI 3.1). Writes sync to every device.

| Method | Path | What |
|---|---|---|
| GET | `/notes` | List notes (metadata). Query: `q`, `type`, `space`, `folder`, `tag`, `since` (ms), `limit`, `offset` |
| POST | `/notes` | Create `{ title, body, type, spaceId, folderId, tags, props, id? }` → 201 (409 if the id exists). Without `body`, `canvas` / `whiteboard` / `board` notes start as an empty JSON Canvas / .excalidraw scene |
| GET / PUT / DELETE | `/notes/:id` | Note JSON · create-or-update with a partial note · move to Trash |
| GET | `/notes/:id/markdown` | Markdown with front matter |
| POST | `/notes/:id/append` | `{ text, heading? }` append at the end, or at the end of that heading's section (created if missing) |
| GET | `/search` | `q`, `limit` → id, title, type, spaceId, snippet |
| GET / POST | `/spaces` | List · create `{ name, kind, icon, color, description }` |
| GET / POST | `/folders` | List (`space`) · create `{ name, spaceId, parentId }` |
| GET | `/tags` | Tags with counts |
| GET | `/cards/due` | Flashcards due now (`count`, `cards`) |
| GET / PUT | `/canvas/:id` | JSON Canvas 1.0 |
| GET / PUT | `/whiteboard/:id` · POST `/whiteboard/:id/elements` | Excalidraw scene · append elements. Works for `whiteboard` and `board` notes (a PUT keeps the note's type; `?type=board` creates a Board) |
| GET / PUT | `/att/:id` | Attachment bytes |
| POST | `/sync` | Raw sync `{ since, items }` |

Example: `curl -X POST $BASE/notes/<id>/append -H "Authorization: Bearer $LUMEN_TOKEN" -H 'content-type: application/json' -d '{"text":"- new idea","heading":"Inbox"}'`
