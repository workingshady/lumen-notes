// Dev simulator scenario: a learning path built on three overlapping courses.
import { autoOrganize, buildPath, parsePath, resolveCourses, serializePath, type BuiltPath } from "../path";
import { clock, emptyVault, INBOX, note, space, type Vault } from "./kit";

const ML = `## 01 Linear algebra
- [x] Vectors & norms → [[Vectors and norms]]
- [x] Matrix multiplication
- [/] Eigenvectors (needs: Matrix multiplication)
## 02 Optimization
- [x] Loss functions
- [/] Gradient descent (needs: Matrix multiplication) 📅 {d3}
- [ ] Momentum & Nesterov (needs: Gradient descent) 📅 {d8}
- [ ] Learning rate schedules (needs: Gradient descent) 📅 {d12}
## 03 Neural networks
- [x] Perceptron
- [ ] Backpropagation (needs: Gradient descent) 📅 {d16} → [[Backpropagation]]
- [ ] Regularization & dropout (needs: Backpropagation)
`;
const CS231N = `## Lecture 1–3 · Foundations
- [x] Image classification
- [x] Linear classifiers (needs: Image classification)
- [x] Loss functions
- [x] Linear algebra review
## Lecture 4–6 · Training
- [/] Optimization: SGD (needs: Loss functions) 📅 {d2}
- [ ] Backpropagation (needs: Optimization: SGD) 📅 {d9}
- [ ] Neural networks (needs: Backpropagation)
- [ ] Training tricks: dropout & batch norm (needs: Neural networks) 📅 {d20}
## Lecture 7–9 · Vision
- [ ] CNNs (needs: Neural networks) 📅 {d25}
- [ ] CNN architectures (needs: CNNs)
`;
const FASTAI = `## Part 1 · Getting started
- [x] Your first model
- [x] From model to production
## Part 2 · Under the hood
- [x] SGD from scratch
- [/] Neural net foundations (needs: SGD from scratch) 📅 {d4}
- [ ] Learning rate finder (needs: SGD from scratch) 📅 {d10}
- [ ] Backprop by hand (needs: Neural net foundations)
## Part 3 · Applications
- [ ] Transfer learning (needs: Your first model)
- [ ] Convolutions (needs: Backprop by hand) 📅 {d24}
`;

export async function seedPaths(): Promise<Vault> {
  const c = clock();
  const fill = (s: string) => s.replace(/\{d(\d+)\}/g, (_, n) => c.iso(Number(n)));
  const v = emptyVault();
  v.spaces.push(
    INBOX,
    space({ id: "lp-s-ml", name: "ML Foundations", kind: "course", icon: "🧠", color: "6", roadmapId: "lp-rm-ml", props: { provider: "Coursera · Stanford Online" }, sort: 1 }),
    space({ id: "lp-s-cs", name: "CS231n", kind: "course", icon: "👁️", color: "5", roadmapId: "lp-rm-cs", props: { provider: "Stanford · YouTube lectures", url: "https://cs231n.stanford.edu/" }, sort: 2 }),
    space({ id: "lp-s-fa", name: "fast.ai Practical DL", kind: "course", icon: "⚡", color: "2", roadmapId: "lp-rm-fa", props: { provider: "fast.ai", url: "https://course.fast.ai/" }, sort: 3 }),
  );
  v.notes.push(
    note({ id: "lp-rm-ml", title: "ML Foundations roadmap", space: "lp-s-ml", type: "roadmap", body: fill(ML), updated: c.ago(90) }),
    note({ id: "lp-rm-cs", title: "CS231n roadmap", space: "lp-s-cs", type: "roadmap", body: fill(CS231N), updated: c.ago(300) }),
    note({ id: "lp-rm-fa", title: "fast.ai roadmap", space: "lp-s-fa", type: "roadmap", body: fill(FASTAI), updated: c.ago(800) }),
    note({ id: "lp-n-bp", title: "Backpropagation", space: "lp-s-ml", type: "lesson", status: "todo", text: "Chain rule over the computation graph.\n\nKarpathy builds it from scratch (micrograd):\n\nhttps://www.youtube.com/watch?v=VMj-3S1tku0\n\nCS231n notes: [Backprop intuition](https://cs231n.github.io/optimization-2/)\n" }),
    note({ id: "lp-n-vec", title: "Vectors and norms", space: "lp-s-ml", type: "lesson", status: "mastered", text: "L1, L2 and max norms.\n\n[3Blue1Brown: Vectors](https://www.youtube.com/watch?v=fNk_zzaMoSs)\n" }),
    note({ id: "lp-n-gd", title: "Gradient descent", space: "lp-s-cs", type: "lesson", status: "learning", text: "Step against the gradient.\n\nhttps://www.youtube.com/watch?v=IHZwWFHWa-w\n\n[fast.ai lesson 3](https://course.fast.ai/Lessons/lesson3.html)\n" }),
  );
  // the path: auto-organized, then a few manual touches (merges, resources, revision state)
  const courses = ["ML Foundations", "CS231n", "fast.ai Practical DL"];
  const refs = resolveCourses(courses, v.notes, v.spaces);
  let body = serializePath({ courses, title: "Deep learning, end to end", intro: "One concept roadmap over three courses. Learn each idea once; use every course's material for it.", stages: [], fm: {} });
  body = autoOrganize(body, buildPath(body, refs));
  const p = (): BuiltPath => buildPath(body, refs);
  const find = (name: string) => p().concepts.find((x) => x.def.name.toLowerCase() === name.toLowerCase());
  const merge = async (into: string, other: string) => { const { mergeConcepts } = await import("../path"); const a = find(into), b = find(other); if (a && b) body = mergeConcepts(body, a, b); };
  await merge("Gradient descent", "Optimization: SGD");
  await merge("Gradient descent", "SGD from scratch");
  await merge("Backpropagation", "Backprop by hand");
  await merge("Regularization & dropout", "Training tricks: dropout & batch norm");
  await merge("CNNs", "Convolutions");
  await merge("Neural networks", "Neural net foundations");
  await merge("Vectors & norms", "Linear algebra review");
  const { addResource } = await import("../path");
  const gd = find("Gradient descent");
  if (gd) {
    body = addResource(body, gd, "3Blue1Brown · Gradient descent", "https://www.youtube.com/watch?v=IHZwWFHWa-w");
    body = addResource(body, gd, "Distill · Why momentum really works", "https://distill.pub/2017/momentum/");
  }
  const bp = find("Backpropagation");
  if (bp) body = addResource(body, bp, "3Blue1Brown · Backpropagation calculus", "https://www.youtube.com/watch?v=tIeHLnjs5U8");
  // finished concepts get revision dates; one is due today
  const { scheduleNewlyDone } = await import("../path");
  body = scheduleNewlyDone(body, p()) ?? body;
  // one finished concept is due for revision today
  const d = parsePath(body);
  for (const st of d.stages) for (const k of st.concepts) if (k.name === "Loss functions") { k.review = c.iso(0); k.interval = 3; }
  body = serializePath(d);
  v.notes.push(note({ id: "lp-path", title: "Deep learning, end to end", type: "path", body, updated: c.ago(20), pinned: 1 }));
  // a base (database view) over the lessons: board by status, table grouped by course, calendar by `due`
  v.notes.push(
    note({ id: "lp-n-cnn", title: "Convolutions", space: "lp-s-fa", type: "lesson", status: "learning", tags: ["vision"], fm: { due: c.iso(4), difficulty: "3" }, text: "Kernels slide over the image." }),
    note({ id: "lp-n-lr", title: "Learning rate finder", space: "lp-s-fa", type: "lesson", status: "review", fm: { due: c.iso(1), difficulty: "2" }, text: "Increase the LR until the loss explodes." }),
    note({ id: "lp-n-ar", title: "الانتشار العكسي (ملخص)", space: "lp-s-ml", type: "lesson", status: "review", tags: ["arabic"], fm: { due: c.iso(9) }, text: "قاعدة السلسلة على مخطط الحساب." }),
    note({ id: "lp-base", title: "Lessons by status × course", type: "base", updated: c.ago(5), pinned: 1, text: `All lessons from the three courses.

\`\`\`base
filters:
  and:
    - type == "lesson"
views:
  - type: board
    name: By status
    groupBy:
      property: status
      direction: ASC
    order: [file.name, space, due]
  - type: table
    name: By course
    groupBy:
      property: space
      direction: ASC
    order: [file.name, status, space, due, difficulty, file.tags, file.mtime]
  - type: calendar
    name: Due dates
    date: due
\`\`\`
` }),
  );
  return v;
}
