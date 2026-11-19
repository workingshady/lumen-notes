// Read-mode table paging (Lumen 22 "2,000-row table"): tables with more than TABLE_PAGE_ABOVE rows show `tableRows`
// rows per page with "Rows 1–100 of 2,000" and ‹ 1 2 3 … 20 ›. Filter and sort still work on every row (the page is
// taken from the filtered, sorted order). "Open as base" opens the table full screen with every row on one scrolling
// page, sortable and filterable (the Markdown is never rewritten).
import { fmtNum, t } from "./i18n";
import { getScale, TABLE_PAGE_ABOVE } from "./scale-prefs";

export { TABLE_PAGE_ABOVE };

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** Page numbers to show: first, a window around the current page, last, with … gaps. */
export function pageList(cur: number, n: number): (number | "…")[] {
  if (n <= 7) return Array.from({ length: n }, (_, i) => i);
  const set = new Set([0, 1, 2, cur - 1, cur, cur + 1, n - 1].filter((p) => p >= 0 && p < n));
  const sorted = [...set].sort((a, b) => a - b);
  const out: (number | "…")[] = [];
  sorted.forEach((p, i) => { if (i && p - sorted[i - 1] > 1) out.push("…"); out.push(p); });
  return out;
}

export function pageTable(wrap: HTMLElement, tools: HTMLElement, body: HTMLTableSectionElement, input: HTMLInputElement | null) {
  const size = getScale().tableRows;
  let page = 0, all = false;
  wrap.classList.add("tbl-paged");
  const foot = document.createElement("div");
  foot.className = "tbl-pager";
  wrap.append(foot);
  const base = document.createElement("button");
  base.type = "button"; base.className = "tbl-base"; base.textContent = t("Open as base");
  base.title = t("Every row on one page, full screen: sort and filter everything");
  tools.querySelector(".tbl-full")?.before(base);
  const refresh = () => {
    const rows = [...body.rows];
    const vis = rows.filter((r) => !r.hidden);
    const pages = Math.max(1, Math.ceil(vis.length / size));
    page = Math.min(page, pages - 1);
    const from = all ? 0 : page * size, to = all ? vis.length : from + size;
    const on = new Set(vis.slice(from, to));
    for (const r of rows) r.classList.toggle("tbl-off", !on.has(r));
    const range = vis.length ? t("Rows {a}–{b} of {n}", { a: fmtNum(from + 1), b: fmtNum(Math.min(to, vis.length)), n: fmtNum(vis.length) }) : t("No rows match");
    foot.innerHTML = `<span class="tbl-range">${esc(range)}</span>` + (all || pages < 2 ? "" : `<span class="tbl-pages"><button type="button" data-p="${page - 1}" aria-label="${esc(t("Previous page"))}"${page ? "" : " disabled"}>‹</button>${pageList(page, pages).map((p) => (p === "…" ? `<span>…</span>` : `<button type="button" data-p="${p}"${p === page ? ' aria-current="page"' : ""}>${fmtNum(p + 1)}</button>`)).join("")}<button type="button" data-p="${page + 1}" aria-label="${esc(t("Next page"))}"${page < pages - 1 ? "" : " disabled"}>›</button></span>`);
  };
  foot.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-p]");
    if (!b || b.disabled) return;
    page = Number(b.dataset.p);
    refresh();
    wrap.querySelector(".tbl-scroll")?.scrollTo({ top: 0 });
    wrap.scrollIntoView({ block: "nearest" });
  });
  input?.addEventListener("input", () => { page = 0; refresh(); });
  new MutationObserver(refresh).observe(body, { childList: true });
  base.addEventListener("click", () => { all = true; refresh(); void wrap.requestFullscreen?.(); });
  wrap.addEventListener("fullscreenchange", () => { if (document.fullscreenElement !== wrap && all) { all = false; refresh(); } });
  refresh();
}
