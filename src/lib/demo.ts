// Demo-mode seed: reproduces the sample content of the Claude Design handoff
// (design/handoffs/2026-11-13-rounds-1-3) so app screenshots can be compared 1:1 with the design files.
// What comes from which design file: docs/DEMO_DATA.md.
//
// Every record has a fixed id and `dirty: 0` (demo data never syncs). Timestamps are computed relative to
// Date.now(): "12 min ago" style items are exact offsets, calendar items ("Yesterday", "Mon", "3 Nov") keep
// their wall-clock time and move by whole days. With the clock pinned to DEMO_NOW every label matches the design.
import type { AttachmentMeta, Card, Folder, Note, NoteType, Session, Space, Status, Version } from "../../shared/types";
import { db as defaultDb } from "./db";
import { flashcards, inlineTags, splitFrontMatter } from "./parse";
import type { Settings } from "./settings";

type LumenDB = typeof defaultDb;

/** Friday 13 November 2026, 21:41 local: the status-bar time and date on every design screen. */
export const DEMO_NOW = new Date(2026, 10, 13, 21, 41, 0, 0).getTime();

/** Branding + appearance shown in the designs (first run, blog, settings). */
export const DEMO_SETTINGS: Partial<Settings> = {
  theme: "lamplight",
  accentHue: null,
  readingFont: "serif",
  fontSize: 17,
  measure: 68,
  density: "comfortable",
  blogName: "Night Shift Notes",
  tagline: "Learning in public, one lamp-lit page at a time",
  author: "Amir Hakim",
  avatar: "🦉",
  johnnyDecimal: false,
  spellcheck: true,
};

const MIN = 60_000;
const DAY = 86_400_000;

// ------------------------------------------------------------------ ids
export const DEMO_IDS = {
  spaces: { inbox: "inbox", ml: "dm-s-ml", arabic: "dm-s-arabic", thesis: "dm-s-thesis", net: "dm-s-networking", health: "dm-s-health", math: "dm-s-mathref" },
  gradientDescent: "dm-gradient-descent",
  eigenvectors: "dm-eigenvectors",
  idafa: "dm-idafa",
  bidi: "dm-idafa-ar",
  backpropBoard: "dm-backprop-board",
  studyPlan: "dm-study-plan",
  deck: "dm-backprop-deck",
  mlRoadmap: "dm-ml-roadmap",
} as const;
const S = DEMO_IDS.spaces;

/** Share tokens from "Lumen 09 Sharing" (Settings › Sharing list). */
const SHARE = { ml: "m8Lq2Vd", gd: "k3f9Xq2", deck: "p2Wn7Ra", verbs: "f6Hc1Tz", plan: "w4Kd8Ys" };

// ------------------------------------------------------------------ static content
const GD_BODY = `---
type: lesson
status: learning
tags: [ml, optimization]
---
# Gradient descent

Minimize a loss $J(\\theta)$ by stepping
against its gradient.

$$\\theta_{t+1} = \\theta_t - \\eta \\nabla J(\\theta_t)$$

> [!tip] Choosing η
> Too large diverges, too small crawls.
> Start at \`1e-3\`, then sweep.

## Variants
- [x] Batch GD
- [x] Stochastic GD
- [ ] Mini-batch + momentum

See [[Learning rate schedules]] #optimization

What does η control? :: The step size.

## More cards

What does the learning rate η control in gradient descent? :: The step size. θ ← θ − η∇J(θ) — too large diverges, too small crawls.
Which direction does a gradient-descent step move θ? :: Against the gradient, the direction of steepest descent.
What happens when η is far too large? :: The loss oscillates and diverges.
What happens when η is far too small? :: Progress crawls and training stalls on plateaus.
Batch vs stochastic GD? :: Batch uses the full dataset per step; stochastic uses one example.
Why use mini-batches? :: Cheaper steps than batch GD, less noise than pure SGD, and they vectorise well.
When does gradient descent stop? :: When the loss plateaus or the gradient norm falls below a tolerance.
Largest stable step size on a quadratic? :: η < 2 / λmax of the Hessian.
Why does feature scaling help gradient descent? :: It makes the loss contours rounder, so steps stop zig-zagging.
What is an epoch? :: One full pass over the training data.
Does gradient descent find the global minimum? :: Only guaranteed for convex losses; otherwise a local minimum or saddle.
`;

/** Earlier states of Gradient descent for the version history (Lumen 04 · 11A diff). */
const GD_V_2112 = GD_BODY.replace("> [!tip] Choosing η\n> Too large diverges, too small crawls.\n> Start at `1e-3`, then sweep.\n\n", "")
  .replace("- [x] Batch GD\n- [x] Stochastic GD\n", "- [ ] Batch GD\n")
  .replace("See [[Learning rate schedules]] #optimization", "See [[Learning rate schedules]].");
const GD_V_FIRST = `---
type: lesson
status: todo
tags: [ml]
---
# Gradient descent

Minimize a loss by stepping against its gradient.

## Variants
- [ ] Batch GD
`;

const EIG_BODY = (strangDue: string, pcaDue: string) => `---
type: lesson
status: review
tags: [math]
---
# Linear algebra: eigenvectors

An **eigenvector** of a square matrix $A$ is a non-zero vector $v$ that $A$ only stretches: $Av = \\lambda v$. The scalar $\\lambda$ is its **eigenvalue**. Intuitively, eigenvectors are the directions a linear map leaves pointing the same way.[^1]

They show up all over machine learning: PCA keeps the top eigenvectors of the covariance matrix, and the largest stable step size in [[Gradient descent]] is bounded by $2 / \\lambda_{max}$ of the Hessian. #linear-algebra

> [!note]
> *Eigen-* is German for “own” or “characteristic” — the vector belongs to the matrix.

## Finding them

Rewrite $Av = \\lambda v$ as $(A - \\lambda I)v = 0$. A non-zero solution exists only when $A - \\lambda I$ is singular, so

$$\\det(A - \\lambda I) = 0 \\tag{1}$$

Solve this characteristic polynomial for each $\\lambda$, then plug it back in and find the null space of $A - \\lambda I$.

\`\`\`mermaid
flowchart LR
  A[Matrix A] --> B["det(A − λI) = 0"] --> C["λ₁ … λₙ"] --> D["null(A − λI)"] --> E[eigenvectors v]
\`\`\`

> [!tip]
> For a 2×2 matrix, $\\lambda_1 + \\lambda_2 = \\operatorname{tr}(A)$ and $\\lambda_1 \\lambda_2 = \\det(A)$. Use them to check your answers.

## In code

\`\`\`python
import numpy as np
A = np.array([[2, 1], [1, 2]])
vals, vecs = np.linalg.eigh(A)
print(vals)  # [1. 3.]
\`\`\`

> [!warning]
> \`np.linalg.eig\` doesn't sort its output. For symmetric matrices use \`eigh\`: faster, real-valued, ascending.

## Worked examples

| Matrix | Eigenvalues | Eigenvectors | Note |
| --- | --- | --- | --- |
| \`[[2,1],[1,2]]\` | 3, 1 | (1,1), (1,−1) | symmetric |
| \`[[0,−1],[1,0]]\` | ± i | complex only | 90° rotation |
| \`[[1,1],[0,1]]\` | 1 (×2) | (1,0) | defective[^2] |

> [!question]- Why can a rotation have no real eigenvectors?
> A rotation by 90° changes the direction of every non-zero vector, so no real vector is only stretched. Its eigenvalues are ± i.

## Practice

- [x] Watch 3Blue1Brown, chapter 14
- [x] Strang §6.1, problems 1–4
- [ ] Read Strang §6.2 (diagonalization) 📅 ${strangDue}
- [ ] Derive PCA from the covariance eigendecomposition 📅 ${pcaDue}

## Flashcards

What is an eigenvector of A? :: A non-zero vector v with Av = λv: A only stretches it.
What is the eigenvalue of an eigenvector? :: The stretch factor λ in Av = λv.
Which equation gives the eigenvalues? :: The characteristic equation det(A − λI) = 0.
How do you find the eigenvectors once λ is known? :: Solve (A − λI)v = 0, i.e. find the null space of A − λI.
Sum of the eigenvalues of A? :: The trace tr(A).
Product of the eigenvalues of A? :: The determinant det(A).
Eigenvalues of [[2,1],[1,2]]? :: 3 and 1.
Why can a 90° rotation have no real eigenvectors? :: It turns every non-zero vector, so no real direction is only stretched.
What makes a matrix defective? :: It has fewer independent eigenvectors than its size.
Why prefer np.linalg.eigh for symmetric matrices? :: Faster, real-valued, and sorted ascending.
Which eigenvectors does PCA keep? :: The top eigenvectors of the covariance matrix.
What does “eigen” mean? :: German for “own” or “characteristic”.

[^1]: G. Strang, *Introduction to Linear Algebra*, 5th ed., §6.1.
[^2]: A defective matrix has fewer independent eigenvectors than its size; see Jordan form.
`;

/** NoteBidi.dc.html, block for block. */
const BIDI_BODY = `---
type: lesson
status: learning
tags: [arabic, nahw]
---
# الإضافة في اللغة العربية

The *idafa* (إضافة) joins two nouns. The first, the *muḍāf* (مُضاف), drops its tanwīn and never takes *al-*; the second, the *muḍāf ilayhi* (مُضاف إليه), is genitive. So كِتابُ الطالِبِ is simply “the student's book”.

## أمثلة

- بابُ البيتِ — the door of the house
- قلمُ المُعلّمِ — the teacher's pen
- بابُ بيتِ المُعلّمِ — a three-noun chain

> [!info] ملاحظة
> المُضاف لا يُعرَّف بـ«ال» أبداً، والمُضاف إليه مجرور دائماً.

## Checking it in code

\`\`\`python
def is_idafa(first, second):
    # الاسم الأول بلا «ال»
    return not first.startswith("ال") \\
        and second.case == "genitive"
\`\`\`

- Each block takes the direction of its first strong letter.
- Inline عربي inside English stays isolated, so punctuation lands correctly.
`;

const IDAFA_TEXT = `The idafa (إضافة) is a possessive construction: two nouns placed side by side, where the second owns the first. No word for “of” is needed.

The first noun — the mudāf — never takes the definite article and drops its tanwīn. The second — the mudāf ilayhi — is always in the genitive case. So كِتَابُ الطَّالِبِ is simply “the student's book”.

Chains can grow: بَابُ بَيْتِ المُعَلِّمِ, the door of the teacher's house. Only the last noun can be definite.`;

const TCP_TEXT = `Before any data flows, client and server agree on initial sequence numbers in three steps: **SYN**, **SYN-ACK**, **ACK**.

Each side picks a random ISN so that delayed segments from an old connection can't be mistaken for new ones.

After the final ACK both ends are ESTABLISHED.

Closing uses a four-way FIN/ACK exchange, and the side that closes first waits in TIME_WAIT for 2×MSL, so late segments die out before the port pair is reused.`;

/** Arabic verb forms I–X: 4 cards per form (pattern, example, meaning, masdar) = 40 cards. Card 7 = Form II meaning (Lumen 10b). */
const VERB_FORMS: [string, string, string, string, string][] = [
  ["I", "فَعَلَ", "كَتَبَ — to write", "The base meaning: a simple action (to write, to know)", "No fixed pattern; learn each masdar"],
  ["II", "فَعَّلَ", "عَلِمَ ← عَلَّمَ — to know → to teach", "Intensity or causation", "تَفْعِيل"],
  ["III", "فَاعَلَ", "كَاتَبَ — to correspond with", "Doing something with someone", "مُفَاعَلَة / فِعَال"],
  ["IV", "أَفْعَلَ", "أَخْرَجَ — to take out", "Causative: making someone do Form I", "إِفْعَال"],
  ["V", "تَفَعَّلَ", "تَعَلَّمَ — to learn", "Reflexive of Form II", "تَفَعُّل"],
  ["VI", "تَفَاعَلَ", "تَكَاتَبَ — to write to each other", "Reciprocal: doing it to each other", "تَفَاعُل"],
  ["VII", "اِنْفَعَلَ", "اِنْكَسَرَ — to be broken", "Passive or reflexive of Form I", "اِنْفِعَال"],
  ["VIII", "اِفْتَعَلَ", "اِجْتَمَعَ — to meet", "Reflexive of Form I, often “for oneself”", "اِفْتِعَال"],
  ["IX", "اِفْعَلَّ", "اِحْمَرَّ — to turn red", "Colours and physical defects", "اِفْعِلَال"],
  ["X", "اِسْتَفْعَلَ", "اِسْتَغْفَرَ — to ask forgiveness", "Seeking or considering: to ask for", "اِسْتِفْعَال"],
];
const VERB_BODY = `---
type: flashcards
status: review
tags: [arabic, sarf]
---
# Arabic: verb forms I–X

Ten derived patterns from one three-letter root. Practise the pattern, an example, the meaning it adds and the masdar.

${VERB_FORMS.map(([n, pat, ex, mean, masdar]) => `## Form ${n} (${pat})

Form ${n} — which pattern? :: ${pat}
Form ${n} — give an example :: ${ex}
What meaning does Form ${n} (${pat}) usually add? :: ${mean}
Form ${n} — masdar pattern? :: ${masdar}`).join("\n\n")}
`;

// ------------------------------------------------------------------ JSON Canvas / Excalidraw
const BACKPROP_CANVAS = {
  nodes: [
    { id: "g-forward", type: "group", label: "Forward pass", x: 60, y: 80, width: 420, height: 330, color: "5" },
    { id: "g-backward", type: "group", label: "Backward pass", x: 560, y: 80, width: 440, height: 330, color: "6" },
    { id: "n-idea", type: "text", text: "## Idea\nCompute activations layer by layer and cache them for the backward pass.", x: 84, y: 130, width: 180, height: 120 },
    { id: "n-layer", type: "text", text: "## Layer\n$z = Wx + b$\n$a = \\sigma(z)$", x: 84, y: 270, width: 180, height: 110 },
    { id: "n-gd", type: "file", file: "ML Foundations/02 Optimization/Gradient descent.md", x: 284, y: 130, width: 176, height: 160 },
    { id: "n-backprop", type: "file", file: "ML Foundations/03 Neural networks/Backpropagation.md", x: 584, y: 130, width: 190, height: 160 },
    { id: "n-chain", type: "text", text: "## Chain rule\n$\\partial L/\\partial W = \\partial L/\\partial a \\cdot \\partial a/\\partial z \\cdot \\partial z/\\partial W$", x: 794, y: 130, width: 186, height: 128 },
    { id: "n-question", type: "text", color: "1", text: "## Open question\nWhy do gradients vanish with sigmoid but not ReLU?", x: 794, y: 276, width: 186, height: 112 },
    { id: "n-checked", type: "text", color: "4", text: "## Checked\nDerived by hand for a 2-layer MLP ✓", x: 150, y: 470, width: 240, height: 80 },
    { id: "n-cs231n", type: "link", url: "https://cs231n.github.io/optimization-2/", x: 584, y: 470, width: 270, height: 84 },
  ],
  edges: [
    { id: "e1", fromNode: "g-forward", fromSide: "right", toNode: "g-backward", toSide: "left", label: "feeds" },
    { id: "e2", fromNode: "n-backprop", fromSide: "bottom", toNode: "n-cs231n", toSide: "top", toEnd: "arrow", label: "explained in" },
    { id: "e3", fromNode: "n-layer", fromSide: "bottom", toNode: "n-checked", toSide: "top", toEnd: "arrow", label: "check" },
    { id: "e4", fromNode: "n-question", fromSide: "bottom", toNode: "n-cs231n", toSide: "right", toEnd: "arrow", label: "see §3" },
  ],
};

const OPTIMIZERS_CANVAS = {
  nodes: [
    { id: "o-gd", type: "file", file: "ML Foundations/02 Optimization/Gradient descent.md", x: 0, y: 0, width: 220, height: 120 },
    { id: "o-mom", type: "file", file: "ML Foundations/02 Optimization/Momentum & Nesterov.md", x: 300, y: -80, width: 220, height: 120 },
    { id: "o-lr", type: "file", file: "ML Foundations/02 Optimization/Learning rate schedules.md", x: 300, y: 80, width: 220, height: 120 },
    { id: "o-adam", type: "file", file: "ML Foundations/02 Optimization/Adam optimizer.md", x: 600, y: 0, width: 220, height: 120, color: "4" },
    { id: "o-newton", type: "text", text: "## Second order\nNewton's method: Hessian, O(n³) per step.", x: 0, y: 200, width: 220, height: 110, color: "2" },
  ],
  edges: [
    { id: "oe1", fromNode: "o-gd", toNode: "o-mom", toEnd: "arrow", label: "+ velocity" },
    { id: "oe2", fromNode: "o-gd", toNode: "o-lr", toEnd: "arrow", label: "+ schedule" },
    { id: "oe3", fromNode: "o-mom", toNode: "o-adam", toEnd: "arrow" },
    { id: "oe4", fromNode: "o-lr", toNode: "o-adam", toEnd: "arrow" },
  ],
};

const TCP_CANVAS = {
  nodes: [
    { id: "t-closed", type: "text", text: "CLOSED", x: 0, y: 0, width: 160, height: 60 },
    { id: "t-synsent", type: "text", text: "SYN_SENT", x: 240, y: 0, width: 160, height: 60 },
    { id: "t-est", type: "text", text: "ESTABLISHED", x: 480, y: 0, width: 180, height: 60, color: "4" },
    { id: "t-fin", type: "text", text: "FIN_WAIT_1 → FIN_WAIT_2", x: 480, y: 140, width: 220, height: 60 },
    { id: "t-tw", type: "text", text: "TIME_WAIT (2×MSL)", x: 240, y: 140, width: 180, height: 60, color: "3" },
  ],
  edges: [
    { id: "te1", fromNode: "t-closed", toNode: "t-synsent", toEnd: "arrow", label: "send SYN" },
    { id: "te2", fromNode: "t-synsent", toNode: "t-est", toEnd: "arrow", label: "SYN-ACK / ACK" },
    { id: "te3", fromNode: "t-est", toNode: "t-fin", toEnd: "arrow", label: "close" },
    { id: "te4", fromNode: "t-fin", toNode: "t-tw", toEnd: "arrow", label: "FIN / ACK" },
  ],
};

const STICKY = ["#fff3bf", "#d3f9d8", "#d0ebff", "#ffd8a8", "#eebefa", "#ffc9c9"];
/** WhiteboardBoard.dc.html as Excalidraw skeletons (converted by the whiteboard on first open). */
const STUDY_PLAN_ITEMS = ["Finish PS3 Q2 by Fri", "Eigen ✓ — now derive PCA", "Ask: why does ReLU help?", "Re-watch backprop lecture", "Idafa drills 11–20", "Thesis: send §2 to Dr. Lim"];
function studyPlanScene() {
  const pos: [number, number, number][] = [[66, 92, -2], [250, 84, 1.5], [432, 98, -1], [70, 282, 1], [254, 290, -1.5], [436, 276, 2]];
  const stickies = STUDY_PLAN_ITEMS.map((text, i) => ({
    type: "rectangle", id: `sticky-${i + 1}`, x: pos[i][0], y: pos[i][1], width: 160, height: 128, angle: (pos[i][2] * Math.PI) / 180,
    backgroundColor: STICKY[i], fillStyle: "solid", strokeColor: "transparent", roundness: { type: 3 },
    customData: { lumen: "sticky" }, label: { text, fontSize: 20, strokeColor: "#1e1e1e" },
  }));
  return {
    type: "excalidraw", version: 2, source: "lumen", elements: [],
    appState: { viewBackgroundColor: "transparent", gridSize: null }, files: {},
    lumenAttachments: ["att:dm-att-whiteboard-photo"],
    lumenPending: [
      ...stickies,
      { type: "frame", id: "frame-week3", name: "Week 3", children: stickies.map((s) => s.id) },
      { type: "arrow", id: "arrow-plot", x: 572, y: 150, width: 166, height: -22, points: [[0, 0], [58, -80], [166, -22]], strokeColor: "#1e1e1e", strokeWidth: 2 },
      { type: "text", id: "text-plot", x: 640, y: 150, text: "see the plot", fontSize: 22, angle: (-6 * Math.PI) / 180 },
      { type: "rectangle", id: "img-loss", x: 742, y: 70, width: 300, height: 190, strokeColor: "#868e96", fillStyle: "hachure", backgroundColor: "#ced4da", label: { text: "pasted image · loss-curve.png", fontSize: 14 } },
      { type: "rectangle", id: "box-forward", x: 720, y: 330, width: 140, height: 60, roundness: { type: 3 }, label: { text: "forward", fontSize: 22 } },
      { type: "diamond", id: "dia-loss", x: 894, y: 302, width: 108, height: 108, backgroundColor: "#ffec99", fillStyle: "solid", label: { text: "loss ok?", fontSize: 20 } },
      { type: "ellipse", id: "ell-ship", x: 760, y: 458, width: 124, height: 58, label: { text: "ship it", fontSize: 22 } },
      { type: "arrow", id: "arrow-1", x: 0, y: 0, start: { id: "box-forward" }, end: { id: "dia-loss" } },
      { type: "arrow", id: "arrow-2", x: 0, y: 0, start: { id: "dia-loss" }, end: { id: "ell-ship" } },
    ],
  };
}
function smallScene(boxes: [string, string, number, number][]) {
  return {
    type: "excalidraw", version: 2, source: "lumen", elements: [], appState: { viewBackgroundColor: "transparent", gridSize: null }, files: {},
    lumenPending: [
      ...boxes.map(([id, text, x, y], i) => ({ type: "rectangle", id, x, y, width: 200, height: 90, roundness: { type: 3 }, backgroundColor: STICKY[i % 6], fillStyle: "solid", label: { text, fontSize: 18 } })),
      ...boxes.slice(1).map(([id], i) => ({ type: "arrow", x: 0, y: 0, start: { id: boxes[i][0] }, end: { id } })),
    ],
  };
}

const svg = (w: number, h: number, inner: string) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}" fill="#1D222B"/>${inner}</svg>`;
const FEATURE_MAPS_SVG = svg(960, 540, Array.from({ length: 24 }, (_, i) => {
  const x = 40 + (i % 8) * 112, y = 40 + Math.floor(i / 8) * 160, o = (0.25 + ((i * 37) % 60) / 100).toFixed(2);
  return `<rect x="${x}" y="${y}" width="96" height="140" rx="8" fill="#F2A93B" opacity="${o}"/>`;
}).join(""));
const LOSS_CURVE_SVG = svg(600, 380, `<path d="M40 40 C120 300, 220 320, 560 340" stroke="#5CC8C2" stroke-width="4" fill="none"/><path d="M40 340 H560 M40 340 V30" stroke="#9AA0AA" stroke-width="2"/>`);

// ------------------------------------------------------------------ seed
interface Spec {
  id: string;
  title: string;
  space: string;
  folder?: string | null;
  type?: NoteType;
  status?: Status | null;
  /** Front-matter tags (inline #tags in the text are added automatically). */
  tags?: string[];
  /** Markdown after the H1 (front-matter + H1 are generated). */
  text?: string;
  /** Full raw body (overrides text). */
  body?: string;
  updated: number;
  created?: number;
  pinned?: 1;
  favorite?: 1;
  published?: 1;
  slug?: string;
  props?: Record<string, string>;
  shareId?: string;
  fm?: Record<string, string>;
}

/** Deterministic pseudo-random level, same formula as the heatmap in "Lumen 01 Welcome and Home". */
const lv = (w: number, d: number) => {
  const x = Math.sin(w * 12.9898 + d * 78.233) * 43758.5453;
  const r = x - Math.floor(x);
  const v = r + (w > 13 ? 0.3 : 0) - (d === 5 || d === 6 ? 0.15 : 0);
  return v < 0.38 ? 0 : v < 0.62 ? 1 : v < 0.82 ? 2 : v < 0.96 ? 3 : 4;
};

export async function seedDemo(db: LumenDB = defaultDb): Promise<void> {
  const now = Date.now();
  const t0 = new Date(now);
  t0.setHours(0, 0, 0, 0);
  const usedDays = new Set<number>();
  /** k days ago at local HH:MM (k = 0 today; Nov 13 − k in the design calendar). */
  const at = (k: number, hm = "18:00") => {
    const d = new Date(t0);
    d.setDate(d.getDate() - k);
    const [h, m] = hm.split(":").map(Number);
    d.setHours(h, m, 0, 0);
    usedDays.add(k);
    return Math.min(d.getTime(), now - MIN);
  };
  const ago = (min: number) => now - min * MIN;
  /** Local YYYY-MM-DD `off` days from today (negative = past). */
  const iso = (off: number) => {
    const d = new Date(t0);
    d.setDate(d.getDate() + off);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };
  // Design dates → days ago (today = Fri 13 Nov 2026).
  const nov = (d: number) => 13 - d, oct = (d: number) => 13 + 31 - d, sep = (d: number) => 13 + 31 + 30 - d, aug = (d: number) => 13 + 31 + 30 + 31 - d;
  const due = (k: number) => iso(-k); // a past design date as a due string

  // ---------------------------------------------------------------- spaces
  const space = (p: Partial<Space> & Pick<Space, "id" | "name" | "kind" | "icon">): Space => ({
    color: null, description: "", props: {}, roadmapId: null, sort: 0, archived: 0, createdAt: at(120, "12:00"), updatedAt: at(1, "12:00"), deleted: 0, dirty: 0, ...p,
  });
  const spaces: Space[] = [
    space({ id: S.inbox, name: "Inbox", kind: "area", icon: "📥", description: "Default space", sort: 0, createdAt: at(130, "12:00"), updatedAt: at(130, "12:00") }),
    space({
      id: S.ml, name: "ML Foundations", kind: "course", icon: "🧠", color: "#A371F7", sort: 1, roadmapId: DEMO_IDS.mlRoadmap, shareId: SHARE.ml,
      description: "My path through Stanford's machine-learning course: lessons, flashcards and the roadmap I follow.",
      props: { provider: "Coursera · Stanford Online", url: "https://www.coursera.org/specializations/machine-learning-introduction", target: iso(37) },
      createdAt: at(oct(1), "10:00"), updatedAt: ago(120),
    }),
    space({
      id: S.arabic, name: "Arabic Grammar", kind: "course", icon: "🕌", color: "#39C5CF", sort: 2, roadmapId: "dm-ar-roadmap",
      description: "Nahw and sarf from Madinah Book 1, with drills and flashcards.",
      props: { provider: "Madinah Arabic · Book 1", url: "https://www.madinaharabic.com/", target: iso(90) },
      createdAt: at(sep(20), "10:00"), updatedAt: at(1, "22:15"),
    }),
    space({
      id: S.thesis, name: "Thesis: Sparse attention", kind: "project", icon: "🚀", color: "#E8893A", sort: 3, roadmapId: "dm-th-milestones",
      description: "MSc thesis: block-sparse attention for long-document classification.",
      props: { goal: "submit a 40-page MSc thesis on sparse attention for long documents", deadline: iso(91) },
      createdAt: now - 63 * DAY, updatedAt: ago(118),
    }),
    space({ id: S.net, name: "Networking", kind: "area", icon: "🌐", color: "#57AB5A", sort: 4, description: "Protocols I keep having to look up.", createdAt: at(aug(10), "10:00"), updatedAt: at(nov(10), "21:00") }),
    space({ id: S.health, name: "Health & sleep", kind: "area", icon: "💪", color: "#E5534B", sort: 5, description: "Daily notes, sleep and training.", createdAt: at(aug(1), "10:00") }),
    space({ id: S.math, name: "Math reference", kind: "resource", icon: "📚", color: "#E3B341", sort: 6, description: "Formulas and identities I reach for.", createdAt: at(aug(5), "10:00") }),
    space({ id: "dm-s-calc", name: "Calculus refresher", kind: "archive", icon: "📐", sort: 7, archived: 1, createdAt: at(130, "10:00"), updatedAt: at(100, "10:00") }),
    space({ id: "dm-s-spanish", name: "Spanish A1", kind: "archive", icon: "🗣️", sort: 8, archived: 1, createdAt: at(130, "10:00"), updatedAt: at(110, "10:00") }),
    space({ id: "dm-s-drafts", name: "Old blog drafts", kind: "archive", icon: "🗃️", sort: 9, archived: 1, createdAt: at(130, "10:00"), updatedAt: at(115, "10:00") }),
  ];

  // ---------------------------------------------------------------- folders
  const F = {
    la: "dm-f-ml-01", opt: "dm-f-ml-02", nn: "dm-f-ml-03", prob: "dm-f-ml-04", uns: "dm-f-ml-05", exams: "dm-f-ml-90",
    nahw: "dm-f-ar-nahw", sarf: "dm-f-ar-sarf", vocab: "dm-f-ar-vocab",
    transport: "dm-f-net-transport", app: "dm-f-net-app", netlayer: "dm-f-net-layer",
    calc: "dm-f-math-calc", linalg: "dm-f-math-la", stats: "dm-f-math-stats", ineq: "dm-f-math-ineq",
  };
  const folder = (id: string, spaceId: string, name: string, color: string | null, sort: number): Folder => ({ id, spaceId, name, parentId: null, color, sort, updatedAt: at(30, "12:00"), deleted: 0, dirty: 0 });
  const folders: Folder[] = [
    folder(F.la, S.ml, "01 Linear algebra", "#39C5CF", 1), folder(F.opt, S.ml, "02 Optimization", "#E8893A", 2), folder(F.nn, S.ml, "03 Neural networks", "#A371F7", 3),
    folder(F.prob, S.ml, "04 Probability", "#57AB5A", 4), folder(F.uns, S.ml, "05 Unsupervised", "#E3B341", 5), folder(F.exams, S.ml, "90 Exams", "#E5534B", 90),
    folder(F.nahw, S.arabic, "Nahw", "#39C5CF", 1), folder(F.sarf, S.arabic, "Sarf", "#A371F7", 2), folder(F.vocab, S.arabic, "Vocabulary", "#57AB5A", 3),
    folder(F.transport, S.net, "Transport", "#57AB5A", 1), folder(F.app, S.net, "Application", "#39C5CF", 2), folder(F.netlayer, S.net, "Network layer", "#E8893A", 3),
    folder(F.calc, S.math, "Calculus", "#E3B341", 1), folder(F.linalg, S.math, "Linear algebra identities", "#39C5CF", 2), folder(F.stats, S.math, "Probability & statistics", "#57AB5A", 3), folder(F.ineq, S.math, "Inequalities", "#E5534B", 4),
  ];

  // ---------------------------------------------------------------- notes with design-given content/times
  const specs: Spec[] = [];
  const add = (s: Spec) => specs.push(s);
  const ML = S.ml;

  // 02 Optimization (ScreenWorkspace list, exact order/times/pins/tags/statuses) + 5 more → 12
  add({ id: DEMO_IDS.gradientDescent, title: "Gradient descent", space: ML, folder: F.opt, type: "lesson", status: "learning", body: GD_BODY, updated: ago(12), created: at(nov(8), "17:58"), pinned: 1, shareId: SHARE.gd });
  add({ id: "dm-lr-schedules", title: "Learning rate schedules", space: ML, folder: F.opt, type: "lesson", status: "todo", tags: ["optimization"], updated: ago(65), created: at(0, "09:20"),
    text: "Step decay, cosine annealing and warmup. Why warmup stabilises Adam during the first few hundred steps.\n\n## Step decay\nDivide η by 10 every few epochs.\n\n## Cosine annealing\n$\\eta_t = \\eta_{min} + \\tfrac12(\\eta_{max} - \\eta_{min})(1 + \\cos(\\pi t / T))$\n\n## Warmup\nRamp η up linearly for the first few hundred steps, while Adam's second-moment estimate is still noisy.\n" });
  add({ id: "dm-convexity", title: "Convexity & minima", space: ML, folder: F.opt, type: "lesson", status: "review", tags: ["math"], updated: at(1, "20:30"), created: at(oct(15), "18:00"),
    text: "A function is convex if the segment between any two points lies above its graph. Every local minimum is global.\n\n$$f(\\lambda x + (1-\\lambda) y) \\le \\lambda f(x) + (1-\\lambda) f(y)$$\n\n## Flashcards\n\nWhen is a function convex? :: When the segment between any two points on its graph lies on or above the graph.\nWhy is convexity useful for optimization? :: Every local minimum is a global minimum.\nSecond-order test for convexity? :: The Hessian is positive semi-definite everywhere.\nIs the logistic loss convex? :: Yes, in the weights.\nIs a sum of convex functions convex? :: Yes.\nWhat is a strictly convex function's minimum like? :: Unique, if it exists.\n" });
  add({ id: "dm-momentum", title: "Momentum & Nesterov", space: ML, folder: F.opt, type: "lesson", status: "learning", tags: ["optimization"], updated: at(nov(9), "19:10"), created: at(oct(20), "18:00"),
    text: "Accumulate a velocity v ← βv + ∇J. Nesterov evaluates the gradient at the look-ahead point instead.\n\n$$v_{t+1} = \\beta v_t + \\nabla J(\\theta_t), \\quad \\theta_{t+1} = \\theta_t - \\eta v_{t+1}$$\n\n## Flashcards\n\nWhat does momentum accumulate? :: A velocity v ← βv + ∇J, an exponential average of past gradients.\nTypical value of β? :: 0.9.\nWhere does Nesterov evaluate the gradient? :: At the look-ahead point θ − ηβv.\nWhy does momentum help in narrow valleys? :: Oscillations across the valley cancel while the consistent direction builds up.\n" });
  add({ id: "dm-adam", title: "Adam optimizer", space: ML, folder: F.opt, type: "lesson", status: "mastered", tags: ["optimization", "exam"], updated: at(nov(3), "18:00"), created: at(oct(12), "18:00"), pinned: 1,
    text: "Adaptive moment estimation: per-parameter step sizes from running averages of the gradient and its square.\n\n$$m_t = \\beta_1 m_{t-1} + (1-\\beta_1) g_t, \\quad v_t = \\beta_2 v_{t-1} + (1-\\beta_2) g_t^2$$\n\n## Flashcards\n\nWhat does Adam stand for? :: Adaptive moment estimation.\nWhat is m_t in Adam? :: A running average of the gradient (first moment).\nWhat is v_t in Adam? :: A running average of the squared gradient (second moment).\nDefault β1 and β2? :: 0.9 and 0.999.\nWhy does Adam use bias correction? :: m and v start at zero, so early estimates are biased towards zero.\nDefault learning rate for Adam? :: 1e-3.\nWhat is AdamW? :: Adam with decoupled weight decay.\nWhy can warmup help Adam? :: v_t is noisy in the first steps, so the effective step size is unreliable.\n" });
  add({ id: "dm-newton", title: "Newton’s method", space: ML, folder: F.opt, type: "lesson", status: "todo", tags: ["math"], updated: at(oct(28), "18:00"), created: at(oct(28), "17:00"),
    text: "Second-order: uses the Hessian. Converges quadratically near the optimum, but each step costs O(n³).\n\n$$\\theta_{t+1} = \\theta_t - H^{-1} \\nabla J(\\theta_t)$$\n" });
  add({ id: "dm-ps3", title: "Problem set 3", space: ML, folder: F.opt, type: "note", status: "learning", tags: ["exam"], updated: at(oct(24), "18:00"), created: at(oct(22), "18:00"),
    text: `Q1 show the logistic loss is convex. Q2 implement mini-batch SGD and plot loss vs. epoch for three batch sizes.\n\n- [ ] Finish Problem set 3, Q1 📅 ${due(nov(12))}\n- [ ] Problem set 3, Q2 — mini-batch SGD 📅 ${iso(0)}\n- [x] Read the hand-out\n` });
  add({ id: "dm-loss-functions", title: "Loss functions", space: ML, folder: F.opt, type: "lesson", status: "mastered", tags: ["optimization"], updated: at(oct(5), "18:00"), created: at(sep(30), "18:00"),
    text: "Squared error for regression, cross-entropy for classification, hinge for margins.\n" });
  add({ id: "dm-line-search", title: "Line search", space: ML, folder: F.opt, type: "lesson", status: "todo", tags: ["optimization"], updated: at(oct(19), "18:00"), created: at(oct(19), "17:00"),
    text: "Pick the step size per iteration: backtracking with the Armijo condition.\n" });
  add({ id: "dm-saddle-points", title: "Saddle points", space: ML, folder: F.opt, type: "lesson", status: "learning", tags: ["optimization"], updated: at(oct(30), "18:00"), created: at(oct(26), "18:00"),
    text: "In high dimensions most critical points are saddles, not local minima. Noise from SGD helps escape them.\n" });
  add({ id: "dm-gd-slides", title: "Gradient descent — slides", space: ML, folder: F.opt, type: "slides", status: "learning", tags: ["optimization"], updated: at(oct(31), "18:00"), created: at(oct(29), "18:00"),
    body: `---
type: slides
status: learning
tags: [optimization]
---
# Gradient descent

02 · Optimization

---

## Why minimize a loss?

- A loss J(θ) scores how wrong the model is
- Learning = finding θ that makes it small

---

## The gradient

- ∇J(θ) points uphill
- Its length says how steep

---

## Gradient descent loop

- Start from a random θ
- Step against the gradient
- Stop when the loss plateaus

\`\`\`mermaid
flowchart LR
  A[init θ] --> B["compute ∇J(θ)"] --> C["θ ← θ − η∇J"] --> D{converged?}
  D -- no --> B
\`\`\`

Note: Draw the bowl on the whiteboard first. Ask: what happens if η is 10× bigger? Then show the divergence plot on the next slide.

---

## Choosing η

- Too large diverges, too small crawls
- Start at 1e-3, then sweep

---

## Divergence

![loss-curve.png](att:dm-att-loss-curve)

---

## Momentum

- v ← βv + ∇J
- Smooths the zig-zag

---

## Mini-batches

- Cheaper steps, useful noise

---

## Adam

- Per-parameter step sizes

---

## Convexity

- Local minimum = global minimum

---

## Summary

- Step against the gradient, scaled by η

---

# Questions
` });
  add({ id: "dm-opt-cheatsheet", title: "Optimization cheat sheet", space: ML, folder: F.opt, type: "note", status: "review", tags: ["optimization", "exam"], updated: at(oct(26), "18:00"), created: at(oct(10), "18:00"),
    text: "| Method | Update | Cost |\n| --- | --- | --- |\n| GD | θ − η∇J | O(n) |\n| Momentum | θ − ηv | O(n) |\n| Adam | θ − η m̂/(√v̂ + ε) | O(n) |\n| Newton | θ − H⁻¹∇J | O(n³) |\n" });

  // 01 Linear algebra (8)
  add({ id: DEMO_IDS.eigenvectors, title: "Linear algebra: eigenvectors", space: ML, folder: F.la, type: "lesson", status: "review", body: EIG_BODY(iso(0), iso(5)), updated: ago(125), created: at(nov(10), "20:00") });
  const laCards = {
    vec: "Vectors and norms", mat: "Matrix multiplication", det: "Determinants",
  };
  add({ id: "dm-vectors-norms", title: laCards.vec, space: ML, folder: F.la, type: "lesson", status: "mastered", tags: ["math"], updated: at(nov(3), "19:00"), created: at(oct(2), "18:00"),
    text: "A norm measures length: $\\|x\\|_1$, $\\|x\\|_2$, $\\|x\\|_\\infty$. Unit balls are a diamond, a circle and a square.\n" });
  add({ id: "dm-matrix-mult", title: laCards.mat, space: ML, folder: F.la, type: "lesson", status: "mastered", tags: ["math"], updated: at(nov(6), "19:30"), created: at(oct(4), "18:00"),
    text: "Entry (i, j) of AB is row i of A dotted with column j of B. Composition of linear maps.\n\n## Flashcards\n\nShape of AB if A is m×n and B is n×p? :: m×p.\nEntry (i, j) of AB? :: Row i of A dotted with column j of B.\nIs matrix multiplication commutative? :: No, AB ≠ BA in general.\nIs it associative? :: Yes, (AB)C = A(BC).\n(AB)ᵀ equals? :: BᵀAᵀ.\n(AB)⁻¹ equals? :: B⁻¹A⁻¹.\nCost of multiplying two n×n matrices naively? :: O(n³).\nWhat does AB mean geometrically? :: Apply B, then A.\nIdentity matrix property? :: AI = IA = A.\nColumn picture of Ax? :: A linear combination of the columns of A weighted by x.\n" });
  add({ id: "dm-determinants", title: laCards.det, space: ML, folder: F.la, type: "lesson", status: "mastered", tags: ["math"], updated: at(nov(8), "18:40"), created: at(oct(6), "18:00"),
    text: "The signed volume scaling of a linear map. Zero exactly when the matrix is singular.\n\n## Flashcards\n\nWhat does det(A) measure? :: How A scales signed volume.\ndet(A) = 0 means? :: A is singular (not invertible).\ndet(AB)? :: det(A)·det(B).\ndet(Aᵀ)? :: det(A).\ndet of a triangular matrix? :: The product of its diagonal.\nEffect of swapping two rows? :: The determinant changes sign.\n" });
  add({ id: "dm-svd-intuition", title: "SVD intuition", space: ML, folder: F.la, type: "lesson", status: "todo", tags: ["math"], updated: at(oct(30), "19:00"), created: at(oct(30), "18:00"),
    text: "Every matrix is a rotation, a stretch and another rotation: A = UΣVᵀ. The right singular vectors are the eigenvectors of AᵀA.\n" });
  add({ id: "dm-linear-maps", title: "Linear maps", space: ML, folder: F.la, type: "lesson", status: "mastered", tags: ["math"], updated: at(oct(8), "18:00"), created: at(sep(28), "18:00"),
    text: "A map is linear if it preserves addition and scaling. Every linear map between finite spaces is a matrix.\n" });
  add({ id: "dm-rank-null", title: "Rank and null space", space: ML, folder: F.la, type: "lesson", status: "learning", tags: ["math"], updated: at(oct(21), "18:00"), created: at(oct(14), "18:00"),
    text: "rank(A) + dim null(A) = n. The null space holds every x with Ax = 0.\n" });
  add({ id: "dm-orthogonality", title: "Orthogonality & projections", space: ML, folder: F.la, type: "lesson", status: "todo", tags: ["math"], updated: at(oct(23), "18:00"), created: at(oct(23), "17:00"),
    text: "Project b onto the column space of A: p = A(AᵀA)⁻¹Aᵀb. Least squares is a projection.\n" });

  // 03 Neural networks (9)
  add({ id: "dm-backprop", title: "Backpropagation", space: ML, folder: F.nn, type: "lesson", status: "learning", tags: ["nn"], updated: at(nov(9), "21:30"), created: at(oct(27), "18:00"),
    text: "Reverse-mode autodiff over the computation graph. Cache, then multiply local gradients from the loss backwards.\n\n## Flashcards\n\nWhat is backpropagation? :: Reverse-mode automatic differentiation over the computation graph.\nWhy cache activations in the forward pass? :: The backward pass needs them to compute local gradients.\nWhich rule does backprop apply repeatedly? :: The chain rule.\n∂L/∂W for z = Wx + b? :: (∂L/∂z) xᵀ.\nDerivative of σ(z)? :: σ(z)(1 − σ(z)).\nWhy do gradients vanish with sigmoid? :: σ′ ≤ 0.25, so long products shrink towards zero.\nWhy does ReLU help? :: Its derivative is 1 for positive inputs, so gradients don't shrink.\nCost of the backward pass vs the forward pass? :: About the same order, roughly 2×.\nWhat is gradient checking? :: Comparing backprop gradients with finite differences.\n" });
  add({ id: "dm-perceptron", title: "Perceptron", space: ML, folder: F.nn, type: "lesson", status: "learning", tags: ["nn"], updated: at(oct(30), "20:00"), created: at(oct(25), "18:00"),
    text: "A single linear threshold unit. Converges if the data are linearly separable.\n" });
  add({ id: "dm-attention", title: "Attention", space: ML, folder: F.nn, type: "lesson", status: "learning", tags: ["nn", "thesis"], updated: at(nov(6), "18:30"), created: at(nov(6), "10:00"),
    text: "softmax(QKᵀ/√d)V: every token takes a weighted average of the values, weighted by query–key similarity. Quadratic in sequence length, which is what my thesis attacks.\n" });
  add({ id: "dm-cnns", title: "CNNs", space: ML, folder: F.nn, type: "lesson", status: "todo", tags: ["deep-learning"], updated: at(oct(17), "18:00"), created: at(oct(17), "17:00"), text: "Convolutions share weights across positions; pooling buys translation tolerance.\n" });
  add({ id: "dm-sequence-models", title: "Sequence models", space: ML, folder: F.nn, type: "lesson", status: "todo", tags: ["deep-learning"], updated: at(oct(18), "18:00"), created: at(oct(18), "17:00"), text: "RNNs, LSTMs and why transformers replaced them.\n" });
  add({ id: "dm-activations", title: "Activation functions", space: ML, folder: F.nn, type: "lesson", status: "mastered", tags: ["deep-learning"], updated: at(oct(9), "18:00"), created: at(oct(3), "18:00"), text: "Sigmoid, tanh, ReLU, GELU: shapes, derivatives and when each one saturates.\n" });
  add({ id: "dm-regularization", title: "Regularization & dropout", space: ML, folder: F.nn, type: "lesson", status: "todo", tags: ["deep-learning"], updated: at(oct(20), "18:00"), created: at(oct(20), "17:00"), text: "Weight decay, dropout and early stopping.\n" });
  add({ id: "dm-weight-init", title: "Weight initialization", space: ML, folder: F.nn, type: "lesson", status: "learning", tags: ["deep-learning"], updated: at(oct(27), "18:00"), created: at(oct(16), "18:00"), text: "Xavier for tanh, He for ReLU: keep the activation variance constant across layers.\n" });
  add({ id: "dm-residual", title: "Residual connections", space: ML, folder: F.nn, type: "lesson", status: "mastered", tags: ["deep-learning"], updated: at(oct(11), "18:00"), created: at(oct(7), "18:00"), text: "y = x + F(x) gives gradients a highway through deep networks.\n" });

  // 04 Probability (6)
  add({ id: "dm-bayes", title: "Bayes rule", space: ML, folder: F.prob, type: "lesson", status: "mastered", tags: ["probability"], updated: at(nov(4), "19:00"), created: at(oct(1), "18:00"),
    text: "P(A|B) = P(B|A) P(A) / P(B). Posterior ∝ likelihood × prior.\n\n## Flashcards\n\nBayes rule? :: P(A|B) = P(B|A)P(A) / P(B).\nPosterior is proportional to? :: Likelihood × prior.\nWhat is P(B) in Bayes rule called? :: The evidence (marginal likelihood).\nBase-rate fallacy? :: Ignoring the prior P(A) when judging P(A|B).\nWhat does a conjugate prior give you? :: A posterior in the same family as the prior.\nP(A|B) = P(A) means? :: A and B are independent.\nLaw of total probability? :: P(B) = Σ P(B|Aᵢ)P(Aᵢ).\n" });
  add({ id: "dm-mle-map", title: "MLE vs MAP", space: ML, folder: F.prob, type: "lesson", status: "review", tags: ["probability"], updated: at(nov(9), "18:00"), created: at(oct(13), "18:00"),
    text: "MLE maximizes the likelihood; MAP maximizes likelihood × prior. A Gaussian prior on weights is L2 regularization.\n\n## Flashcards\n\nWhat does MLE maximize? :: The likelihood p(data | θ).\nWhat does MAP maximize? :: The posterior p(θ | data) ∝ likelihood × prior.\nWhen do MLE and MAP coincide? :: With a uniform prior.\nA Gaussian prior on weights corresponds to? :: L2 regularization.\nA Laplace prior on weights corresponds to? :: L1 regularization.\n" });
  add({ id: "dm-kl", title: "KL divergence", space: ML, folder: F.prob, type: "lesson", status: "learning", tags: ["probability"], updated: at(nov(4), "21:00"), created: at(oct(29), "18:00"), text: "KL(p‖q) = Σ p log(p/q). Not symmetric, never negative.\n" });
  add({ id: "dm-markov", title: "Markov chains", space: ML, folder: F.prob, type: "lesson", status: "todo", tags: ["probability", "math"], updated: at(oct(22), "18:00"), created: at(oct(22), "17:00"), text: "The stationary distribution is the eigenvector for λ = 1 of the transition matrix.\n" });
  add({ id: "dm-random-variables", title: "Random variables", space: ML, folder: F.prob, type: "lesson", status: "mastered", tags: ["probability", "math"], updated: at(oct(2), "18:00"), created: at(sep(25), "18:00"), text: "A function from outcomes to numbers; discrete or continuous.\n" });
  add({ id: "dm-expectation", title: "Expectation & variance", space: ML, folder: F.prob, type: "lesson", status: "mastered", tags: ["probability", "math"], updated: at(oct(3), "18:00"), created: at(sep(26), "18:00"), text: "E[aX + b] = aE[X] + b; Var(X) = E[X²] − E[X]².\n" });

  // 05 Unsupervised (5)
  add({ id: "dm-pca", title: "PCA from scratch", space: ML, folder: F.uns, type: "lesson", status: "review", tags: ["unsupervised"], updated: at(nov(2), "19:00"), created: at(oct(26), "18:00"), text: "Centre the data, form the covariance Σ, then project onto the top-k eigenvectors of Σ.\n" });
  add({ id: "dm-spectral", title: "Spectral clustering", space: ML, folder: F.uns, type: "lesson", status: "learning", tags: ["unsupervised"], updated: at(nov(8), "18:00"), created: at(nov(5), "18:00"), text: "Build a similarity graph, use the eigenvectors of the graph Laplacian, then run k-means on them.\n" });
  add({ id: "dm-kmeans", title: "k-means", space: ML, folder: F.uns, type: "lesson", status: "mastered", tags: ["unsupervised"], updated: at(oct(14), "18:00"), created: at(oct(9), "18:00"), text: "Alternate assigning points to the nearest centroid and moving centroids to the mean.\n" });
  add({ id: "dm-gmm", title: "Gaussian mixtures", space: ML, folder: F.uns, type: "lesson", status: "todo", tags: ["unsupervised"], updated: at(oct(25), "18:00"), created: at(oct(25), "17:00"), text: "Soft k-means fitted with EM.\n" });
  add({ id: "dm-tsne", title: "t-SNE & UMAP", space: ML, folder: F.uns, type: "lesson", status: "todo", tags: ["unsupervised"], updated: at(oct(26), "18:00"), created: at(oct(26), "17:00"), text: "Neighbour-preserving embeddings for plots, not for distances.\n" });

  // 90 Exams (4)
  add({ id: "dm-0b-exam2-cheatsheet", title: "Exam 2 cheat sheet", space: ML, folder: F.exams, type: "note", status: "review", tags: ["exam"], updated: at(oct(31), "19:00"), created: at(oct(20), "18:00"), pinned: 1, props: { due: iso(15) }, fm: { due: iso(15) },
    text: `One page, both sides. Eigenvalues, convexity tests, update rules, Bayes.\n\n- [ ] Print the final version 📅 ${iso(15)}\n` });
  add({ id: "dm-eigen-practice", title: "Eigen-decomposition practice", space: ML, folder: F.exams, type: "note", status: "learning", tags: ["exam", "math"], updated: at(oct(29), "18:00"), created: at(oct(29), "17:00"), text: "Diagonalise A = PDP⁻¹ where D holds the eigenvalues and P the eigenvectors.\n" });
  add({ id: "dm-exam1-retro", title: "Exam 1 retrospective", space: ML, folder: F.exams, type: "note", status: "mastered", tags: ["exam"], updated: at(oct(10), "18:00"), created: at(oct(10), "17:00"), text: "Lost points on matrix calculus. Practise more Jacobians.\n" });
  add({ id: "dm-past-paper", title: "Past paper 2025", space: ML, folder: F.exams, type: "note", status: "todo", tags: ["exam", "math"], updated: at(oct(15), "18:00"), created: at(oct(15), "17:00"), text: "Timed attempt planned for the weekend before the exam.\n" });

  // ML root: MOC, roadmap, visual notes, slides, "This week", blog posts
  const mocLinks = ["Vectors and norms", "Matrix multiplication", "Determinants", "Linear algebra: eigenvectors", "SVD intuition", "Rank and null space", "Gradient descent", "Learning rate schedules", "Convexity & minima", "Momentum & Nesterov", "Adam optimizer", "Newton’s method", "Perceptron", "Backpropagation", "Attention", "CNNs", "Bayes rule", "MLE vs MAP", "KL divergence", "PCA from scratch", "Spectral clustering", "Exam 2 cheat sheet", "Backprop study board", "Backprop — study group deck"];
  add({ id: "dm-0a-ml-moc", title: "ML Foundations — map of content", space: ML, type: "moc", status: "mastered", tags: ["ml"], updated: at(nov(5), "18:00"), created: at(oct(1), "11:00"), pinned: 1,
    text: `Start here.\n\n## Linear algebra\n${mocLinks.slice(0, 6).map((t) => `- [[${t}]]`).join("\n")}\n\nLinear algebra → eigenvectors, SVD, norms.\n\n## Optimization\n${mocLinks.slice(6, 12).map((t) => `- [[${t}]]`).join("\n")}\n\n## Neural networks\n${mocLinks.slice(12, 16).map((t) => `- [[${t}]]`).join("\n")}\n\n## Probability & unsupervised\n${mocLinks.slice(16, 21).map((t) => `- [[${t}]]`).join("\n")}\n\n## Study aids\n${mocLinks.slice(21).map((t) => `- [[${t}]]`).join("\n")}\n` });
  add({ id: DEMO_IDS.mlRoadmap, title: "ML Foundations roadmap", space: ML, type: "roadmap", status: "learning", updated: at(nov(10), "20:30"), created: at(oct(1), "11:00"),
    body: `## 01 Linear algebra 📅 ${iso(9)}
- [x] Vectors & norms 📅 ${due(nov(3))} → [[Vectors and norms]]
- [x] Linear maps → [[Linear maps]]
- [x] Matrix multiplication 📅 ${due(nov(6))} → [[Matrix multiplication]]
- [x] Determinants 📅 ${due(nov(8))} → [[Determinants]]
- [/] Eigenvectors (needs: Vectors & norms, Matrix multiplication, Determinants) 📅 ${iso(5)} → [[Linear algebra: eigenvectors]]
- [ ] SVD (needs: Eigenvectors) 📅 ${iso(9)}
- [-] Norm inequalities

## 02 Optimization 📅 ${iso(23)}
- [x] Loss functions → [[Loss functions]]
- [/] Gradient descent (needs: Matrix multiplication, Vectors & norms) 📅 ${due(nov(12))} → [[Gradient descent]]
- [x] Convexity & minima → [[Convexity & minima]]
- [/] Momentum & Nesterov (needs: Gradient descent, Convexity & minima) 📅 ${iso(13)} → [[Momentum & Nesterov]]
- [ ] Learning rate schedules (needs: Gradient descent) 📅 ${iso(18)}
- [x] Adam (needs: Momentum & Nesterov, Learning rate schedules) → [[Adam optimizer]]

## 03 Neural networks 📅 ${iso(32)}
- [x] Perceptron → [[Perceptron]]
- [/] Activation functions
- [ ] Backpropagation (needs: Gradient descent) 📅 ${iso(21)} → [[Backpropagation]]
- [ ] CNNs (needs: Backpropagation) 📅 ${iso(28)} → [[CNNs]]
- [ ] Sequence models (needs: Backpropagation) 📅 ${iso(32)} → [[Sequence models]]
- [ ] Regularization & dropout

## 04 Probability 📅 ${iso(17)}
- [x] Random variables → [[Random variables]]
- [x] Expectation & variance → [[Expectation & variance]]
- [x] Common distributions
- [x] Bayes rule 📅 ${due(nov(4))} → [[Bayes rule]]
- [x] Conditional independence
- [x] MLE vs MAP → [[MLE vs MAP]]
- [x] KL divergence
- [x] Markov chains
` });
  add({ id: DEMO_IDS.backpropBoard, title: "Backprop study board", space: ML, type: "canvas", status: "learning", body: JSON.stringify(BACKPROP_CANVAS, null, 2), updated: ago(3), created: at(nov(5), "20:00") });
  add({ id: DEMO_IDS.studyPlan, title: "Study plan — November", space: ML, type: "whiteboard", status: "learning", body: JSON.stringify(studyPlanScene()), updated: at(nov(3), "21:00"), created: at(nov(3), "20:00"), shareId: SHARE.plan });
  add({ id: "dm-optimizers-map", title: "Optimizers map", space: ML, type: "canvas", status: "mastered", body: JSON.stringify(OPTIMIZERS_CANVAS, null, 2), updated: at(oct(20), "18:00"), created: at(oct(19), "18:00") });
  add({ id: DEMO_IDS.deck, title: "Backprop — study group deck", space: ML, type: "slides", status: "learning", tags: ["nn"], updated: at(nov(9), "17:00"), created: at(nov(5), "19:00"), shareId: SHARE.deck,
    body: `---
type: slides
status: learning
tags: [nn]
---
Study group · week 6

# Backprop, from one neuron up

Amir Hakim · Night Shift Notes

---

## Why gradients?

- A network is a function with millions of knobs
- The gradient says which way to turn each one

---

## The chain rule, one neuron

- Forward: z = wx + b, a = σ(z)
- Backward: multiply the local gradients
- Cache activations — you'll need them

---

![Layer-3 activations on a cat photo](att:dm-att-feature-maps)

---

https://www.youtube.com/watch?v=Ilg3gGewQ5U

---

## One training step

\`\`\`mermaid
flowchart LR
  A[Input x] --> B[Forward] --> C[Loss L] --> D["Backward ∂L/∂w"] --> E[Update w]
\`\`\`

---

## Vanishing gradients

- σ′ ≤ 0.25, so deep products shrink

---

## ReLU vs sigmoid

- ReLU passes gradients unchanged for z > 0

---

![backprop-demo.webm](att:dm-att-backprop-demo)

---

## Exercises

- Derive ∂L/∂W for a 2-layer MLP
- Check it numerically

---

## Summary

- Forward, cache, backward, update

---

# Questions
` });
  add({ id: "dm-this-week", title: "This week", space: ML, type: "note", status: "learning", updated: at(nov(10), "08:30"), created: at(nov(10), "08:00"),
    text: `${STUDY_PLAN_ITEMS.map((t) => `- ${t}`).join("\n")}\n` });

  // Blog posts (Lumen 06b): 12 published, tag counts #ml 6 · #math 4 · #arabic 3 · #networking 2.
  const post = (id: string, title: string, k: number, space: string, tags: string[], excerpt: string, text: string, status: Status | null, slug: string) =>
    add({ id, title, space, type: "post", status, tags, published: 1, slug, updated: at(k, "10:30"), created: at(k, "09:30"), props: { date: iso(-k), excerpt }, fm: { date: iso(-k) }, text });
  post("dm-post-eigenvectors", "Eigenvectors, the directions a matrix leaves alone", nov(12), ML, ["math", "ml"],
    "How to find them, why PCA and gradient descent both depend on them, and three matrices that break the rules.",
    `## Intuition\n\nAn **eigenvector** of a square matrix $A$ is a non-zero vector $v$ that $A$ only stretches: $Av = \\lambda v$. The scalar $\\lambda$ is its eigenvalue.\n\n## Finding them\n\nA non-zero solution of $(A - \\lambda I)v = 0$ exists only when $A - \\lambda I$ is singular, so\n\n$$\\det(A - \\lambda I) = 0$$\n\n> [!tip]\n> For 2×2 matrices, λ₁ + λ₂ = tr(A) and λ₁λ₂ = det(A).\n\n## In code\n\n\`\`\`python\nvals, vecs = np.linalg.eigh(A)\nprint(vals)  # [1. 3.]\n\`\`\`\n\nThat's the whole trick: find where the determinant vanishes, then solve for the null space.\n\n## Worked examples\n\nA symmetric matrix, a rotation and a shear: three matrices that behave very differently.\n\n## Practice\n\nTry the 2×2 checks on the three examples above.\n`, "mastered", "eigenvectors");
  post("dm-post-idafa", "Idafa in five examples", nov(5), S.arabic, ["arabic"],
    "Two nouns side by side, no word for “of”: a gentle tour of the Arabic possessive, from كتاب الطالب to longer chains.",
    "Two nouns side by side, no word for “of”.\n\n1. كتابُ الطالبِ — the student's book\n2. بابُ البيتِ — the door of the house\n3. قلمُ المعلّمِ — the teacher's pen\n4. مدينةُ النبيِّ — the city of the Prophet\n5. بابُ بيتِ المعلّمِ — the door of the teacher's house\n", null, "idafa-in-five-examples");
  post("dm-post-gd-gently", "Gradient descent, gently", oct(29), ML, ["ml"],
    "A walk downhill with a blindfold: learning rates, momentum, and why my first model diverged.",
    "Imagine walking downhill with a blindfold: feel the slope, take a step, repeat.\n\nThe step size is the learning rate. Mine was 10× too big, and the loss went to infinity.\n", "mastered", "gradient-descent-gently");
  post("dm-post-tcp", "The TCP handshake, slowly", oct(18), S.net, ["networking"],
    "SYN, SYN-ACK, ACK — and the one random number that keeps old packets out of new connections.",
    "SYN, SYN-ACK, ACK. Three packets, and one random number that keeps old packets out of new connections.\n", null, "the-tcp-handshake-slowly");
  post("dm-post-convexity", "Why convexity makes life easy", oct(10), ML, ["math", "ml"],
    "If the bowl has one bottom, any way down is the right way down.", "If the bowl has one bottom, any way down is the right way down.\n", "mastered", "why-convexity-makes-life-easy");
  post("dm-post-backprop", "Backprop by hand, one neuron at a time", oct(2), ML, ["ml"],
    "The chain rule, a pencil and a single sigmoid neuron.", "The chain rule, a pencil and a single sigmoid neuron.\n", "mastered", "backprop-by-hand");
  post("dm-post-verb-forms", "Verb forms I–X as a table you can remember", sep(24), S.arabic, ["arabic"],
    "Ten patterns, one root, and the meanings they add.", "Ten patterns, one root, and the meanings they add.\n", null, "verb-forms-table");
  post("dm-post-bayes", "Bayes rule with a broken smoke alarm", sep(15), ML, ["math", "ml"],
    "Priors, likelihoods and why the alarm is probably wrong.", "Priors, likelihoods and why the alarm is probably wrong.\n", "mastered", "bayes-smoke-alarm");
  post("dm-post-dns", "DNS in one diagram", sep(6), S.net, ["networking"],
    "Stub resolver, recursive resolver, root, TLD, authoritative: one picture.", "Stub resolver, recursive resolver, root, TLD, authoritative.\n", null, "dns-in-one-diagram");
  post("dm-post-sun-moon", "Sun letters, moon letters, and one silent lām", aug(28), S.arabic, ["arabic"],
    "Why the ل of ال sometimes disappears when you read aloud.", "Why the ل of ال sometimes disappears when you read aloud.\n", null, "sun-and-moon-letters");
  post("dm-post-norms", "Norms, measured three ways", aug(19), ML, ["math"],
    "L1, L2 and L∞: a diamond, a circle and a square.", "L1, L2 and L∞: a diamond, a circle and a square.\n", "mastered", "norms-three-ways");
  post("dm-post-lr-story", "My first model diverged: a learning-rate story", aug(8), ML, ["ml"],
    "NaNs at step 40, and what they taught me about η.", "NaNs at step 40, and what they taught me about η.\n", "mastered", "learning-rate-story");

  // ---------------------------------------------------------------- Arabic Grammar (41)
  const AR = S.arabic;
  add({ id: DEMO_IDS.idafa, title: "Arabic grammar: idafa", space: AR, folder: F.nahw, type: "lesson", status: "learning", tags: ["arabic", "nahw"], updated: at(1, "22:15"), created: at(nov(5), "18:00"),
    props: { course: "Madinah Book 1, lesson 4", source: "youtube.com/@ArabicPod101", due: iso(6), difficulty: "3" },
    fm: { course: "Madinah Book 1, lesson 4", source: "youtube.com/@ArabicPod101", due: iso(6), difficulty: "3" },
    text: `${IDAFA_TEXT}\n\n- [ ] Memorise idafa examples 11–20 📅 ${iso(6)}\n\n## Flashcards\n\nIn an idafa, what happens to the first noun (mudāf)? :: It loses “al-” and its tanwīn. كِتَابُ الطَّالِبِ — “the student’s book”.\nArabic: when does idafa drop tanwīn? :: Always on the first noun (the mudāf).\nWhat case is the mudāf ilayhi in? :: Always genitive (majrūr).\nCan the mudāf take the definite article? :: No, never.\nWhich noun in an idafa chain can be definite? :: Only the last one.\nTranslate بَابُ بَيْتِ المُعَلِّمِ :: The door of the teacher's house.\n` });
  add({ id: DEMO_IDS.bidi, title: "الإضافة في اللغة العربية", space: AR, folder: F.nahw, type: "lesson", status: "learning", body: BIDI_BODY, updated: at(nov(10), "20:00"), created: at(nov(10), "19:00") });
  add({ id: "dm-idafa-chains", title: "Arabic: idafa chains", space: AR, folder: F.nahw, type: "note", status: "todo", updated: ago(240), created: at(0, "11:30"), text: "Three- and four-noun chains from the reader, with the case of each noun.\n" });
  for (const [i, t] of ["Nominal sentences", "Verbal sentences", "Kāna and its sisters", "Inna and its sisters", "The five nouns", "Case endings (iʿrāb)", "Sun and moon letters", "Adjective agreement", "Demonstratives"].entries())
    add({ id: `dm-ar-nahw-${i}`, title: t, space: AR, folder: F.nahw, type: "lesson", updated: 0, text: `${t}: rules, the exceptions I keep forgetting, and five examples from the reader.\n` });
  add({ id: "dm-02-verb-forms", title: "Arabic: verb forms I–X", space: AR, folder: F.sarf, type: "flashcards", status: "review", body: VERB_BODY, updated: at(nov(7), "18:00"), created: at(oct(1), "18:00"), pinned: 1, shareId: SHARE.verbs });
  for (const [i, t] of ["Root and pattern", "Weak verbs", "Hollow verbs", "Defective verbs", "Masdar patterns", "Active participle", "Passive participle", "Broken plurals", "Doubled verbs"].entries())
    add({ id: `dm-ar-sarf-${i}`, title: t, space: AR, folder: F.sarf, type: "lesson", updated: 0, text: `${t}: the pattern, how it conjugates and the common verbs that use it.\n` });
  for (let i = 1; i <= 8; i++) add({ id: `dm-ar-vocab-${i}`, title: `Madinah Book 1 — lesson ${i} vocabulary`, space: AR, folder: F.vocab, type: "note", updated: 0, text: `New words from lesson ${i}, with plurals and one example sentence each.\n` });
  add({ id: "dm-ar-particles", title: "Common particles", space: AR, folder: F.vocab, type: "note", updated: 0, text: "في، على، من، إلى، عن، مع — with the case they govern.\n" });
  add({ id: "dm-ar-numbers", title: "Numbers 1–10", space: AR, folder: F.vocab, type: "note", updated: 0, text: "Gender polarity for 3–10: the number takes the opposite gender of the counted noun.\n" });
  add({ id: "dm-ar-roadmap", title: "Arabic Grammar roadmap", space: AR, type: "roadmap", updated: at(nov(5), "18:30"), created: at(sep(20), "10:00"),
    body: `## 01 Script & sounds
- [x] Alphabet & joining
- [x] Short vowels
- [x] Long vowels
- [x] Sukūn & shadda
- [x] Sun and moon letters

## 02 Nouns
- [x] Gender
- [x] Definiteness
- [x] Duals
- [ ] Sound plurals
- [ ] Broken plurals
- [ ] The five nouns

## 03 Constructions 📅 ${iso(6)}
- [/] Idafa 📅 ${iso(6)} → [[Arabic grammar: idafa]]
- [x] Adjective agreement → [[Adjective agreement]]
- [x] Demonstratives
- [ ] Nominal sentences
- [ ] Verbal sentences
- [ ] Inna and its sisters (needs: Nominal sentences)

## 04 Verbs
- [x] Past tense
- [ ] Present tense
- [ ] Imperative
- [ ] Weak verbs
- [ ] Verb forms I–X → [[Arabic: verb forms I–X]]

## 05 Particles
- [ ] Prepositions
- [ ] Conjunctions
- [ ] Negation
- [ ] Questions
- [ ] Conditionals

## 06 Reading
- [ ] Short stories
- [ ] Qaṣaṣ al-Anbiyāʾ ch. 1
- [ ] Hadith selection
- [ ] News headlines
- [ ] Poetry
` });
  add({ id: "dm-ar-sentences-wb", title: "Arabic sentence diagrams", space: AR, type: "whiteboard", updated: at(oct(30), "18:00"), body: JSON.stringify(smallScene([["ar-1", "كِتَابُ", 0, 0], ["ar-2", "الطَّالِبِ", 260, 0], ["ar-3", "مُضاف + مُضاف إليه", 130, 160]])) });
  add({ id: "dm-ar-reading", title: "Reading: Qaṣaṣ al-Anbiyāʾ ch. 1", space: AR, type: "note", updated: 0, text: "Unknown words and every idafa I spotted.\n" });
  add({ id: "dm-ar-plan", title: "Study plan", space: AR, type: "note", updated: 0, text: "Two lessons a week, drills on Sundays.\n" });
  add({ id: "dm-ar-mistakes", title: "Mistakes log", space: AR, type: "note", updated: 0, text: "Putting al- on the mudāf. Again.\n" });
  add({ id: "dm-ar-resources", title: "Resources", space: AR, type: "note", updated: 0, text: "Madinah Book 1, ArabicPod101, Wright's grammar for lookups.\n" });

  // ---------------------------------------------------------------- Networking (28)
  const NET = S.net;
  add({ id: "dm-tcp", title: "TCP handshake", space: NET, folder: F.transport, type: "lesson", status: "mastered", tags: ["networking"], updated: at(nov(10), "21:00"), created: at(oct(16), "18:00"),
    text: `${TCP_TEXT}\n\n- [ ] Draw TCP state diagram from memory\n` });
  for (const [i, t] of ["UDP vs TCP", "Congestion control", "Flow control & windows", "TCP teardown & TIME_WAIT", "QUIC"].entries()) add({ id: `dm-net-tr-${i}`, title: t, space: NET, folder: F.transport, type: "lesson", updated: 0, text: `${t}: what it solves and the packet trace that made it click.\n` });
  for (const [i, t] of ["DNS resolution", "HTTP/1.1 vs HTTP/2", "TLS 1.3 handshake", "HTTP caching", "WebSockets", "SMTP basics", "CDNs"].entries()) add({ id: `dm-net-app-${i}`, title: t, space: NET, folder: F.app, type: "lesson", updated: 0, text: `${t}: the moving parts and the one header everybody gets wrong.\n` });
  for (const [i, t] of ["IP addressing & CIDR", "Subnetting practice", "Routing: OSPF vs BGP", "NAT", "ICMP & traceroute", "IPv6 basics", "ARP"].entries()) add({ id: `dm-net-l3-${i}`, title: t, space: NET, folder: F.netlayer, type: "lesson", updated: 0, text: `${t}: notes and two worked examples.\n` });
  add({ id: "dm-net-moc", title: "Networking MOC", space: NET, type: "moc", updated: 0, text: "- [[TCP handshake]]\n- [[DNS resolution]]\n- [[TLS 1.3 handshake]]\n- [[IP addressing & CIDR]]\n" });
  add({ id: "dm-net-tcp-canvas", title: "TCP state machine", space: NET, type: "canvas", updated: at(oct(16), "19:00"), body: JSON.stringify(TCP_CANVAS, null, 2) });
  for (const [i, t] of ["Wireshark cheatsheet", "Home lab setup", "Interview questions", "Reading list"].entries()) add({ id: `dm-net-root-${i}`, title: t, space: NET, type: "note", updated: 0, text: `${t}.\n` });

  // ---------------------------------------------------------------- Math reference (63)
  const MATH: [string, string[]][] = [
    [F.calc, ["Limits", "Derivative rules", "Chain rule", "Product & quotient rules", "Common derivatives", "Common integrals", "Integration by parts", "Substitution", "Taylor series", "L'Hôpital's rule", "Partial derivatives", "Gradient, Jacobian, Hessian", "Matrix calculus identities", "Lagrange multipliers", "Multiple integrals", "Change of variables"]],
    [F.linalg, ["Transpose rules", "Inverse rules", "Trace identities", "Determinant identities", "Woodbury identity", "Positive definite matrices", "Orthogonal matrices", "Spectral theorem", "Cholesky decomposition", "QR decomposition", "Pseudoinverse", "Kronecker product"]],
    [F.stats, ["Bernoulli & binomial", "Poisson", "Uniform", "Gaussian", "Multivariate Gaussian", "Exponential & gamma", "Beta & Dirichlet", "Student's t", "Central limit theorem", "Law of large numbers", "Covariance & correlation", "Conditional expectation", "Moment generating functions", "Hypothesis tests", "Confidence intervals"]],
    [F.ineq, ["Cauchy–Schwarz", "Triangle inequality", "Jensen's inequality", "Markov's inequality", "Chebyshev's inequality", "Hoeffding's inequality", "AM–GM", "Hölder's inequality"]],
    ["", ["Greek alphabet", "Set notation", "Logarithm rules", "Trig identities", "Complex numbers", "Big-O notation", "Summation formulas", "Combinatorics", "Proof techniques", "Fourier transform pairs", "Units & constants", "LaTeX snippets"]],
  ];
  MATH.forEach(([fid, titles], fi) => titles.forEach((t, i) => add({ id: `dm-math-${fi}-${i}`, title: t, space: S.math, folder: fid || null, type: "note", updated: 0, text: `Reference card: ${t}. Definitions, the key identity and one worked example.\n` })));

  // ---------------------------------------------------------------- Thesis (project)
  const TH = S.thesis;
  add({ id: "dm-th-milestones", title: "Thesis milestones", space: TH, type: "roadmap", updated: at(oct(14), "18:00"), created: now - 63 * DAY,
    body: `## Milestones
- [x] Proposal 📅 ${due(sep(2))}
- [x] Literature review 📅 ${due(oct(14))}
- [ ] Experiments 📅 ${iso(29)}
- [ ] First draft 📅 ${iso(68)}
- [ ] Submission 📅 ${iso(91)}
` });
  add({ id: "dm-th-results", title: "Results log", space: TH, type: "note", updated: ago(118), created: at(oct(20), "18:00"),
    text: `Every run, its config hash and the number that matters.\n\n- [/] Plot attention entropy per layer 📅 ${iso(7)}\n- [x] Reproduce BigBird numbers\n- [x] Set up W&B project\n` });
  add({ id: "dm-th-experiments", title: "Experiments plan", space: TH, type: "note", updated: at(1, "14:00"), created: at(oct(15), "18:00"),
    text: `Baselines first, then the block-sparse kernel, then ablations.\n\n- [ ] Run Longformer baseline on arXiv-long 📅 ${iso(4)}\n- [/] Implement block-sparse kernel 📅 ${iso(6)}\n- [ ] Book GPU slot for ablations 📅 ${iso(18)}\n- [x] Pick evaluation metrics\n- [x] Freeze the train/test split\n` });
  add({ id: "dm-th-kernel", title: "Block-sparse kernel notes", space: TH, type: "note", updated: at(nov(10), "16:00"), created: at(nov(3), "18:00"),
    text: "Triton kernel, 64×64 blocks, global tokens on the first block row.\n\n- [x] Benchmark dense attention baseline\n- [x] Write block-mask generator\n" });
  add({ id: "dm-th-meeting", title: "Meeting 6 Nov — Dr. Lim", space: TH, type: "note", updated: at(nov(6), "15:00"), created: at(nov(6), "14:00"),
    text: `Agreed: arXiv-long as the main benchmark, Longformer as baseline.\n\n- [ ] Ask Dr. Lim about compute quota 📅 ${due(nov(10))}\n- [x] Send updated timeline\n` });
  add({ id: "dm-th-litreview", title: "Lit review: efficient transformers", space: TH, type: "note", updated: at(nov(2), "18:00"), created: at(oct(1), "18:00"),
    text: "Sparse, low-rank, kernel and recurrent families.\n\n- [x] Summarise Longformer\n- [x] Summarise BigBird\n- [x] Summarise Performer\n" });
  add({ id: "dm-th-outline", title: "Thesis outline", space: TH, type: "note", updated: at(oct(28), "18:00"), created: at(sep(20), "18:00"),
    text: "1 Introduction · 2 Related work · 3 Method · 4 Experiments · 5 Discussion\n\n- [x] Agree chapter structure with Dr. Lim\n" });
  add({ id: "dm-th-proposal", title: "Proposal v3", space: TH, type: "note", updated: at(sep(2), "18:00"), created: at(aug(20), "18:00"),
    text: "Block-sparse attention for long-document classification.\n\n- [x] Submit proposal\n- [x] Get sign-off from Dr. Lim\n" });
  add({ id: "dm-th-litnotes", title: "Lit review notes", space: TH, type: "note", updated: at(oct(27), "18:00"), created: at(oct(1), "18:00"),
    text: `Reading notes per paper, grouped by family.\n\n- [ ] Write related-work §2.3 📅 ${iso(8)}\n- [ ] Draft §3 method outline 📅 ${iso(13)}\n` });
  add({ id: "dm-th-datasets", title: "Datasets: arXiv-long", space: TH, type: "note", updated: at(oct(12), "18:00"), created: at(oct(5), "18:00"),
    text: "Documents over 8k tokens, 11 classes.\n\n- [x] Download and dedupe\n" });
  add({ id: "dm-th-attention-explained", title: "Attention, explained", space: TH, type: "note", updated: at(nov(5), "21:00"), created: at(nov(5), "20:00"),
    text: "Start with the visual intuition, then read the paper. The video is the best 26 minutes on the topic I've found.\n\nhttps://www.youtube.com/watch?v=eMlx5fFNoYc\n\nJay Alammar's walkthrough is still the clearest written version:\n\nhttps://jalammar.github.io/illustrated-transformer/\n\nLecture 7 recording (uploaded from my phone):\n\n![lecture-07-attention.m4a](att:dm-att-lecture07)\n\nMy screen recording of the attention-entropy plot:\n\n![entropy-per-layer.mp4](att:dm-att-entropy)\n\nAnd the paper itself, annotated:\n\n![vaswani-2017-attention.pdf](att:dm-att-vaswani)\n" });
  add({ id: "dm-th-arch-wb", title: "Thesis architecture sketch", space: TH, type: "whiteboard", updated: at(oct(31), "18:00"), body: JSON.stringify(smallScene([["th-1", "Tokens (8k)", 0, 0], ["th-2", "Block-sparse attention", 260, 0], ["th-3", "Classifier", 520, 0]])) });
  for (const [i, t] of ["Related work: BigBird", "Related work: Longformer", "Writing style guide", "Reading list"].entries()) add({ id: `dm-th-root-${i}`, title: t, space: TH, type: "note", updated: 0, text: `${t}.\n` });

  // ---------------------------------------------------------------- Health & sleep: daily notes (Calendar 14C: 2–6, 9–13 Nov)
  for (const d of [2, 3, 4, 5, 6, 9, 10, 11, 12, 13]) {
    const k = nov(d);
    add({ id: `dm-journal-${d}`, title: `Journal ${iso(-k)}`, space: S.health, type: "journal", updated: k === 0 ? ago(20) : at(k, "21:10"), created: k === 0 ? ago(300) : at(k, "08:15"),
      text: d === 13 ? "Slept 7 h. Review before dinner, idafa drills after.\n\n- Felt good about eigenvectors\n" : "Slept, studied, walked.\n" });
  }
  add({ id: "dm-health-sleep", title: "Sleep log", space: S.health, type: "note", updated: 0, text: "Bed by 00:30 on weekdays.\n" });
  add({ id: "dm-health-training", title: "Training plan", space: S.health, type: "note", updated: 0, text: "Run Tue/Thu, gym Sat.\n" });

  // ---------------------------------------------------------------- Inbox (3)
  add({ id: "dm-inbox-videos", title: "Videos to find", space: S.inbox, type: "note", updated: ago(400), created: ago(410), text: "- [ ] Find a good video on KL divergence\n" });
  add({ id: "dm-inbox-linformer", title: "Linformer paper", space: S.inbox, type: "note", updated: at(1, "12:00"), created: at(1, "11:58"), text: "https://arxiv.org/abs/2006.04768\n" });
  add({ id: "dm-inbox-zoo", title: "Idea: optimizer zoo canvas", space: S.inbox, type: "note", updated: ago(380), created: ago(380), text: "One card per optimizer, arrows for “adds to”.\n" });

  // ---------------------------------------------------------------- archived spaces
  add({ id: "dm-arc-calc-1", title: "Epsilon–delta", space: "dm-s-calc", type: "note", updated: 0, text: "Archived.\n" });
  add({ id: "dm-arc-calc-2", title: "Series convergence tests", space: "dm-s-calc", type: "note", updated: 0, text: "Archived.\n" });
  add({ id: "dm-arc-es-1", title: "Ser vs estar", space: "dm-s-spanish", type: "note", updated: 0, text: "Archived.\n" });
  add({ id: "dm-arc-es-2", title: "Numbers & dates", space: "dm-s-spanish", type: "note", updated: 0, text: "Archived.\n" });
  add({ id: "dm-arc-draft-1", title: "Draft: why I take notes in Markdown", space: "dm-s-drafts", type: "post", updated: 0, text: "Never published.\n" });
  add({ id: "dm-arc-draft-2", title: "Draft: a year of flashcards", space: "dm-s-drafts", type: "post", updated: 0, text: "Never published.\n" });

  // ---------------------------------------------------------------- ML root lectures (20) + papers (16)
  const lectures = ["Introduction & course map", "Linear algebra review", "Matrix calculus", "Convex sets & functions", "Convex optimization", "Gradient methods", "Stochastic optimization", "Linear regression", "Logistic regression", "Generalization & bias–variance", "Regularization", "Kernels & SVMs", "Neural networks I", "Neural networks II", "Backpropagation in practice", "Convolutional networks", "Sequence models", "Unsupervised learning", "Probabilistic models", "Review session"];
  lectures.forEach((t, i) => {
    const n = i + 1;
    const status: Status = n <= 14 ? "mastered" : n <= 17 ? "review" : n <= 19 ? "learning" : "todo";
    add({ id: `dm-lecture-${String(n).padStart(2, "0")}`, title: `Lecture ${String(n).padStart(2, "0")} — ${t}`, space: ML, type: "lesson", status, tags: n === 2 || n === 5 ? ["ml", "math"] : ["ml"], updated: 0,
      text: `Notes from lecture ${n}: ${t.toLowerCase()}. Key slides, the derivation I had to redo, and open questions.\n` });
  });
  const papers: [string, Status, boolean][] = [
    ["Paper: Adam (Kingma & Ba, 2014)", "mastered", true], ["Paper: Batch normalization (2015)", "mastered", true], ["Paper: Dropout (2014)", "review", true],
    ["Paper: ResNet (2015)", "mastered", true], ["Paper: Attention is all you need (2017)", "learning", true], ["Paper: Rethinking generalization (2017)", "todo", true],
    ["Paper: Xavier initialization (2010)", "mastered", false], ["Paper: Lottery ticket hypothesis", "learning", false], ["Paper: Deep double descent", "todo", false],
    ["Paper: Sharpness-aware minimization", "todo", false], ["Paper: SGDR — cosine annealing", "review", false], ["Paper: Layer normalization", "mastered", false],
    ["Paper: GELU", "learning", false], ["Paper: Label smoothing", "todo", false], ["Paper: Mixup", "learning", false], ["Paper: Knowledge distillation", "todo", false],
  ];
  papers.forEach(([t, status, ml], i) => add({ id: `dm-paper-${String(i + 1).padStart(2, "0")}`, title: t, space: ML, type: "note", status, tags: ml ? ["ml"] : [], updated: 0,
    text: "Problem, idea, result, and what I'd steal for my own work.\n" }));

  // ---------------------------------------------------------------- study sessions → streak 12 (best 31), 6 h 40 m this week
  const named = new Set(usedDays);
  const minutes = new Map<number, number>();
  const recent: Record<number, number> = { 0: 65, 1: 65, 2: 45, 3: 70, 4: 60, 5: 55, 6: 40, 7: 48, 8: 35, 9: 50, 10: 30, 11: 42 };
  const off = new Set([12, 38, 63, 89, 121]);
  for (let k = 0; k < 140; k++) {
    if (k in recent) { minutes.set(k, recent[k]); continue; }
    if (off.has(k)) continue;
    const idx = 137 - k; // design grid: week 19, day 4 (Fri) = today, Monday-first
    const w = Math.floor(idx / 7), d = ((idx % 7) + 7) % 7;
    let m = [0, 15, 30, 55, 90][lv(w, d)];
    if ((k >= 90 && k <= 120) || named.has(k)) m ||= 20; // a 31-day run in Jul–Aug (best streak), plus every design-dated day
    if (m) minutes.set(k, m);
  }
  // Break any other run that would reach 31 days (best streak stays 31).
  for (let k = 139, run = 0; k >= 13; k--) {
    run = minutes.has(k) ? run + 1 : 0;
    if (run >= 30 && !(k >= 90 && k <= 120) && !named.has(k)) { minutes.delete(k); run = 0; }
  }
  const active = [...minutes.keys()].filter((k) => k >= 13).sort((a, b) => a - b);
  const notesById = new Map(specs.map((s) => [s.id, s]));
  const sessionNotes = [DEMO_IDS.gradientDescent, DEMO_IDS.eigenvectors, "dm-momentum", "dm-backprop", "dm-convexity", "dm-adam", "dm-bayes", DEMO_IDS.idafa];
  const sessions: Session[] = [];
  for (const [k, m] of minutes) {
    if (k === 0) {
      // Today: 1 h 05 min on "Arabic grammar: idafa" (properties panel + calendar).
      for (const [i, [a, mm]] of ([[150, 25], [100, 25], [30, 15]] as const).entries()) sessions.push({ id: `dm-sess-0-${i}`, noteId: DEMO_IDS.idafa, minutes: mm, at: ago(a), updatedAt: ago(a), deleted: 0, dirty: 0 });
      continue;
    }
    const parts = m >= 50 ? [Math.round(m * 0.6), m - Math.round(m * 0.6)] : [m];
    parts.forEach((mm, i) => {
      const t = at(k, i ? "20:40" : "19:00");
      sessions.push({ id: `dm-sess-${k}-${i}`, noteId: k === 7 ? "dm-attention" : sessionNotes[(k + i) % sessionNotes.length], minutes: mm, at: t, updatedAt: t, deleted: 0, dirty: 0 });
    });
  }

  // ---------------------------------------------------------------- notes → records (fillers get dates on active days only)
  let fill = 0;
  const pick = () => active[(fill++ * 7) % active.length];
  const notes: Note[] = specs.map((s) => {
    const type = s.type ?? "note";
    const status = s.status ?? null;
    const updated = s.updated || at(pick(), `${10 + (fill % 9)}:${String((fill * 13) % 60).padStart(2, "0")}`);
    const created = s.created ?? Math.min(updated, updated - (7 + (fill % 23)) * DAY);
    let body = s.body;
    if (body === undefined) {
      const fm: string[] = [];
      if (type !== "note") fm.push(`type: ${type}`);
      if (status) fm.push(`status: ${status}`);
      if (s.tags?.length) fm.push(`tags: [${s.tags.join(", ")}]`);
      for (const [k, v] of Object.entries(s.fm ?? {})) fm.push(`${k}: ${v}`);
      body = `${fm.length ? `---\n${fm.join("\n")}\n---\n` : ""}# ${s.title}\n\n${s.text ?? ""}`;
    }
    const md = type !== "canvas" && type !== "whiteboard" && type !== "roadmap";
    const fmTags = md ? (splitFrontMatter(body).data.tags ?? "").replace(/^\[|\]$/g, "").split(",").map((t) => t.trim()).filter(Boolean) : [];
    const tags = [...new Set([...(s.tags ?? []), ...fmTags, ...(md ? inlineTags(splitFrontMatter(body).body) : [])])];
    return {
      id: s.id, title: s.title, body, spaceId: s.space, folderId: s.folder ?? null, tags, type, status,
      pinned: s.pinned ?? 0, favorite: s.favorite ?? 0, published: s.published ?? 0, slug: s.slug ?? "", props: s.props ?? {},
      createdAt: created, updatedAt: updated, deleted: 0, dirty: 0, shareId: s.shareId ?? null,
    };
  });
  void notesById;

  // Graph density like the design (Lumen 04: "41 notes · 78 links" in this space): generated ML notes link to 1–2 neighbours.
  const ml = notes.filter((n, i) => n.spaceId === S.ml && specs[i].body === undefined && n.type !== "canvas" && n.type !== "whiteboard" && n.type !== "roadmap");
  let extra = 0;
  ml.forEach((n, i) => {
    if (extra >= 34 || ml.length < 3) return;
    const a = ml[(i * 7 + 3) % ml.length], b = ml[(i * 11 + 5) % ml.length];
    const links = [a, b].filter((x) => x.id !== n.id).slice(0, i % 3 === 0 ? 2 : 1);
    if (!links.length) return;
    n.body += `

See also ${links.map((x) => `[[${x.title}]]`).join(", ")}.
`;
    extra += links.length;
  });

  // ---------------------------------------------------------------- versions: Gradient descent · 23 versions (Lumen 04 · 11A/11B)
  const versions: Version[] = [];
  const ver = (i: number, t: number, body: string, label = "") => versions.push({ id: `dm-ver-gd-${String(i).padStart(2, "0")}`, noteId: DEMO_IDS.gradientDescent, title: "Gradient descent", body, label, createdAt: t, updatedAt: t, deleted: 0, dirty: 0 });
  ver(1, ago(29), GD_V_2112);
  ver(2, ago(121), GD_V_2112.replace("\n## More cards", "\n## Cards"), "Before exam rewrite");
  ver(3, at(1, "23:05"), GD_V_2112.split("\n## More cards")[0] + "\n", "");
  ver(4, at(nov(9), "20:18"), GD_V_FIRST + "- [ ] Stochastic GD\n\nWhat does η control? :: The step size.\n");
  ver(5, at(nov(8), "22:30"), GD_V_FIRST + "- [ ] Stochastic GD\n", "Restored from 8 Nov");
  ver(23, at(nov(8), "18:02"), GD_V_FIRST, "First draft");
  const autoDays: [number, string][] = [[1, "21:40"], [1, "20:10"], [1, "18:30"], [2, "22:10"], [2, "21:00"], [2, "19:20"], [3, "22:00"], [3, "20:30"], [nov(9), "22:40"], [nov(9), "21:30"], [nov(9), "19:05"], [nov(8), "23:40"], [nov(8), "21:15"], [nov(8), "20:05"], [nov(8), "19:40"], [nov(8), "18:45"], [nov(8), "18:20"]];
  autoDays.forEach(([k, hm], i) => ver(6 + i, at(k, hm), GD_V_FIRST + "- [ ] Stochastic GD\n".repeat(i % 2)));

  // ---------------------------------------------------------------- flashcards → Card records (23 due now, 14 due tomorrow)
  const tomorrow = new Date(t0);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(9, 0, 0, 0);
  // Review order (sorted by due): eigenvectors ×5, idafa ×1, then the GD η card (7 / 23, “New”), GD ×10, idafa ×3, verb forms ×3.
  const dueOrder: [string, number[]][] = [
    [DEMO_IDS.eigenvectors, [0, 1, 2, 3, 4]], [DEMO_IDS.idafa, [0]], [DEMO_IDS.gradientDescent, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]],
    [DEMO_IDS.idafa, [1, 2, 3]], ["dm-02-verb-forms", [0, 1, 2]],
  ];
  const tomorrowSet: Record<string, number[]> = { "dm-momentum": [0, 1, 2, 3], "dm-convexity": [0, 1, 2, 3, 4], "dm-backprop": [0, 1, 2, 3, 4] };
  const dueAt = new Map<string, number>();
  let order = 0;
  for (const [nid, idxs] of dueOrder) for (const i of idxs) dueAt.set(`${nid}#${i}`, now - (40 - order++) * 60 * MIN);
  const cards: Card[] = [];
  let ci = 0;
  for (const n of notes) {
    if (n.type === "canvas" || n.type === "whiteboard") continue;
    flashcards(n.body).forEach((fc, i) => {
      const key = `${n.id}#${i}`;
      const isNew = n.id === DEMO_IDS.gradientDescent && i === 1;
      let dueT = dueAt.get(key);
      if (dueT === undefined && tomorrowSet[n.id]?.includes(i)) dueT = tomorrow.getTime() + i * MIN;
      dueT ??= t0.getTime() + (3 + (ci % 27)) * DAY + 9 * 60 * MIN;
      const interval = isNew ? 0 : 1 + (ci % 20);
      cards.push({ id: `${n.id}:${fc.key}`, noteId: n.id, ease: 2.3 + (ci % 5) / 10, interval, due: dueT, reps: isNew ? 0 : 1 + (ci % 6), lapses: ci % 7 === 0 ? 1 : 0, updatedAt: Math.min(now - MIN, dueT - interval * DAY), deleted: 0, dirty: 0 });
      ci++;
    });
  }

  // ---------------------------------------------------------------- attachments (Lumen 11 · Settings › Storage, largest files)
  const att = (id: string, name: string, mime: string, size: number): AttachmentMeta => ({ id, name, mime, size, updatedAt: at(nov(5), "20:00"), deleted: 0, dirty: 0 });
  const attachments: AttachmentMeta[] = [
    att("dm-att-entropy", "entropy-per-layer.mp4", "video/mp4", 92 * 1024 * 1024),
    att("dm-att-lecture07", "lecture-07-attention.m4a", "audio/mp4", 61 * 1024 * 1024),
    att("dm-att-backprop-demo", "backprop-demo.webm", "video/webm", 48 * 1024 * 1024),
    att("dm-att-vaswani", "vaswani-2017-attention.pdf", "application/pdf", Math.round(2.1 * 1024 * 1024)),
    att("dm-att-whiteboard-photo", "whiteboard-photo.jpg", "image/jpeg", Math.round(9.8 * 1024 * 1024)),
    att("dm-att-feature-maps", "feature-maps.svg", "image/svg+xml", FEATURE_MAPS_SVG.length),
    att("dm-att-loss-curve", "loss-curve.svg", "image/svg+xml", LOSS_CURVE_SVG.length),
  ];
  const blobs = [
    { id: "dm-att-feature-maps", blob: new Blob([FEATURE_MAPS_SVG], { type: "image/svg+xml" }), uploaded: 1 as const },
    { id: "dm-att-loss-curve", blob: new Blob([LOSS_CURVE_SVG], { type: "image/svg+xml" }), uploaded: 1 as const },
  ];

  // ---------------------------------------------------------------- write
  const tables = [db.spaces, db.notes, db.folders, db.versions, db.cards, db.sessions, db.attachments, db.blobs];
  await db.transaction("rw", tables, async () => {
    await Promise.all(tables.map((t) => t.clear()));
    await db.spaces.bulkPut(spaces);
    await db.folders.bulkPut(folders);
    await db.notes.bulkPut(notes);
    await db.versions.bulkPut(versions);
    await db.cards.bulkPut(cards);
    await db.sessions.bulkPut(sessions);
    await db.attachments.bulkPut(attachments);
    await db.blobs.bulkPut(blobs);
  });
}
