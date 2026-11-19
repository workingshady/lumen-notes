// Slash commands ("/" menu, Confluence / Notion / Obsidian style) + the visual Insert gallery + the block menu's glyphs.
// One catalog drives all three: every command inserts plain Markdown that Lumen already renders (see markdown.ts):
//   ::: columns / column 30%, ::: tabs, ::: expand, ::: info|warning… panels, > [!type] callouts, ::: wide|full|center|aside,
//   [[toc]], :status[…], ![[Note#Heading]], ```mermaid, $$ math $$, ==highlight==, footnotes, Q :: A flashcards, ```query.
// Typing:  "/"  at the start of a line or after a space opens the menu (components/SlashMenu.tsx);  "//"  inserts today's
// date (as in Confluence). Never opens inside a URL or a code fence. Design: Lumen 16 Editor and Read (R4-16A/B/C, P1).
import type { EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { newOcclusion, occlusionFence } from "./occlusion";
import { timestampMd, videoClock } from "./video-notes";

export type SlashGroup = "Basic" | "Layout" | "Panels & callouts" | "Media & embeds" | "Knowledge" | "Advanced";
export interface SlashCommand {
  id: string;
  label: string;
  group: SlashGroup;
  /** Extra words matched by the filter (aliases from Confluence / Notion / Obsidian). */
  keys: string;
  /** Lumen glyph name (lib/glyphs.ts) shown in the slash row, the Insert gallery and the block menu. */
  glyph: string;
  hint: string;
  /** Markdown shortcut shown at the end of the row (`##`, `[]`, ```…). */
  sc?: string;
  /** Layout thumbnail kind (components/LayoutThumb.tsx) when the block appears in the Insert gallery. */
  thumb?: string;
  /** One-line description for the gallery preview. */
  desc?: string;
  /** Markdown to insert; `$0` marks where the cursor goes. A block snippet starts on its own line. */
  text: string | (() => string);
  block?: boolean;
  /** Runs an editor action instead of inserting text (handled by the caller). */
  action?: "file" | "voice";
}

const today = () => new Date().toISOString().slice(0, 10);
const COLOR_WORD: Record<string, string> = { info: "blue", note: "grey", success: "green", warning: "amber", error: "red", tip: "green", important: "amber", question: "violet", example: "grey", abstract: "grey", todo: "blue", bug: "red", danger: "red" };
const CALLOUT_GLYPH: Record<string, string> = { info: "c-info", note: "c-note", success: "c-success", warning: "c-warning", error: "c-danger", tip: "c-tip", important: "c-warning", question: "c-question", example: "c-example", abstract: "c-abstract", todo: "task", bug: "c-danger", danger: "c-danger", quote: "c-quote" };
const panel = (kind: string, title: string, thumb?: string): SlashCommand => ({
  id: `panel-${kind}`, label: title, group: "Panels & callouts", keys: `panel callout ${kind} ${title} box admonition confluence`, glyph: CALLOUT_GLYPH[kind] ?? "c-info",
  hint: `Panel · ${COLOR_WORD[kind] ?? "blue"}`, text: `::: ${kind} ${title}\n$0\n:::\n`, block: true, thumb, desc: `A ${COLOR_WORD[kind] ?? "blue"} ${title.toLowerCase()} panel with a glyph. Works as an Obsidian callout too.`,
});
const callout = (kind: string, title: string, extra = "", thumb?: string): SlashCommand => ({
  id: `callout-${kind}`, label: title, group: "Panels & callouts", keys: `callout ${kind} ${title} obsidian admonition panel ${extra}`, glyph: CALLOUT_GLYPH[kind] ?? "c-info",
  hint: `Panel · ${COLOR_WORD[kind] ?? "blue"}`, text: `> [!${kind}] ${title}\n> $0\n`, block: true, thumb, desc: `A ${COLOR_WORD[kind] ?? "blue"} ${title.toLowerCase()} panel, written as an Obsidian callout.`,
});

export const SLASH: SlashCommand[] = [
  // ---- Basic (Notion "Basic blocks")
  { id: "text", label: "Text", group: "Basic", keys: "text paragraph plain body normal", glyph: "text", hint: "Plain paragraph", text: "$0", block: true },
  { id: "h1", label: "Heading 1", group: "Basic", keys: "h1 title big heading", glyph: "h1", hint: "Page title", sc: "#", text: "# $0", block: true },
  { id: "h2", label: "Heading 2", group: "Basic", keys: "h2 subtitle heading section", glyph: "h2", hint: "Section title", sc: "##", text: "## $0", block: true },
  { id: "h3", label: "Heading 3", group: "Basic", keys: "h3 heading small subsection", glyph: "h3", hint: "Subsection", sc: "###", text: "### $0", block: true },
  { id: "bullet", label: "Bulleted list", group: "Basic", keys: "ul bullet list unordered", glyph: "list", hint: "Simple list", sc: "-", text: "- $0", block: true },
  { id: "numbered", label: "Numbered list", group: "Basic", keys: "ol numbered ordered list", glyph: "numbered", hint: "List with numbers", sc: "1.", text: "1. $0", block: true },
  { id: "todo", label: "Task list", group: "Basic", keys: "todo task checkbox action item checklist", glyph: "task", hint: "Checkboxes", sc: "[]", text: "- [ ] $0", block: true },
  { id: "quote", label: "Quote", group: "Basic", keys: "quote blockquote citation", glyph: "quote", hint: "Capture a quote", sc: ">", text: "> $0", block: true },
  { id: "divider", label: "Divider", group: "Basic", keys: "divider hr rule line separator ---", glyph: "divider", hint: "Separate sections", sc: "---", text: "\n---\n$0", block: true },
  { id: "code", label: "Code", group: "Basic", keys: "code block snippet fence pre", glyph: "code", hint: "With language and copy", sc: "```", text: "```python\n$0\n```\n", block: true },
  { id: "math-block", label: "Math", group: "Basic", keys: "math block latex katex equation display", glyph: "math-block", hint: "KaTeX block", sc: "$$", text: "$$\n$0\n$$\n", block: true },
  { id: "table", label: "Table", group: "Basic", keys: "table grid rows columns", glyph: "table", hint: "3 × 3, sortable in Read", sc: "|", text: "| $0Column | Column | Column |\n| --- | --- | --- |\n|  |  |  |\n|  |  |  |\n", block: true },
  { id: "highlight", label: "Highlight", group: "Basic", keys: "highlight mark marker yellow", glyph: "highlight", hint: "==highlighted text==", sc: "==", text: "==$0==" },
  { id: "footnote", label: "Footnote", group: "Basic", keys: "footnote reference citation note", glyph: "footnote", hint: "Reference at the bottom", sc: "[^1]", text: "[^1]$0\n\n[^1]: Footnote text" },
  // ---- Layout (Confluence layouts / columns)
  { id: "cols2", label: "2 columns", group: "Layout", keys: "layout columns 2 two split side by side", glyph: "columns-2", hint: "Side by side, stacks on phone", thumb: "cols-2", desc: "Two equal columns. Stacks on phones.", text: "::: columns\n::: column\n$0Left column\n:::\n::: column\nRight column\n:::\n:::\n", block: true },
  { id: "cols3", label: "3 columns", group: "Layout", keys: "layout columns 3 three", glyph: "columns-3", hint: "Three equal columns", thumb: "cols-3", desc: "Three equal columns. Stacks on phones.", text: "::: columns\n::: column\n$0First\n:::\n::: column\nSecond\n:::\n::: column\nThird\n:::\n:::\n", block: true },
  { id: "cols4", label: "4 columns", group: "Layout", keys: "layout columns 4 four grid", glyph: "columns-4", hint: "Four equal columns", text: "::: columns\n::: column\n$0One\n:::\n::: column\nTwo\n:::\n::: column\nThree\n:::\n::: column\nFour\n:::\n:::\n", block: true },
  { id: "sidebar-l", label: "Sidebar + main", group: "Layout", keys: "layout sidebar left 30 70 nav", glyph: "sidebar-main", hint: "30% / 70%", thumb: "cols-side", desc: "Two columns, 30% / 70%. Stacks on phones.", text: "::: columns\n::: column 30%\n$0\n:::\n::: column\n\n:::\n:::\n", block: true },
  { id: "sidebar-r", label: "Main + sidebar", group: "Layout", keys: "layout sidebar right 70 30 aside", glyph: "sidebar-main", hint: "70% / 30%", text: "::: columns\n::: column 70%\n$0Main content\n:::\n::: column 30%\n> [!info] Sidebar\n> Notes, links, status\n:::\n:::\n", block: true },
  { id: "three-sb", label: "Main between sidebars", group: "Layout", keys: "layout three sidebars 25 50 25", glyph: "columns-3", hint: "25% / 50% / 25%", text: "::: columns\n::: column 25%\nLeft\n:::\n::: column 50%\n$0Main\n:::\n::: column 25%\nRight\n:::\n:::\n", block: true },
  { id: "tabs", label: "Tabs", group: "Layout", keys: "tabs tabbed switch tabset", glyph: "tabs", hint: "Each heading becomes a tab", thumb: "tabs", desc: "Each heading inside becomes a tab; the text under it is its panel.", text: "::: tabs\n## First tab\n$0Content of the first tab.\n\n## Second tab\nContent of the second tab.\n:::\n", block: true },
  { id: "toggle", label: "Toggle", group: "Layout", keys: "toggle expand collapse details fold accordion spoiler", glyph: "expand", hint: "Folded until opened", thumb: "expand", desc: "Folded until opened (Confluence Expand, Notion Toggle).", text: "::: expand Click to show\n$0\n:::\n", block: true },
  // ---- Panels & callouts (Confluence panels + Obsidian callouts)
  panel("info", "Info", "panel-info"), panel("note", "Note"), callout("tip", "Tip", "hint", "panel-tip"), panel("success", "Success"), panel("warning", "Warning", "panel-warn"), panel("error", "Error"),
  callout("important", "Important"), callout("question", "Question", "faq help"), callout("example", "Example"),
  callout("abstract", "Summary", "tldr abstract"), callout("todo", "To do"), callout("bug", "Bug"), callout("danger", "Danger"),
  { id: "callout-fold", label: "Folded callout", group: "Panels & callouts", keys: "callout fold collapsible collapsed", glyph: "expand", hint: "> [!note]- folded by default", text: "> [!note]- Title\n> $0\n", block: true },
  { id: "aside", label: "Aside", group: "Panels & callouts", keys: "aside margin note sidenote", glyph: "aside", hint: "Small note beside the text", thumb: "aside", desc: "A small side note in a muted box beside the text.", text: "::: aside\n$0\n:::\n", block: true },
  { id: "center", label: "Center", group: "Panels & callouts", keys: "center centred align middle", glyph: "center", hint: "Centre text or an image", thumb: "center", desc: "Centres everything inside: a quote, an image, a formula.", text: "::: center\n$0\n:::\n", block: true },
  // ---- Media & embeds
  { id: "file", label: "Image", group: "Media & embeds", keys: "image picture photo file upload attachment pdf video audio", glyph: "image", hint: "Upload or link", text: "", action: "file" },
  { id: "voice", label: "Voice note", group: "Media & embeds", keys: "voice record dictate transcribe audio", glyph: "voice", hint: "Record and transcribe", text: "", action: "voice" },
  { id: "youtube", label: "Video", group: "Media & embeds", keys: "youtube vimeo video embed", glyph: "video", hint: "YouTube or Vimeo link on its own line", text: "\nhttps://www.youtube.com/watch?v=$0\n", block: true },
  { id: "timestamp", label: "Timestamp", group: "Media & embeds", keys: "timestamp time video moment seek chapter lecture", glyph: "timestamp", hint: "[12:34] at the playing video's time", sc: "Alt+T", text: () => { const c = videoClock.now(); return timestampMd(c ? Math.floor(c.seconds) : 0, c?.video ?? 1) + " $0"; } },
  { id: "linkcard", label: "Link card", group: "Media & embeds", keys: "link card bookmark preview url web", glyph: "link-card", hint: "<https://…> shows a preview card", text: "<https://$0>\n", block: true },
  { id: "embed-note", label: "Embed a note", group: "Media & embeds", keys: "embed transclude note excerpt synced", glyph: "block-embed", hint: "![[Note]] shows it inline", sc: "![[", text: "![[$0]]\n", block: true },
  // ---- Knowledge (Obsidian / study)
  { id: "link", label: "Link to note", group: "Knowledge", keys: "link wiki wikilink page mention reference", glyph: "wikilink", hint: "[[Note]] with autocomplete", sc: "[[", text: "[[$0" },
  { id: "block-ref", label: "Link to block", group: "Knowledge", keys: "block reference ref anchor ^id link paragraph", glyph: "wikilink", hint: "[[Note#^id]] jumps to one block", sc: "#^", text: "[[$0#^" },
  { id: "tag", label: "Tag", group: "Knowledge", keys: "tag label hashtag", glyph: "tag", hint: "#tag", sc: "#", text: "#$0" },
  { id: "flashcard", label: "Flashcard", group: "Knowledge", keys: "flashcard card anki spaced repetition question answer", glyph: "flashcards", hint: "Question :: Answer (shows in Review)", sc: "::", text: "$0Question :: Answer", block: true },
  { id: "occlusion", label: "Image occlusion", group: "Knowledge", keys: "image occlusion cards hide boxes diagram label anki flashcard", glyph: "occlusion", hint: "Hide parts of an image, one card per box", text: () => occlusionFence(newOcclusion()) + "\n$0", block: true },
  { id: "math-inline", label: "Inline math", group: "Knowledge", keys: "math latex katex equation inline", glyph: "math", hint: "$x^2$ inside a sentence", sc: "$", text: "$$0$" },
  { id: "mermaid", label: "Diagram", group: "Knowledge", keys: "mermaid diagram flowchart graph chart sequence", glyph: "mermaid", hint: "Mermaid flowchart from text", sc: "```mermaid", text: "```mermaid\nflowchart LR\n  A[$0Start] --> B[Next]\n```\n", block: true },
  // ---- Advanced (Confluence macros)
  { id: "wide", label: "Wide", group: "Advanced", keys: "wide breakout full width", glyph: "wide", hint: "Breaks out of the text column", thumb: "wide", desc: "Breaks out of the text column for wide tables, diagrams or images.", text: "::: wide\n$0\n:::\n", block: true },
  { id: "full", label: "Full width", group: "Advanced", keys: "full width edge to edge", glyph: "full", hint: "Uses the whole pane", thumb: "full", desc: "Uses the whole pane, edge to edge.", text: "::: full\n$0\n:::\n", block: true },
  { id: "toc", label: "Contents", group: "Advanced", keys: "toc table of contents outline headings index", glyph: "toc", hint: "Built from this note's headings", sc: "[[toc]]", thumb: "toc", desc: "Built from this note's headings; the section you're reading is bold.", text: "[[toc]]\n$0", block: true },
  { id: "include", label: "Include", group: "Advanced", keys: "include section heading excerpt synced block reuse transclude", glyph: "include", hint: "![[Note#Heading]] stays in sync", thumb: "include", desc: "A live copy of another note's section, with a source chip.", text: "![[$0Note title#Heading]]\n", block: true },
  { id: "cards", label: "Cards", group: "Advanced", keys: "cards grid tiles boxes features", glyph: "v-gallery", hint: "Three cards in a row", thumb: "cards", desc: "Three bordered cards; each #### heading is a card title.", text: "::: columns cards\n::: column\n#### $0First\nOne line about it.\n:::\n::: column\n#### Second\nOne line about it.\n:::\n::: column\n#### Third\nOne line about it.\n:::\n:::\n", block: true },
  { id: "status", label: "Status", group: "Advanced", keys: "status pill lozenge badge label progress", glyph: "status-pill", hint: ":status[In review]{amber}", text: ":status[$0In progress] " },
  { id: "date", label: "Date", group: "Advanced", keys: "date today now time // calendar", glyph: "date", hint: "Today · also type //", sc: "//", text: () => today() + " $0" },
  { id: "query", label: "Query", group: "Advanced", keys: "query database list table filter dataview live", glyph: "query", hint: "Live list of matching notes", sc: "```query", text: "```query\ntag:$0 sort:title view:table\n```\n", block: true },
  { id: "details-props", label: "Page properties", group: "Advanced", keys: "properties front matter metadata yaml frontmatter", glyph: "v-list", hint: "Front-matter at the top", sc: "---", text: "---\nstatus: $0\ntags: []\n---\n", block: true },
];

export const SLASH_GROUPS: SlashGroup[] = ["Basic", "Layout", "Panels & callouts", "Media & embeds", "Knowledge", "Advanced"];
export const slashById = (id: string) => SLASH.find((c) => c.id === id);

/** Insert gallery (R4-16C): three rows of five, in the design's order. */
export const GALLERY: { group: SlashGroup; ids: string[] }[] = [
  { group: "Layout", ids: ["cols2", "cols3", "sidebar-l", "tabs", "toggle"] },
  { group: "Panels & callouts", ids: ["panel-info", "callout-tip", "panel-warning", "aside", "center"] },
  { group: "Advanced", ids: ["wide", "full", "toc", "include", "cards"] },
];
/** The Markdown a command writes, without the cursor mark (gallery preview). */
export const slashMarkdown = (c: SlashCommand) => (typeof c.text === "function" ? c.text() : c.text).replace("$0", "");

/** Panel colours follow the callout tokens used by the renderer. */
export const PANEL_COLOR: Record<string, string> = {
  info: "var(--info)", note: "var(--muted)", tip: "var(--success)", success: "var(--success)", important: "var(--warning)", question: "var(--learn)",
  warning: "var(--warning)", example: "var(--muted)", abstract: "var(--accent)", todo: "var(--info)", bug: "var(--danger)", danger: "var(--danger)", error: "var(--danger)",
};

// ------------------------------------------------------------------ recently used (per device)
const RECENT_KEY = "lumen.slashRecent";
export function recentSlash(): SlashCommand[] {
  try { return (JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]") as string[]).map(slashById).filter((c): c is SlashCommand => !!c).slice(0, 3); } catch { return []; }
}
export function rememberSlash(id: string) {
  try { const cur = (JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]") as string[]).filter((x) => x !== id); localStorage.setItem(RECENT_KEY, JSON.stringify([id, ...cur].slice(0, 3))); } catch { /* private mode */ }
}

/** Insert a command's snippet in place of "/query" (block snippets get their own line), placing the cursor at $0. */
export function applySlash(view: EditorView, c: SlashCommand, from: number, to: number) {
  const raw = typeof c.text === "function" ? c.text() : c.text;
  const line = view.state.doc.lineAt(from);
  const before = view.state.sliceDoc(line.from, from);
  const lead = c.block && before.trim() ? "\n" : "";
  const text = lead + raw.replace("$0", "");
  const at = raw.indexOf("$0");
  const cursor = from + lead.length + (at >= 0 ? at : raw.length);
  view.dispatch({ changes: { from, to, insert: text }, selection: { anchor: cursor }, scrollIntoView: true, userEvent: "input.complete" });
  view.focus();
  rememberSlash(c.id);
}

const words = (s: string) => s.toLowerCase().split(/[\s/·+%,()-]+/).filter(Boolean);
const rank = (c: SlashCommand, q: string) => {
  if (!q) return 1;
  const l = c.label.toLowerCase(), k = c.keys.toLowerCase();
  // a word of the label starting with the query ranks first ("/col" → 2 columns…), then alias words, then substrings;
  // ties keep catalog order
  if (l.startsWith(q)) return 5;
  if (words(l).some((w) => w.startsWith(q))) return 4;
  if (k.split(/\s+/).some((w) => w.startsWith(q))) return 3;
  if (l.includes(q)) return 2;
  return q.split(/\s+/).every((w) => k.includes(w) || l.includes(w)) ? 1 : 0;
};
/** Commands matching a query, best first (catalog order on ties). `//…` = the date command only. */
export function slashMatch(query: string): SlashCommand[] {
  if (query.startsWith("/")) return SLASH.filter((c) => c.id === "date");
  const q = query.trim().toLowerCase();
  return SLASH.map((c, i) => [c, rank(c, q), i] as const).filter(([, s]) => s > 0).sort((a, b) => b[1] - a[1] || a[2] - b[2]).map(([c]) => c);
}
/** Same, but looser: hints too, and letters in order ("Search all commands"). */
export function slashSearchAll(query: string): SlashCommand[] {
  const q = query.trim().toLowerCase();
  if (!q) return SLASH;
  const sub = (s: string) => { let i = 0; for (const ch of s) if (ch === q[i]) i++; return i === q.length; };
  return SLASH.filter((c) => `${c.label} ${c.keys} ${c.hint}`.toLowerCase().includes(q) || sub(c.label.toLowerCase()) || sub(c.keys.toLowerCase()));
}

// Words people try that Lumen spells differently: [suggested block query, extra advice].
const SUGGEST: Record<string, [string, string]> = {
  kanban: ["board", "or make a Base with a Board view."], board: ["query", "or make a Base with a Board view."], database: ["query", "or make a Base."],
  db: ["query", "or make a Base."], gallery: ["cards", "or a Base with a Gallery view."], calendar: ["date", "or a Base with a Calendar view."],
  todo: ["task", ""], checklist: ["task", ""], embed: ["include", ""], transclude: ["include", ""], button: ["link", ""], bookmark: ["link card", ""],
  chart: ["diagram", "or a Dashboard note."], graph: ["diagram", ""], latex: ["math", ""], equation: ["math", ""], accordion: ["toggle", ""],
  details: ["toggle", ""], sidebar: ["sidebar", ""], grid: ["columns", ""], columns: ["2 columns", ""], hr: ["divider", ""], line: ["divider", ""],
};
const lev = (a: string, b: string) => {
  const d = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) { let prev = d[0]; d[0] = i; for (let j = 1; j <= b.length; j++) { const t = d[j]; d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = t; } }
  return d[b.length];
};
/** "No block called “kanban”": the closest real block word + one more idea. */
export function slashSuggest(query: string): { word: string; more: string } {
  const q = query.trim().toLowerCase();
  const s = SUGGEST[q];
  if (s) return { word: s[0], more: s[1] };
  let best = "", bd = Infinity;
  for (const c of SLASH) for (const w of [...words(c.label), ...c.keys.toLowerCase().split(/\s+/)]) { if (w.length < 3) continue; const d = lev(q, w); if (d < bd) { bd = d; best = w; } }
  return { word: best || "text", more: "" };
}

// ------------------------------------------------------------------ detection
export interface SlashContext { from: number; to: number; query: string }
/** "/" at line start or after whitespace / "(" with up to 24 letters, digits, spaces; not inside a code fence. */
export function slashContext(state: EditorState): SlashContext | null {
  const sel = state.selection.main;
  if (!sel.empty) return null;
  const line = state.doc.lineAt(sel.head);
  const before = state.sliceDoc(Math.max(line.from, sel.head - 40), sel.head);
  const m = /(?:^|[\s(])(\/\/?[\p{L}\p{N} -]{0,24})$/u.exec(before);
  if (!m) return null;
  const from = sel.head - m[1].length;
  if (from > line.from && !/[\s(]/.test(state.sliceDoc(from - 1, from))) return null;
  const query = m[1].slice(1);
  if (/\s{2,}$/.test(query) || query.split(" ").length > 4 || /^\s/.test(query)) return null;
  const head = state.sliceDoc(0, from);
  if (((head.match(/^\s*(```|~~~)/gm) ?? []).length & 1) === 1) return null;
  return { from, to: sel.head, query };
}
