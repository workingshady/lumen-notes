# Architecture & diagram studio: research, feature list, user experience, use cases

> **Status:** research and specification, merged into Claude Design round 6 (`docs/design/CLAUDE_DESIGN_UPDATE_06.md` §11–§13: Architecture studio, drag and drop everywhere, shared parts and conversions). Build order: `docs/WHITEBOARD_CANVAS_PLAN.md` waves 13–18. Nothing built yet; waiting for the design.
> **Question answered here:** can Lumen do what Eraser does? That means drag-and-drop *and* text editing of diagrams and
> system / cloud architecture, with JSON, Mermaid and live preview kept in sync, plus export and save.
>
> **Short answer:** yes. It belongs on the **canvas**: a new *Architecture* mode on top of the JSON Canvas Lumen already has. It is
> not a separate tool. About half of the building blocks already exist; see §4.

---

## 1. What the market does (research summary)

### 1.1 Eraser
- **Workspace:** Markdown docs, a collaborative canvas and a diagram-as-code (DaC) editor in one workspace ([eraser.io](https://www.eraser.io/), [Eraser review](https://www.ai-tools-hq.com/tools/eraser/)).
- **Diagram-as-code:** a small text DSL (domain-specific language). The canvas updates as you type, and you can edit either the code or the visual result ([what is DaC](https://docs.eraser.io/docs/diagram-as-code)).
- **Five DaC diagram types:** flow chart, entity-relationship (ERD), cloud architecture, sequence, BPMN.
  - Architecture is built from nodes, groups (VPC, region, …) and connections such as `Compute > Storage` with labels, using cloud and tech icons ([architecture syntax](https://docs.eraser.io/architecture-diagram-syntax.md), [cloud architecture](https://docs.eraser.io/docs/cloud-architecture-diagrams), [ERD syntax](https://docs.eraser.io/erd-syntax), [flow chart syntax](https://docs.eraser.io/flow-chart-syntax.md)).
- **AI (DiagramGPT):** prompt or pasted code → diagram code. Covers architecture, sequence, BPMN, flowchart, ERD and cloud ([DiagramGPT comparison](https://slashdot.org/software/comparison/DiagramGPT-vs-Eraser.io/), [review](https://www.reviewmytools.com/review/eraser-io-diagramgpt-review/)). In the canvas, `/` → AI Diagram, or ⌘J.
- **Integrations:**
  - GitHub: diagrams in READMEs and repos.
  - API and MCP server: render code to an image ([diagramming API](https://www.eraser.io/product/diagramming-api)).
  - VS Code extension using `.eraserdiagram` files whose first line names the type ([VS Code](https://docs.eraser.io/using-the-vs-code-extension.md)).
- **Export:** PNG, SVG, PDF, Markdown. Through the API also JPEG and draw.io; Visio, PowerPoint, BPMN and PDF on paid plans ([export](https://docs.eraser.io/reference/export-diagram)).
- **Weakness noted by reviewers:** the DSL is proprietary, so diagrams are less portable than Mermaid or draw.io XML ([comparison](https://aidev.fit/en/tools/best-diagram-tools.html)).

### 1.2 Others worth copying from
| Tool | What it's best at | Idea for Lumen |
|---|---|---|
| draw.io | Biggest shape library (AWS / Azure / GCP / Kubernetes), XML that diffs cleanly in PRs ([comparison](https://dupple.com/learn/best-diagram-tools)) | draw.io XML import/export; rich icon sets |
| Lucidchart | Polished collaboration, integrations | Presentation-quality theme, comments |
| Excalidraw / tldraw | Fast sketch, "this is a draft" feel | Lumen already has the Excalidraw whiteboard; keep "sketch" vs "clean" styles |
| Mermaid `architecture-beta` | Groups, services, edges with side anchors (`db:L -- R:server`), junctions, built-in icons (cloud, database, disk, server, internet), extra icon packs ([Mermaid architecture](https://mermaid.js.org/syntax/architecture.html)) | Two-way canvas ⇄ Mermaid |
| Mermaid `block-beta` | Grid of blocks with `columns N`, spans, nested blocks | Export target for "block" layouts ([block tutorial](https://www.mermaidonline.live/mermaid-tutorials/block)) |
| Mermaid C4 | C4Context, C4Container, C4Component, C4Dynamic, C4Deployment | C4 levels as linked canvases |
| IcePanel (C4) | Zoomable levels; reused objects update everywhere they appear ([IcePanel](https://icepanel.io/), [zoomable diagrams](https://dev.to/icepanel/how-to-create-interactive-zoomable-software-architecture-diagrams-5315)) | Model objects reused across diagrams; zoom into a container |
| D2 / Structurizr / Python Diagrams | Better auto layout; one model → many views; cloud icon libraries ([tool list](https://www.besthub.dev/articles/top-11-open-source-diagram-as-code-tools-every-software-architect-should-know-09eb5be2b714)) | One model, several views |
| oxdraw | Visual tweaks are written back to the source code ([README](https://docs.rs/crate/oxdraw/0.2.1/source/README.md)) | Exactly the two-way sync we want |
| AWS Infrastructure (Application) Composer | Drag-and-drop canvas kept in sync with CloudFormation / SAM ([AWS](https://aws.amazon.com/application-composer/features)) | IaC import (read-only first) |
| Cloudcraft | Live AWS inventory, cost estimates, 3D ([Medium](https://shubhamkhairnar.medium.com/cloudcraft-create-your-infrastructure-in-a-snap-339980375baa)) | Optional cost labels; "live" is out of scope |
| TerraVision / Terraform-to-diagram tools | Diagram from `terraform plan` / HCL ([TerraVision](https://terravision.online/), [dev.to](https://dev.to/pandey-raghvendra/i-built-a-free-tool-to-generate-aws-architecture-diagrams-from-terraform-no-signup-no-e0o)) | Terraform import via AI or parser |

### 1.3 Auto layout
- **ELK Layered** (`elkjs`):
  - Lays out compound graphs, meaning groups inside groups, with edges that cross hierarchy levels, all in one run.
  - Supports orthogonal, polyline and spline edge routing with port constraints.
  - Runs in a Web Worker for large diagrams ([ELK Layered](https://eclipse.dev/elk/reference/algorithms/org-eclipse-elk-layered.html), [ELK overview](https://eclipse.dev/elk/blog/posts/2025/25-08-21-layered.html)).
  - dagre cannot do compound nodes, which is why projects move to ELK ([issue](https://github.com/magic5644/Graph-It-Live/issues/393)).

### 1.4 Icon licensing (important)
- **AWS:** customers may use the official Architecture Icons to make architecture diagrams. Modifying them, or using them for anything other than AWS services, is not allowed ([AWS icon usage](https://datadef.io/guides/en/can-i-use-aws-icons-in-presentations)).
- **Azure:** allowed in architecture diagrams and docs; no modifying them or combining them into logos ([Azure / GCP terms](https://datadef.io/guides/en/azure-and-google-cloud-icon-terms)).
- **Google Cloud:** icons published at cloud.google.com/icons; usage is generally fine for indicating Google Cloud.
- **Consequence for Lumen:**
  - Ship our **own glyph-style generic icons**: server, database, queue, cache, function, bucket, CDN, LB, API, user, mobile, browser, k8s pod….
  - Treat **vendor icon packs as optional, loaded on demand and unmodified** (rendered as-is, never recoloured).
  - Re-check licences before shipping ([icon sets overview](https://dev.to/thegdsks/free-aws-azure-and-gcp-architecture-icons-as-svg-hn8)).

---

## 2. Is it applicable to Lumen?

Yes. Lumen already has these pieces:

| Need | Already in Lumen | File |
|---|---|---|
| Drag-and-drop boxes, arrows, groups, colours | Canvas (JSON Canvas 1.0) | `src/components/CanvasEditor.tsx`, `src/lib/canvas.ts` |
| Live JSON editing next to the board | Canvas Code panel + script console (`canvas.addNode…`) | `src/components/VisualCodePanel.tsx` |
| Mermaid as code + live preview + zoom/pan | `.mermaid` diagram files, Diagrams tab | `src/components/DiagramFile.tsx`, `src/lib/diagrams.ts` |
| Diagram on a canvas | Diagram file cards, links both ways | `src/lib/canvas.ts` |
| Mermaid → editable shapes | Whiteboard (Excalidraw) | `src/components/Whiteboard.tsx` |
| Auto layout | Tidy up (layered / radial / force, pins, undo) | `src/lib/graph-layout.ts` |
| Export | SVG / PNG / JPEG / WebP dialog; `.canvas`, `.excalidraw` | `src/components/DiagramExport.tsx`, `src/lib/visual-export.ts` |
| AI | Workers AI (Llama 3.3 70B) through the Worker | `worker/ext/*.ts` |
| Docs that diagrams live in | Notes, project hub (PRD / RFC / ADR / requirements) | `src/views/ProjectHub.tsx` |

**What's missing:** architecture-aware nodes (icons, kinds, ports), nested groups (boundaries), a text DSL kept in **two-way** sync with the canvas, Mermaid / draw.io / C4 export and import, ELK layout, and the AI diagram flow.

**Design decision:** the **canvas JSON is the single source of truth.**
- Text DSL, Mermaid and the visual board are all **views** of it.
- Edits in any view write back to the same JSON.
- Everything that works on canvases today (sync, versions, share links, export, file cards, Tidy up, history) keeps working.
- Architecture data rides in extra JSON Canvas fields (`lumenArch…`), which other JSON Canvas readers ignore, as `lumenPinned` already does.

---

## 3. Complete feature list

### 3.1 Diagram types
| # | Type | Primary editing | Code view | Export |
|---|---|---|---|---|
| 1 | **Cloud / system architecture** (services, groups, connections, icons) | Drag-and-drop | Lumen DSL ⇄ Mermaid `architecture-beta` | Mermaid, JSON, draw.io, SVG/PNG/PDF |
| 2 | **Flowchart** | Drag-and-drop or code | DSL ⇄ Mermaid `flowchart` | all |
| 3 | **Sequence diagram** | Code-first with live preview; reorder participants by drag | Mermaid `sequenceDiagram` / DSL | Mermaid, SVG/PNG |
| 4 | **ERD** (entities, attributes, keys, relations, cardinality) | Table cards + drag relations | DSL ⇄ Mermaid `erDiagram`; SQL DDL import | Mermaid, SQL, SVG/PNG |
| 5 | **C4** (Context, Container, Component, Dynamic, Deployment) | Drag-and-drop, levels as linked canvases (zoom in) | Mermaid C4 / Structurizr-like DSL | Mermaid C4 |
| 6 | **Block diagram** (grid of blocks) | Drag on grid | Mermaid `block-beta` | Mermaid |
| 7 | **Network / deployment** (VPC, subnets, zones, LB, k8s) | Drag + nested groups | DSL ⇄ `architecture-beta` | all |
| 8 | **Data / ML pipeline** (sources, ETL, feature store, training, serving) | Drag | DSL ⇄ flowchart | all |
| 9 | **State machine** | Drag + code | Mermaid `stateDiagram-v2` | Mermaid |
| 10 | **Class / UML** | Code-first | Mermaid `classDiagram` | Mermaid |
| 11 | **BPMN-lite** (lanes, tasks, gateways, events) | Drag with swimlanes | DSL | SVG/PNG, BPMN XML (later) |
| 12 | **Mind map / Gantt / timeline / quadrant / pie / journey** | Code (already supported by Mermaid files) | Mermaid | Mermaid |
| 13 | **Threat model** (trust boundaries, data flows, STRIDE tags) | Drag + tags | DSL | report Markdown |

### 3.2 Canvas & drag-and-drop
- **Shape library panel:**
  - Searchable, with categories: Generic · Compute · Data · Network · Messaging · AI/ML · Security · Clients · AWS · Azure · GCP · Kubernetes · SaaS.
  - Drag a shape onto the canvas or **into a group**.
  - Recent and favourite shapes.
- **Node kinds:** service, database, queue/topic, cache, storage/bucket, function, container/pod, gateway/LB, CDN, user/actor, external system, client (web/mobile), note, text, image, embedded note card, embedded diagram card.
- **Groups / boundaries:**
  - Kinds: region, VPC, subnet, zone, cluster, namespace, account, team, trust boundary.
  - Nestable; children move with the group.
  - Collapse a group into a summary node.
  - Label + icon + colour.
- **Connections:**
  - Arrow ends: none / one / both.
  - Shapes: straight / orthogonal (elbow) / curved.
  - Labels (protocol, port, payload), dashed for async, colour by kind (sync / async / data / control).
  - Anchors on node sides (ports), and junctions to split or merge.
- **Editing:**
  - Snap to grid and alignment guides.
  - Distribute, align, same size.
  - Multi-select, group / ungroup, lock, pin.
  - Copy / paste / duplicate.
  - Undo / redo, keyboard nudging.
- **Quick-connect:** drag from a node's edge handle to empty space, then a shape picker creates the connected node, the way Lumen's skill tree does.
- **Properties side panel:**
  - Name, kind, icon, technology (e.g. "Postgres 16"), description, owner, link to note / RFC / repo.
  - Tags, status (planned / live / deprecated), cost label, SLA.
- **Layers / views:** show/hide layers (network, data flow, security), plus filter by tag.
- **Navigation:** minimap, fit, zoom, focus mode (dim everything not connected to the selection).
- **Phone:** pinch/pan, tap to select, long-press for the menu, a shape sheet, and code view as a tab. Drag is supported but not required: every action has a menu path.

### 3.3 Code views (two-way)
- **Split view:** canvas left, code right; tabs **DSL · Mermaid · JSON**.
- **Lumen DSL** (Eraser-like, human-friendly):
  ```
  direction right
  // groups (nest with braces)
  AWS [icon: aws] {
    VPC [icon: vpc] {
      API [icon: server, tech: "FastAPI"]
      Worker [icon: function]
    }
    DB [icon: database, tech: "Postgres"]
    Queue [icon: queue]
  }
  User [icon: user]
  User > API: HTTPS
  API > DB: SQL
  API > Queue: enqueue (async)
  Queue > Worker
  ```
- **Editing behaviour:**
  - **Two-way sync:**
    - typing updates the canvas (debounced; layout preserved for existing nodes);
    - dragging, renaming or connecting rewrites the DSL;
    - positions are stored in JSON, not in the DSL, so the text stays clean.
  - **Errors:** inline errors with line markers; the canvas keeps the last valid state.
  - **Editor help:** autocomplete for icons, nodes and keywords; hover a node in code to highlight it on the canvas and vice versa.
  - **Paste-in conversion:** paste Mermaid (flowchart / architecture-beta / erDiagram / C4), draw.io XML or SQL DDL into the code pane to convert it.

### 3.4 Layout
- **Auto layout (elkjs):**
  - layered with **compound groups** and **orthogonal routing**;
  - direction (right / down);
  - spacing (compact / roomy);
  - "keep my positions" vs "re-layout all";
  - preview → apply → undo (same flow as Tidy up).
- **Partial layout:** lay out only the selection or one group.

### 3.5 AI (Workers AI; optional, plain labels, no sparkle)
| Flow | Input | Output |
|---|---|---|
| **Describe → diagram** | "Payments service on AWS with API Gateway, Lambda, DynamoDB, SQS, Stripe webhook" | DSL → canvas, auto-laid-out |
| **Code → diagram** | Pasted code / repo files / OpenAPI / docker-compose / k8s YAML | Architecture or sequence DSL |
| **IaC → diagram** | Terraform HCL / `terraform plan` JSON / CloudFormation / SAM | Architecture DSL (parser first, AI fallback) |
| **SQL → ERD** | DDL / ORM models (Prisma, SQLAlchemy) | ERD |
| **Doc → diagram** | An RFC / PRD note in Lumen | Diagram inserted into the note (via a canvas card) |
| **Edit by instruction** | "add a Redis cache between API and DB", "split into 2 regions" | A change shown as a diff; Accept / Reject |
| **Explain / review** | The diagram | Prose explanation, single points of failure, missing auth / encryption / backups, STRIDE threats |
| **Diagram → docs** | The diagram | ADR / RFC section, component table, Mermaid for README |
| **Flashcards** | The diagram | `Q :: A` cards ("What sits between API and DB?"), linking to the learning path |

AI output is always the **DSL**, which is validated before it touches the canvas. It is never raw JSON.

### 3.6 Import / export / save
| Format | Import | Export |
|---|---|---|
| JSON Canvas (`.canvas`) + Lumen arch fields | check | check (already) |
| Lumen DSL (`.lumendiagram` / code block) | check | check |
| Mermaid (flowchart, architecture-beta, erDiagram, C4, sequence, block-beta, state, class) | check (to canvas or code) | check |
| draw.io XML (`.drawio`) | check (shapes, groups, edges) | check |
| Excalidraw | via whiteboard | check (sketch style) |
| SVG / PNG / JPEG / WebP / PDF | — | check (SVG–WebP via the existing dialog; PDF to add) |
| SQL DDL | check (ERD) | check (ERD → DDL) |
| Terraform / CloudFormation / docker-compose / k8s | check (read-only → diagram) | — (later: skeleton IaC) |
| Markdown | — | check (diagram + component table for docs / README) |

**Save:**
- **Format and sync:** a diagram is a canvas note (`type: canvas`, `kind: architecture`). It autosaves, syncs, keeps version history, and has share links and public pages.
- **Embedding:**
  - `![[Diagram]]` embeds it in any note, live, with zoom and a click to open.
  - A `diagram` code block can hold the DSL inline in a note.

### 3.7 Model features (beyond one picture)
- **Reused objects** (IcePanel-style): the same "Payments API" node can appear in several diagrams. Editing its name, tech or owner updates it everywhere.
- **Zoom levels (C4):** double-click a container to open its component diagram, with a breadcrumb back.
- **Links to work:**
  - A node can link to notes, RFCs, ADRs, requirements (REQ-n) and project-hub task cards.
  - The node shows a status ring from the linked cards: planned / in progress / done.
- **Diff between versions:** added nodes are green, removed red, changed amber, using the existing version history.
- **Templates:** 3-tier web app, serverless API, event-driven microservices, RAG / LLM app, ML training + serving pipeline, data lakehouse, k8s deployment, mobile + backend, C4 starter, ERD starter, threat-model starter.

### 3.8 Collaboration & sharing (reuse what exists)
- Share link (read-only public page with zoom/pan), publish to blog, comments on nodes (later), and a presenter mode that steps through layers or groups.

---

## 4. Lumen today → target

| Area | Today | Target |
|---|---|---|
| Nodes | text / note / link / group cards | + architecture kinds with icons, tech, status, ports |
| Groups | flat group cards | nested boundaries, collapse to a summary |
| Edges | label, colour, arrow ends, shape (curved / elbow / straight) | + protocol / async styles, anchors, junctions |
| Code | JSON panel + JS script | **DSL ⇄ canvas two-way**, Mermaid tab, errors, autocomplete |
| Mermaid | separate `.mermaid` files, Mermaid → whiteboard shapes | canvas ⇄ Mermaid conversion (flowchart, architecture-beta, ER, C4) |
| Layout | Tidy up (layered / radial / force) | elkjs compound layered + orthogonal routing |
| Export | SVG/PNG/JPEG/WebP, .canvas | + PDF, Mermaid, DSL, draw.io, Markdown, SQL |
| AI | none for diagrams | describe / code / IaC / SQL → diagram; edit by instruction; review; docs |
| Icons | Lumen glyph set (~120) | + generic architecture set (~80 glyph-style) + optional vendor packs |

---

## 5. User experience

### 5.1 Entry points
- **Creating one:** `+` menu → **New diagram…** opens a chooser with Architecture · Flowchart · Sequence · ERD · C4 · From template · Describe it (AI) · Import (Mermaid / draw.io / Terraform / SQL).
- **From inside a note:** the slash menu (`/architecture`, `/diagram`, `/erd`) and the project hub's Diagrams tab ("New architecture").
- **From what you have:** select text or code in a note → "Make a diagram".

### 5.2 Main screen (desktop)
```
┌ Breadcrumb · title · Saved ───────────── [Layout ▾] [Code ⇆] [Export] [Share] ┐
│ Shapes │                 Canvas (dot grid)               │ Code: DSL·Mermaid·JSON │
│ search │  ┌ AWS ───────────────────────┐                 │ 1 AWS {                 │
│ Generic│  │ ┌ VPC ─────────┐  [DB]     │   (User)        │ 2   VPC { API Worker }  │
│ AWS    │  │ │ [API] [Wkr]  │  [Queue]  │                 │ 3   DB  Queue           │
│ GCP …  │  │ └──────────────┘           │                 │ 4 }  User > API: HTTPS  │
│ Recent │  └────────────────────────────┘      minimap    │ Note: line 7: unknown icon  │
└────────┴─────────────────────────────────────────────────┴────────────────────────┘
               Properties panel slides over the code pane when a node is selected
```
- **Drag in:** drag a shape in, drop it inside a group, and it nests.
- **Connect:** hover a node to show 4 handles, drag one to connect. A drop on empty space opens the shape picker.
- **Code and canvas follow each other:** typing in the code pane updates the canvas within 300 ms; the canvas never jumps, because only new nodes get placed.
- **Layout ▾:** Auto layout (preview, Apply, Undo), Direction, Spacing, Keep positions.

### 5.3 Phone
- **Canvas:** full-screen; bottom bar with Shapes · Connect · Code · Layout · ⋯.
- **Sheets:** shapes as a searchable sheet; code as a full-screen tab with a "Preview" toggle.
- **Without drag:** long-press a node for Rename / Connect to… / Move into group… / Delete. Every drag action has a menu alternative.

### 5.4 Principles
- **Two-way, no surprises:** code never loses positions, the canvas never loses code comments.
- **Last valid state wins:** a syntax error never blanks the diagram.
- **Portable by default:** Mermaid export is always available; the DSL is documented and plain text.
- **AI proposes, you accept:** every AI change is shown as a diff with Accept or Reject.
- **Design:** round-4 rules (glyphs, no emoji, no "AI look"), Lamplight + Paper, Arabic labels supported.

---

## 6. Use cases
1. **System design study:** while learning *AI Engineering* or *Designing ML systems*, draw a RAG pipeline, link each node to the lesson note, and generate flashcards from the diagram.
2. **Project hub RFC:** an architecture diagram embedded in the RFC, with nodes linked to REQ-n and task cards. A node's status ring shows progress.
3. **Interview prep:** templates for common system designs (URL shortener, chat, feed, payments). Review mode hides labels for recall.
4. **Cloud migration:** import Terraform to get the current state, copy it into a target diagram, and diff the two versions.
5. **Data model:** paste SQL DDL to get an ERD, edit the relations visually, and export DDL or Mermaid for the README.
6. **Onboarding docs:** a C4 context → container → component chain, shared as a public link.
7. **Incident / threat review:** trust boundaries plus STRIDE tags, with an AI review listing the risks, saved as a note.
8. **README diagrams:** export Mermaid and paste it into GitHub, where Mermaid renders natively.
9. **ML pipeline:** data sources → feature store → training → registry → serving → monitoring, with cost and SLA labels.
10. **Teaching / slides:** present a diagram layer by layer in Slides, or as a step-through presenter.

---

## 7. Data model (proposal)
JSON Canvas stays the file format. Extra fields:
```jsonc
{
  "lumenArch": { "kind": "architecture", "direction": "right", "dsl": "AWS { … }", "layout": "elk-layered" },
  "nodes": [
    { "id": "api", "type": "text", "text": "API", "x": 0, "y": 0, "width": 160, "height": 64,
      "lumenNode": { "kind": "service", "icon": "server", "tech": "FastAPI", "status": "live",
                     "links": ["[[RFC 012]]", "REQ-4"], "ref": "obj-payments-api" } },
    { "id": "vpc", "type": "group", "label": "VPC", "lumenGroup": { "kind": "vpc", "parent": "aws", "collapsed": false } }
  ],
  "edges": [
    { "id": "e1", "fromNode": "user", "toNode": "api", "label": "HTTPS",
      "lumenEdge": { "style": "sync", "shape": "orthogonal", "protocol": "https", "port": 443 } }
  ]
}
```
- `ref` points to a shared **model object** (a small synced record or a front-matter block) so the same object can be reused across diagrams.
- The DSL is derived from nodes and edges. `lumenArch.dsl` caches comments and formatting so a round trip keeps them.

---

## 8. Build plan (suggested)
| Phase | Scope | Size |
|---|---|---|
| 0 | Claude Design round: shape library, node and group styles, split code view, AI flows, phone | design |
| 1 | Architecture node kinds + generic icon set; nested groups; properties panel; edge styles and anchors | M |
| 2 | Lumen DSL parser/printer + **two-way sync** + errors and autocomplete | L |
| 3 | Mermaid import/export (flowchart, architecture-beta, erDiagram, C4); elkjs layout with compound groups | M |
| 4 | Export: PDF, draw.io, Markdown, SQL; `![[Diagram]]` live embed; templates | M |
| 5 | AI: describe / code / IaC / SQL → DSL; edit by instruction with diff; review; diagram → docs and flashcards | M |
| 6 | Model objects reused across diagrams, C4 zoom levels, version diff, hub links and status rings | L |
| 7 | Optional vendor icon packs (AWS/Azure/GCP, unmodified, on demand); threat-model tags; presenter | S–M |

**Dependencies:** `elkjs` (EPL-2.0, ~1 MB, lazy-loaded in a worker). Mermaid is already bundled. No other heavy library is needed.

**Risks:**
- Vendor icon licences: §1.4.
- Layout jumps on two-way sync: keep positions and place only new nodes.
- Mermaid `architecture-beta` is still beta, so the syntax may change.
- AI quality on Llama 3.3: validate the DSL and fall back to the parser.

---

## 9. Sources
- Eraser:
  - [eraser.io](https://www.eraser.io/)
  - [Diagram as code](https://docs.eraser.io/docs/diagram-as-code)
  - [Architecture syntax](https://docs.eraser.io/architecture-diagram-syntax.md)
  - [Cloud architecture diagrams](https://docs.eraser.io/docs/cloud-architecture-diagrams)
  - [ERD syntax](https://docs.eraser.io/erd-syntax)
  - [Flow chart syntax](https://docs.eraser.io/flow-chart-syntax.md)
  - [Export API](https://docs.eraser.io/reference/export-diagram)
  - [Diagramming API](https://www.eraser.io/product/diagramming-api)
  - [VS Code extension](https://docs.eraser.io/using-the-vs-code-extension.md)
  - [DiagramGPT vs Eraser](https://slashdot.org/software/comparison/DiagramGPT-vs-Eraser.io/)
  - [Eraser DiagramGPT review](https://www.reviewmytools.com/review/eraser-io-diagramgpt-review/)
  - [Eraser review 2026](https://www.ai-tools-hq.com/tools/eraser/)
- Comparisons:
  - [Best diagram tools 2026](https://dupple.com/learn/best-diagram-tools)
  - [Excalidraw vs draw.io vs Mermaid vs Eraser](https://aidev.fit/en/tools/best-diagram-tools.html)
  - [Architecture diagramming tools 2026](https://www.8starlabs.com/blogs/architecture-diagramming-tools-2026)
  - [Top 7 diagrams-as-code tools](https://icepanel.io/blog/top-7-diagrams-as-code-tools-for-software-architecture)
  - [Top 11 open-source diagram-as-code tools](https://www.besthub.dev/articles/top-11-open-source-diagram-as-code-tools-every-software-architect-should-know-09eb5be2b714)
  - [oxdraw](https://docs.rs/crate/oxdraw/0.2.1/source/README.md)
- Mermaid:
  - [Architecture (v11.1.0+)](https://mermaid.js.org/syntax/architecture.html)
  - [Block diagrams](https://www.mermaidonline.live/mermaid-tutorials/block)
  - [Cheat sheet](https://mermaideditor.com/cheatsheet)
- Layout:
  - [ELK Layered](https://eclipse.dev/elk/reference/algorithms/org-eclipse-elk-layered.html)
  - [ELK Layered overview](https://eclipse.dev/elk/blog/posts/2025/25-08-21-layered.html)
  - [Why ELK over dagre](https://github.com/magic5644/Graph-It-Live/issues/393)
- C4 and IcePanel:
  - [IcePanel](https://icepanel.io/)
  - [IcePanel diagramming](https://docs.icepanel.io/core-features/diagramming)
  - [Zoomable diagrams](https://dev.to/icepanel/how-to-create-interactive-zoomable-software-architecture-diagrams-5315)
  - [C4 model](https://c4model.info/)
- Icons:
  - [AWS icon usage](https://datadef.io/guides/en/can-i-use-aws-icons-in-presentations)
  - [Azure and Google Cloud icon terms](https://datadef.io/guides/en/azure-and-google-cloud-icon-terms)
  - [Free AWS/Azure/GCP SVGs](https://dev.to/thegdsks/free-aws-azure-and-gcp-architecture-icons-as-svg-hn8)
- IaC and AI:
  - [AWS Infrastructure Composer](https://aws.amazon.com/application-composer/features)
  - [Cloudcraft](https://shubhamkhairnar.medium.com/cloudcraft-create-your-infrastructure-in-a-snap-339980375baa)
  - [TerraVision](https://terravision.online/)
  - [Terraform to diagram](https://diagrams.so/learn/terraform-to-architecture-diagram)
  - [Cloud diagram tools 2026](https://infrasketch.net/blog/best-cloud-architecture-diagram-tools-2026)
