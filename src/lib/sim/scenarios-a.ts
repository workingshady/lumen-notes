// Dev simulator scenarios, part A: empty, starter, every-type showcase, all spaces/kinds, study heavy.
import { mermaidGallery, kitchenSink, roadmapBody, showcaseCanvas, showcaseWhiteboard, slidesBody } from "./content";
import { addFile, cardsFor, clock, emptyVault, folder, note, pdfBlob, pngBlob, rng, session, space, svgBlob, version, wavBlob, type CardState, type Vault } from "./kit";

// ------------------------------------------------------------------ empty
export async function seedEmpty(): Promise<Vault> {
  return emptyVault();
}

// ------------------------------------------------------------------ starter
export async function seedStarter(): Promise<Vault> {
  const c = clock();
  const v = emptyVault();
  v.spaces.push(space({ id: "st-s-course", name: "Intro to Statistics", kind: "course", icon: "📊", color: "#39C5CF", props: { provider: "Khan Academy", target: c.iso(30) }, roadmapId: "st-roadmap" }));
  v.spaces.push(space({ id: "st-s-proj", name: "Side project", kind: "project", icon: "🚀", color: "#E8893A", props: { goal: "ship v1", deadline: c.iso(14) } }));
  v.folders.push(folder({ id: "st-f-1", spaceId: "st-s-course", name: "Unit 1", color: "#57AB5A" }));
  const n = (p: Parameters<typeof note>[0]) => v.notes.push(note(p));
  n({ id: "st-note", title: "Welcome note", text: "A plain note with a [[Mean and median]] link and a #starter tag.\n\n- [ ] Try the editor 📅 " + c.iso(0) + "\n", updated: c.ago(5) });
  n({ id: "st-lesson", title: "Mean and median", space: "st-s-course", folder: "st-f-1", type: "lesson", status: "learning", tags: ["stats"], text: "The mean is $\\bar x = \\frac1n\\sum x_i$.\n\nMean vs median? :: The median ignores outliers.\n", updated: c.ago(60) });
  n({ id: "st-journal", title: c.iso(0), type: "journal", text: "Short journal entry for today. Felt good about stats.\n", updated: c.ago(30) });
  n({ id: "st-cards", title: "Stats cards", space: "st-s-course", type: "flashcards", tags: ["stats"], text: "Variance? :: Mean squared deviation.\nStandard deviation? :: √variance.\nMode? :: Most frequent value.\n", updated: c.ago(90) });
  n({ id: "st-slides", title: "Stats in 3 slides", space: "st-s-course", type: "slides", body: "---\ntype: slides\n---\n# Stats in 3 slides\n\n---\n\n## Mean\n\nAverage\n\n---\n\n## Median\n\nMiddle value\n", updated: c.ago(200) });
  n({ id: "st-post", title: "Why I'm learning statistics", type: "post", published: 1, slug: "why-statistics", tags: ["blog"], text: "Because data is everywhere.\n", updated: c.at(2) });
  n({ id: "st-canvas", title: "Stats map", space: "st-s-course", type: "canvas", body: JSON.stringify({ nodes: [{ id: "a", type: "text", text: "Mean", x: 0, y: 0, width: 160, height: 60 }, { id: "b", type: "text", text: "Median", x: 240, y: 0, width: 160, height: 60 }], edges: [{ id: "e", fromNode: "a", toNode: "b", toEnd: "arrow" }] }), updated: c.at(3) });
  n({ id: "st-wb", title: "Project sketch", space: "st-s-proj", type: "whiteboard", body: showcaseWhiteboard(), updated: c.at(4) });
  n({ id: "st-roadmap", title: "Statistics roadmap", space: "st-s-course", type: "roadmap", body: `# Statistics roadmap\n\n## Basics 📅 ${c.iso(10)}\n- [x] Mean and median → [[Mean and median]]\n- [/] Variance\n- [ ] Distributions (needs: Variance)\n`, updated: c.at(1) });
  n({ id: "st-moc", title: "Statistics MOC", space: "st-s-course", type: "moc", text: "- [[Mean and median]]\n- [[Stats cards]]\n- [[Statistics roadmap]]\n", updated: c.at(5) });
  n({ id: "st-proj-tasks", title: "Launch checklist", space: "st-s-proj", text: `- [x] Pick a name\n- [/] Build MVP 📅 ${c.iso(3)}\n- [ ] Launch 📅 ${c.iso(14)}\n`, updated: c.ago(120) });
  v.cards = cardsFor(v.notes, c, (i) => (["new", "due", "later"] as CardState[])[i % 3]);
  v.sessions.push(session("st-sess-1", "st-lesson", 25, c.ago(90)), session("st-sess-2", "st-cards", 15, c.at(1)));
  return v;
}

// ------------------------------------------------------------------ every type showcase
export async function seedShowcase(): Promise<Vault> {
  const c = clock();
  const v = emptyVault();
  v.spaces.push(space({ id: "sc-s", name: "Showcase", kind: "course", icon: "✨", color: "#A371F7", description: "Every note type and Markdown feature.", roadmapId: "sc-roadmap", props: { provider: "Dev simulator", url: "https://example.com", target: c.iso(45) } }));
  v.folders.push(folder({ id: "sc-f-types", spaceId: "sc-s", name: "Note types", color: "#39C5CF" }), folder({ id: "sc-f-md", spaceId: "sc-s", name: "Markdown", color: "#E8893A" }));
  const n = (p: Parameters<typeof note>[0]) => { const x = note({ space: "sc-s", folder: "sc-f-types", ...p }); v.notes.push(x); return x; };

  const sink = n({ id: "sc-kitchen", title: "Kitchen sink", folder: "sc-f-md", type: "lesson", status: "learning", body: kitchenSink(c), updated: c.ago(3), pinned: 1, favorite: 1 });
  n({ id: "sc-mermaid", title: "Mermaid gallery", folder: "sc-f-md", body: mermaidGallery(), updated: c.ago(20) });
  n({ id: "sc-fm", title: "Front-matter showcase", folder: "sc-f-md", body: `---\ntitle: Front-matter showcase\ntype: note\nstatus: review\ntags: [showcase, frontmatter]\naliases: [FM, Properties]\nauthor: "Amir: the owner"\ndue: ${c.iso(3)}\nurl: https://example.com/a?b=c#d\nrating: 4.5\ndone: true\nempty:\n---\n# Front-matter showcase\n\nProperties of every shape: lists, quoted strings with colons, dates, URLs, numbers, booleans, an empty value.\n`, updated: c.ago(40) });
  n({ id: "sc-note", title: "Gradient descent (showcase)", type: "note", tags: ["showcase", "ml/optimization"], text: "Plain note linked from the kitchen sink. $\\theta \\leftarrow \\theta - \\eta\\nabla J$\n\nBacklinks: [[Kitchen sink]].\n", updated: c.ago(50) });
  n({ id: "sc-lesson", title: "Lesson: eigenvectors", type: "lesson", status: "review", tags: ["showcase", "math"], text: "$Av = \\lambda v$\n\n## Practice\n- [ ] Exercise 1 📅 " + c.iso(-1) + "\n- [x] Exercise 2\n\nWhat is an eigenvector? :: A vector whose direction A doesn't change.\n", updated: c.ago(70) });
  for (let k = 0; k < 4; k++) n({ id: `sc-journal-${k}`, title: c.iso(-k), type: "journal", tags: ["journal"], text: k === 1 ? "اليوم درست الإضافة. Then reviewed 40 cards. 😴\n" : `Journal entry ${k} days ago. Mood: ${["🙂", "😐", "🔥", "😴"][k]}\n`, updated: c.at(k, "22:00"), created: c.at(k, "21:00") });
  n({ id: "sc-cards", title: "Flashcards showcase", type: "flashcards", tags: ["showcase", "cards"], text: "Single-line card :: Its answer.\nCard with math $e^{i\\pi}$? :: $-1$\nما معنى «كتاب»؟ :: book\nMulti-line card\n?\nLine one of the answer\nLine two, with **bold**\n\nCard with code `x++`? :: Increments x.\n- Bulleted card :: Also works.\n", updated: c.ago(100) });
  n({ id: "sc-slides", title: "Showcase deck", type: "slides", body: slidesBody(), updated: c.ago(130) });
  n({ id: "sc-post", title: "Showcase blog post", type: "post", status: "mastered", published: 1, slug: "showcase-post", tags: ["blog", "showcase"], fm: { excerpt: "A published post with every feature." }, text: "A published post with **markdown**, $math$ and an image:\n\n![chart.png](att:sim-att-png)\n", updated: c.at(2) });
  n({ id: "sc-post-draft", title: "Draft post (unpublished)", type: "post", tags: ["blog"], text: "Not published yet.\n", updated: c.at(1) });
  n({ id: "sc-canvas", title: "Showcase canvas", type: "canvas", body: showcaseCanvas(), updated: c.ago(160) });
  n({ id: "sc-wb", title: "Showcase whiteboard", type: "whiteboard", body: showcaseWhiteboard(), updated: c.ago(190) });
  n({ id: "sc-roadmap", title: "Kitchen sink roadmap", type: "roadmap", body: roadmapBody(c), updated: c.ago(220) });
  n({ id: "sc-moc", title: "Showcase MOC", type: "moc", tags: ["showcase"], text: "# Map of content\n\n## Markdown\n- [[Kitchen sink]]\n- [[Mermaid gallery]]\n- [[Front-matter showcase]]\n\n## Types\n- [[Flashcards showcase]] · [[Showcase deck]] · [[Showcase canvas]] · [[Showcase whiteboard]] · [[Kitchen sink roadmap]]\n- [[Missing note in MOC]]\n", updated: c.ago(250) });
  n({ id: "sc-rtl", title: "ملاحظة عربية بالكامل", type: "note", tags: ["عربي"], text: "# عنوان فرعي\n\nهذه ملاحظة مكتوبة بالعربية بالكامل، مع رابط [[Kitchen sink]] ووسم #عربي.\n\n- [ ] مهمة اليوم 📅 " + c.iso(0) + "\n\n| العمود ١ | العمود ٢ |\n|---|---|\n| قيمة | value |\n\nما هو المضاف إليه؟ :: الاسم الثاني في الإضافة، مجرور دائماً.\n", updated: c.ago(280) });

  // Real attachment bytes.
  addFile(v, "sim-att-png", "chart.png", await pngBlob(480, 270, "#1D222B", "chart.png · simulator"));
  addFile(v, "sim-att-svg", "diagram.svg", svgBlob(`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200"><rect width="400" height="200" fill="#0f172a"/><circle cx="100" cy="100" r="60" fill="#F2A93B"/><text x="200" y="110" fill="#fff" font-size="24">SVG</text></svg>`));
  addFile(v, "sim-att-wav", "tone.wav", wavBlob(1.5, 440));
  addFile(v, "sim-att-pdf", "handout.pdf", pdfBlob("Lumen simulator handout"));
  addFile(v, "sim-att-csv", "grades.csv", new Blob(["name,grade\nAmir,A\nSara,B+\n"], { type: "text/csv" }));

  v.versions.push(version("sc-ver-1", sink, sink.body.slice(0, 400), c.ago(60 * 5), "Early draft"), version("sc-ver-2", sink, sink.body.replace("## Embeds", "## Media"), c.ago(60), ""));
  v.cards = cardsFor(v.notes, c, (i) => (["new", "learning", "due", "later", "lapsed", "suspended"] as CardState[])[i % 6]);
  v.sessions.push(session("sc-sess-1", "sc-kitchen", 40, c.ago(120)), session("sc-sess-2", "sc-cards", 20, c.at(1)));
  return v;
}

// ------------------------------------------------------------------ all spaces / kinds
export async function seedSpaces(): Promise<Vault> {
  const c = clock();
  const v = emptyVault();
  v.spaces.push(
    space({ id: "sp-proj", name: "Thesis: sparse attention", kind: "project", icon: "🚀", color: "#E8893A", sort: 1, roadmapId: "sp-proj-ms", description: "Project with a goal, deadline and milestones.", props: { goal: "submit the thesis", deadline: c.iso(60) } }),
    space({ id: "sp-proj-late", name: "Overdue project", kind: "project", icon: "⏰", color: "#E5534B", sort: 2, description: "Deadline already passed.", props: { goal: "renew passport", deadline: c.iso(-4) } }),
    space({ id: "sp-area", name: "Health", kind: "area", icon: "💪", color: "#57AB5A", sort: 3, description: "Ongoing responsibility." }),
    space({ id: "sp-course", name: "Deep Learning Specialization", kind: "course", icon: "🧠", color: "#A371F7", sort: 4, roadmapId: "sp-course-rm", description: "Course with roadmap: locked, learning, done, skipped topics; overdue and due modules.", props: { provider: "Coursera · DeepLearning.AI", url: "https://www.coursera.org/specializations/deep-learning", target: c.iso(40) } }),
    space({ id: "sp-course-empty", name: "Empty course", kind: "course", icon: "📘", sort: 5, description: "Course without a roadmap or notes." }),
    space({ id: "sp-res", name: "Math reference", kind: "resource", icon: "📚", color: "#E3B341", sort: 6 }),
    space({ id: "sp-arch", name: "Spanish A1 (archived)", kind: "archive", icon: "🗄️", sort: 7, archived: 1, description: "Archived space." }),
    space({ id: "sp-arch-proj", name: "Old project (archived)", kind: "project", icon: "📦", sort: 8, archived: 1 }),
    space({ id: "sp-jd", name: "10-19 Life admin", kind: "area", icon: "🗂️", color: "#39C5CF", sort: 9, description: "Johnny-Decimal structure." }),
  );
  const colors = ["#39C5CF", "#E8893A", "#A371F7", "#57AB5A", "#E3B341", "#E5534B", null];
  // Nested folders 4 levels deep (course).
  const chain = ["01 Neural networks", "01.1 Shallow nets", "01.1.1 Activations", "01.1.1.a ReLU family"];
  chain.forEach((name, i) => v.folders.push(folder({ id: `sp-f-deep-${i}`, spaceId: "sp-course", parentId: i ? `sp-f-deep-${i - 1}` : null, name, color: colors[i], sort: i })));
  ["02 Improving deep nets", "03 Structuring projects", "04 CNNs", "05 Sequence models"].forEach((name, i) => v.folders.push(folder({ id: `sp-f-c-${i}`, spaceId: "sp-course", name, color: colors[(i + 2) % colors.length], sort: 10 + i })));
  // Johnny-Decimal.
  const jd: [string, string, string | null][] = [["sp-jd-11", "11 Finance", null], ["sp-jd-1101", "11.01 Taxes", "sp-jd-11"], ["sp-jd-1102", "11.02 Bank", "sp-jd-11"], ["sp-jd-1110", "11.10 Insurance", "sp-jd-11"], ["sp-jd-12", "12 Home", null], ["sp-jd-1201", "12.01 Lease", "sp-jd-12"]];
  jd.forEach(([id, name, parent], i) => v.folders.push(folder({ id, spaceId: "sp-jd", parentId: parent, name, color: colors[i % colors.length], sort: i })));
  v.folders.push(folder({ id: "sp-f-proj", spaceId: "sp-proj", name: "Drafts", color: "#E8893A" }), folder({ id: "sp-f-res", spaceId: "sp-res", name: "Calculus" }), folder({ id: "sp-f-arch", spaceId: "sp-arch", name: "Verbs" }));

  const n = (p: Parameters<typeof note>[0]) => v.notes.push(note(p));
  chain.forEach((name, i) => n({ id: `sp-n-deep-${i}`, title: `${name} · lesson`, space: "sp-course", folder: `sp-f-deep-${i}`, type: "lesson", status: (["mastered", "review", "learning", "todo"] as const)[i], text: `Level ${i + 1} folder.\n\nQ${i}? :: A${i}.\n`, updated: c.ago(30 + i * 60) }));
  n({ id: "sp-course-rm", title: "Deep learning roadmap", space: "sp-course", type: "roadmap", updated: c.ago(10), body: `# Deep learning roadmap

## Neural networks 📅 ${c.iso(-20)}
- [x] Logistic regression → [[01 Neural networks · lesson]]
- [x] Shallow networks
- [-] Optional: history of perceptrons

## Improving deep nets · overdue 📅 ${c.iso(-3)}
- [/] Regularization (needs: Shallow networks) 📅 ${c.iso(-2)}
- [ ] Batch norm (needs: Regularization) 📅 ${c.iso(-1)}
- [ ] Hyperparameter tuning (needs: Batch norm)

## CNNs · due today 📅 ${c.iso(0)}
- [/] Convolutions 📅 ${c.iso(0)}
- [ ] ResNets (needs: Convolutions, Batch norm)

## Sequence models 📅 ${c.iso(30)}
- [ ] RNNs (needs: Convolutions)
- [ ] Attention (needs: RNNs)
- [ ] Transformers (needs: Attention) → [[Transformers lesson (missing)]]
` });
  n({ id: "sp-proj-ms", title: "Thesis milestones", space: "sp-proj", type: "roadmap", updated: c.ago(15), body: `# Milestones\n\n## Proposal 📅 ${c.iso(-30)}\n- [x] Pick topic\n- [x] Supervisor sign-off\n\n## Experiments 📅 ${c.iso(-2)}\n- [/] Baseline (needs: Pick topic)\n- [ ] Sparse variant (needs: Baseline)\n\n## Writing 📅 ${c.iso(50)}\n- [ ] Draft (needs: Sparse variant)\n` });
  n({ id: "sp-proj-board", title: "Thesis tasks", space: "sp-proj", folder: "sp-f-proj", text: `- [ ] Overdue: send §2 📅 ${c.iso(-3)}\n- [/] Run ablations 📅 ${c.iso(0)}\n- [/] Write related work\n- [ ] Make figures 📅 ${c.iso(5)}\n- [x] Set up cluster\n`, updated: c.ago(40) });
  n({ id: "sp-late-task", title: "Passport renewal", space: "sp-proj-late", text: `- [ ] Book appointment 📅 ${c.iso(-6)}\n- [ ] Photos 📅 ${c.iso(-4)}\n`, updated: c.at(6) });
  n({ id: "sp-area-n", title: "Sleep log", space: "sp-area", type: "journal", text: "7h 20m. Good.\n", updated: c.at(0, "08:00") });
  n({ id: "sp-res-n", title: "Derivative rules", space: "sp-res", folder: "sp-f-res", text: "$(fg)' = f'g + fg'$\n", updated: c.at(20) });
  n({ id: "sp-arch-n", title: "Ser vs estar", space: "sp-arch", folder: "sp-f-arch", type: "flashcards", text: "Ser? :: Permanent.\nEstar? :: Temporary.\n", updated: c.at(200) });
  n({ id: "sp-arch-proj-n", title: "Old project notes", space: "sp-arch-proj", text: "Archived.\n", updated: c.at(300) });
  jd.forEach(([id, name], i) => n({ id: `${id}-n`, title: `${name.split(" ")[0]}.${String(i + 1).padStart(2, "0")} Document`, space: "sp-jd", folder: id, text: `Filed under ${name}.\n`, updated: c.at(i + 2) }));
  v.cards = cardsFor(v.notes, c, (i) => (["due", "later", "new"] as CardState[])[i % 3]);
  return v;
}

// ------------------------------------------------------------------ study heavy
export async function seedStudy(): Promise<Vault> {
  const c = clock();
  const v = emptyVault();
  const r = rng(42);
  v.spaces.push(space({ id: "sd-s", name: "Medical school · Year 2", kind: "course", icon: "🩺", color: "#E5534B", props: { provider: "University", target: c.iso(120) } }), space({ id: "sd-s-lang", name: "Japanese N4", kind: "course", icon: "🗾", color: "#39C5CF" }));
  const topics = ["Anatomy", "Physiology", "Pharmacology", "Pathology", "Biochemistry", "Microbiology"];
  topics.forEach((t, i) => v.folders.push(folder({ id: `sd-f-${i}`, spaceId: "sd-s", name: `${String(i + 1).padStart(2, "0")} ${t}`, color: ["#39C5CF", "#E8893A", "#A371F7", "#57AB5A", "#E3B341", "#E5534B"][i], sort: i })));
  // 24 decks × 25 cards = 600 cards + 1 Japanese deck of 120.
  for (let d = 0; d < 24; d++) {
    const t = topics[d % topics.length];
    const lines = Array.from({ length: 25 }, (_, j) => `${t} fact ${d + 1}.${j + 1}: what is item ${j + 1}? :: Answer ${d + 1}.${j + 1}${j % 7 === 0 ? " with $x^2$" : ""}.`);
    v.notes.push(note({ id: `sd-deck-${d}`, title: `${t} deck ${Math.floor(d / topics.length) + 1}`, space: "sd-s", folder: `sd-f-${d % topics.length}`, type: "flashcards", status: (["todo", "learning", "review", "mastered"] as const)[d % 4], tags: ["med", t.toLowerCase()], text: lines.join("\n") + "\n", updated: c.ago(60 * (d + 1) * 7) }));
  }
  const kana = "あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわをん";
  v.notes.push(note({ id: "sd-jp", title: "Kana + vocab", space: "sd-s-lang", type: "flashcards", tags: ["japanese"], text: Array.from({ length: 120 }, (_, j) => `${kana[j % kana.length]}${j >= kana.length ? ` (${j})` : ""} :: reading ${j}`).join("\n") + "\n", updated: c.ago(30) }));
  const mix: [CardState, number][] = [["new", 0.18], ["learning", 0.06], ["due", 0.22], ["later", 0.42], ["lapsed", 0.07], ["suspended", 0.05]];
  v.cards = cardsFor(v.notes, c, () => {
    let x = r.next();
    for (const [s, p] of mix) { if ((x -= p) < 0) return s; }
    return "later";
  });
  // A year of sessions: current streak 23 days, best streak 64, gaps and bursts.
  let id = 0;
  for (let day = 0; day < 365; day++) {
    const inCurrent = day < 23;
    const inBest = day >= 120 && day < 184;
    const gap = day === 23 || (day >= 60 && day < 75) || (day >= 200 && day < 230) || day === 119 || day === 184;
    if (gap) continue;
    if (!inCurrent && !inBest && r.chance(0.35)) continue;
    const blocks = r.int(1, day % 7 === 6 ? 4 : 3);
    for (let b = 0; b < blocks; b++) {
      const deck = r.int(0, 23);
      v.sessions.push(session(`sd-sess-${id++}`, b === 2 ? null : `sd-deck-${deck}`, r.pick([10, 15, 25, 25, 30, 45, 50, 90]), day === 0 ? c.ago(30 + b * 70) : c.at(day, `${8 + b * 4}:${String(r.int(0, 59)).padStart(2, "0")}`)));
    }
  }
  return v;
}

