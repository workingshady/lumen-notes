// Dev simulator scenario "Organize & connect (round 4)": one vault that puts every Organize & connect feature in a
// state worth checking. Bases (every view, multi-value tags/courses, empty base → template picker), a dashboard with
// every tile type over real sessions / cards / path / notes / base numbers, smart folders (pinned, coloured, every
// operator), unlinked mentions (English + Arabic prefixes, one ignored), shared tags, orphans + broken links, course
// roadmaps with branching prerequisites (implied links, after:/related:), a learning path over them, a canvas (groups,
// pinned cards, PDF highlight cards, a PDF card, a .mermaid file card), a whiteboard and a .mermaid diagram file.
//
// The builder only ADDS records to the vault it is given (no clearing), so it can be composed with other seeds.
// Every id starts with `r4o-`.
import { autoOrganize, buildPath, mergeConcepts, parsePath, resolveCourses, serializePath, addResource, addConceptNeed, scheduleNewlyDone, type BuiltPath } from "../path";
import { hlCanvasNode, serializeHighlight, type Highlight } from "../pdf-format";
import { SMART_PROP } from "../smart";
import { addFile, cardsFor, clock, DAY, emptyVault, folder, INBOX, note, pdfBlob, pngBlob, rng, session, space, type Vault } from "./kit";

const F = "```";

// ------------------------------------------------------------------ course roadmaps (branching prerequisites)
// Implied links (transitive, hidden by "Hide implied links"): CS231n Neural networks → Optimization (via
// Backpropagation), ResNet → Neural networks (via Convolution), CS224n Transformer block → Word vectors (via Attention).
const RM_CS231N = `## Foundations
- [x] Linear classifiers
- [x] Loss functions (needs: Linear classifiers)
- [x] Optimization (needs: Loss functions) → [[Gradient descent]]
## Networks
- [/] Backpropagation (needs: Optimization) 📅 {d2} → [[Backpropagation]]
- [/] Activation functions (needs: Backpropagation) (related: Batch normalization) 📅 {d4} → [[Activation functions]]
- [ ] Neural networks (needs: Backpropagation, Optimization) 📅 {d9}
- [ ] Batch normalization (needs: Neural networks) (after: Activation functions) 📅 {d12} → [[Batch normalization]]
## Vision
- [ ] Convolution (needs: Neural networks) 📅 {d19} → [[Convolution]]
- [ ] Pooling (needs: Convolution) → [[Pooling]]
- [ ] ResNet (needs: Convolution, Batch normalization, Neural networks) 📅 {d26} → [[ResNet]]
- [ ] Data augmentation (after: Convolution) → [[Data augmentation]]
`;
const RM_CS224N = `## Words
- [x] Word vectors
- [/] Subword tokenization (needs: Word vectors) 📅 {d3}
## Sequence models
- [ ] Attention (needs: Word vectors) 📅 {d5} → [[Attention]]
- [ ] Transformer block (needs: Attention, Word vectors) 📅 {d14} → [[Transformer block]]
- [ ] RAG (needs: Transformer block) (related: Fine-tuning with LoRA) 📅 {d29} → [[RAG]]
`;
const RM_KARPATHY = `## micrograd
- [x] Backprop by hand
- [x] AdamW (needs: Backprop by hand) → [[AdamW]]
## makemore and GPT
- [/] BPE tokenizer (needs: Backprop by hand) 📅 {d6} → [[Tokenization (BPE)]]
- [ ] GPT from scratch (needs: BPE tokenizer, AdamW) (after: Attention) 📅 {d30}
`;

// ------------------------------------------------------------------ a small Excalidraw scene (converted on first open)
function whiteboard() {
  return JSON.stringify({
    type: "excalidraw", version: 2, source: "lumen", elements: [], appState: { viewBackgroundColor: "transparent", gridSize: null }, files: {},
    lumenPending: [
      { type: "rectangle", id: "r4o-wb-in", x: 0, y: 0, width: 180, height: 80, backgroundColor: "#d0ebff", fillStyle: "solid", roundness: { type: 3 }, label: { text: "Tokens", fontSize: 20 } },
      { type: "rectangle", id: "r4o-wb-att", x: 260, y: 0, width: 200, height: 80, backgroundColor: "#e5dbff", fillStyle: "solid", roundness: { type: 3 }, label: { text: "Self-attention", fontSize: 20 } },
      { type: "rectangle", id: "r4o-wb-ffn", x: 540, y: 0, width: 180, height: 80, backgroundColor: "#d3f9d8", fillStyle: "solid", roundness: { type: 3 }, label: { text: "MLP", fontSize: 20 } },
      { type: "ellipse", id: "r4o-wb-out", x: 800, y: -10, width: 160, height: 100, backgroundColor: "#ffec99", fillStyle: "solid", label: { text: "Logits", fontSize: 20 } },
      { type: "arrow", id: "r4o-wb-a1", x: 0, y: 0, start: { id: "r4o-wb-in" }, end: { id: "r4o-wb-att" } },
      { type: "arrow", id: "r4o-wb-a2", x: 0, y: 0, start: { id: "r4o-wb-att" }, end: { id: "r4o-wb-ffn" } },
      { type: "arrow", id: "r4o-wb-a3", x: 0, y: 0, start: { id: "r4o-wb-ffn" }, end: { id: "r4o-wb-out" }, strokeColor: "#e03131" },
      { type: "rectangle", id: "r4o-wb-st", x: 260, y: 150, width: 200, height: 130, backgroundColor: "#fff3bf", fillStyle: "solid", strokeColor: "transparent", customData: { lumen: "sticky" }, label: { text: "Residual around both blocks", fontSize: 18 } },
      { type: "text", id: "r4o-wb-ar", x: 540, y: 170, text: "الانتباه يربط كل رمز بالآخر", fontSize: 22 },
      { type: "frame", id: "r4o-wb-fr", name: "Transformer block", children: ["r4o-wb-att", "r4o-wb-ffn"] },
    ],
  });
}

const DIAGRAM = "flowchart LR\n  t[Tokens] --> e[Embedding]\n  e --> a[Self-attention]\n  a --> m[MLP]\n  m --> o((Logits))\n  a -. residual .-> m\n";

const BASE_YAML = `\`\`\`base
filters:
  and:
    - type == "lesson"
views:
  - type: table
    name: Table
    filters:
      and:
        - or:
            - status == "learning"
            - status == "review"
            - status == "todo"
            - status == "mastered"
        - '!file.hasTag("archived")'
    sort:
      - property: due
        direction: ASC
    order: [file.name, status, course, file.tags, due, cards]
  - type: board
    name: Board
    groupBy:
      property: status
      direction: ASC
    order: [file.name, course]
  - type: cards
    name: Gallery
    order: [file.name, status, course]
  - type: list
    name: List
    groupBy:
      property: course
      direction: ASC
    order: [file.name, course, due]
  - type: calendar
    name: Calendar
    date: due
    order: [file.name, course]
  - type: board
    name: By tag
    groupBy:
      property: file.tags
      direction: ASC
    groupMulti: each
    order: [file.name, course]
  - type: table
    name: By courses
    groupBy:
      property: courses
      direction: ASC
    groupMulti: each
    order: [file.name, status, courses, difficulty, due]
\`\`\`
`;

const DASH_YAML = (path: string, base: string) => `\`\`\`dashboard
range: 8w
tiles:
  - id: learned
    title: Concepts learned
    type: number
    source: path:${path}
    filter: learned == true
    range: 7d
    layout: { x: 0, y: 0, w: 3, h: 2 }
  - id: due
    title: Cards due today
    type: number
    source: cards
    filter: dueOn <= today()
    better: down
    caption: FSRS · retention 0.90
    layout: { x: 3, y: 0, w: 3, h: 2 }
  - id: minutes
    title: Minutes studied
    type: number
    source: sessions
    y: minutes
    aggregate: sum
    range: 7d
    delta: percent
    caption: this week · goal 420
    layout: { x: 6, y: 0, w: 3, h: 2 }
  - id: ring
    title: Path progress
    type: ring
    source: path:${path}
    part: learned == true
    layout: { x: 9, y: 0, w: 3, h: 4 }
  - id: stacked
    title: Minutes per week by course
    type: stackedBar
    source: sessions
    x: at
    bucket: week
    y: minutes
    aggregate: sum
    series: course
    range: 8w
    layout: { x: 0, y: 2, w: 5, h: 4 }
  - id: line
    title: Minutes per day
    type: line
    source: sessions
    x: at
    bucket: day
    y: minutes
    aggregate: sum
    range: 30d
    layout: { x: 5, y: 2, w: 4, h: 4 }
  - id: area
    title: Concepts learned over time
    type: area
    source: path:${path}
    x: learnedOn
    bucket: week
    range: 20w
    cumulative: true
    layout: { x: 9, y: 4, w: 3, h: 4 }
  - id: donut
    title: Time by course
    type: donut
    source: sessions
    x: course
    y: minutes
    aggregate: sum
    layout: { x: 0, y: 6, w: 4, h: 4 }
  - id: heat
    title: Study days · 20 weeks
    type: heatmap
    source: sessions
    x: at
    y: minutes
    aggregate: sum
    range: 20w
    layout: { x: 4, y: 6, w: 5, h: 4 }
  - id: bar
    title: Cards due, next 14 days
    type: bar
    source: cards
    x: dueOn
    bucket: day
    range: next 14d
    layout: { x: 0, y: 10, w: 6, h: 4 }
  - id: table
    title: Lessons by course
    type: table
    source: base:${base}
    x: course
    layout: { x: 6, y: 10, w: 6, h: 4 }
  - id: list
    title: Due next
    type: list
    source: notes
    filter:
      and:
        - type == "lesson"
        - due >= today()
    fields: [title, due]
    sort: due
    limit: 6
    layout: { x: 9, y: 8, w: 3, h: 2 }
  - id: rows
    title: Slowest concepts
    type: table
    source: path:${path}
    fields: [concept, stage, status]
    limit: 5
    layout: { x: 0, y: 14, w: 6, h: 4 }
\`\`\`
`;

/** Smart folders: pinned, coloured, every operator family (see docs/SMART_FOLDERS.md). */
const SMART = (c: ReturnType<typeof clock>) => [
  { id: "r4o-sf-week", name: "Lessons due this week", query: "type:lesson due:this-week -status:mastered", glyph: "due", color: "2", sort: 0 },
  { id: "r4o-sf-llm", name: "#llm learning", query: "tag:#llm status:learning", glyph: "s-learning", color: "6", pinned: true, sort: 0 },
  { id: "r4o-sf-pdf", name: "PDFs with no notes", query: "type:pdf no:backlinks", glyph: "pdf", color: "1", sort: 1 },
  { id: "r4o-sf-revise", name: "To revise", query: "status:review", filters: ["difficulty >= 4", "due < today()"], match: "or", glyph: "s-revise", color: "3", pinned: true, sort: 1 },
  { id: "r4o-sf-cs231n", name: "Cards from CS231n", query: "type:flashcards course:CS231n", glyph: "flashcards", color: "5", sort: 2 },
  { id: "r4o-sf-untagged", name: "Untagged lessons", query: "type:lesson no:tags", glyph: "lesson", sort: 3 },
  { id: "r4o-sf-phrase", name: "Chain rule, not vision", query: "\"chain rule\" -tag:#cv", glyph: "query", color: "4", sort: 4 },
  { id: "r4o-sf-overdue", name: "Overdue with tasks", query: "due:overdue has:tasks", glyph: "p1", color: "1", sort: 5 },
  { id: "r4o-sf-video", name: "Videos to watch", query: "has:video -status:mastered", glyph: "k-video", sort: 6 },
  { id: "r4o-sf-stale", name: "Stale drafts", query: "status:todo updated:>30d", glyph: "clock", sort: 7 },
  { id: "r4o-sf-opt", name: "Optimization folder", query: "in:optimization space:\"ML Foundations\" has:links", glyph: "inbox", sort: 8 },
  { id: "r4o-sf-dec", name: `Due before ${c.iso(30)}`, query: `due:<${c.iso(30)} has:status -has:backlinks`, glyph: "highlight", sort: 9 },
  { id: "r4o-sf-fresh", name: "Pinned, new this fortnight", query: "is:pinned created:2w", glyph: "flame", color: "3", sort: 10 },
  { id: "r4o-sf-empty", name: "Nothing matches (empty state)", query: "tag:#nothing-has-this-tag", glyph: "smart-folder", sort: 11 },
];

export async function seedR4Organize(v: Vault = emptyVault()): Promise<Vault> {
  const c = clock();
  const fill = (s: string) => s.replace(/\{d(-?\d+)\}/g, (_, n) => c.iso(Number(n)));
  const ago = (days: number) => c.now - days * DAY;

  // ---------------------------------------------------------------- spaces + folders
  const course = (id: string, name: string, color: string, icon: string, sort: number, roadmapId: string | null = null) =>
    space({ id, name, kind: "course", color, icon, roadmapId, sort, props: { provider: "Round 4 sample" } });
  v.spaces.push(
    space({ id: "r4o-s-ml", name: "ML Foundations", kind: "course", icon: "glyph:neural", color: "6", sort: 20, description: "Course", props: { provider: "Stanford Online" } }),
    course("r4o-s-cs231n", "CS231n", "5", "glyph:eye", 21, "r4o-rm-cs231n"),
    course("r4o-s-cs224n", "CS224n", "6", "glyph:lesson", 22, "r4o-rm-cs224n"),
    course("r4o-s-dl", "DL Spec.", "2", "glyph:neural", 23),
    course("r4o-s-kar", "Karpathy", "3", "glyph:code", 24, "r4o-rm-kar"),
    course("r4o-s-fai", "fast.ai", "1", "glyph:code", 25),
  );
  v.folders.push(
    folder({ id: "r4o-f-la", spaceId: "r4o-s-ml", name: "01 Linear algebra", color: "5", sort: 1 }),
    folder({ id: "r4o-f-opt", spaceId: "r4o-s-ml", name: "02 Optimization", color: "2", sort: 2 }),
    folder({ id: "r4o-f-nn", spaceId: "r4o-s-ml", name: "03 Neural networks", color: "6", sort: 3 }),
    folder({ id: "r4o-f-prob", spaceId: "r4o-s-ml", name: "04 Probability", color: "4", sort: 4 }),
    folder({ id: "r4o-f-uns", spaceId: "r4o-s-ml", name: "05 Unsupervised", color: "3", sort: 5 }),
  );

  // ---------------------------------------------------------------- smart folders (Inbox props, merged)
  const inbox = v.spaces.find((s) => s.id === "inbox");
  const prev = (() => { try { return JSON.parse(inbox?.props?.[SMART_PROP] ?? "[]") as unknown[]; } catch { return []; } })();
  const smart = JSON.stringify([...prev, ...SMART(c)]);
  if (inbox) inbox.props = { ...inbox.props, [SMART_PROP]: smart };
  else v.spaces.push({ ...INBOX, props: { ...INBOX.props, [SMART_PROP]: smart } });

  // ---------------------------------------------------------------- files: PDFs + images
  addFile(v, "r4o-pdf-att", "vaswani-2017-attention.pdf", pdfBlob("Attention Is All You Need"));
  addFile(v, "r4o-pdf-res", "he-2015-resnet.pdf", pdfBlob("Deep Residual Learning"));
  addFile(v, "r4o-pdf-adam", "kingma-2014-adam.pdf", pdfBlob("Adam: A Method for Stochastic Optimization"));
  addFile(v, "r4o-img-gd", "gradient-descent.png", await pngBlob(960, 540, "#1d222b", "Gradient descent"));
  addFile(v, "r4o-img-cnn", "convolution.png", await pngBlob(960, 540, "#14212b", "Convolution"));
  addFile(v, "r4o-img-att", "attention.png", await pngBlob(960, 540, "#1f1830", "Attention"));

  // ---------------------------------------------------------------- lessons (the base rows)
  type L = { id: string; title: string; sp: string; course: string; courses: string[]; status: string; tags: string[]; due?: number; diff?: number; text: string; upd?: number; pinned?: 0 | 1; folder?: string; created?: number; fm?: Record<string, string> };
  const SP: Record<string, string> = { CS231n: "r4o-s-cs231n", CS224n: "r4o-s-cs224n", "DL Spec.": "r4o-s-dl", Karpathy: "r4o-s-kar", "fast.ai": "r4o-s-fai" };
  const lessons: L[] = [
    { id: "r4o-l-att", title: "Attention", sp: "CS224n", course: "CS224n", courses: ["CS224n", "Karpathy"], status: "todo", tags: ["nlp", "llm"], due: 5, diff: 4,
      text: "Queries, keys and values: each token looks at every other token.\n\n![attention](att:r4o-img-att)\n\nhttps://www.youtube.com/watch?v=eMlx5fFNoYc\n\nWhat are the three projections in attention? :: Queries, keys and values.\nWhy scale by √d? :: To keep the softmax out of its flat region.\n" },
    { id: "r4o-l-conv", title: "Convolution", sp: "CS231n", course: "CS231n", courses: ["CS231n", "fast.ai"], status: "todo", tags: ["cv"], due: 19, diff: 3,
      text: "A kernel slides over the image and shares its weights.\n\n![kernel](att:r4o-img-cnn)\n\nSee [[Pooling]] and [[ResNet]].\n" },
    { id: "r4o-l-res", title: "ResNet", sp: "CS231n", course: "CS231n", courses: ["CS231n"], status: "todo", tags: ["cv", "nn"], due: 26, diff: 4, text: "Skip connections let gradients flow through very deep networks. Builds on [[Convolution]] and [[Batch normalization]].\n" },
    { id: "r4o-l-bp", title: "Backpropagation", sp: "CS231n", course: "CS231n", courses: ["CS231n", "DL Spec.", "Karpathy"], status: "learning", tags: ["nn"], due: 2, diff: 5, pinned: 1, created: ago(3),
      text: "The chain rule over the computation graph, applied from the loss backwards. Needs [[Gradient descent]].\n\n- [ ] Re-derive the softmax gradient 📅 {d-2}\n- [x] Watch micrograd\n\nWhat does backprop compute? :: The gradient of the loss with respect to every weight.\nWhich rule does backprop apply? :: The chain rule.\nWhy cache forward activations? :: The backward pass reuses them.\n" },
    { id: "r4o-l-tok", title: "Tokenization (BPE)", sp: "Karpathy", course: "Karpathy", courses: ["Karpathy", "CS224n"], status: "learning", tags: ["nlp", "llm"], due: 6, diff: 3,
      text: "Byte-pair encoding merges the most frequent pair until the vocabulary is full.\n\nhttps://www.youtube.com/watch?v=zduSFxRajkE\n" },
    { id: "r4o-l-bn", title: "Batch normalization", sp: "DL Spec.", course: "DL Spec.", courses: ["DL Spec.", "CS231n"], status: "review", tags: ["nn"], due: 3, diff: 4, text: "Normalize each mini-batch, then scale and shift. Applied after [[Activation functions]] in some nets.\n" },
    { id: "r4o-l-adamw", title: "AdamW", sp: "Karpathy", course: "Karpathy", courses: ["Karpathy"], status: "mastered", tags: ["nn", "optimization"], due: -5, diff: 2, text: "Adam with decoupled weight decay. Compare [[Gradient descent]].\n" },
    { id: "r4o-l-gd", title: "Gradient descent", sp: "DL Spec.", course: "DL Spec.", courses: ["DL Spec.", "CS231n", "fast.ai"], status: "mastered", tags: ["math", "optimization"], due: -10, diff: 2, folder: undefined,
      fm: { cover: "att:r4o-img-gd" }, text: "Step against the gradient; the learning rate sets the step size. Uses [[Matrix multiplication]].\n\nWhat does the gradient point to? :: The direction of steepest increase.\n" },
    { id: "r4o-l-lora", title: "Fine-tuning with LoRA", sp: "fast.ai", course: "fast.ai", courses: ["fast.ai"], status: "todo", tags: ["llm"], due: 26, diff: 3, upd: ago(45), created: ago(60), text: "Low-rank adapters: train two small matrices instead of the whole weight.\n" },
    { id: "r4o-l-rag", title: "RAG", sp: "CS224n", course: "CS224n", courses: ["CS224n", "fast.ai"], status: "todo", tags: ["llm", "nlp"], due: 29, diff: 3, text: "Retrieve passages, then generate with them in the prompt. Uses [[Attention]] over the passages.\n" },
    { id: "r4o-l-act", title: "Activation functions", sp: "CS231n", course: "CS231n", courses: ["CS231n"], status: "learning", tags: ["nn"], due: 4, diff: 2, text: "ReLU, GELU, sigmoid, tanh: where each saturates.\n" },
    { id: "r4o-l-aug", title: "Data augmentation", sp: "fast.ai", course: "fast.ai", courses: ["fast.ai", "CS231n"], status: "review", tags: ["cv"], due: 7, diff: 2, text: "Flips, crops and colour jitter make more training images.\n" },
    { id: "r4o-l-pool", title: "Pooling", sp: "CS231n", course: "CS231n", courses: ["CS231n"], status: "todo", tags: ["cv"], due: 7, diff: 1, text: "Max pooling keeps the strongest response in each window.\n" },
    { id: "r4o-l-tb", title: "Transformer block", sp: "CS224n", course: "CS224n", courses: ["CS224n", "Karpathy"], status: "learning", tags: ["nlp", "llm"], diff: 4,
      text: `Linked: [[Attention]].\n\nThe attention layer mixes tokens; the MLP works on each token alone. Residual connections wrap both.\n\n## Forward pass\n\n${F}mermaid\n${DIAGRAM}${F}\n` },
    { id: "r4o-l-drop", title: "Dropout", sp: "DL Spec.", course: "DL Spec.", courses: ["DL Spec."], status: "todo", tags: [], due: 15, diff: 2, upd: ago(40), created: ago(50), text: "Zero random activations at train time.\n" },
    { id: "r4o-l-sa-ar", title: "الانتباه الذاتي", sp: "CS224n", course: "CS224n", courses: ["CS224n"], status: "review", tags: ["nlp"], due: -1, diff: 4,
      text: "آلية الانتباه تسمح لكل رمز بأن ينظر إلى بقية الرموز. والانتباه متعدد الرؤوس يكرر ذلك بالتوازي، وبالانتباه نبني كتلة المحوّل. يحتاج النموذج للانتباه في كل طبقة.\n\n- [ ] مراجعة الصيغة قبل الامتحان 📅 {d-1}\n" },
  ];
  for (const l of lessons) {
    const fm: Record<string, string> = { course: l.course, courses: `[${l.courses.join(", ")}]`, ...(l.due !== undefined ? { due: c.iso(l.due) } : {}), ...(l.diff ? { difficulty: String(l.diff) } : {}), ...(l.fm ?? {}) };
    if (l.id === "r4o-l-att") fm.aliases = "[انتباه, self-attention]";
    if (l.id === "r4o-l-att") fm["mentions-ignore"] = "[Week 5 log]";
    v.notes.push(note({ id: l.id, title: l.title, space: SP[l.sp], folder: l.folder ?? null, type: "lesson", status: l.status as never, tags: l.tags, fm, text: fill(l.text), updated: l.upd ?? ago(1 + (l.id.length % 6)), created: l.created, pinned: l.pinned }));
  }

  // ---------------------------------------------------------------- graph notes (ML Foundations), shared tags, orphans, broken links
  const g = (id: string, title: string, folderId: string, tags: string[], text: string, extra: Partial<Parameters<typeof note>[0]> = {}) =>
    v.notes.push(note({ id, title, space: "r4o-s-ml", folder: folderId, tags, text, updated: ago(2 + (id.length % 9)), ...extra }));
  g("r4o-g-vec", "Vectors & norms", "r4o-f-la", ["math"], "L1, L2 and max norms. Used by [[Eigenvectors]] and [[Gradient descent]].\n");
  g("r4o-g-mm", "Matrix multiplication", "r4o-f-la", ["math"], "Rows times columns. See [[Eigenvectors]] and [[Determinants]].\n");
  g("r4o-g-det", "Determinants", "r4o-f-la", ["math"], "Volume scaling of a linear map. Zero when [[Eigenvectors]] collapse a direction.\n");
  g("r4o-g-svd", "SVD", "r4o-f-la", ["math", "unsupervised"], "Any matrix = rotation · scale · rotation. Related to [[Eigenvectors]] and [[PCA]].\n");
  g("r4o-g-eig", "Eigenvectors", "r4o-f-la", ["math", "exam"], "An eigenvector of A is a non-zero vector v that A only stretches: Av = λv. See [[PCA]], [[Spectral clustering]], [[ML Foundations MOC]].\n", { status: "review" });
  g("r4o-g-pca", "PCA", "r4o-f-uns", ["unsupervised", "math"], "Project onto the top [[Eigenvectors]] of the covariance.\n");
  g("r4o-g-spec", "Spectral clustering", "r4o-f-uns", ["unsupervised"], "Cluster with the [[Eigenvectors]] of the graph Laplacian.\n");
  g("r4o-g-cvx", "Convexity", "r4o-f-opt", ["optimization", "math"], "Every local minimum is global. [[Newton's method]] converges fast here; see [[Gradient descent]].\n");
  g("r4o-g-newton", "Newton's method", "r4o-f-opt", ["optimization"], "Second-order steps with the Hessian. Compare [[AdamW]].\n");
  g("r4o-g-opt", "Optimizers overview", "r4o-f-opt", ["optimization"], "[[Gradient descent]], [[AdamW]], [[Lion optimizer]] and [[Shampoo]] (the last two are not written yet: broken links).\n");
  g("r4o-g-bayes", "Bayes rule", "r4o-f-prob", ["probability", "exam"], "Posterior ∝ likelihood × prior. See [[Gaussian]].\n");
  g("r4o-g-gauss", "Gaussian", "r4o-f-prob", ["probability"], "The bell curve; conjugate to itself under [[Bayes rule]].\n");
  g("r4o-g-moc", "ML Foundations MOC", "r4o-f-nn", ["ml"], "- [[Eigenvectors]]\n- [[Gradient descent]]\n- [[Backpropagation]]\n- [[Attention]]\n- [[Bayes rule]]\n- [[Missing chapter]]\n", { type: "moc", pinned: 1 });
  // orphans: no links in or out
  g("r4o-g-orph1", "Loose idea: curriculum learning", "r4o-f-nn", ["ml"], "Train on easy examples first, then harder ones.\n");
  g("r4o-g-orph2", "Reading list 2027", "r4o-f-uns", [], "Books to read next year.\n");
  v.notes.push(note({ id: "r4o-g-orph3", title: "Scratch", space: "inbox", text: "Unsorted thought.\n", updated: ago(70), created: ago(80) }));

  // journals: unlinked mentions of "Attention" (Week 5 is ignored via mentions-ignore on Attention)
  v.notes.push(
    note({ id: "r4o-j-w6", title: "Week 6 log", space: "r4o-s-cs224n", type: "journal", tags: ["log"], text: "Need to reread the attention paper again before Friday. Also revisit backpropagation through the softmax.\n", updated: ago(2) }),
    note({ id: "r4o-j-w5", title: "Week 5 log", space: "r4o-s-cs224n", type: "journal", tags: ["log"], text: "Skimmed attention, not ready yet.\n", updated: ago(9) }),
    note({ id: "r4o-n-ragp", title: "RAG pipeline", space: "r4o-s-cs224n", tags: ["llm"], text: "Linked: [[RAG]].\n\nThe reader uses cross-attention between query and passages. Gradient descent fine-tunes the retriever.\n", updated: ago(4) }),
    note({ id: "r4o-n-ar", title: "ملاحظات المحاضرة ٦", space: "r4o-s-cs224n", tags: ["nlp"], text: "تحدثنا عن الانتباه وعن البحث. والانتباه هو الأساس، وبالانتباه نفهم السياق كاملا.\n", updated: ago(3) }),
  );

  // ---------------------------------------------------------------- flashcards deck (Cards from CS231n) + card states
  const deck = note({ id: "r4o-cards", title: "CS231n cards", space: "r4o-s-cs231n", type: "flashcards", tags: ["cv"], fm: { course: "CS231n" }, updated: ago(6), text: [
    "What is a kernel? :: A small weight matrix slid over the input.", "What does stride change? :: How far the kernel moves.", "Why pool? :: Smaller maps and some translation invariance.",
    "What does a skip connection add? :: The block's input to its output.", "What is batch norm? :: Normalizing activations per mini-batch.", "Why augment data? :: More varied training images for free.",
    "What is ReLU? :: max(0, x).", "What does dropout do? :: Zeroes random activations at train time.", "Receptive field? :: The input region a unit sees.",
    "What is a 1×1 conv? :: A per-pixel linear map across channels.", "What is global average pooling? :: Averaging each channel to one number.", "What is transfer learning? :: Starting from pretrained weights.",
  ].join("\n") });
  v.notes.push(deck);
  const withCards = v.notes.filter((n) => n.id.startsWith("r4o-") && (n.type === "flashcards" || n.type === "lesson"));
  v.cards.push(...cardsFor(withCards, c, (i) => (i % 5 === 0 ? "due" : i % 5 === 1 ? "learning" : i % 7 === 2 ? "new" : i % 11 === 3 ? "lapsed" : "later")));

  // ---------------------------------------------------------------- PDFs: one with highlights (canvas cards), two with no notes
  const hls: Highlight[] = [
    { id: "hl-r4o1", color: "yellow", page: 1, quote: "Attention Is All You Need", tags: ["nlp"], rects: [[0.12, 0.08, 0.6, 0.04]], comment: "The title says it all", created: c.iso(-6) },
    { id: "hl-r4o2", color: "blue", page: 1, quote: "The Transformer relies entirely on self-attention to compute representations of its input and output.", tags: [], rects: [[0.12, 0.2, 0.7, 0.05]], created: c.iso(-5) },
    { id: "hl-r4o3", color: "green", page: 1, quote: "Scaled dot-product attention divides by the square root of the key dimension.", tags: ["exam"], rects: [[0.12, 0.3, 0.7, 0.05]], created: c.iso(-4) },
  ];
  const PDF_ATT = "Attention Is All You Need";
  v.notes.push(
    note({ id: "r4o-pdf-n-att", title: PDF_ATT, space: "r4o-s-cs224n", type: "pdf", body: `---\ntype: pdf\nfile: att:r4o-pdf-att\npage: 1\npages: 1\nprogress: 100\ntags: [nlp, paper]\n---\n# ${PDF_ATT}\n\n## Highlights\n${hls.map(serializeHighlight).join("\n")}\n`, updated: ago(4) }),
    note({ id: "r4o-pdf-n-res", title: "Deep Residual Learning", space: "r4o-s-cs231n", type: "pdf", body: `---\ntype: pdf\nfile: att:r4o-pdf-res\npage: 1\npages: 1\nprogress: 0\n---\n# Deep Residual Learning\n\n## Highlights\n`, updated: ago(12) }),
    note({ id: "r4o-pdf-n-adam", title: "Adam paper", space: "r4o-s-kar", type: "pdf", body: `---\ntype: pdf\nfile: att:r4o-pdf-adam\npage: 1\npages: 1\nprogress: 0\n---\n# Adam paper\n\n## Highlights\n`, updated: ago(20) }),
  );

  // ---------------------------------------------------------------- .mermaid diagram file (saved from "Transformer block")
  const DIAG = "transformer-forward.mermaid";
  v.notes.push(note({ id: "r4o-diagram", title: DIAG, space: "r4o-s-cs224n", type: "diagram", tags: ["diagram"], body: DIAGRAM, updated: ago(1),
    props: { diagramFrom: "r4o-l-tb", diagramFromTitle: "Transformer block", diagramHeading: "Forward pass", diagramLine: "8", diagramHash: "", diagramKind: "flowchart", diagramSavedAt: new Date(ago(1)).toISOString() } }));

  // ---------------------------------------------------------------- canvas: groups, pinned cards, highlight cards, PDF card, diagram card
  const canvas = {
    nodes: [
      { id: "r4o-c-g1", type: "group", label: "Read", x: -40, y: -60, width: 760, height: 520, color: "5" },
      { id: "r4o-c-g2", type: "group", label: "Understand", x: 780, y: -60, width: 760, height: 520, color: "6" },
      { id: "r4o-c-pdf", type: "file", file: `${PDF_ATT}.md`, x: 0, y: 0, width: 300, height: 140 },
      hlCanvasNode(PDF_ATT, hls[1], 360, 0, "r4o-c-hl1"),
      hlCanvasNode(PDF_ATT, hls[2], 360, 220, "r4o-c-hl2"),
      { id: "r4o-c-att", type: "file", file: "Attention.md", x: 0, y: 220, width: 300, height: 180, lumenPinned: true },
      { id: "r4o-c-tb", type: "file", file: "Transformer block.md", x: 820, y: 0, width: 280, height: 160, lumenPinned: true },
      { id: "r4o-c-diag", type: "file", file: `diagrams/${DIAG}`, x: 820, y: 200, width: 620, height: 220 },
      { id: "r4o-c-q", type: "text", text: "## Open question\nWhy does the residual stream make depth cheap?", x: 1160, y: 0, width: 300, height: 160, color: "3" },
      { id: "r4o-c-ar", type: "text", text: "## ملاحظة\nالانتباه يربط كل رمز بالآخر", x: 1600, y: 0, width: 260, height: 120 },
      { id: "r4o-c-link", type: "link", url: "https://jalammar.github.io/illustrated-transformer/", x: 1600, y: 180, width: 260, height: 100 },
      { id: "r4o-c-free", type: "text", text: "Loose card (drag me, then Tidy up)", x: 600, y: 620, width: 240, height: 80 },
    ],
    edges: [
      { id: "r4o-e1", fromNode: "r4o-c-pdf", fromSide: "right", toNode: "r4o-c-hl1", toSide: "left", toEnd: "arrow" },
      { id: "r4o-e2", fromNode: "r4o-c-hl1", fromSide: "bottom", toNode: "r4o-c-hl2", toSide: "top", toEnd: "arrow", color: "5" },
      { id: "r4o-e3", fromNode: "r4o-c-att", fromSide: "right", toNode: "r4o-c-tb", toSide: "left", toEnd: "arrow", label: "used in" },
      { id: "r4o-e4", fromNode: "r4o-c-tb", fromSide: "bottom", toNode: "r4o-c-diag", toSide: "top", toEnd: "arrow", color: "4" },
      { id: "r4o-e5", fromNode: "r4o-c-tb", fromSide: "right", toNode: "r4o-c-q", toSide: "left", label: "asks" },
      { id: "r4o-e6", fromNode: "r4o-c-q", toNode: "r4o-c-ar", color: "2" },
      { id: "r4o-e7", fromNode: "r4o-c-free", toNode: "r4o-c-att", toEnd: "arrow" },
    ],
  };
  v.notes.push(
    note({ id: "r4o-canvas", title: "Transformer study map", space: "r4o-s-cs224n", type: "canvas", body: JSON.stringify(canvas, null, 2), updated: ago(1), tags: ["llm"] }),
    note({ id: "r4o-wb", title: "Transformer sketch", space: "r4o-s-cs224n", type: "whiteboard", body: whiteboard(), updated: ago(2) }),
  );

  // ---------------------------------------------------------------- course roadmaps + the learning path
  v.notes.push(
    note({ id: "r4o-rm-cs231n", title: "CS231n roadmap", space: "r4o-s-cs231n", type: "roadmap", body: fill(RM_CS231N), updated: ago(3) }),
    note({ id: "r4o-rm-cs224n", title: "CS224n roadmap", space: "r4o-s-cs224n", type: "roadmap", body: fill(RM_CS224N), updated: ago(5) }),
    note({ id: "r4o-rm-kar", title: "Karpathy roadmap", space: "r4o-s-kar", type: "roadmap", body: fill(RM_KARPATHY), updated: ago(7) }),
  );
  const PATH = "AI Engineer path";
  const courses = ["CS231n", "CS224n", "Karpathy"];
  const refs = resolveCourses(courses, v.notes, v.spaces);
  let body = serializePath({ courses, title: PATH, intro: "Vision, language models and the maths under them: one concept map over three courses.", stages: [], fm: {} });
  body = autoOrganize(body, buildPath(body, refs));
  const p = (): BuiltPath => buildPath(body, refs);
  const find = (name: string) => p().concepts.find((x) => x.def.name.toLowerCase() === name.toLowerCase());
  const merge = (into: string, other: string) => { const a = find(into), b = find(other); if (a && b) body = mergeConcepts(body, a, b); };
  merge("Backpropagation", "Backprop by hand");
  merge("Subword tokenization", "BPE tokenizer");
  // path-level prerequisites across courses: Attention needs Neural networks; GPT needs Transformer block (and
  // Attention through it: implied)
  const need = (cName: string, pre: string) => { const a = find(cName), b = find(pre); if (a && b) body = addConceptNeed(body, a, b); };
  need("Attention", "Neural networks");
  need("GPT from scratch", "Transformer block");
  need("GPT from scratch", "Attention");
  body = autoOrganize(body, p()); // re-stage with the new cross-course prerequisites
  const bp = find("Backpropagation");
  if (bp) body = addResource(body, bp, "Karpathy · micrograd", "https://www.youtube.com/watch?v=VMj-3S1tku0");
  const at = find("Attention");
  if (at) body = addResource(body, at, "3Blue1Brown · Attention in transformers", "https://www.youtube.com/watch?v=eMlx5fFNoYc");
  body = scheduleNewlyDone(body, p()) ?? body;
  const d = parsePath(body);
  const spread: [number, number][] = [[60, 60], [45, 60], [30, 30], [20, 30], [12, 14], [6, 7], [3, 3]];
  let si = 0;
  for (const st of d.stages) for (const k of st.concepts) {
    if (k.name === "Loss functions") { k.review = c.iso(0); k.interval = 3; continue; }
    if (k.review && si < spread.length) { const [a, iv] = spread[si++]; k.interval = iv; k.review = c.iso(iv - a); }
  }
  body = serializePath(d);
  v.notes.push(note({ id: "r4o-path", title: PATH, type: "path", body, updated: ago(1), pinned: 1 }));

  // ---------------------------------------------------------------- sessions (20 weeks, per course) → dashboard numbers
  const r = rng(404);
  const byCourse = [["r4o-l-bp", "r4o-l-conv", "r4o-l-act", "r4o-cards"], ["r4o-l-att", "r4o-l-tb", "r4o-l-rag"], ["r4o-l-tok", "r4o-l-adamw"], ["r4o-l-gd", "r4o-l-bn"], ["r4o-l-lora", "r4o-l-aug"]];
  for (let k = 0; k < 140; k++) {
    if (!r.chance(k < 56 ? 0.75 : 0.5)) continue;
    const n = r.int(1, k < 14 ? 3 : 2);
    for (let j = 0; j < n; j++) {
      const ci = r.chance(0.35) ? 0 : r.chance(0.4) ? 1 : r.int(2, 4);
      v.sessions.push(session(`r4o-se-${k}-${j}`, r.pick(byCourse[ci]), 10 + 5 * r.int(1, 10), c.at(k, `${17 + r.int(0, 4)}:${r.pick(["05", "20", "40"])}`)));
    }
  }

  // ---------------------------------------------------------------- bases + dashboard
  const BASE = "Lessons by status × course";
  v.notes.push(
    note({ id: "r4o-base", title: BASE, type: "base", updated: ago(0.2), pinned: 1, text: `Every lesson across the five courses. Views: Table · Board · Gallery · List · Calendar, plus By tag and By courses (notes in several groups).\n\n${BASE_YAML}` }),
    note({ id: "r4o-base-new", title: "New base", type: "base", body: "---\ntype: base\n---\n# New base\n", updated: ago(0.1) }),
    note({ id: "r4o-dash", title: "AI Engineer dashboard", type: "dashboard", updated: ago(0.3), pinned: 1, text: `Every tile type over sessions, cards, the AI Engineer path, notes and the lessons base.\n\n${DASH_YAML(PATH, BASE)}` }),
  );
  return v;
}
