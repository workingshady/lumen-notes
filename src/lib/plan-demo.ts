// Demo seed for plans (design round 8, Lumen 53 / 54): the English A1–C2 course (178 topics) and four plan notes
// (deep-learning course, team project with owners, exam prep back from the exam date, MSc thesis). Dates are written
// relative to the demo "today" (`iso(offset)`), so the Timeline / Board / Agenda read like the design.
// Everything is plain Markdown: roadmap headings + checkbox lines with start:/due:/~h/#track/@owner/(needs: …).

type Iso = (offset: number) => string;
const MARK = { done: "x", active: "/", next: " ", todo: " ", late: "/" } as const;
type St = keyof typeof MARK;

// ------------------------------------------------------------------ English A1 to C2 (course roadmap)
const LEVELS: [string, string, number[]][] = [["A1", "Beginner", [14, 6, 3, 2, 2]], ["A2", "Elementary", [14, 8, 3, 2, 2]], ["B1", "Intermediate", [18, 8, 3, 2, 2]], ["B2", "Upper-intermediate", [17, 9, 3, 2, 2]], ["C1", "Advanced", [16, 8, 3, 2, 2]], ["C2", "Proficient", [12, 6, 3, 2, 2]]];
const MODS = ["Grammar", "Vocabulary", "Listening & speaking", "Reading & writing", "Milestone"];
const A1G = ["Verb to be", "Pronouns and possessives", "Articles", "Plurals and countable nouns", "This, that, these and those", "There is and have got", "Present simple", "Question words", "Like and want", "Can and imperatives", "Present continuous", "Prepositions of time and place", "Adjectives and word order", "Was and were"];
const A1V = ["Greetings and personal information", "Numbers, dates and time", "Family and friends", "Food and drink", "Daily routines", "Places in town"];
const A1L = ["Alphabet and sounds", "Introducing yourself", "Asking simple questions"];
export function englishRoadmap(iso: Iso): string {
  const out = [`---`, `pace: 4`, `hours: 1.9`, `start: ${iso(0)}`, `levels: [${LEVELS.map(([k, n]) => `${k}=${n}`).join(", ")}]`, `levelrange: CEFR A1 – C2`, `---`, `# English A1 to C2`, ``];
  for (const [lv, , counts] of LEVELS) counts.forEach((n, mi) => {
    out.push(`## ${lv} · ${MODS[mi]}`);
    for (let k = 0; k < n; k++) {
      let name = `${lv} ${MODS[mi]} ${k + 1}`;
      if (lv === "A1" && mi === 0) name = A1G[k];
      else if (lv === "A1" && mi === 1) name = A1V[k];
      else if (lv === "A1" && mi === 2) name = A1L[k];
      else if (mi === 4) name = k === 0 ? `${lv} checkpoint` : `${lv} review test`;
      else if (mi === 0) name = `${lv} grammar ${k + 1}`;
      let needs = "";
      if (lv === "A1" && mi === 0) needs = k === 0 ? "" : k <= 6 ? " (needs: Verb to be)" : ` (needs: ${A1G[k - 1]})`;
      if (lv === "A1" && mi === 2 && k === 1) needs = " (needs: Verb to be)";
      out.push(`- [ ] ${name}${needs}`);
    }
    out.push("");
  });
  return out.join("\n");
}

// ------------------------------------------------------------------ plan notes
type Item = [name: string, startWk: number, lenWk: number, track: number, st: St, count: number, owner?: string];
interface Scn { title: string; fm: Record<string, string>; startOff: number; groups: [string, string, Item[]][]; ms: [string, number][]; needs?: Record<string, string>; hoursPerWeek?: number; late?: string[] }
const SCN = (iso: Iso): Record<string, Scn> => ({
  ai: {
    title: "Deep learning: zero to LLMs", startOff: -39, hoursPerWeek: 8, late: ["Train a CNN on CIFAR-10"],
    fm: { plan: "course", sub: "Online course + labs + capstone · fast.ai, Karpathy, papers", icon: "neural", color: "#B48EF0", unit: "lessons", groupby: "Module", tracks: "[Lectures, Labs, Papers, Project]", schedule: "fixed", pace: "8", deadline: iso(122), deadlinelabel: "Capstone due", chips: "course=Course + project | due={deadline} | clock={pace}", cta: "continue" },
    groups: [["1 · Foundations", "#7AA2F7", [["Python & NumPy refresher", 0, 2, 0, "done", 6], ["Linear algebra lab", 1, 2, 1, "done", 4]]], ["2 · Neural networks", "#5CC8C2", [["Backprop from scratch", 3, 2, 0, "done", 5], ["micrograd lab", 3, 2, 1, "done", 3], ["Read: Rumelhart 1986", 4, 1, 2, "done", 1]]], ["3 · CNNs", "#6BCB8B", [["Convolutions & pooling", 5, 2, 0, "active", 5], ["Train a CNN on CIFAR-10", 4.4, 1.5, 1, "late", 1], ["Read: ResNet", 7, 1, 2, "next", 1]]], ["4 · Transformers", "#E3B341", [["Attention is all you need", 9, 3, 0, "todo", 6], ["nanoGPT lab", 10, 3, 1, "todo", 2], ["Read: GPT-2 paper", 11, 1, 2, "todo", 1]]], ["5 · LLM fine-tuning", "#E8893A", [["LoRA, RLHF, evals", 13, 3, 0, "todo", 6], ["Fine-tune a 1B model", 14, 4, 1, "todo", 1]]], ["6 · Capstone", "#F25C9A", [["Proposal", 17, 1, 3, "todo", 1], ["Build + experiments", 18, 5, 3, "todo", 1], ["Write-up + demo", 23, 2, 3, "todo", 1]]]],
    ms: [["Midterm quiz", 8], ["Proposal due", 18], ["Capstone due", 25]], needs: { "Train a CNN on CIFAR-10": "Convolutions & pooling", "Build + experiments": "Proposal", "Fine-tune a 1B model": "nanoGPT lab" },
  },
  project: {
    title: "Lumen 2.0 launch", startOff: -39, late: ["Sync conflict UI"],
    fm: { plan: "project", sub: "Product project · 3 people · phases, owners, dependencies", icon: "project", color: "#F2A93B", unit: "tasks", groupby: "Phase", people: "[sara=Sara, ahmed=Ahmed, lin=Lin]", schedule: "fixed", pace: "40", deadline: iso(94), deadlinelabel: "Launch", chips: "team={team} | due={deadline} | c-warning={risk}", cta: "yours" },
    groups: [["Discovery", "#7AA2F7", [["User interviews", 0, 2, 0, "done", 8, "sara"], ["Competitive teardown", 1, 2, 1, "done", 5, "ahmed"]]], ["Design", "#B48EF0", [["Whiteboard studio", 2, 3, 0, "done", 12, "sara"], ["Architecture studio", 4, 4, 2, "active", 9, "lin"]]], ["Build", "#5CC8C2", [["Sync engine v2", 4, 6, 1, "active", 14, "ahmed"], ["Sync conflict UI", 4.5, 1, 0, "late", 4, "sara"], ["Export pipeline", 8, 3, 2, "todo", 6, "lin"]]], ["Beta", "#E3B341", [["Private beta · 200", 12, 3, 0, "todo", 5, "sara"], ["Bug bash", 13, 2, 1, "todo", 1, "ahmed"]]], ["Launch", "#F25C9A", [["Docs + site", 15, 3, 2, "todo", 7, "lin"], ["Launch day", 18, 1, 0, "todo", 1, "sara"]]]],
    ms: [["Design freeze", 8], ["Beta", 12], ["Launch", 19]], needs: { "Sync conflict UI": "Whiteboard studio", "Bug bash": "Sync engine v2", "Launch day": "Docs + site" },
  },
  exam: {
    title: "AWS Solutions Architect – Associate", startOff: 3, hoursPerWeek: 6,
    fm: { plan: "exam", sub: "Exam prep · planned backwards from the exam date", icon: "c-tip", color: "#E8893A", unit: "sessions", groupby: "Domain", tracks: "[Learn, Practice, Review]", schedule: "deadline", pace: "6", start: iso(3), deadline: iso(92), deadlinelabel: "Exam", chips: "due={deadline} | flashcards=420 cards | clock={pace}", cta: "today", lumenplan: "view=agenda;group=group;colour=group;sort=start;show=milestones,deps,done;zoom=month" },
    groups: [["Secure architectures · 30%", "#EF6B6B", [["IAM, KMS, VPC security", 0, 3, 0, "active", 9], ["Practice set A", 2, 1, 1, "todo", 1]]], ["Resilient · 26%", "#7AA2F7", [["Multi-AZ, DR, decoupling", 3, 3, 0, "todo", 8], ["Practice set B", 5, 1, 1, "todo", 1]]], ["High-performing · 24%", "#6BCB8B", [["Compute, storage, caching", 6, 2, 0, "todo", 7]]], ["Cost-optimized · 20%", "#E3B341", [["Pricing models, S3 tiers", 8, 2, 0, "todo", 5]]], ["Final", "#F25C9A", [["2 mock exams", 10, 2, 1, "todo", 2], ["Weak-spot review", 10, 2.5, 2, "todo", 1]]]],
    ms: [["Mock 1", 10.5], ["Mock 2", 11.5], ["Exam", 12.6]],
  },
  thesis: {
    title: "MSc thesis · Retrieval for long notes", startOff: -67,
    fm: { plan: "thesis", sub: "Research · chapters, experiments, supervisor meetings", icon: "book", color: "#7AA2F7", unit: "tasks", groupby: "Chapter", tracks: "[Reading, Experiments, Writing, Meetings]", schedule: "fixed", pace: "15", deadline: iso(214), deadlinelabel: "Submit", chips: "owner=Supervisor: Dr. Lim | due={deadline} | note=64 papers", cta: "next" },
    groups: [["Lit review", "#7AA2F7", [["Read 40 papers", 0, 8, 0, "done", 40], ["Write ch. 2", 6, 5, 2, "active", 1]]], ["Method", "#5CC8C2", [["Baselines", 9, 4, 1, "active", 3], ["Proposed model", 13, 8, 1, "todo", 1], ["Write ch. 3", 18, 4, 2, "todo", 1]]], ["Results", "#6BCB8B", [["Ablations", 21, 6, 1, "todo", 6], ["Write ch. 4–5", 26, 6, 2, "todo", 2]]], ["Submit", "#F25C9A", [["Full draft to supervisor", 32, 3, 2, "todo", 1], ["Revisions + submit", 35, 5, 2, "todo", 1]]]],
    ms: [["Progress review", 12], ["Draft", 34], ["Submit", 39.5]], needs: { "Proposed model": "Baselines", "Write ch. 4–5": "Ablations" },
  },
});

function planBody(s: Scn, iso: Iso): string {
  const day = (wk: number) => iso(s.startOff + Math.round(wk * 7));
  const colors = s.groups.map((g) => g[1]);
  const fm = { ...s.fm, start: s.fm.start ?? day(0), colors: `[${colors.join(", ")}]` };
  const out = ["---", ...Object.entries(fm).map(([k, v]) => `${k}: ${v}`), "---", `# ${s.title}`, ""];
  const trackNames = (s.fm.tracks ?? "").replace(/^\[|\]$/g, "").split(",").map((x) => x.trim()).filter(Boolean);
  for (const [g, , items] of s.groups) {
    out.push(`## ${g}`);
    for (const [name, sw, len, tr, st, count, owner] of items) {
      const late = s.late?.includes(name);
      const end = late ? iso(-4) : day(sw + len - 1 / 7);
      const start = late ? iso(-4 - Math.round(len * 7) + 1) : day(sw);
      const hours = Math.max(1, Math.round(len * (s.hoursPerWeek ?? 6) * 10) / 10);
      const bits = [`- [${MARK[st]}] ${name}`];
      if (count > 1) bits.push(`×${count}`);
      if (owner) bits.push(`@${owner}`);
      else if (trackNames[tr]) bits.push(`#track/${trackNames[tr].replace(/\s+/g, "_")}`);
      bits.push(`~${hours}h`);
      if (s.fm.schedule !== "deadline") bits.push(`start:${start}`, `due:${end}`);
      if (s.needs?.[name]) bits.push(`(needs: ${s.needs[name]})`);
      out.push(bits.join(" "));
    }
    out.push("");
  }
  out.push("## Milestones");
  for (const [name, wk] of s.ms) out.push(`- [ ] ${name} due:${day(wk)}`);
  return out.join("\n") + "\n";
}

export const PLAN_DEMO_IDS = { englishSpace: "dm-s-english", englishRoadmap: "dm-en-roadmap", plansSpace: "dm-s-plans", english: "dm-plan-english", ai: "dm-plan-ai", project: "dm-plan-project", exam: "dm-plan-exam", thesis: "dm-plan-thesis" };

/** Notes to seed (all `roadmap` type: a course roadmap + plan notes). */
export function planDemoNotes(iso: Iso): { id: string; title: string; space: string; body: string }[] {
  const s = SCN(iso);
  return [
    { id: PLAN_DEMO_IDS.englishRoadmap, title: "English A1 to C2 roadmap", space: PLAN_DEMO_IDS.englishSpace, body: englishRoadmap(iso) },
    { id: PLAN_DEMO_IDS.english, title: "English A1 to C2", space: PLAN_DEMO_IDS.plansSpace, body: `---\nplan: course\nfrom: English A1 to C2 roadmap\nsub: Language course · CEFR levels · self-paced\nicon: language\ncolor: #5CC8C2\nunit: topics\ngroupby: Level\nchips: lesson=Course | s-mastered=CEFR A1 – C2 | clock={pace}\ncta: continue\n---\n# English A1 to C2\n\nThe English course roadmap as a plan: levels are groups, modules are items.\n` },
    { id: PLAN_DEMO_IDS.ai, title: s.ai.title, space: PLAN_DEMO_IDS.plansSpace, body: planBody(s.ai, iso) },
    { id: PLAN_DEMO_IDS.project, title: s.project.title, space: PLAN_DEMO_IDS.plansSpace, body: planBody(s.project, iso) },
    { id: PLAN_DEMO_IDS.exam, title: s.exam.title, space: PLAN_DEMO_IDS.plansSpace, body: planBody(s.exam, iso) },
    { id: PLAN_DEMO_IDS.thesis, title: s.thesis.title, space: PLAN_DEMO_IDS.plansSpace, body: planBody(s.thesis, iso) },
  ];
}
