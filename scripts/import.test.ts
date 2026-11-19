// Imports from Anki / Notion / Obsidian (docs/IMPORT.md). Run: npx tsx scripts/import.test.ts
// Fixtures are generated here: tiny .apkg packages built with sql.js (schema 11 JSON + schema 18 zstd), a fake Notion
// export zip and an Obsidian vault file list. Writes go to an in-memory ImportStore so undo can be checked without IndexedDB.
import initSqlJs from "sql.js";
import { decompress } from "fzstd";
import JSZip from "jszip";
import type { Folder, Kind, Note } from "../shared/types";
import { ankiPlan, ankiSummary, defaultMapping, parseOcclusionField, readAnki, replayFsrs, type AnkiDeps } from "../src/lib/import-anki";
import { htmlToMd, imageSize, planTree, vfileFromBytes, zipFiles, type ImportPlan } from "../src/lib/import-model";
import { notionDate, notionPlan, parseCsv, stripNotionId } from "../src/lib/import-notion";
import { ensureH1, normalizeFrontMatter, obsidianPlan } from "../src/lib/import-obsidian";
import { findConflicts, undoImport, writePlan, type ImportRecord, type ImportStore } from "../src/lib/import-write";
import { flashcards, splitFrontMatter } from "../src/lib/parse";
import { occlusionBlocks } from "../src/lib/occlusion";
import { parseBase } from "../src/lib/base";

let failed = 0, passed = 0;
function ok(cond: unknown, msg: string) { if (cond) passed++; else { failed++; console.error("FAIL:", msg); } }
const DAY = 86_400_000;

// ------------------------------------------------------------------ fixtures
const SQL = await initSqlJs();
const deps: AnkiDeps = { openDb: (b) => new SQL.Database(b), zstd: (b) => decompress(b) };

/** A zstd frame made of raw (stored) blocks: enough for the decoder, no compressor needed. */
function zstdRaw(data: Uint8Array): Uint8Array {
  const parts: number[] = [0x28, 0xb5, 0x2f, 0xfd, 0xa0, data.length & 255, (data.length >> 8) & 255, (data.length >> 16) & 255, (data.length >>> 24) & 255];
  const MAX = 128 * 1024;
  for (let o = 0; o < data.length || o === 0; o += MAX) {
    const chunk = data.subarray(o, o + MAX);
    const last = o + MAX >= data.length ? 1 : 0;
    const h = last | (0 << 1) | (chunk.length << 3);
    parts.push(h & 255, (h >> 8) & 255, (h >> 16) & 255, ...chunk);
    if (!data.length) break;
  }
  return new Uint8Array(parts);
}
/** Minimal protobuf writer (varint + length-delimited). */
const pb = {
  varint(n: number) { const o: number[] = []; while (n > 127) { o.push((n & 127) | 128); n = Math.floor(n / 128); } o.push(n); return o; },
  int(no: number, v: number) { return [...pb.varint(no * 8), ...pb.varint(v)]; },
  bytes(no: number, b: Uint8Array | number[]) { return [...pb.varint(no * 8 + 2), ...pb.varint(b.length), ...b]; },
  str(no: number, s: string) { return pb.bytes(no, [...new TextEncoder().encode(s)]); },
};
function png(w: number, h: number) {
  const u = new Uint8Array(33);
  u.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  u.set([w >>> 24, (w >> 16) & 255, (w >> 8) & 255, w & 255, h >>> 24, (h >> 16) & 255, (h >> 8) & 255, h & 255], 16);
  return u;
}

const CRT = Math.floor(Date.UTC(2026, 0, 1) / 1000);
const T0 = Date.UTC(2026, 9, 1);
const NOW = Date.UTC(2026, 10, 19);

/** Build the shared tables and rows; `modern` = schema 18 tables instead of col JSON. */
function buildCollection(modern: boolean): Uint8Array {
  const d = new SQL.Database();
  d.run(`create table col (id integer primary key, crt integer, mod integer, scm integer, ver integer, dty integer, usn integer, ls integer, conf text, models text, decks text, dconf text, tags text);
    create table notes (id integer primary key, guid text, mid integer, mod integer, usn integer, tags text, flds text, sfld text, csum integer, flags integer, data text);
    create table cards (id integer primary key, nid integer, did integer, ord integer, mod integer, usn integer, type integer, queue integer, due integer, ivl integer, factor integer, reps integer, lapses integer, left integer, odue integer, odid integer, flags integer, data text);
    create table revlog (id integer primary key, cid integer, usn integer, ease integer, ivl integer, lastIvl integer, factor integer, time integer, type integer);`);
  const models = {
    "1001": { id: 1001, name: "Basic", type: 0, flds: [{ name: "Front" }, { name: "Back" }], tmpls: [{ name: "Card 1" }] },
    "1002": { id: 1002, name: "Basic (and reversed card)", type: 0, flds: [{ name: "Front" }, { name: "Back" }], tmpls: [{ name: "Card 1" }, { name: "Card 2" }] },
    "1003": { id: 1003, name: "Cloze", type: 1, flds: [{ name: "Text" }, { name: "Back Extra" }], tmpls: [{ name: "Cloze" }] },
    "1004": { id: 1004, name: "Image Occlusion", type: 1, flds: [{ name: "Occlusion" }, { name: "Image" }, { name: "Header" }, { name: "Back Extra" }, { name: "Comments" }], tmpls: [{ name: "IO" }] },
    "1005": { id: 1005, name: "Vocab", type: 0, flds: [{ name: "Example" }, { name: "Word" }, { name: "Meaning" }], tmpls: [{ name: "Recognise" }] },
  };
  const decks = { "1": { id: 1, name: "Default", dyn: 0 }, "2": { id: 2, name: "Lang::Spanish", dyn: 0 }, "3": { id: 3, name: "Science", dyn: 0 } };
  if (modern) {
    d.run(`create table notetypes (id integer primary key, name text, mtime_secs integer, usn integer, config blob);
      create table fields (ntid integer, ord integer, name text, config blob);
      create table templates (ntid integer, ord integer, name text, mtime_secs integer, usn integer, config blob);
      create table decks (id integer primary key, name text, mtime_secs integer, usn integer, common blob, kind blob);`);
    for (const m of Object.values(models)) {
      d.run("insert into notetypes values (?,?,0,0,?)", [m.id, m.name, new Uint8Array([...pb.int(1, m.type), ...pb.int(2, 0)])]);
      m.flds.forEach((f, i) => d.run("insert into fields values (?,?,?,?)", [m.id, i, f.name, new Uint8Array()]));
      m.tmpls.forEach((t, i) => d.run("insert into templates values (?,?,?,0,0,?)", [m.id, i, t.name, new Uint8Array()]));
    }
    for (const dk of Object.values(decks)) d.run("insert into decks values (?,?,0,0,?,?)", [dk.id, dk.name.replace(/::/g, "\x1f"), new Uint8Array(), new Uint8Array(pb.bytes(1, []))]);
    d.run("insert into col values (1, ?, 0, 0, 18, 0, 0, 0, '', '', '', '', '')", [CRT]);
  } else d.run("insert into col values (1, ?, 0, 0, 11, 0, 0, 0, '{}', ?, ?, '{}', '{}')", [CRT, JSON.stringify(models), JSON.stringify(decks)]);
  const note = (id: number, mid: number, tags: string, ...flds: string[]) => d.run("insert into notes values (?,?,?,0,0,?,?,?,0,0,'')", [id, `g${id}`, mid, ` ${tags} `, flds.join("\x1f"), flds[0]]);
  const card = (id: number, nid: number, did: number, ord: number, type: number, queue: number, due: number, ivl: number, reps: number, lapses = 0, data = "") =>
    d.run("insert into cards values (?,?,?,?,0,0,?,?,?,?,2500,?,?,0,0,0,0,?)", [id, nid, did, ord, type, queue, due, ivl, reps, lapses, data]);
  note(1, 1001, "geo europe::capitals", "Capital of <b>France</b>?", "Paris<br>(since 987)");
  note(2, 1002, "vocab", "perro", "dog");
  note(3, 1003, "bio", "The {{c1::mitochondria}} is the {{c2::powerhouse}} of the cell.", "Extra <i>info</i>");
  note(4, 1004, "anatomy", "{{c1::image-occlusion:rect:left=.1:top=.2:width=.3:height=.1:oi=1}}{{c2::image-occlusion:ellipse:left=.5:top=.5:rx=.1:ry=.05:oi=1}}{{c2::image-occlusion:rect:left=.7:top=.7:width=.1:height=.1:oi=1}}", '<img src="heart.png">', "Heart", "", "");
  note(5, 1005, "", "Él come", "comer", "to eat");
  note(6, 1001, "", "Has image <img src=\"heart.png\"> and sound [sound:beep.mp3]", "x == y");
  // cards: note 1 review card with history; note 2 two cards (reverse new); cloze 2 cards; IO 2 cards; vocab; suspended new
  card(11, 1, 3, 0, 2, 2, (T0 - CRT * 1000) / DAY + 20, 15, 4);
  card(21, 2, 2, 0, 2, 2, (T0 - CRT * 1000) / DAY + 3, 6, 3, 1);
  card(22, 2, 2, 1, 0, 0, 5, 0, 0);
  card(31, 3, 3, 0, 1, 1, Math.floor((T0 + 600_000) / 1000), 0, 1);
  card(32, 3, 3, 1, 2, 2, (T0 - CRT * 1000) / DAY + 10, 10, 3, 0, JSON.stringify({ s: 12.5, d: 4.2 }));
  card(41, 4, 3, 0, 0, 0, 1, 0, 0);
  card(42, 4, 3, 1, 0, -1, 2, 0, 0);
  card(51, 5, 2, 0, 0, 0, 3, 0, 0);
  card(61, 6, 1, 0, 0, 0, 4, 0, 0);
  const rev = (at: number, cid: number, ease: number, ivl: number, type: number) => d.run("insert into revlog values (?,?,0,?,?,0,2500,3000,?)", [at, cid, ease, ivl, type]);
  rev(T0 - 40 * DAY, 11, 3, -600, 0); rev(T0 - 40 * DAY + 600_000, 11, 3, 1, 0); rev(T0 - 39 * DAY, 11, 3, 4, 1); rev(T0 - 35 * DAY, 11, 4, 15, 1);
  rev(T0 - 20 * DAY, 21, 3, 3, 0); rev(T0 - 17 * DAY, 21, 1, -600, 1); rev(T0 - 17 * DAY + 600_000, 21, 3, 6, 2);
  rev(T0, 31, 3, -600, 0);
  rev(T0 - 30 * DAY, 32, 3, 1, 0); rev(T0 - 29 * DAY, 32, 3, 10, 1); rev(T0 - 25 * DAY, 32, 0, 12, 4);
  const out = d.export();
  d.close();
  return out;
}
async function apkg(modern: boolean): Promise<Uint8Array> {
  const zip = new JSZip();
  const col = buildCollection(modern);
  if (modern) {
    zip.file("collection.anki21b", zstdRaw(col));
    zip.file("collection.anki2", new Uint8Array([1, 2, 3])); // the dummy (never read)
    const entries = [...pb.bytes(1, [...pb.str(1, "heart.png"), ...pb.int(2, 33)]), ...pb.bytes(1, [...pb.str(1, "beep.mp3"), ...pb.int(2, 3)])];
    zip.file("media", zstdRaw(new Uint8Array(entries)));
    zip.file("0", zstdRaw(png(400, 200)));
    zip.file("1", zstdRaw(new Uint8Array([1, 2, 3])));
  } else {
    zip.file("collection.anki21", col);
    zip.file("media", JSON.stringify({ "0": "heart.png", "1": "beep.mp3" }));
    zip.file("0", png(400, 200));
    zip.file("1", new Uint8Array([1, 2, 3]));
  }
  return zip.generateAsync({ type: "uint8array" });
}

// ------------------------------------------------------------------ in-memory store
function memStore(seedNotes: Note[] = []) {
  const tables = new Map<Kind, Map<string, Record<string, unknown> & { id: string }>>();
  const t = (k: Kind) => { let m = tables.get(k); if (!m) tables.set(k, (m = new Map())); return m; };
  for (const n of seedNotes) t("note").set(n.id, { ...n });
  const blobs = new Map<string, Uint8Array>();
  let reg: ImportRecord[] = [];
  let n = 0;
  const store: ImportStore = {
    notesIn: async (s) => [...t("note").values()].filter((x) => x.spaceId === s) as unknown as Note[],
    foldersIn: async (s) => [...t("folder").values()].filter((x) => x.spaceId === s) as unknown as Folder[],
    get: async (k, id) => t(k).get(id),
    put: async (k, r) => { t(k).set(r.id, { ...r }); },
    putBlob: async (id, b) => { blobs.set(id, b); },
    deleteBlob: async (id) => { blobs.delete(id); },
    tagged: async (k, id) => [...t(k).values()].filter((r) => r.lumenImport === id),
    batch: async (fn) => fn(),
    registry: async () => reg,
    setRegistry: async (r) => { reg = r; },
    uid: () => `id${++n}`,
  };
  const live = (k: Kind) => [...t(k).values()].filter((r) => !r.deleted);
  return { store, live, blobs, t };
}
const noteFix = (id: string, title: string, body: string, spaceId = "s1"): Note => ({ id, title, body, spaceId, folderId: null, tags: [], type: "note", status: null, pinned: 0, favorite: 0, published: 0, slug: "", props: {}, createdAt: 1, updatedAt: 1, deleted: 0 });

// ------------------------------------------------------------------ unit helpers
ok(htmlToMd("Capital of <b>France</b>?") === "Capital of **France**?", "html bold");
ok(htmlToMd("a<br>b<div>c</div>") === "a\nb\nc", `html br/div (${JSON.stringify(htmlToMd("a<br>b<div>c</div>"))})`);
ok(htmlToMd("<ul><li>x</li><li>y</li></ul>") === "- x\n- y", "html list");
ok(htmlToMd("\\(x^2\\) &amp; &lt;b&gt; &#233;") === "$x^2$ & <b> é", `html math + entities (${htmlToMd("\\(x^2\\) &amp; &lt;b&gt; &#233;")})`);
ok(htmlToMd('<img src="a.png">', (n) => `![](${n})`) === "![](a.png)", "html img via media map");
ok(JSON.stringify(imageSize(png(400, 200))) === '{"w":400,"h":200}', "png size");
ok(stripNotionId("Project plan 0123456789abcdef0123456789abcdef.md") === "Project plan", "strip notion id");
ok(stripNotionId("Tasks 0123456789abcdef0123456789abcdef_all.csv") === "Tasks", "strip notion id _all csv");
ok(notionDate("November 19, 2026") === "2026-11-19" && notionDate("Nov 3, 2026 10:00 AM → Nov 5, 2026") === "2026-11-03", "notion dates");
ok(JSON.stringify(parseCsv('a,b\n"x, y","he said ""hi"""\n')) === JSON.stringify([["a", "b"], ["x, y", 'he said "hi"']]), "csv quoting");
ok(normalizeFrontMatter("---\ntags:\n  - a\n  - b\nx: 1\n---\nhi").startsWith("---\ntags: [a, b]\nx: 1\n---\n"), "front matter block list");
ok(ensureH1("---\na: 1\n---\nText", "T") === "---\na: 1\n---\n# T\n\nText", "ensureH1 adds title");
ok(ensureH1("# T\n\nText", "T") === "# T\n\nText", "ensureH1 keeps title");
{
  const s = parseOcclusionField("{{c1::image-occlusion:rect:left=.1:top=.2:width=.3:height=.1:oi=1}}{{c2::image-occlusion:polygon:points=.1,.1 .3,.1 .2,.4}}");
  ok(s.length === 2 && s[0].hideAll && Math.abs(s[1].h - 0.3) < 1e-9, "occlusion shapes (rect + polygon bbox)");
}
{
  const r = replayFsrs([{ at: 0, grade: 2 }, { at: 3 * DAY, grade: 2 }, { at: 12 * DAY, grade: 2 }]);
  ok(!!r && r.s > 3 && r.d >= 1 && r.d <= 10 && r.last === 12 * DAY, `fsrs replay grows stability (${r?.s})`);
}

// ------------------------------------------------------------------ Anki (both formats)
for (const modern of [false, true]) {
  const label = modern ? "anki21b" : "anki21";
  const col = await readAnki(await apkg(modern), "Deck.apkg", deps);
  const sum = ankiSummary(col);
  ok(sum.notes === 6 && sum.cards === 9, `${label}: counts ${sum.notes}/${sum.cards}`);
  ok(col.types.get("1003")?.kind === "cloze" && col.types.get("1004")?.kind === "occlusion" && col.types.get("1001")?.kind === "basic", `${label}: note type kinds`);
  ok([...col.decks.values()].some((d) => d.name === "Lang::Spanish"), `${label}: sub-deck name`);
  ok(col.media.has("heart.png") && col.media.has("beep.mp3"), `${label}: media map`);
  const mapping = defaultMapping(col);
  ok(mapping["1005"].front === 1 && mapping["1005"].back === 2, `${label}: custom type mapping picks Word/Meaning`);
  ok(mapping["1002"].reverse && !mapping["1001"].reverse, `${label}: reverse default from templates`);
  const plan = await ankiPlan(col, { keepHistory: true, mapping, now: NOW });
  const titles = plan.notes.map((n) => `${n.folder.join("/")}|${n.title}`).sort();
  ok(JSON.stringify(titles) === JSON.stringify(["Lang|Spanish", "|Default", "|Science"].sort()), `${label}: one note per deck, folder per parent (${titles})`);
  const sci = plan.notes.find((n) => n.title === "Science")!;
  const sp = plan.notes.find((n) => n.title === "Spanish")!;
  const fc = flashcards(sci.body);
  ok(sci.body.includes("Capital of **France**? :: ") === false && sci.body.includes("Capital of **France**?\n?\nParis\n(since 987)"), `${label}: multi-line answer uses ? form`);
  ok(fc.some((c) => c.kind === "cloze" && c.cloze!.n === 2) && fc.some((c) => c.kind === "cloze" && c.cloze!.n === 1), `${label}: cloze cards c1, c2`);
  ok(sci.body.includes("{{c1::mitochondria}}"), `${label}: cloze syntax kept`);
  const occ = occlusionBlocks(sci.body)[0];
  ok(!!occ && occ.data.mode === "hide-all" && occ.data.boxes.length === 3 && occ.data.boxes.filter((b) => b.group === "c2").length === 2, `${label}: occlusion block with grouped c2`);
  ok(occ && /^att:@@m\d+@@$/.test(occ.data.image), `${label}: occlusion image is an attachment ref`);
  ok(fc.filter((c) => c.kind === "occlusion").length === 2, `${label}: two occlusion cards`);
  ok(sp.body.includes("perro :: dog") && sp.body.includes("dog :: perro"), `${label}: basic + reversed`);
  ok(sp.body.includes("comer :: to eat"), `${label}: custom note type front/back mapping`);
  ok(sp.tags.includes("vocab") && sci.tags.includes("europe/capitals"), `${label}: tags (:: → /)`);
  const def = plan.notes.find((n) => n.title === "Default")!;
  ok(def.body.includes("=\\=") && def.body.includes("![beep.mp3](att:@@") && def.body.includes("![heart.png](att:@@"), `${label}: == escaped, image + sound attachments`);
  ok(plan.attachments.size === 2, `${label}: two attachments (${plan.attachments.size})`);
  // schedules
  const capital = plan.cards.find((c) => c.noteKey === sci.key && fc.find((x) => x.key === c.cardKey)?.q.startsWith("Capital"));
  ok(!!capital && capital.state === "review" && capital.interval === 15 && Math.abs(capital.due - (T0 + 20 * DAY)) < DAY && capital.stability! > 1, `${label}: review card keeps due and gets FSRS state`);
  const cz2 = plan.cards.find((c) => c.cardKey.startsWith("cz2-"));
  ok(cz2?.stability === 12.5 && cz2.difficulty === 4.2, `${label}: Anki FSRS memory (cards.data) wins`);
  const learning = plan.cards.find((c) => c.cardKey.startsWith("cz1-"));
  ok(learning?.state === "learning" && learning.due === T0 + 600_000, `${label}: learning card due in seconds`);
  ok(plan.cards.some((c) => c.suspended === 1 && c.state === "new"), `${label}: suspended new card kept`);
  ok(plan.reviews.length === 10, `${label}: review log rows without manual entries (${plan.reviews.length})`);
  const capRevs = plan.reviews.filter((r) => r.cardKey === capital?.cardKey);
  ok(capRevs[0]?.state === "new" && capRevs[3]?.grade === 3 && Math.abs(capRevs[3].elapsed - 4) < 0.01, `${label}: review rows state/grade/elapsed`);
  const noHist = await ankiPlan(col, { keepHistory: false, mapping, now: NOW });
  ok(noHist.cards.length === 0 && noHist.reviews.length === 0, `${label}: keep history off → fresh cards`);
  // every schedule maps to a card the note really has
  ok(plan.cards.every((c) => flashcards(plan.notes.find((n) => n.key === c.noteKey)!.body).some((x) => x.key === c.cardKey)), `${label}: card keys match parsed note`);

  // write + undo
  if (!modern) {
    const m = memStore();
    const rec = await writePlan(plan, { spaceId: "s1", folderId: null, rootFolder: "Anki", now: NOW }, m.store);
    ok(rec.counts.notes === 3 && rec.counts.attachments === 2 && rec.counts.cards === plan.cards.length && rec.counts.reviews === 10, `write counts ${JSON.stringify(rec.counts)}`);
    const notes = m.live("note") as unknown as Note[];
    ok(notes.every((n) => !n.body.includes("att:@@")) && notes.some((n) => /att:id\d+/.test(n.body)), "attachment refs replaced");
    const sciNote = notes.find((n) => n.title === "Science")!;
    ok(sciNote.type === "flashcards" && sciNote.tags.includes("bio"), "note type + tags from front matter");
    const card = m.live("card")[0] as { id: string; noteId: string };
    ok(card.id.startsWith(card.noteId + ":"), "card id = noteId:key");
    ok((m.live("folder") as unknown as Folder[]).some((f) => f.name === "Lang"), "parent deck folder");
    ok(m.blobs.size === 2, "blobs stored");
    const removed = await undoImport(rec.id, m.store);
    ok(removed > 0 && m.live("note").length === 0 && m.live("card").length === 0 && m.live("review").length === 0 && m.live("folder").length === 0 && m.live("attachment").length === 0, "undo removes the whole batch");
    ok(m.blobs.size === 0, "undo drops blobs");
    ok((await m.store.registry())[0].undone === true, "registry marked undone");
  }
}

// ------------------------------------------------------------------ Notion
{
  const H = "0123456789abcdef0123456789abcdef", H2 = "fedcba9876543210fedcba9876543210", H3 = "11112222333344445555666677778888";
  const zip = new JSZip();
  zip.file(`Home ${H}.md`, `# Home\n\nSee [Plan](Home%20${H}/Plan%20${H2}.md) and the [tasks](Home%20${H}/Tasks%20${H3}.csv).\n\n![diagram](Home%20${H}/diagram.png)\n\n<aside>\n💡 Remember <b>this</b>\n</aside>\n\n<iframe src="https://figma.com/x"></iframe>\n\n[Elsewhere](https://www.notion.so/Other-abc)\n`);
  zip.file(`Home ${H}/Plan ${H2}.md`, `# Plan\n\nBack to [Home](../Home%20${H}.md).\n`);
  zip.file(`Home ${H}/diagram.png`, png(10, 10));
  zip.file(`Home ${H}/Tasks ${H3}.csv`, "﻿Name,Status,Due,Tags,Done,Related\nWrite intro,In progress,\"November 19, 2026\",\"writing, draft\",Yes,Plan (../Home%20" + H + "/Plan%20" + H2 + ".md)\nNo page row,Done,,,No,\n");
  zip.file(`Home ${H}/Tasks ${H3}/Write intro aaaabbbbccccddddeeeeffff00001111.md`, "# Write intro\n\nStatus: In progress\nDue: November 19, 2026\nTags: writing, draft\n\nDraft the intro.\n");
  if (process.env.FIXTURES) (await import("node:fs")).writeFileSync(`${process.env.FIXTURES}/notion-export.zip`, await zip.generateAsync({ type: "uint8array" }));
  const outer = new JSZip();
  outer.file("Export-1234-Part-1.zip", await zip.generateAsync({ type: "uint8array" }));
  const { expandNestedZips } = await import("../src/lib/import-model");
  const files = await expandNestedZips(await zipFiles(await outer.generateAsync({ type: "uint8array" })));
  const plan = await notionPlan(files, "Export.zip");
  const home = plan.notes.find((n) => n.title === "Home")!;
  ok(!!home && home.folder.length === 0, "notion: root page");
  ok(home.body.includes("[[Plan]]") && home.body.includes("[[Tasks|tasks]]"), `notion: internal links → [[Title]] (${home.body})`);
  ok(/!\[diagram\]\(att:@@a\d+@@\)/.test(home.body), "notion: image → attachment");
  ok(!home.body.includes("</iframe>") && home.body.includes("<https://figma.com/x>"), "notion: iframe → link");
  ok(home.body.includes("> [!note]") && home.body.includes("**this**"), "notion: aside → callout");
  const plan2 = plan.notes.find((n) => n.title === "Plan")!;
  ok(plan2.folder.join("/") === "Home" && plan2.body.includes("[[Home]]"), "notion: folder tree + relative ../ link");
  const base = plan.notes.find((n) => n.type === "base")!;
  ok(base?.title === "Tasks" && base.folder.join("/") === "Home", "notion: database → base note");
  ok(base.body.includes('file.inFolder("@@FOLDER:Home/Tasks@@")'), "notion: base filters the rows folder");
  const rows = plan.notes.filter((n) => n.badge === "row");
  ok(rows.length === 2 && rows.every((r) => r.folder.join("/") === "Home/Tasks"), "notion: rows → notes in the database folder");
  const row = rows.find((r) => r.title === "Write intro")!;
  const fm = splitFrontMatter(row.body).data;
  ok(fm["notion-status"] === "In progress" && fm.Due === "2026-11-19" && fm.Done === "true" && fm.Related === "[[Plan]]", `notion: row properties ${JSON.stringify(fm)}`);
  ok(row.tags.join(",") === "writing,draft" && row.body.includes("Draft the intro.") && !row.body.includes("Status: In progress"), "notion: row tags + body without property lines");
  ok(plan.warnings.some((w) => /embed/.test(w)) && plan.warnings.some((w) => /aren't in this export|isn't in this export|in this export/.test(w)), `notion: warnings ${plan.warnings}`);
  const tree = planTree(plan);
  ok(tree.children[0].kind === "folder" && tree.noteKeys.length === plan.notes.length, "notion: preview tree");
  // write: FOLDER placeholder resolved to the absolute folder path, base parses
  const m = memStore();
  const rec = await writePlan(plan, { spaceId: "s1", folderId: null, rootFolder: "Notion", now: NOW }, m.store);
  const bn = (m.live("note") as unknown as Note[]).find((n) => n.type === "base")!;
  ok(bn.body.includes('file.inFolder("Notion/Home/Tasks")') && parseBase(bn.body).found && !parseBase(bn.body).error, `notion: base body after write (${bn.body})`);
  ok(rec.counts.attachments === 1, "notion: one attachment written");
}

// ------------------------------------------------------------------ Obsidian + conflicts
{
  const files = [
    vfileFromBytes("Vault/Welcome.md", "---\ntags:\n  - start\n  - guide\n---\nHello [[Ideas]] and ![[cat.png|200]] plus ![pdf](files/paper%20one.pdf) and [ideas](Projects/Ideas.md). #inline\n```\n![[not-an-embed.png]]\n```\n"),
    vfileFromBytes("Vault/Projects/Ideas.md", "# Ideas\n\nSee [[Welcome]].\n"),
    vfileFromBytes("Vault/Projects/Board.canvas", JSON.stringify({ nodes: [{ id: "a", type: "text", text: "x", x: 0, y: 0, width: 10, height: 10 }], edges: [] })),
    vfileFromBytes("Vault/Projects/Books.base", "views:\n  - type: table\n    name: All\n"),
    vfileFromBytes("Vault/Sketch.excalidraw.md", "---\nexcalidraw-plugin: parsed\n---\n## Drawing\n```json\n{\"type\":\"excalidraw\",\"elements\":[{\"id\":\"r\",\"type\":\"rectangle\"}]}\n```\n"),
    vfileFromBytes("Vault/attachments/cat.png", png(5, 5)),
    vfileFromBytes("Vault/files/paper one.pdf", "%PDF-1.4"),
    vfileFromBytes("Vault/unused.png", png(1, 1)),
    vfileFromBytes("Vault/.obsidian/app.json", "{}"),
  ];
  if (process.env.FIXTURES) {
    const fs = await import("node:fs");
    for (const f of files) { const out = `${process.env.FIXTURES}/${f.path}`; fs.mkdirSync(out.replace(/\/[^/]+$/, ""), { recursive: true }); fs.writeFileSync(out, await f.bytes()); }
  }
  const plan: ImportPlan = await obsidianPlan(files, "Vault");
  ok(plan.name === "Vault" && plan.notes.length === 5, `obsidian: notes (${plan.notes.map((n) => n.title)})`);
  const w = plan.notes.find((n) => n.title === "Welcome")!;
  ok(w.body.startsWith("---\ntags: [start, guide]\n---\n# Welcome\n"), `obsidian: front matter + H1 (${JSON.stringify(w.body.slice(0, 60))})`);
  ok(/!\[cat\.png\]\(att:@@o\d+@@\)/.test(w.body) && /!\[pdf\]\(att:@@o\d+@@\)/.test(w.body), "obsidian: ![[img]] and relative path → attachments");
  ok(w.body.includes("[[Ideas|ideas]]") && w.body.includes("[[Ideas]]"), "obsidian: md links → wikilinks, wikilinks kept");
  ok(w.body.includes("![[not-an-embed.png]]"), "obsidian: code untouched");
  ok(plan.notes.find((n) => n.title === "Board")?.type === "canvas", "obsidian: canvas native");
  ok(plan.notes.find((n) => n.title === "Books")?.type === "base", "obsidian: .base → base note");
  ok(plan.notes.find((n) => n.title === "Sketch")?.type === "whiteboard", "obsidian: simple excalidraw → whiteboard");
  ok(plan.warnings.some((x) => /linked from any note/.test(x)), "obsidian: unreferenced file warning");
  ok(plan.notes.find((n) => n.title === "Ideas")!.folder.join("/") === "Projects", "obsidian: folders kept");

  // conflicts: Welcome exists → merge, Ideas exists → rename (links follow), Board exists → skip
  const m = memStore([noteFix("e1", "Welcome", "# Welcome\n\nOld text\n"), noteFix("e2", "Ideas", "# Ideas\n\nmine\n"), noteFix("e3", "Board", "{}")]);
  const conflicts = findConflicts(plan, await m.store.notesIn("s1"));
  ok(conflicts.length === 3, `conflicts found (${conflicts.length})`);
  const rec = await writePlan(plan, { spaceId: "s1", folderId: null, conflicts: { "Welcome.md": "merge", "Projects/Ideas.md": "rename", "Projects/Board.canvas": "skip" }, now: NOW }, m.store);
  const notes = m.live("note") as unknown as Note[];
  const merged = notes.find((n) => n.id === "e1")!;
  ok(merged.body.startsWith("# Welcome\n\nOld text") && merged.body.includes("Hello [[Ideas 2]]") && merged.tags.includes("start") && merged.tags.includes("inline"), `merge appends + links follow rename (${merged.body})`);
  ok(notes.some((n) => n.title === "Ideas 2" && n.body.startsWith("# Ideas 2")), "rename gives Title 2");
  ok(rec.counts.skipped === 1 && rec.counts.merged === 1 && rec.counts.renamed === 1, `conflict counts ${JSON.stringify(rec.counts)}`);
  ok(notes.find((n) => n.title === "Sketch")?.type === "whiteboard", "whiteboard written");
  // selection: only Projects/Ideas
  const m2 = memStore();
  const r2 = await writePlan(plan, { spaceId: "s1", folderId: null, selected: new Set(["Projects/Ideas.md"]), now: NOW }, m2.store);
  ok(r2.counts.notes === 1 && r2.counts.attachments === 0, "selection limits notes and attachments");
  await undoImport(rec.id, m.store);
  const after = m.live("note") as unknown as Note[];
  ok(after.length === 3 && after.find((n) => n.id === "e1")!.body === "# Welcome\n\nOld text\n", "undo restores the merged note and removes the rest");
}

if (process.env.FIXTURES) {
  const fs = await import("node:fs");
  fs.writeFileSync(`${process.env.FIXTURES}/deck-modern.apkg`, await apkg(true));
  fs.writeFileSync(`${process.env.FIXTURES}/deck-legacy.apkg`, await apkg(false));
}
if (process.env.SHOW) {
  const col = await readAnki(await apkg(true), "D.apkg", deps);
  const p = await ankiPlan(col, { keepHistory: true, mapping: defaultMapping(col), now: NOW });
  for (const n of p.notes) console.log("=====", n.folder, n.title, String.fromCharCode(10) + n.body);
  console.log(p.cards, p.warnings);
}
console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
