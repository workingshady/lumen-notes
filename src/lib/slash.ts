// Slash commands ("/" menu, Confluence / Notion / Obsidian style) + the visual "Insert layout" gallery.
// One catalog drives both: every command inserts plain Markdown that Lumen already renders (see markdown.ts):
//   ::: columns / column 70%, ::: tabs, ::: expand, ::: info|warning… panels, > [!type] callouts, ::: wide|full|center|aside,
//   [[toc]], :status[…], ![[Note#Heading]], ```mermaid, $$ math $$, ==highlight==, footnotes, Q :: A flashcards, ```query.
// Typing:  "/"  at the start of a line or after a space opens the menu;  "//"  inserts today's date (as in Confluence).
import type { Completion, CompletionContext, CompletionResult } from "@codemirror/autocomplete";
import type { EditorView } from "@codemirror/view";

export type SlashGroup = "Basic" | "Layout" | "Panels & callouts" | "Media & embeds" | "Knowledge" | "Advanced";
export interface SlashCommand {
  id: string;
  label: string;
  group: SlashGroup;
  /** Extra words matched by the filter (aliases from Confluence / Notion / Obsidian). */
  keys: string;
  /** Short glyph (Basic etc.) or a layout thumbnail id. */
  icon: string;
  hint: string;
  /** Markdown to insert; `$0` marks where the cursor goes. A block snippet starts on its own line. */
  text: string | (() => string);
  block?: boolean;
  /** Runs an editor action instead of inserting text (handled by the caller). */
  action?: "file" | "voice";
}

const today = () => new Date().toISOString().slice(0, 10);
const panel = (kind: string, title: string): SlashCommand => ({
  id: `panel-${kind}`, label: `${title} panel`, group: "Panels & callouts", keys: `panel callout ${kind} ${title} box admonition`, icon: `panel:${kind}`,
  hint: `Confluence-style ${kind} panel`, text: `::: ${kind} ${title}\n$0\n:::\n`, block: true,
});
const callout = (kind: string, title: string, extra = ""): SlashCommand => ({
  id: `callout-${kind}`, label: `Callout · ${title}`, group: "Panels & callouts", keys: `callout ${kind} ${title} obsidian admonition ${extra}`, icon: `panel:${kind}`,
  hint: `> [!${kind}] (Obsidian)`, text: `> [!${kind}] ${title}\n> $0\n`, block: true,
});

export const SLASH: SlashCommand[] = [
  // ---- Basic (Notion "Basic blocks")
  { id: "h1", label: "Heading 1", group: "Basic", keys: "h1 title big heading", icon: "H1", hint: "Big section heading", text: "# $0", block: true },
  { id: "h2", label: "Heading 2", group: "Basic", keys: "h2 subtitle heading", icon: "H2", hint: "Medium heading", text: "## $0", block: true },
  { id: "h3", label: "Heading 3", group: "Basic", keys: "h3 heading small", icon: "H3", hint: "Small heading", text: "### $0", block: true },
  { id: "bullet", label: "Bulleted list", group: "Basic", keys: "ul bullet list unordered", icon: "•", hint: "Simple list", text: "- $0", block: true },
  { id: "numbered", label: "Numbered list", group: "Basic", keys: "ol numbered ordered list", icon: "1.", hint: "List with numbers", text: "1. $0", block: true },
  { id: "todo", label: "Task list", group: "Basic", keys: "todo task checkbox action item checklist", icon: "☐", hint: "Track tasks (also shows in Tasks)", text: "- [ ] $0", block: true },
  { id: "quote", label: "Quote", group: "Basic", keys: "quote blockquote citation", icon: "❝", hint: "Capture a quote", text: "> $0", block: true },
  { id: "divider", label: "Divider", group: "Basic", keys: "divider hr rule line separator ---", icon: "—", hint: "Visually separate blocks", text: "\n---\n$0", block: true },
  { id: "code", label: "Code block", group: "Basic", keys: "code snippet fence pre", icon: "</>", hint: "Code with syntax highlighting", text: "```python\n$0\n```\n", block: true },
  { id: "table", label: "Table", group: "Basic", keys: "table grid rows columns", icon: "▦", hint: "3 × 3 Markdown table", text: "| $0Column | Column | Column |\n| --- | --- | --- |\n|  |  |  |\n|  |  |  |\n", block: true },
  { id: "toggle", label: "Toggle / expand", group: "Basic", keys: "toggle expand collapse details fold accordion", icon: "▸", hint: "Hidden until opened (Confluence Expand, Notion Toggle)", text: "::: expand Click to show\n$0\n:::\n", block: true },
  { id: "highlight", label: "Highlight", group: "Basic", keys: "highlight mark marker yellow", icon: "🖍", hint: "==highlighted text==", text: "==$0==" },
  { id: "footnote", label: "Footnote", group: "Basic", keys: "footnote reference citation note", icon: "¹", hint: "Reference at the bottom", text: "[^1]$0\n\n[^1]: Footnote text", },
  // ---- Layout (Confluence layouts / columns)
  { id: "cols2", label: "Two columns", group: "Layout", keys: "layout columns 2 two split side by side", icon: "lay:2", hint: "50 / 50", text: "::: columns\n::: column\n$0Left column\n:::\n::: column\nRight column\n:::\n:::\n", block: true },
  { id: "cols3", label: "Three columns", group: "Layout", keys: "layout columns 3 three", icon: "lay:3", hint: "33 / 33 / 33", text: "::: columns\n::: column\n$0First\n:::\n::: column\nSecond\n:::\n::: column\nThird\n:::\n:::\n", block: true },
  { id: "cols4", label: "Four columns", group: "Layout", keys: "layout columns 4 four grid", icon: "lay:4", hint: "4 equal columns", text: "::: columns\n::: column\n$0One\n:::\n::: column\nTwo\n:::\n::: column\nThree\n:::\n::: column\nFour\n:::\n:::\n", block: true },
  { id: "sidebar-r", label: "Main + right sidebar", group: "Layout", keys: "layout sidebar right 70 30 aside", icon: "lay:r", hint: "70 / 30", text: "::: columns\n::: column 70%\n$0Main content\n:::\n::: column 30%\n> [!info] Sidebar\n> Notes, links, status\n:::\n:::\n", block: true },
  { id: "sidebar-l", label: "Left sidebar + main", group: "Layout", keys: "layout sidebar left 30 70 nav", icon: "lay:l", hint: "30 / 70", text: "::: columns\n::: column 30%\n> [!note] Sidebar\n> Contents, links\n:::\n::: column 70%\n$0Main content\n:::\n:::\n", block: true },
  { id: "three-sb", label: "Three columns with sidebars", group: "Layout", keys: "layout three sidebars 25 50 25", icon: "lay:3s", hint: "25 / 50 / 25", text: "::: columns\n::: column 25%\nLeft\n:::\n::: column 50%\n$0Main\n:::\n::: column 25%\nRight\n:::\n:::\n", block: true },
  { id: "tabs", label: "Tabs", group: "Layout", keys: "tabs tabbed switch", icon: "lay:tabs", hint: "Each heading becomes a tab", text: "::: tabs\n## First tab\n$0Content of the first tab.\n\n## Second tab\nContent of the second tab.\n:::\n", block: true },
  { id: "wide", label: "Wide block", group: "Layout", keys: "wide breakout full width", icon: "lay:wide", hint: "Breaks out of the text column", text: "::: wide\n$0Wide tables, diagrams or images go here.\n:::\n", block: true },
  { id: "full", label: "Full-width block", group: "Layout", keys: "full width edge to edge", icon: "lay:full", hint: "Uses the whole pane", text: "::: full\n$0\n:::\n", block: true },
  { id: "center", label: "Centered block", group: "Layout", keys: "center centred align middle", icon: "lay:center", hint: "Centre text or an image", text: "::: center\n$0\n:::\n", block: true },
  { id: "aside", label: "Side note (aside)", group: "Layout", keys: "aside margin note sidenote", icon: "lay:aside", hint: "Small note beside the text", text: "::: aside\n$0\n:::\n", block: true },
  // ---- Panels & callouts (Confluence panels + Obsidian callouts)
  panel("info", "Info"), panel("note", "Note"), panel("success", "Success"), panel("warning", "Warning"), panel("error", "Error"),
  callout("tip", "Tip", "hint"), callout("important", "Important"), callout("question", "Question", "faq help"), callout("example", "Example"),
  callout("abstract", "Summary", "tldr abstract"), callout("todo", "To do"), callout("bug", "Bug"), callout("danger", "Danger"),
  { id: "callout-fold", label: "Collapsible callout", group: "Panels & callouts", keys: "callout fold collapsible collapsed", icon: "panel:note", hint: "> [!note]- folded by default", text: "> [!note]- Title\n> $0\n", block: true },
  // ---- Media & embeds
  { id: "file", label: "Image or file", group: "Media & embeds", keys: "image picture photo file upload attachment pdf video audio", icon: "🖼", hint: "Upload from your device", text: "", action: "file" },
  { id: "voice", label: "Voice note → text", group: "Media & embeds", keys: "voice record dictate transcribe audio", icon: "🎙", hint: "Record and transcribe", text: "", action: "voice" },
  { id: "youtube", label: "YouTube / Vimeo video", group: "Media & embeds", keys: "youtube vimeo video embed", icon: "▶", hint: "Paste the link on its own line", text: "\nhttps://www.youtube.com/watch?v=$0\n", block: true },
  { id: "linkcard", label: "Link preview card", group: "Media & embeds", keys: "link card bookmark preview url web", icon: "🔗", hint: "<https://…> shows a preview card", text: "<https://$0>\n", block: true },
  { id: "embed-note", label: "Embed a note", group: "Media & embeds", keys: "embed transclude include note excerpt synced", icon: "⧉", hint: "![[Note]] shows it inline", text: "![[$0]]\n", block: true },
  { id: "include", label: "Include a section", group: "Media & embeds", keys: "include section heading excerpt synced block reuse", icon: "⧉", hint: "![[Note#Heading]]", text: "![[$0Note title#Heading]]\n", block: true },
  // ---- Knowledge (Obsidian / study)
  { id: "link", label: "Link to note", group: "Knowledge", keys: "link wiki wikilink page mention reference", icon: "[[", hint: "[[Note]] with autocomplete", text: "[[$0" },
  { id: "tag", label: "Tag", group: "Knowledge", keys: "tag label hashtag", icon: "#", hint: "#tag", text: "#$0" },
  { id: "flashcard", label: "Flashcard", group: "Knowledge", keys: "flashcard card anki spaced repetition question answer", icon: "🃏", hint: "Question :: Answer (shows in Review)", text: "$0Question :: Answer", block: true },
  { id: "math-inline", label: "Inline math", group: "Knowledge", keys: "math latex katex equation inline", icon: "∑", hint: "$x^2$", text: "$$0$" },
  { id: "math-block", label: "Math block", group: "Knowledge", keys: "math latex katex equation block display", icon: "∫", hint: "Display equation", text: "$$\n$0\n$$\n", block: true },
  { id: "mermaid", label: "Mermaid diagram", group: "Knowledge", keys: "mermaid diagram flowchart graph chart sequence", icon: "◇", hint: "Flowchart from text", text: "```mermaid\nflowchart LR\n  A[$0Start] --> B[Next]\n```\n", block: true },
  // ---- Advanced (Confluence macros)
  { id: "toc", label: "Table of contents", group: "Advanced", keys: "toc table of contents outline headings index", icon: "☰", hint: "Built from this note's headings", text: "[[toc]]\n$0", block: true },
  { id: "status", label: "Status", group: "Advanced", keys: "status pill lozenge badge label progress", icon: "◉", hint: ":status[In progress]", text: ":status[$0In progress] " },
  { id: "date", label: "Date (today)", group: "Advanced", keys: "date today now time // calendar", icon: "📅", hint: "Also: type //", text: () => today() + " $0" },
  { id: "query", label: "Query / live list", group: "Advanced", keys: "query database list table filter dataview", icon: "⚲", hint: "Live list of matching notes", text: "```query\ntag:$0 sort:title view:table\n```\n", block: true },
  { id: "details-props", label: "Page properties", group: "Advanced", keys: "properties front matter metadata yaml frontmatter", icon: "⚙", hint: "Front-matter at the top", text: "---\nstatus: $0\ntags: []\n---\n", block: true },
];

export const SLASH_GROUPS: SlashGroup[] = ["Basic", "Layout", "Panels & callouts", "Media & embeds", "Knowledge", "Advanced"];

/** Layout gallery thumbnails: small SVGs drawn with currentColor so they follow the theme. */
export function slashThumb(icon: string): string {
  const r = (x: number, y: number, w: number, h: number, o = 0.28) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="1.5" fill="currentColor" opacity="${o}"/>`;
  const lines = (x: number, w: number) => [8, 12, 16].map((y) => r(x + 2, y, w - 4, 1.6, 0.55)).join("");
  const col = (x: number, w: number) => r(x, 4, w, 18) + lines(x, w);
  const shapes: Record<string, string> = {
    "lay:2": col(2, 15) + col(19, 15),
    "lay:3": col(2, 9.3) + col(13.3, 9.3) + col(24.6, 9.3),
    "lay:4": [0, 1, 2, 3].map((i) => col(2 + i * 8, 6.5)).join(""),
    "lay:r": col(2, 21) + col(25, 9),
    "lay:l": col(2, 9) + col(13, 21),
    "lay:3s": col(2, 7) + col(11, 14) + col(27, 7),
    "lay:tabs": r(2, 4, 9, 4, 0.6) + r(12, 4, 9, 4) + r(2, 8, 32, 14) + lines(2, 32),
    "lay:wide": r(0, 4, 36, 18) + lines(0, 36),
    "lay:full": r(0, 2, 36, 22),
    "lay:center": r(10, 6, 16, 14) + [10, 14].map((y) => r(13, y, 10, 1.6, 0.55)).join(""),
    "lay:aside": col(2, 22) + r(26, 6, 8, 8, 0.5),
  };
  const s = shapes[icon];
  if (!s) return "";
  return `<svg viewBox="0 0 36 26" width="36" height="26" aria-hidden="true">${s}</svg>`;
}
/** Panel colours follow the callout tokens used by the renderer. */
export const PANEL_COLOR: Record<string, string> = {
  info: "var(--info)", note: "var(--info)", tip: "var(--success)", success: "var(--success)", important: "var(--accent)", question: "var(--warning)",
  warning: "var(--warning)", example: "var(--learn)", abstract: "var(--info)", todo: "var(--info)", bug: "var(--danger)", danger: "var(--danger)", error: "var(--danger)",
};

function iconEl(c: SlashCommand): HTMLElement {
  const el = document.createElement("span");
  el.className = "lm-slash-ic";
  if (c.icon.startsWith("lay:")) el.innerHTML = slashThumb(c.icon);
  else if (c.icon.startsWith("panel:")) { const k = c.icon.slice(6); el.innerHTML = `<span class="lm-slash-panel" style="--pc:${PANEL_COLOR[k] ?? "var(--info)"}"></span>`; }
  else el.textContent = c.icon;
  return el;
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
}

const rank = (c: SlashCommand, q: string) => {
  if (!q) return 1;
  const l = c.label.toLowerCase(), k = c.keys.toLowerCase();
  // a word of the label starting with the query ranks first ("/col" → Two columns…), then alias words, then substrings;
  // ties keep catalog order (Layout before callouts)
  if (l.split(/[\s/·+-]+/).some((w) => w.startsWith(q))) return 4;
  if (k.split(/\s+/).some((w) => w.startsWith(q))) return 3;
  if (l.includes(q)) return 2;
  return q.split(/\s+/).every((w) => k.includes(w) || l.includes(w)) ? 1 : 0;
};

/**
 * CodeMirror completion source. `onAction` handles commands that open a picker (upload, voice).
 * Detection: "/" at line start or after whitespace (never inside a URL or a code fence); "//" = today's date.
 */
export function slashSource(onAction: (a: NonNullable<SlashCommand["action"]>, view: EditorView) => void) {
  return (ctx: CompletionContext): CompletionResult | null => {
    const m = ctx.matchBefore(/(?:^|[\s(])\/\/?[\p{L}\p{N} -]{0,24}$/u);
    if (!m) return null;
    const slash = m.text.indexOf("/");
    const from = m.from + slash;
    const query = ctx.state.sliceDoc(from + 1, ctx.pos);
    // inside a fenced code block? (count fences above the cursor)
    const head = ctx.state.sliceDoc(0, from);
    if (((head.match(/^(```|~~~)/gm) ?? []).length & 1) === 1) return null;
    if (/\s{2,}$/.test(query) || (query.includes(" ") && !ctx.explicit && query.split(" ").length > 3)) return null;
    const q = query.replace(/^\//, "").trim().toLowerCase();
    const dateMode = query.startsWith("/");
    const list = dateMode ? SLASH.filter((c) => c.id === "date") : SLASH.map((c) => [c, rank(c, q)] as const).filter(([, s]) => s > 0).sort((a, b) => b[1] - a[1]).map(([c]) => c);
    if (!list.length) return null;
    const options: Completion[] = list.map((c, i) => ({
      label: c.label,
      detail: c.hint,
      section: q ? undefined : { name: c.group, rank: SLASH_GROUPS.indexOf(c.group) },
      boost: q ? 50 - i : 0,
      apply: (view, _comp, f, t) => (c.action ? (view.dispatch({ changes: { from: f, to: t, insert: "" } }), onAction(c.action, view)) : applySlash(view, c, f, t)),
      lmSlash: c,
    } as Completion & { lmSlash: SlashCommand }));
    return { from, to: ctx.pos, options, filter: false };
  };
}

/** Renders the icon column of slash options (autocompletion `addToOptions`). */
export const slashIconOption = {
  render: (c: Completion) => ((c as Completion & { lmSlash?: SlashCommand }).lmSlash ? iconEl((c as Completion & { lmSlash: SlashCommand }).lmSlash) : null),
  position: 20,
};
