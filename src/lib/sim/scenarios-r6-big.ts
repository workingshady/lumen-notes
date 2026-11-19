// Dev simulator: "AI Engineer · 3,142 notes" (round 6, Lumen 32 Big data + Lumen 22 Scale states).
// One course space with the design's folders and counts (01 Math 84 … Archive 409 = 3,142 notes), sub-folders with
// the notes the design names (Architectures › Attention, Week 9 › Cross-attention, Backprop › Chain rule …), a
// 214-topic skill tree (path over an "AI Engineer roadmap"), a note with 47 videos / 14 diagrams / 212 links, a
// 12,140-word note with 48 headings, a 2,000-row table, 512 cards due after a break and a Today with too much planned.
import { words } from "./content";
import { cardsFor, clock, DAY, emptyVault, folder, MIN, note, rng, session, space, type Vault } from "./kit";

const S = "ai-s";
type FSpec = [id: string, name: string, count: number, parent?: string, named?: string[]];
const FOLDERS: FSpec[] = [
  ["ai-f-math", "01 Math", 84], ["ai-f-ml", "02 ML basics", 226], ["ai-f-dl", "03 Deep learning", 270],
  ["ai-f-opt", "Optimization", 38, "ai-f-dl", ["AdamW", "Momentum and Nesterov", "LR schedules"]],
  ["ai-f-bp", "Backprop", 24, "ai-f-dl", ["Backprop, by hand", "Chain rule", "Backpropagation"]],
  ["ai-f-norm", "Normalization", 19, "ai-f-dl", ["Batch normalization", "Layer norm"]],
  ["ai-f-arch", "Architectures", 61, "ai-f-dl", ["Attention", "Multi-head attention", "Linear attention", "Residual connections"]],
  ["ai-f-nlp", "04 NLP", 293], ["ai-f-w9", "Week 9", 24, "ai-f-nlp", ["Attention variants", "Cross-attention", "attention-is-all.pdf", "Tokenization (BPE)"]], ["ai-f-w10", "Week 10", 31, "ai-f-nlp"],
  ["ai-f-vis", "05 Vision", 190], ["ai-f-proj", "06 Projects", 121], ["ai-f-jr", "Journal", 612], ["ai-f-pap", "Papers", 388, undefined, ["vaswani-shazeer-parmar-uszkoreit-jones-gomez-kaiser-polosukhin-2017-attention.pdf"]],
  ["ai-f-inbox", "Inbox", 42], ["ai-f-ar", "Arabic", 310], ["ai-f-arc", "Archive", 148],
];
const AR_TITLES = ["ملخص محاضرة الانتشار العكسي والتدرجات المحلية في الشبكات العصبية العميقة", "الانتباه متعدد الرؤوس", "ترميز الموضع", "التطبيع الطبقي"];
const LONG_TITLE = "Lecture 11 · Detection and segmentation: R-CNN, Fast R-CNN, Faster R-CNN, Mask R-CNN and YOLO compared";

/** 214 topics across 6 modules (24 + 30 + 42 + 36 + 44 + 38). */
const MODULES: [string, number, string[]][] = [
  ["1 Math", 24, ["Vectors", "Matrices", "Eigenvectors", "Derivatives", "Chain rule (calculus)", "Probability", "Bayes", "Entropy"]],
  ["2 ML basics", 30, ["Linear regression", "Logistic regression", "Loss functions", "Overfitting", "Cross-validation", "Gradient descent"]],
  ["3 Deep learning", 42, ["Augment", "Tokenization", "Embeddings", "Attention", "Transformer", "Seq2seq", "LoRA", "RAG", "Eval", "Prompting", "Backprop", "Batch norm"]],
  ["4 Vision", 36, ["RAG systems", "Eval harness", "Prompting for vision", "Backprop through convs", "Batch norm in CNNs", "Dropout", "Init", "Residuals", "AdamW", "LR schedules", "Regularization", "Clipping"]],
  ["5 NLP", 44, ["Residual streams", "AdamW for LMs", "LR warmup", "Regularization in NLP", "Clipping gradients", "Mixed precision", "Convolution in text", "Pooling", "ResNet", "ViT", "Augment text", "Tokenization (BPE)"]],
  ["6 LLM eng.", 38, ["Pooling heads", "ResNet adapters", "ViT encoders", "Augment prompts", "Tokenization at scale", "Embeddings store", "Attention sinks", "Transformer serving", "Seq2seq eval", "LoRA merging", "RAG pipelines", "Eval suites"]],
];
/** done / learning per module (rest todo; later modules lock behind earlier ones). */
const PROGRESS: [number, number][] = [[24, 0], [30, 0], [11, 2], [2, 1], [1, 1], [0, 0]];

export async function seedR6Big(): Promise<Vault> {
  const c = clock();
  const v = emptyVault();
  const r = rng(3142);
  v.spaces.push(space({ id: S, name: "AI Engineer", kind: "course", icon: "glyph:neural", color: "#A371F7", sort: 1, roadmapId: "ai-roadmap" }));
  v.spaces.push(space({ id: "ai-s-2", name: "Arabic Grammar", kind: "course", icon: "glyph:language", color: "#39C5CF", sort: 2 }));
  FOLDERS.forEach(([id, name, , parent], i) => v.folders.push(folder({ id, spaceId: S, name, parentId: parent ?? null, sort: i })));
  // Notes per folder; ids are sequential so links can point at neighbours in the same folder.
  const ranges: { f: string; from: number; to: number }[] = [];
  let i = 0;
  for (const [fid, fname, count, , named] of FOLDERS) {
    const from = i;
    for (let k = 0; k < count; k++, i++) {
      const title = named?.[k] ?? (fid === "ai-f-ar" && k < AR_TITLES.length ? AR_TITLES[k] : fid === "ai-f-vis" && k === 0 ? LONG_TITLE : `${fname.replace(/^\d+ /, "")} · note ${k + 1}`);
      const type = fid === "ai-f-jr" ? "journal" : fid === "ai-f-pap" ? "note" : k % 5 === 0 ? "lesson" : "note";
      v.notes.push(note({ id: `ai-n-${i}`, title, space: S, folder: fid, type, status: (["todo", "learning", "review", "mastered", null] as const)[k % 5], tags: [fname.replace(/^\d+ /, "").toLowerCase().replace(/\s+/g, "-"), `t${k % 12}`], text: "", updated: c.now - Math.floor(r.next() * 300) * DAY - r.int(0, 900) * MIN }));
    }
    ranges.push({ f: fid, from, to: i });
  }
  const at = (fid: string) => ranges.find((x) => x.f === fid)!;
  const pick = (fid: string) => { const x = at(fid); return x.from + r.int(0, x.to - x.from - 1); };
  // Cross-folder link weights (design: 03 Deep learning ↔ 04 NLP is the thickest).
  const CROSS: [string, string, number][] = [["ai-f-math", "ai-f-dl", 60], ["ai-f-ml", "ai-f-dl", 80], ["ai-f-arch", "ai-f-nlp", 70], ["ai-f-w9", "ai-f-arch", 48], ["ai-f-dl", "ai-f-vis", 50], ["ai-f-nlp", "ai-f-ar", 30], ["ai-f-dl", "ai-f-pap", 60], ["ai-f-ml", "ai-f-pap", 30], ["ai-f-vis", "ai-f-arc", 20], ["ai-f-proj", "ai-f-nlp", 30], ["ai-f-jr", "ai-f-dl", 40]];
  const links = new Map<number, Set<number>>();
  const link = (a: number, b: number) => { if (a !== b) (links.get(a) ?? links.set(a, new Set()).get(a)!).add(b); };
  for (const x of ranges) for (let n = x.from; n < x.to; n++) for (let k = 0; k < 2; k++) link(n, x.from + r.int(0, x.to - x.from - 1));
  for (const [a, b, w] of CROSS) for (let k = 0; k < w; k++) link(pick(a), pick(b));
  // Hubs: Backpropagation, Attention, AdamW get many backlinks.
  const hub = (title: string) => v.notes.findIndex((n) => n.title === title);
  for (const h of ["Backpropagation", "Attention", "AdamW"]) { const hi = hub(h); for (let k = 0; k < 40; k++) link(pick(k % 2 ? "ai-f-dl" : "ai-f-nlp"), hi); }
  v.notes.forEach((n, k) => {
    const out = [...(links.get(k) ?? [])].map((j) => `[[${v.notes[j].title}]]`);
    n.body += `${words(30 + (k % 50), false)}\n\nSee ${out.join(" · ")}\n`;
  });

  // ---- 214-topic skill tree: a roadmap course + the path over it
  let rm = "# AI Engineer roadmap\n";
  let pathBody = `---\ntype: path\ncourses: [AI Engineer roadmap]\n---\n# AI Engineer skill tree\n\n214 topics across 6 modules.\n`;
  MODULES.forEach(([mod, count, names], mi) => {
    const [done, learning] = PROGRESS[mi];
    rm += `\n## ${mod}\n`;
    pathBody += `\n## ${mod}\n`;
    for (let k = 0; k < count; k++) {
      const name = names[k] ?? `${mod.replace(/^\d+ /, "")} topic ${k + 1}`;
      const st = k < done ? "x" : k < done + learning ? "/" : " ";
      rm += `- [${st}] ${name}${mi >= 3 && st === " " ? " (needs: Deep learning topic 42)" : ""}\n`;
      pathBody += `- ${name}\n`;
    }
  });
  v.notes.push(note({ id: "ai-roadmap", title: "AI Engineer roadmap", space: S, type: "roadmap", body: rm, updated: c.ago(300) }));
  v.notes.push(note({ id: "ai-path", title: "AI Engineer skill tree", space: S, type: "path", body: pathBody, updated: c.ago(30), pinned: 1 }));

  // ---- One note with 47 videos, 14 diagrams, 212 links
  const vids: string[] = [];
  const YT = ["aircAruvnKk", "IHZwWFHWa-w", "Ilg3gGewQ5U", "tIeHLnjs5U8", "kCc8FmEb1nY", "VMj-3S1tku0", "zjkBMFhNj_g", "wjZofJX0v4M", "eMlx5fFNoYc", "9-Jl0dxWQs8"];
  const vt = ["CS224n L", "Karpathy · GPT", "3B1B · ch.", "Lecture ", "Podcast ep."];
  for (let k = 0; k < 31; k++) vids.push(`## ${vt[k % 3]}${k + 1}\n\nhttps://www.youtube.com/watch?v=${YT[k % YT.length]}${k >= YT.length ? `&t=${k * 30}` : ""}\n`);
  for (let k = 0; k < 9; k++) vids.push(`## Lecture ${k + 3}.mp4\n\n![Lecture ${k + 3}](https://example.com/media/lecture-${k + 3}.mp4)\n`);
  for (let k = 0; k < 5; k++) vids.push(`## Podcast ep.${40 + k}\n\n![Podcast ${40 + k}](https://example.com/media/podcast-${40 + k}.mp3)\n`);
  for (let k = 0; k < 2; k++) vids.push(`## Broken recording ${k + 1}\n\n![Recording](attachment:missing-video-${k}.webm)\n`);
  const diagrams = Array.from({ length: 14 }, (_, k) => `\`\`\`mermaid\nflowchart LR\n  A${k}[Input] --> B${k}[Layer ${k + 1}] --> C${k}[Output]\n\`\`\`\n`);
  const lnk = Array.from({ length: 212 }, (_, k) => (k % 2 ? `[[${v.notes[(k * 13) % 3000].title}]]` : `[Reading ${k + 1}](https://example.com/reading/${k + 1})`));
  v.notes.push(note({ id: "ai-videos", title: "Video lectures index", space: S, folder: "ai-f-dl", type: "lesson", text: `${vids.join("\n")}\n## Diagrams\n\n${diagrams.join("\n")}\n## Links\n\n${lnk.map((l) => `- ${l}`).join("\n")}\n`, updated: c.ago(15), pinned: 1 }));

  // ---- 12,140-word note with 48 headings ("Attention is all you need" study notes)
  const secs = ["Introduction", "Background", "Model architecture", "Attention", "Training", "Results", "Analysis", "Ablations", "Related work", "Conclusion", "Appendix A", "Appendix B"];
  const subs = ["Scaled dot-product", "Multi-head attention", "Positional encoding"];
  let long = "";
  let wc = 0;
  secs.forEach((s, si) => {
    long += `\n## ${si + 1} ${s}\n\n${words(250, false)}\n`; wc += 250;
    subs.forEach((x, k) => { const n = si === 3 && k === 1 ? 1840 : 250; long += `\n### ${si + 1}.${k + 1} ${si === 3 ? x : `${s} part ${k + 1}`}\n\n${si === 3 && k === 1 ? "Instead of one attention function, we project queries, keys and values h times with different learned projections. " : ""}${words(n, false)}\n`; wc += n; });
  });
  long += `\n${words(12140 - wc - 40, false)}\n`;
  v.notes.push(note({ id: "ai-long", title: "Attention is all you need · study notes", space: S, folder: "ai-f-pap", type: "lesson", text: long.trim(), updated: c.ago(40) }));

  // ---- 2,000-row table
  const models = ["Transformer (big)", "Transformer (base)", "ConvS2S", "ByteNet", "GNMT + RL", "MoE"];
  const rows = Array.from({ length: 2000 }, (_, k) => `| ${k < 6 ? models[k] : `Run ${k + 1}`} | ${k < 2 ? ["213M", "65M"][k] : `${10 + (k % 300)}M`} | ${(20 + ((k * 37) % 90) / 10).toFixed(1)} | ${k < 2 ? ["300k", "100k"][k] : `${(k % 50) * 10}k`} |`);
  v.notes.push(note({ id: "ai-table", title: "Benchmark results", space: S, folder: "ai-f-pap", text: `Benchmark results · 2,000 rows\n\n| Model | Params | BLEU | Steps |\n|---|---|---|---|\n${rows.join("\n")}\n`, updated: c.ago(50) }));

  // ---- 512 cards due after a break (256 flashcard notes × 2 cards)
  const decks: ReturnType<typeof note>[] = [];
  for (let k = 0; k < 256; k++) {
    decks.push(note({ id: `ai-fc-${k}`, title: `Deck ${Math.floor(k / 16) + 1} · cards ${k + 1}`, space: S, folder: "ai-f-ml", type: "flashcards", text: `Term ${k}a? :: Definition ${k}a.\nTerm ${k}b? :: Definition ${k}b.\n`, updated: c.ago(60 * 24 * 20) }));
  }
  v.notes.push(...decks);
  v.cards = cardsFor(decks, c, () => "due").map((cd, k) => ({ ...cd, due: c.now - (2 + (k % 12)) * DAY }));
  // A break: nothing for 12 days, sessions before.
  for (let d = 12; d < 60; d++) v.sessions.push(session(`ai-sess-${d}`, `ai-n-${d}`, 25 + (d % 40), c.at(d, "19:00")));
  return v;
}
