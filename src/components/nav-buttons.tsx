// Desktop header history buttons (Lumen 20 · A13): Back / Forward (28px, bordered), and a long-press (or right-click)
// on Back lists the earlier places of this session ("Back · long-press"). Uses the real browser history
// (lib/nav-history.ts), so the buttons, the mouse back button and the phone back gesture walk the same pages.
import { ArrowLeft, ArrowRight } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { backList, canGoBack, canGoForward, goBackSteps, navVersion, subscribeNav, type Loc } from "../lib/nav-history";
import { back, useVault, type Vault } from "../lib/store";

const VIEW: Record<string, string> = { home: "Home", today: "Today", inbox: "Inbox", notes: "Notes", graph: "Graph", review: "Review", tasks: "Tasks", calendar: "Calendar", canvases: "Canvases", blog: "Blog", settings: "Settings", trash: "Trash", space: "Space", daily: "Daily note" };

/** Human label of a place: note title, "Tag #x", "Filter: x", "Space · View". */
export function placeLabel(l: Loc, v: Vault): string {
  if (l.noteId) { const n = v.byId.get(l.noteId); if (n) return n.title; }
  if (l.tag) return `Tag #${l.tag}`;
  const space = l.spaceId && l.spaceId !== "all" ? v.spaceMap.get(l.spaceId)?.name : "";
  if (l.filter) return `${space ? `${space} · ` : ""}Filter: ${l.filter.replace(/^status:/, "status ")}`;
  const view = VIEW[l.view] ?? l.view.charAt(0).toUpperCase() + l.view.slice(1);
  return space && l.view !== "home" && l.view !== "today" ? `${space} · ${view}` : view;
}

export function NavButtons() {
  useSyncExternalStore(subscribeNav, navVersion);
  const v = useVault();
  const [menu, setMenu] = useState(false);
  const timer = useRef<number | null>(null);
  const long = useRef(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const off = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setMenu(false); };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setMenu(false);
    document.addEventListener("mousedown", off); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", off); document.removeEventListener("keydown", esc); };
  }, [menu]);
  const goBack = () => (canGoBack() ? history.back() : back());
  const list = menu ? backList(6) : [];
  const btn = "flex size-7 shrink-0 items-center justify-center rounded-[7px] border border-line hover:bg-surface-2 disabled:text-muted disabled:hover:bg-transparent";
  return (
    <div ref={ref} className="relative flex shrink-0 items-center gap-2">
      <button aria-label="Back" title="Back (hold for history)" className={btn}
        onPointerDown={() => { long.current = false; timer.current = window.setTimeout(() => { long.current = true; setMenu(true); }, 450); }}
        onPointerUp={() => { if (timer.current) clearTimeout(timer.current); }} onPointerLeave={() => { if (timer.current) clearTimeout(timer.current); }}
        onContextMenu={(e) => { e.preventDefault(); setMenu(true); }}
        onClick={() => { if (!long.current) goBack(); }}>
        <ArrowLeft size={15} className="rtl:rotate-180" />
      </button>
      <button aria-label="Forward" title="Forward" disabled={!canGoForward()} className={btn} onClick={() => history.forward()}><ArrowRight size={15} className="rtl:rotate-180" /></button>
      {menu && (
        <div role="menu" aria-label="Back history" className="absolute start-0 top-[calc(100%+6px)] z-50 flex w-[260px] flex-col rounded-[10px] border border-line bg-surface-2 p-1 text-[12.5px] shadow-[0_8px_24px_rgb(0_0_0/.3)]">
          <span className="px-2 py-1.5 text-[11px] text-muted">Back · long-press</span>
          {!list.length && <span className="px-2 py-1.5 text-muted">No earlier pages yet.</span>}
          {list.map((x, i) => (
            <button key={x.steps} role="menuitem" onClick={() => { setMenu(false); goBackSteps(x.steps); }} className={"truncate rounded-[6px] px-2 py-1.5 text-start hover:bg-bg " + (i === 0 ? "bg-bg" : "")}>{placeLabel(x.loc, v)}</button>
          ))}
        </div>
      )}
    </div>
  );
}
