// A small, real, multi-page PDF for the demo vault ("vaswani-2017-attention.pdf"), built by hand (no dependencies):
// about 15 pages of original study-guide text about attention (no text from the paper itself), Times body text with exact
// /Widths so highlight rects can be computed here, Helvetica headings, vector figures and a bookmark outline.
// `demoPdf()` returns the bytes plus `find(phrase)` (page + rects) for seeding highlights at the right place.
import type { Rect } from "./pdf-format";

const W = 612, H = 792, ML = 54, MR = 54, TOP = 54, BOTTOM = 64, BODY = 14, LEAD = 21;
// Times-Roman advance widths (AFM, 1/1000 em) for ASCII 32…126.
const TIMES = [250, 333, 408, 500, 500, 833, 778, 333, 333, 333, 500, 564, 250, 333, 250, 278, 500, 500, 500, 500, 500, 500, 500, 500, 500, 500, 278, 278, 564, 564, 564, 444, 921,
  722, 667, 667, 722, 611, 556, 722, 722, 333, 389, 722, 611, 889, 722, 722, 556, 722, 667, 556, 611, 722, 722, 944, 722, 722, 611, 333, 278, 333, 469, 500, 333,
  444, 500, 444, 500, 444, 333, 500, 500, 278, 278, 500, 278, 778, 500, 500, 500, 500, 333, 389, 278, 500, 500, 722, 500, 500, 444, 480, 200, 480, 541];
// WinAnsi extras used in the text: en dash, middle dot, curly quotes, multiplication sign.
const EXTRA: Record<string, [number, number]> = { "–": [0x96, 500], "·": [0xb7, 250], "“": [0x93, 444], "”": [0x94, 444], "’": [0x92, 333], "×": [0xd7, 564] };
const cw = (ch: string) => { const c = ch.charCodeAt(0); return c >= 32 && c <= 126 ? TIMES[c - 32] : EXTRA[ch]?.[1] ?? 500; };
const tw = (s: string, size: number) => [...s].reduce((a, ch) => a + cw(ch), 0) * size / 1000;
const enc = (s: string) => [...s].map((ch) => { const e = EXTRA[ch]; const b = e ? e[0] : ch.charCodeAt(0) < 128 ? ch.charCodeAt(0) : 63; const c = String.fromCharCode(b); return c === "(" || c === ")" || c === "\\" ? "\\" + c : c; }).join("");

type Block = { h: string; lvl?: 1 | 2 } | { p: string } | { fig: "attention" | "heads" | "bars"; cap: string } | { title: string; sub: string };

// ------------------------------------------------------------------ content (original text)
const PAGES: Block[][] = [
  [{ title: "Attention Is All You Need", sub: "A study edition written for the Lumen demo · 15 pages" },
    { h: "Abstract" },
    { p: "This booklet retells, in plain words, the ideas behind the Transformer: a sequence model that drops recurrence and convolution and relies on attention alone. It is an original summary written for practice with highlights, cards and canvases; it quotes nothing from the paper it describes." },
    { p: "Each section is short. Read one page, highlight what you would want to remember in a month, and turn the important lines into cards. The later pages hold exercises and a glossary, so the outline on the left has something to show." },
    { h: "1 Introduction" },
    { p: "Before attention models, most sequence work ran on recurrent networks. A recurrent network reads one token at a time and carries a hidden state forward, which makes long sentences slow to train because every step waits for the previous one." },
    { p: "Attention lets every position look at every other position in one step. The cost moves from time to memory, and the work becomes a few large matrix products that a graphics card runs well." }],
  [{ h: "1.1 Why this matters" },
    { p: "Parallel training changed what was affordable. Models that once needed weeks could be trained in days, and that in turn made it possible to try many more ideas, larger data sets and deeper stacks." },
    { p: "The second gain is the path length between two words. In a recurrent network, information from the first word must survive many steps to reach the last one. With attention the path is a single hop, so long-range relations are easier to learn." },
    { p: "Keep both gains in mind while reading: speed from parallel matrix products, and short paths between any two positions. Most design choices in the next sections serve one of these two goals." },
    { h: "1.2 How to read this booklet" },
    { p: "Sections 2 and 3 describe the model. Section 4 compares it with recurrence and convolution. Section 5 covers training, section 6 the results and section 7 what the design leaves open. The appendix has worked examples." }],
  [{ h: "2 Background" },
    { p: "Earlier work already reduced sequential computation with convolutions, which look at a fixed window of neighbours. To relate two distant words a convolutional model must stack many layers, so the path still grows with distance." },
    { p: "Self-attention, sometimes called intra-attention, relates different positions of one sequence to compute a representation of that same sequence. It had been used for reading comprehension and summarization before it became the whole model." },
    { h: "3 Model architecture" },
    { p: "The model keeps the familiar encoder and decoder. The encoder turns the input tokens into a sequence of vectors; the decoder produces the output one token at a time, looking at the encoder output and at what it has already written." },
    { h: "3.1 Encoder and decoder stacks", lvl: 2 },
    { p: "Both sides are stacks of identical layers, six in the base model. Each encoder layer has two parts: multi-head self-attention, then a small feed-forward network. Every part is wrapped in a residual connection followed by layer normalization." }],
  [{ h: "3.2 Attention", lvl: 2 },
    { p: "An attention function takes a query and a collection of key and value pairs and returns one vector. The output is computed as a weighted sum of the values, and each weight says how well the query matches the matching key." },
    { h: "3.2.1 Scaled dot-product attention", lvl: 2 },
    { p: "The version used here is called scaled dot-product attention. Queries and keys have dimension d_k and values have dimension d_v. We compute the dot products of the query with all keys, divide each by sqrt(d_k), and apply a softmax function to obtain the weights." },
    { fig: "attention", cap: "Figure 2 · Scaled dot-product attention" },
    { p: "In matrix form, Attention(Q, K, V) = softmax(Q K^T / sqrt(d_k)) V. Without the division, large dot products push the softmax into regions where its gradient is tiny and learning stalls." }],
  [{ h: "3.2.2 Multi-head attention", lvl: 2 },
    { p: "One attention function averages everything it sees. Multi-head attention allows the model to jointly attend to information from different subspaces: the queries, keys and values are projected several times with different learned matrices, and each projection gets its own attention." },
    { fig: "heads", cap: "Figure 3 · Eight heads run side by side, then concatenate" },
    { p: "The base model uses eight heads of size 64. Because each head is smaller, the total cost is close to one full-size scaled dot-product attention, yet each head can specialise in a different relation." }],
  [{ h: "3.2.3 Three uses of attention", lvl: 2 },
    { p: "Encoder self-attention lets each input position look at all input positions. Decoder self-attention does the same over the output so far, with a mask so a position never sees the future. Encoder-decoder attention lets each output position look at the whole input." },
    { h: "3.3 Position-wise feed-forward networks", lvl: 2 },
    { p: "After attention, every position passes through the same two-layer network: a linear map to 2048 units, a ReLU, and a linear map back to 512. The weights are shared across positions but differ from layer to layer." },
    { h: "3.4 Embeddings and softmax", lvl: 2 },
    { p: "Tokens become vectors through a learned embedding, and the decoder output becomes next-token probabilities through a linear layer and a softmax. The input and output embeddings share their weights." }],
  [{ h: "3.5 Positional encoding", lvl: 2 },
    { p: "Attention by itself ignores order: shuffle the tokens and the weighted sums stay the same. To give the model a sense of position, a vector that depends on the position is added to each embedding." },
    { p: "The encoding uses sine and cosine waves of different wavelengths. Each dimension is a wave; together they give every position a unique pattern, and a fixed offset between two positions becomes a simple linear function." },
    { p: "Learned position vectors work about as well. The waves were kept because they might extend to sequences longer than any seen in training." },
    { h: "Margin note" },
    { p: "If you remember one thing from this page: order enters the model only through what is added to the embeddings. Everything after that is order-blind." }],
  [{ h: "4 Why self-attention" },
    { p: "Three costs decide whether a layer suits long sequences: the total work per layer, how much of it can run in parallel, and the longest path a signal travels between two positions." },
    { fig: "bars", cap: "Figure 4 · Path length between two positions, by layer type" },
    { p: "Self-attention connects all positions with a constant number of steps. Recurrence needs a number of steps that grows with the length. Convolution sits between the two and depends on the kernel width." },
    { p: "A side benefit is that attention weights can be inspected. Some heads clearly track syntax, others track which word a pronoun refers to." }],
  [{ h: "5 Training" },
    { p: "The models were trained on sentence pairs for English to German and English to French translation. Sentences were split into sub-word pieces so rare words could still be represented." },
    { h: "5.1 Optimizer", lvl: 2 },
    { p: "We used the Adam optimizer with beta1 = 0.9, beta2 = 0.98 and a learning rate that first rises linearly for a warm-up period and then decays with the inverse square root of the step number." },
    { h: "5.2 Regularization", lvl: 2 },
    { p: "Dropout is applied to the output of each sub-layer and to the sums of embeddings and positional encodings. Label smoothing makes the model less sure of itself, which hurts perplexity but improves the translation score." },
    { p: "Scaled dot-product attention appears again here: it is cheap enough that the whole stack trains in about half a day for the base model." }],
  [{ h: "6 Results" },
    { p: "On both translation tasks the large model beat the earlier best systems, including ensembles, at a fraction of their training cost. The base model was already competitive." },
    { p: "Changing the number of heads matters: one head is clearly worse, and too many heads also lose quality. Smaller key sizes hurt, which suggests that judging compatibility is not trivial." },
    { h: "6.1 Model variations", lvl: 2 },
    { p: "Bigger models are better, and dropout is important against overfitting. Replacing the sine waves with learned positions gives nearly identical results." }],
  [{ h: "6.2 Beyond translation", lvl: 2 },
    { p: "To test generality the model was applied to English constituency parsing, a task with strong structure and long outputs. With little tuning it performed well, even with small training sets." },
    { p: "The lesson many readers took away: the architecture is not tied to translation. Later work reused the encoder alone, the decoder alone, or both, for text, images, audio and code." }],
  [{ h: "7 Conclusion" },
    { p: "The Transformer replaces recurrence with attention. It trains faster, connects distant positions in one step, and reaches better quality on translation." },
    { p: "Open questions at the time: attention over very long inputs is expensive because every position looks at every other position, and generation is still one token at a time." },
    { h: "Further reading" },
    { p: "Look for an illustrated walkthrough of the architecture, a lecture on sequence models, and any annotated implementation that builds the model line by line." }],
  [{ h: "Appendix A · Worked example" },
    { p: "Take three tokens with two-dimensional keys and queries. Compute each query-key dot product, divide by sqrt(2), apply the softmax along each row, and multiply by the values. Check that every row of weights sums to one." },
    { p: "Now double every key. The dot products double, the softmax gets sharper, and one value dominates each output. This is exactly what the scaling factor is there to prevent as d_k grows." }],
  [{ h: "Appendix B · Exercises" },
    { p: "1. Why does the decoder need a mask in self-attention but not in encoder-decoder attention?" },
    { p: "2. What would happen to the model if positional encodings were removed?" },
    { p: "3. Count the parameters of one encoder layer of the base model." },
    { p: "4. Explain in one sentence why multi-head attention costs about the same as single-head attention." }],
  [{ h: "Appendix C · Glossary" },
    { p: "Query, key, value: three projections of a token. The query asks, the keys answer how relevant they are, the values carry the content that gets mixed." },
    { p: "Head: one attention function with its own projections. Layer normalization: rescales each vector to zero mean and unit variance. Residual connection: adds the input of a sub-layer to its output." },
    { p: "Warm-up: the first steps of training, when the learning rate grows from zero." }],
];

/** Bookmarks: heading text (as in PAGES) → children. Pages are looked up from the layout. */
const OUTLINE: { t: string; kids?: string[] }[] = [
  { t: "Abstract" }, { t: "1 Introduction" }, { t: "2 Background" },
  { t: "3 Model architecture", kids: ["3.1 Encoder and decoder stacks", "3.2 Attention", "3.2.2 Multi-head attention", "3.3 Position-wise feed-forward networks", "3.5 Positional encoding"] },
  { t: "4 Why self-attention" }, { t: "5 Training" }, { t: "6 Results" }, { t: "7 Conclusion" },
  { t: "Appendix A · Worked example" }, { t: "Appendix B · Exercises" }, { t: "Appendix C · Glossary" },
];

// ------------------------------------------------------------------ layout
interface Line { page: number; x: number; base: number; size: number; text: string }

function wrap(text: string, size: number, width: number): string[] {
  const out: string[] = [];
  let cur = "";
  for (const w of text.split(" ")) {
    const t = cur ? cur + " " + w : w;
    if (tw(t, size) > width && cur) { out.push(cur); cur = w; } else cur = t;
  }
  if (cur) out.push(cur);
  return out;
}

function figure(kind: string, x: number, top: number): { ops: string; h: number } {
  const y = (v: number) => H - (top + v);
  const box = (bx: number, by: number, bw: number, bh: number, label: string) =>
    `0.96 0.95 0.92 rg ${bx} ${y(by + bh)} ${bw} ${bh} re B BT /F2 8 Tf 0.12 g ${bx + bw / 2 - label.length * 2.1} ${y(by + bh / 2 + 3)} Td (${enc(label)}) Tj ET `;
  const line = (x1: number, y1: number, x2: number, y2: number) => `${x1} ${y(y1)} m ${x2} ${y(y2)} l S `;
  let ops = "q 0.55 0.52 0.47 RG 0.8 w ";
  let h = 150;
  if (kind === "attention") {
    const cx = x + 252;
    [["MatMul", 10], ["SoftMax", 38], ["Mask (opt.)", 66], ["Scale", 94], ["MatMul", 122]].forEach(([l, by]) => { ops += box(cx - 45, by as number, 90, 18, l as string); });
    for (let i = 0; i < 4; i++) ops += line(cx, 28 + i * 28, cx, 38 + i * 28);
    ops += line(cx - 25, 140, cx - 25, 150) + line(cx + 25, 140, cx + 25, 150) + line(cx + 70, 19, cx + 70, 150) + line(cx + 70, 19, cx + 45, 19);
    ops += `BT /F2 8 Tf 0.12 g ${cx - 30} ${y(160)} Td (Q) Tj 26 0 Td (K) Tj 44 0 Td (V) Tj ET `;
    h = 170;
  } else if (kind === "heads") {
    for (let i = 0; i < 8; i++) ops += box(x + 20 + i * 54, 40, 46, 40, `head ${i + 1}`);
    ops += box(x + 150, 6, 170, 18, "Concat + linear") + box(x + 150, 100, 170, 18, "Linear projections of Q, K, V");
    for (let i = 0; i < 8; i++) ops += line(x + 43 + i * 54, 80, x + 235, 100) + line(x + 43 + i * 54, 40, x + 235, 24);
    h = 130;
  } else {
    const bars: [string, number][] = [["Self-attention", 40], ["Convolution", 160], ["Recurrent", 380]];
    bars.forEach(([l, w], i) => { ops += `0.89 0.70 0.25 rg ${x + 110} ${y(14 + i * 34 + 20)} ${w} 20 re f BT /F2 9 Tf 0.12 g ${x + 10} ${y(14 + i * 34 + 14)} Td (${enc(l)}) Tj ET `; });
    h = 120;
  }
  return { ops: ops + "Q ", h };
}

function layout() {
  const lines: Line[] = [];
  const pageOps: string[] = [];
  const figs = new Map<string, { page: number; r: Rect }>();
  const heads = new Map<string, number>();
  let page = 0, top = TOP, ops = "";
  const flush = () => { if (!page) return; ops += `BT /F1 10 Tf 0.1 g ${W / 2 - 3} 36 Td (${page}) Tj ET\n`; pageOps.push(ops); };
  const newPage = () => { flush(); page++; top = TOP; ops = ""; };
  const need = (h: number) => { if (top + h > H - BOTTOM && top > TOP) newPage(); };
  const text = (font: string, size: number, x: number, base: number, s: string) => { ops += `BT /${font} ${size} Tf 0.1 g ${x.toFixed(2)} ${(H - base).toFixed(2)} Td (${enc(s)}) Tj ET\n`; };
  for (const blocks of PAGES) {
    if (top > TOP || !page) newPage();
    for (const b of blocks) {
      if ("title" in b) {
        top += 44; text("F3", 26, (W - b.title.length * 13.6) / 2, top, b.title);
        top += 28; text("F1", 13, (W - tw(b.sub, 13)) / 2, top, b.sub); top += 30;
      } else if ("h" in b) {
        const size = b.lvl === 2 ? 14.5 : 18;
        need(size + 14 + LEAD * 2);
        if (top > TOP) top += b.lvl === 2 ? 8 : 12;
        text("F3", size, ML, top + size * 0.8, b.h); top += size + 12;
        if (!heads.has(b.h)) heads.set(b.h, page);
      } else if ("p" in b) {
        for (const l of wrap(b.p, BODY, W - ML - MR)) { need(LEAD); const base = top + BODY * 0.85; text("F1", BODY, ML, base, l); lines.push({ page, x: ML, base, size: BODY, text: l }); top += LEAD; }
        top += 9;
      } else {
        const f0 = figure(b.fig, ML, 0);
        need(f0.h + 44);
        top += 8;
        const f = figure(b.fig, ML, top);
        if (!figs.has(b.fig)) figs.set(b.fig, { page, r: [ML / W, top / H, (W - ML - MR) / W, f.h / H] });
        ops += f.ops + `q 0.62 0.6 0.56 RG 0.6 w ${ML} ${H - top - f.h} ${W - ML - MR} ${f.h} re S Q\n`;
        top += f.h + 18; text("F2", 11, (W - b.cap.length * 5.6) / 2, top, b.cap); top += 22;
      }
    }
  }
  flush();
  return { lines, pageOps, figs, heads };
}

// ------------------------------------------------------------------ PDF objects
export interface DemoPdf { bytes: Uint8Array; pages: number; find: (phrase: string) => { page: number; rects: Rect[] }; fig: (kind: Fig) => { page: number; rect: Rect } }
type Fig = "attention" | "heads" | "bars";

let cached: DemoPdf | null = null;
export function demoPdf(): DemoPdf {
  if (cached) return cached;
  const { lines, pageOps, figs, heads } = layout();
  const n = pageOps.length;
  // object numbers: 1 catalog, 2 pages, 3-5 fonts, 6 outlines root, then per page (page, content), then outline items
  const objs: string[] = [];
  const pageObj = (i: number) => 7 + i * 2;
  const widths = Array.from({ length: 224 }, (_, k) => { const c = k + 32; if (c <= 126) return TIMES[c - 32]; const e = Object.values(EXTRA).find(([b]) => b === c); return e ? e[1] : 500; });
  objs[1] = `<< /Type /Catalog /Pages 2 0 R /Outlines 6 0 R /PageMode /UseOutlines >>`;
  objs[2] = `<< /Type /Pages /Count ${n} /Kids [${Array.from({ length: n }, (_, i) => `${pageObj(i)} 0 R`).join(" ")}] >>`;
  objs[3] = `<< /Type /Font /Subtype /Type1 /BaseFont /Times-Roman /Encoding /WinAnsiEncoding /FirstChar 32 /LastChar 255 /Widths [${widths.join(" ")}] >>`;
  objs[4] = `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>`;
  objs[5] = `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>`;
  pageOps.forEach((ops, i) => {
    objs[pageObj(i)] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R /F3 5 0 R >> >> /Contents ${pageObj(i) + 1} 0 R >>`;
    objs[pageObj(i) + 1] = `<< /Length ${ops.length} >>\nstream\n${ops}\nendstream`;
  });
  let next = 7 + n * 2;
  const str = (s: string) => `(${enc(s)})`;
  const dest = (p: number) => `[${pageObj(p - 1)} 0 R /XYZ 0 ${H} 0]`;
  const items = (list: { t: string; kids?: string[] }[], parent: number): [number, number, number] => {
    const ids = list.map(() => next++);
    let count = 0;
    list.forEach((it, i) => {
      let kids = "";
      if (it.kids?.length) { const [f, l, c] = items(it.kids.map((t) => ({ t })), ids[i]); kids = ` /First ${f} 0 R /Last ${l} 0 R /Count ${c}`; count += c; }
      objs[ids[i]] = `<< /Title ${str(it.t)} /Parent ${parent} 0 R /Dest ${dest(heads.get(it.t) ?? 1)}${i ? ` /Prev ${ids[i - 1]} 0 R` : ""}${i < ids.length - 1 ? ` /Next ${ids[i + 1]} 0 R` : ""}${kids} >>`;
      count++;
    });
    return [ids[0], ids[ids.length - 1], count];
  };
  const [first, last, count] = items(OUTLINE, 6);
  objs[6] = `<< /Type /Outlines /First ${first} 0 R /Last ${last} 0 R /Count ${count} >>`;
  objs[next] = `<< /Title (Attention Is All You Need \\(study edition\\)) /Author (Lumen demo) /Producer (Lumen) >>`;
  const info = next;
  let out = "%PDF-1.4\n%\xe2\xe3\xcf\xd3\n";
  const offs: number[] = [];
  for (let i = 1; i < objs.length; i++) { offs[i] = out.length; out += `${i} 0 obj\n${objs[i]}\nendobj\n`; }
  const xref = out.length;
  out += `xref\n0 ${objs.length}\n0000000000 65535 f \n` + offs.slice(1).map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("");
  out += `trailer\n<< /Size ${objs.length} /Root 1 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  const bytes = new Uint8Array(out.length);
  for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 0xff;

  const r4 = (v: number) => Math.round(v * 10000) / 10000;
  const find = (phrase: string) => {
    for (let page = 1; page <= n; page++) {
      const pl = lines.filter((l) => l.page === page);
      const at = pl.map((l) => l.text).join(" ").indexOf(phrase);
      if (at < 0) continue;
      const rects: Rect[] = [];
      let o = 0;
      for (const l of pl) {
        const a = Math.max(at, o), b = Math.min(at + phrase.length, o + l.text.length);
        if (a < b) {
          const x = l.x + tw(l.text.slice(0, a - o), l.size), w = tw(l.text.slice(a - o, b - o), l.size);
          rects.push([r4(x / W), r4((l.base - l.size * 0.9) / H), r4(w / W), r4((l.size * 1.15) / H)]);
        }
        o += l.text.length + 1;
      }
      return { page, rects };
    }
    return { page: 1, rects: [] };
  };
  return (cached = { bytes, pages: n, find, fig: (k) => { const f = figs.get(k); return { page: f?.page ?? 1, rect: (f?.r ?? [0.2, 0.4, 0.6, 0.2]).map(r4) as Rect }; } });
}
