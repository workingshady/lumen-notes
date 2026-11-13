// Dev simulator scenarios, part B: big vault, sharing & blog, edge cases & broken data, conflicts & history.
import type { Note, NoteType, Version } from "../../../shared/types";
import { F, words } from "./content";
import { addFile, attachment, card, cardsFor, clock, DAY, emptyVault, folder, MIN, note, pngBlob, rng, session, space, version, type CardState, type Vault } from "./kit";

// ------------------------------------------------------------------ big vault / performance
export function seedBig(count: number) {
  return async (): Promise<Vault> => {
    const c = clock();
    const v = emptyVault();
    const r = rng(count);
    const SPACES = 12, FOLDERS = 60;
    const topics = ["Algebra", "Biology", "Chemistry", "Databases", "Economics", "French", "Geometry", "History", "Immunology", "Java", "Kotlin", "Logic"];
    for (let s = 0; s < SPACES; s++) v.spaces.push(space({ id: `bg-s-${s}`, name: topics[s], kind: (["course", "area", "project", "resource"] as const)[s % 4], icon: "📁", color: `hsl(${s * 30} 60% 55%)`, sort: s + 1, props: s % 4 === 2 ? { goal: "finish", deadline: c.iso(30 + s) } : {} }));
    for (let f = 0; f < FOLDERS; f++) v.folders.push(folder({ id: `bg-f-${f}`, spaceId: `bg-s-${f % SPACES}`, parentId: f >= SPACES * 2 && f % 3 === 0 ? `bg-f-${f - SPACES}` : null, name: `${String(f).padStart(2, "0")} Folder`, color: f % 4 ? null : "#39C5CF", sort: f }));
    const title = (i: number) => `${topics[i % SPACES]} note ${String(i).padStart(5, "0")}`;
    const types: NoteType[] = ["note", "note", "note", "lesson", "lesson", "journal", "flashcards", "moc", "post", "slides"];
    for (let i = 0; i < count; i++) {
      // Dense graph: 3–8 links, biased towards a few hubs so the graph has clusters.
      const links = Array.from({ length: r.int(3, 8) }, () => (r.chance(0.2) ? r.int(0, 20) : r.chance(0.5) ? (i + r.int(1, 30)) % count : r.int(0, count - 1)));
      const type = types[i % types.length];
      const cards = type === "flashcards" || i % 13 === 0 ? `\nTerm ${i}? :: Definition ${i}.\nSecond term ${i}? :: Second definition.\n` : "";
      const t = c.now - Math.floor(r.next() * 365) * DAY - r.int(0, 1000) * MIN;
      v.notes.push(note({
        id: `bg-n-${i}`, title: title(i), space: `bg-s-${i % SPACES}`, folder: r.chance(0.7) ? `bg-f-${(i * 7) % FOLDERS}` : null, type,
        status: (["todo", "learning", "review", "mastered", null] as const)[i % 5], tags: [topics[i % SPACES].toLowerCase(), `t${i % 40}`], pinned: i < 5 ? 1 : 0,
        published: type === "post" && i % 3 === 0 ? 1 : 0, slug: type === "post" ? `post-${i}` : "",
        text: `${words(40 + (i % 120), false)}\n\nLinks: ${links.map((l) => `[[${title(l)}]]`).join(" · ")}\n${i % 9 === 0 ? `- [ ] Task ${i} 📅 ${c.iso((i % 21) - 10)}\n` : ""}${cards}`,
        updated: t, created: t - r.int(1, 90) * DAY,
      }));
    }
    // Big canvases: 500 nodes in a grid, ~700 edges.
    for (let b = 0; b < 2; b++) {
      const nodes = Array.from({ length: 500 }, (_, i) => i % 10 === 0
        ? { id: `n${i}`, type: "file", file: `${topics[i % SPACES]}/${title(i)}.md`, x: (i % 25) * 260, y: Math.floor(i / 25) * 180, width: 220, height: 140 }
        : { id: `n${i}`, type: "text", text: `Node ${i}\n${words(8, false)}`, x: (i % 25) * 260, y: Math.floor(i / 25) * 180, width: 220, height: 140, ...(i % 7 ? {} : { color: String((i % 6) + 1) }) });
      const edges = Array.from({ length: 700 }, (_, i) => ({ id: `e${i}`, fromNode: `n${i % 500}`, toNode: `n${(i * 37 + 1) % 500}`, toEnd: "arrow" }));
      v.notes.push(note({ id: `bg-canvas-${b}`, title: `Big canvas ${b + 1} (500 nodes)`, space: "bg-s-0", type: "canvas", body: JSON.stringify({ nodes, edges }), updated: c.ago(10 + b) }));
    }
    // Long notes: 50k words.
    for (let l = 0; l < 2; l++) v.notes.push(note({ id: `bg-long-${l}`, title: `Long note ${l + 1} (50k words)`, space: "bg-s-1", type: "lesson", text: words(50_000) + `\n\n[[${title(1)}]]\n`, updated: c.ago(20 + l) }));
    // Many versions: 10 notes × 40 versions.
    for (let h = 0; h < 10; h++) {
      const n = v.notes[h];
      for (let k = 0; k < 40; k++) v.versions.push(version(`bg-v-${h}-${k}`, n, n.body.slice(0, 200 + k * 20), n.updatedAt - (k + 1) * 3 * 60 * MIN, k % 10 === 0 ? `Milestone ${k / 10}` : ""));
    }
    v.cards = cardsFor(v.notes, c, (i) => (["due", "later", "later", "new", "lapsed"] as CardState[])[i % 5]);
    for (let d = 0; d < 365; d++) if (r.chance(0.75)) v.sessions.push(session(`bg-sess-${d}`, `bg-n-${r.int(0, count - 1)}`, r.int(10, 90), c.at(d, "19:00")));
    return v;
  };
}

// ------------------------------------------------------------------ sharing & blog
export async function seedSharing(): Promise<Vault> {
  const c = clock();
  const v = emptyVault();
  v.spaces.push(
    space({ id: "sh-s-course", name: "Linear Algebra (shared)", kind: "course", icon: "📐", color: "#A371F7", sort: 1, shareId: "simShCourse1", roadmapId: "sh-rm", description: "A shared course page.", props: { provider: "MIT OCW 18.06", url: "https://ocw.mit.edu/courses/18-06-linear-algebra-spring-2010/", target: c.iso(25), secret: "should never be exposed in a share" } }),
    space({ id: "sh-s-proj", name: "Open-source app (shared)", kind: "project", icon: "🛠️", color: "#E8893A", sort: 2, shareId: "simShProj01", props: { goal: "ship 1.0", deadline: c.iso(20) } }),
    space({ id: "sh-s-blog", name: "Blog", kind: "area", icon: "✍️", color: "#57AB5A", sort: 3 }),
  );
  v.folders.push(folder({ id: "sh-f-posts", spaceId: "sh-s-blog", name: "Posts" }), folder({ id: "sh-f-drafts", spaceId: "sh-s-blog", name: "Drafts" }));
  const n = (p: Parameters<typeof note>[0]) => v.notes.push(note(p));
  n({ id: "sh-rm", title: "18.06 roadmap", space: "sh-s-course", type: "roadmap", body: `# 18.06\n\n## Vectors 📅 ${c.iso(-5)}\n- [x] Geometry of linear equations → [[Shared lesson: elimination]]\n- [/] Elimination\n\n## Spaces 📅 ${c.iso(10)}\n- [ ] Column space (needs: Elimination)\n` });
  n({ id: "sh-n-1", title: "Shared lesson: elimination", space: "sh-s-course", type: "lesson", status: "learning", shareId: "simShNote01", text: "Shared via an unlisted link.\n\n$$A = LU$$\n\nPivot? :: First non-zero in a row.\n", updated: c.ago(30) });
  n({ id: "sh-n-2", title: "Shared canvas", space: "sh-s-course", type: "canvas", shareId: "simShCanv01", body: JSON.stringify({ nodes: [{ id: "a", type: "text", text: "Ax = b", x: 0, y: 0, width: 160, height: 60 }, { id: "b", type: "text", text: "LU", x: 240, y: 0, width: 160, height: 60 }], edges: [{ id: "e", fromNode: "a", toNode: "b", toEnd: "arrow" }] }), updated: c.ago(90) });
  n({ id: "sh-n-3", title: "Shared deck", space: "sh-s-course", type: "slides", shareId: "simShDeck01", body: "---\ntype: slides\n---\n# Shared deck\n\n---\n\n## Slide 2\n\n- point\n", updated: c.ago(200) });
  n({ id: "sh-n-4", title: "Not shared (private)", space: "sh-s-course", text: "Should not appear in the shared course page.\n", updated: c.ago(220) });
  n({ id: "sh-n-proj", title: "Release checklist", space: "sh-s-proj", text: `- [x] CI\n- [/] Docs 📅 ${c.iso(2)}\n- [ ] Tag 1.0 📅 ${c.iso(20)}\n`, updated: c.ago(60) });
  const posts: [string, string, number, string[], string][] = [
    ["Learning in public", "learning-in-public", 2, ["meta"], "Why I publish my notes."],
    ["Gradient descent, intuitively", "gradient-descent-intuitively", 9, ["ml", "math"], "A bowl, a ball and a step size."],
    ["تعلم العربية: الإضافة", "arabic-idafa", 15, ["arabic", "عربي"], "شرح مبسط للإضافة."],
    ["A post with a very long title that keeps going to test how the blog index wraps headlines across lines", "very-long-title", 30, ["test"], "Long title test."],
    ["Notes on spaced repetition", "spaced-repetition", 45, ["learning"], "SM-2, ease and lapses."],
    ["Post with no excerpt", "no-excerpt", 60, [], ""],
  ];
  posts.forEach(([title, slug, ago, tags, ex], i) => n({ id: `sh-post-${i}`, title, space: "sh-s-blog", folder: "sh-f-posts", type: "post", status: "mastered", published: 1, slug, tags: ["blog", ...tags], props: ex ? { excerpt: ex } : {}, fm: ex ? { excerpt: JSON.stringify(ex) } : {}, text: `${ex}\n\n${words(250 + i * 120)}\n\n${i === 1 ? "$$\\theta \\leftarrow \\theta - \\eta \\nabla J$$\n\n![chart.png](att:sh-att-cover)\n" : ""}`, updated: c.at(ago, "10:00"), created: c.at(ago + 1, "10:00") }));
  n({ id: "sh-draft-1", title: "Draft: transformers explained", space: "sh-s-blog", folder: "sh-f-drafts", type: "post", status: "learning", tags: ["blog", "ml"], text: "Unpublished draft.\n", updated: c.ago(15) });
  n({ id: "sh-draft-2", title: "Draft with slug but unpublished", space: "sh-s-blog", folder: "sh-f-drafts", type: "post", slug: "draft-with-slug", tags: ["blog"], text: "Has a slug but is not published.\n", updated: c.at(3) });
  n({ id: "sh-dup-slug", title: "Duplicate slug post", space: "sh-s-blog", type: "post", published: 1, slug: "learning-in-public", tags: ["blog"], text: "Same slug as another published post.\n", updated: c.at(70) });
  n({ id: "sh-unpub", title: "Unpublished (was public)", space: "sh-s-blog", type: "post", published: 0, slug: "was-public", shareId: null, text: "Unpublished after being live.\n", updated: c.at(5) });
  addFile(v, "sh-att-cover", "cover.png", await pngBlob(800, 420, "#20242c", "blog cover"));
  return v;
}

// ------------------------------------------------------------------ edge cases & broken data
// Folder parent cycles (A -> B -> A) are deliberately NOT seeded: today they freeze the app (unguarded parent walks in
// search.ts, NoteView.tsx, io.ts, GraphView.tsx). See docs/DEV_SIMULATOR.md.
export async function seedEdge(): Promise<Vault> {
  const c = clock();
  const v = emptyVault();
  v.spaces.push(
    space({ id: "ed-s", name: "Edge cases", kind: "area", icon: "🧪", color: "#E5534B", sort: 1, description: "Broken and weird data." }),
    space({ id: "ed-s-deleted", name: "Deleted space (tombstone)", kind: "project", icon: "🪦", sort: 2, deleted: 1 }),
    space({ id: "ed-s-weird", name: "\u200B\u200F\u202EWeird space name with RTL override\u202C", kind: "resource", icon: "", color: "not-a-color", sort: 3, props: { deadline: "not-a-date", target: "2026-13-45" } }),
    space({ id: "ed-s-long", name: "A space name that is far too long to fit in any sidebar row without truncation ".repeat(3), kind: "course", icon: "🦄", sort: 4, roadmapId: "ed-missing-roadmap-id" }),
  );
  v.folders.push(
    folder({ id: "ed-f-ok", spaceId: "ed-s", name: "Normal folder" }),
    folder({ id: "ed-f-deleted", spaceId: "ed-s", name: "Deleted folder", deleted: 1 }),
    folder({ id: "ed-f-orphan", spaceId: "ed-s", name: "Folder whose parent is missing", parentId: "ed-f-nope" }),
    folder({ id: "ed-f-otherspace", spaceId: "ed-s-missing", name: "Folder in a missing space" }),
    folder({ id: "ed-f-empty", spaceId: "ed-s", name: "" }),
  );
  const n = (p: Parameters<typeof note>[0]) => v.notes.push(note({ space: "ed-s", ...p }));
  const longTitle = "Very long title ".repeat(30).trim();
  n({ id: "ed-canvas-json", title: "Canvas: invalid JSON", type: "canvas", body: '{ "nodes": [ { "id": "a", "type": "text", "text": "unterminated', updated: c.ago(1) });
  n({ id: "ed-canvas-edges", title: "Canvas: edges to missing nodes", type: "canvas", body: JSON.stringify({ nodes: [{ id: "a", type: "text", text: "Only node", x: 0, y: 0, width: 200, height: 80 }], edges: [{ id: "e1", fromNode: "a", toNode: "ghost", toEnd: "arrow" }, { id: "e2", fromNode: "ghost2", toNode: "ghost3" }, { id: "e3", fromNode: "a", toNode: "a", label: "self loop" }] }), updated: c.ago(2) });
  n({ id: "ed-canvas-bad", title: "Canvas: malformed nodes", type: "canvas", body: JSON.stringify({ nodes: [{ id: "dup", type: "text", text: "dup 1", x: 0, y: 0, width: 100, height: 50 }, { id: "dup", type: "text", text: "dup 2", x: 50, y: 50, width: 100, height: 50 }, { id: "neg", type: "text", text: "negative size", x: 0, y: 200, width: -100, height: 0 }, { id: "nan", type: "text", text: "NaN pos", x: "abc", y: null, width: 100, height: 50 }, { id: "unk", type: "hologram", x: 300, y: 0, width: 100, height: 50 }, { type: "text", text: "no id", x: 400, y: 0, width: 100, height: 50 }, { id: "far", type: "text", text: "far away", x: 1e7, y: -1e7, width: 100, height: 50 }, { id: "f", type: "file", file: "", x: 600, y: 0, width: 100, height: 50 }, { id: "l", type: "link", url: "javascript:alert(1)", x: 700, y: 0, width: 100, height: 50 }], edges: "not an array" }), updated: c.ago(3) });
  n({ id: "ed-canvas-empty", title: "Canvas: empty body", type: "canvas", body: "", updated: c.ago(4) });
  n({ id: "ed-canvas-arr", title: "Canvas: JSON array", type: "canvas", body: "[1,2,3]", updated: c.ago(5) });
  n({ id: "ed-wb-json", title: "Whiteboard: invalid JSON", type: "whiteboard", body: "{ excalidraw broken", updated: c.ago(6) });
  n({ id: "ed-wb-empty", title: "Whiteboard: empty body", type: "whiteboard", body: "", updated: c.ago(7) });
  n({ id: "ed-mermaid", title: "Invalid Mermaid", body: `# Invalid Mermaid\n\n${F}mermaid\nflowchart LR\n  A -->\n  B --> {{{\n${F}\n\n${F}mermaid\nnotADiagramType\n  foo\n${F}\n\n${F}mermaid\n${F}\n`, updated: c.ago(8) });
  n({ id: "ed-fm-unclosed", title: "Front-matter: unclosed", body: "---\ntype: lesson\ntags: [a, b\nstatus: learning\n# Title after unclosed front-matter\n\nBody.\n", updated: c.ago(9) });
  n({ id: "ed-fm-bad", title: "Front-matter: malformed values", body: "---\n: no key\ntags: [unclosed, list\nstatus: not-a-status\ntype: bogus-type\n\tindented: with tab\nkey with spaces: value: with: colons\n\"quoted\": 'mixed\"\n---\n# Malformed front-matter\n", updated: c.ago(10) });
  n({ id: "ed-fm-only", title: "Front-matter only", body: "---\ntitle: only front-matter\n---\n", updated: c.ago(11) });
  n({ id: "ed-empty-title", title: "", body: "Body of a note with an empty title.\n", updated: c.ago(12) });
  n({ id: "ed-space-title", title: "   ", body: "Whitespace-only title.\n", updated: c.ago(13) });
  n({ id: "ed-empty-body", title: "Empty body", body: "", updated: c.ago(14) });
  for (let i = 0; i < 3; i++) n({ id: `ed-dup-${i}`, title: "Duplicate title", text: `Copy ${i + 1}. Linking [[Duplicate title]] is ambiguous.\n`, updated: c.ago(15 + i) });
  n({ id: "ed-dup-case", title: "duplicate TITLE", text: "Differs only by case.\n", updated: c.ago(18) });
  n({ id: "ed-long-title", title: longTitle, text: "Very long title.\n", updated: c.ago(19) });
  n({ id: "ed-zw", title: "Zero\u200Bwidth\u200C‍title\uFEFF", text: "Zero-width characters in the title.\n", updated: c.ago(20) });
  n({ id: "ed-rtl-mark", title: "\u200FRTL mark at start · \u202Ereversed\u202C · \u061Cمختلط", text: "RTL/LRM/RLO marks in the title.\n", updated: c.ago(21) });
  n({ id: "ed-emoji-title", title: "👩‍👩‍👧‍👦🏳️‍🌈🇸🇦 Emoji-only-ish title 🧪", text: "Emoji ZWJ sequences.\n", updated: c.ago(22) });
  n({ id: "ed-in-deleted-folder", title: "Note in a deleted folder", folder: "ed-f-deleted", text: "My folder is a tombstone.\n", updated: c.ago(23) });
  n({ id: "ed-in-missing-folder", title: "Note in a missing folder", folder: "ed-f-does-not-exist", text: "folderId points nowhere.\n", updated: c.ago(24) });
  n({ id: "ed-in-missing-space", title: "Note in a missing space", space: "ed-s-missing", text: "spaceId points nowhere.\n", updated: c.ago(25) });
  n({ id: "ed-in-deleted-space", title: "Note in a deleted space", space: "ed-s-deleted", text: "Space is a tombstone.\n", updated: c.ago(26) });
  for (let i = 0; i < 6; i++) n({ id: `ed-trash-${i}`, title: `Trashed note ${i + 1}`, type: (["note", "lesson", "canvas", "whiteboard", "flashcards", "post"] as NoteType[])[i], body: i === 2 ? '{"nodes":[],"edges":[]}' : i === 3 ? '{"type":"excalidraw","version":2,"elements":[]}' : `# Trashed ${i + 1}\n\nIn the trash.\n`, deleted: 1, updated: c.ago(60 * 24 * (i + 1)) });
  n({ id: "ed-missing-att", title: "Missing attachments", text: "![gone.png](att:ed-att-nope)\n\n![meta without bytes](att:ed-att-meta-only)\n\n[📎 doc.pdf](att:ed-att-pdf-gone)\n\n![bad scheme](att:)\n\n![external broken](https://example.invalid/x.png)\n", updated: c.ago(28) });
  n({ id: "ed-xss", title: "HTML / script injection", text: "<script>alert('xss')</script>\n\n<img src=x onerror=alert(1)>\n\n[js link](javascript:alert(1))\n\n<iframe src=\"https://example.com\"></iframe>\n\n**Should all render as text or be stripped.**\n", updated: c.ago(29) });
  n({ id: "ed-bad-tasks", title: "Bad task dates", text: "- [ ] Impossible date 📅 2026-13-45\n- [ ] Feb 30 📅 2026-02-30\n- [ ] Two dates 📅 2026-01-01 📅 2027-01-01\n- [?] Unknown marker\n-[ ] no space\n", updated: c.ago(30) });
  n({ id: "ed-roadmap-cycle", title: "Roadmap: cyclic prerequisites", type: "roadmap", body: "# Cycle\n\n## Loop\n- [ ] A (needs: B)\n- [ ] B (needs: C)\n- [ ] C (needs: A)\n- [ ] Self (needs: Self)\n- [ ] Topic without module heading above? no\n\n## Empty module 📅 2026-02-30\n", updated: c.ago(31) });
  n({ id: "ed-roadmap-empty", title: "Roadmap: empty", type: "roadmap", body: "", updated: c.ago(32) });
  n({ id: "ed-cards-bad", title: "Malformed flashcards", type: "flashcards", text: " :: answer with no question\nquestion with no answer ::\n:: \nQ\n?\n\nA after a blank line\n", updated: c.ago(33) });
  n({ id: "ed-bogus-type", title: "Unknown note type", type: "bogus" as NoteType, text: "type is not one of NoteType.\n", updated: c.ago(34) });
  n({ id: "ed-huge-line", title: "One 200k-char line", text: "x".repeat(200_000) + "\n", updated: c.ago(35) });
  n({ id: "ed-future", title: "Updated in the future", text: "updatedAt is a year ahead.\n", updated: c.now + 365 * DAY, created: c.now + 300 * DAY });
  n({ id: "ed-epoch", title: "Updated at epoch 0", text: "updatedAt = 0.\n", updated: 0, created: 0 });
  // Raw-ish records that bypass the note() builder.
  v.notes.push({ ...note({ id: "ed-bad-props", title: "Non-string props / null tags", space: "ed-s", text: "props contain numbers and objects.\n" }), props: { n: 1, o: { a: 1 }, nul: null } as unknown as Record<string, string>, tags: ["", "#", "a".repeat(200)] });
  v.notes.push({ ...note({ id: "ed-null-folder", title: "folderId undefined", space: "ed-s" }), folderId: undefined as unknown as null });
  // Tombstones of every kind.
  v.versions.push({ ...version("ed-ver-tomb", v.notes[0], "old", c.ago(100)), deleted: 1 }, version("ed-ver-orphan", { ...v.notes[0], id: "ed-no-such-note" } as Note, "orphan version", c.ago(200), "Orphan"));
  v.cards.push({ ...card("ed-no-such-note", "x1", "due", c), id: "ed-card-orphan" }, { ...card("ed-cards-bad", "tomb", "due", c), deleted: 1 }, { ...card("ed-cards-bad", "nan", "due", c), due: NaN, ease: -1 });
  v.sessions.push(session("ed-sess-orphan", "ed-no-such-note", 30, c.ago(60)), session("ed-sess-zero", null, 0, c.ago(30)), session("ed-sess-huge", null, 60 * 30, c.at(1)), { ...session("ed-sess-tomb", null, 20, c.ago(10)), deleted: 1 });
  v.attachments.push(attachment("ed-att-meta-only", "meta-only.png", "image/png", 123_456), { ...attachment("ed-att-tomb", "deleted.mp4", "video/mp4", 5_000_000), deleted: 1 }, attachment("ed-att-weird", "", "", -1));
  v.blobs.push({ id: "ed-blob-orphan", blob: new Blob(["orphan bytes"], { type: "text/plain" }), uploaded: 0 });
  return v;
}

// ------------------------------------------------------------------ conflicts & history
export const CONFLICT_NOTE = "cf-note";
export async function seedConflicts(): Promise<Vault> {
  const c = clock();
  const v = emptyVault();
  v.spaces.push(space({ id: "cf-s", name: "History lab", kind: "area", icon: "🕰️", color: "#E3B341", sort: 1 }));
  const base = (k: number) => `---\ntype: lesson\nstatus: learning\n---\n# Attention\n\nRevision ${k}. ${words(30 + k * 6, false)}\n\n${k % 3 === 0 ? "- [x] Done step\n" : "- [ ] Open step\n"}${k > 30 ? "\n## Added later\nMore content.\n" : ""}`;
  const main = note({ id: CONFLICT_NOTE, title: "Attention (conflicted note)", space: "cf-s", type: "lesson", status: "learning", body: base(60), updated: c.ago(4) });
  v.notes.push(main);
  // 60 versions over 30 days, with labels and two conflict-saved copies.
  for (let k = 0; k < 60; k++) {
    const t = c.ago(10 + k * 12 * 60);
    const label = k === 0 ? "Other version · Pixel 8 (simulated)" : k === 7 ? "Other version · Windows PC" : k === 15 ? "Before keeping the other version" : k === 59 ? "First draft" : k % 10 === 0 ? `Restored from ${new Date(t).toLocaleDateString()}` : "";
    v.versions.push(version(`cf-v-${String(k).padStart(2, "0")}`, main, k === 0 ? base(59).replace("Revision 59", "Revision 59 — edited on the phone while offline") : base(59 - k), t, label));
  }
  const other = note({ id: "cf-note-2", title: "Pending local edits (dirty)", space: "cf-s", text: "This note has unsynced local changes (dirty = 1).\n", updated: c.ago(2) });
  v.notes.push({ ...other, dirty: 1 });
  const vs: Version[] = [];
  for (let k = 0; k < 5; k++) vs.push(version(`cf-v2-${k}`, other, `# Pending\n\nv${k}\n`, c.ago(60 * (k + 1))));
  v.versions.push(...vs);
  v.notes.push(note({ id: "cf-note-3", title: "Deleted remotely (tombstone)", space: "cf-s", text: "Another device trashed this.\n", deleted: 1, updated: c.ago(30) }));
  v.notes.push(note({ id: "cf-note-4", title: "No history yet", space: "cf-s", text: "Zero versions.\n", updated: c.ago(90) }));
  return v;
}

