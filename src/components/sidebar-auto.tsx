// Sidebar auto-expand (Settings › Appearance › Sidebar): "open" (docked as before), "hover" or "click".
// In the two collapsed modes a 56 px rail holds the layout and the full sidebar widens over the content (no reflow).
import { useEffect, useRef, useState } from "react";
import { Sidebar } from "./Sidebar";
import { useSb } from "./sidebar-r6";
import { getSettings, useSettings } from "../lib/settings";

export type SidebarMode = "open" | "hover" | "click";
export const sidebarMode = (): SidebarMode => (getSettings() as { sidebarMode?: SidebarMode }).sidebarMode ?? "open";
export const useSidebarMode = (): SidebarMode => (useSettings() as { sidebarMode?: SidebarMode }).sidebarMode ?? "open";
export const SB_OPEN = "lumen:sidebar-open";
export const SB_TOGGLE = "lumen:sidebar-toggle";
const MS = 180;
const reduced = () => typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;

export function AutoSidebar({ mode, tablet }: { mode: "hover" | "click"; tablet: boolean }) {
  const p = useSb();
  const [open, setOpen] = useState(false);
  const [full, setFull] = useState(false); // full content stays mounted while the width animates back
  const root = useRef<HTMLDivElement>(null);
  const inside = useRef(false);
  const timer = useRef(0);
  const clear = () => { clearTimeout(timer.current); };

  useEffect(() => {
    if (open) { setFull(true); return; }
    const id = setTimeout(() => setFull(false), reduced() ? 0 : MS);
    return () => clearTimeout(id);
  }, [open]);

  const busy = () => {
    const el = root.current; if (!el) return false;
    const a = document.activeElement as HTMLElement | null;
    const focused = !!a && el.contains(a) && a.matches(":focus-visible");
    return focused || !!el.querySelector('[role="dialog"], [role="menu"], [aria-expanded="true"]');
  };
  const schedule = (to: boolean, ms: number) => {
    clear();
    timer.current = window.setTimeout(function run() {
      if (!to && (inside.current ? true : busy())) { if (!inside.current) timer.current = window.setTimeout(run, 300); return; }
      setOpen(to);
    }, ms);
  };

  useEffect(() => {
    const onOpen = () => { clear(); setOpen(true); };
    const onToggle = () => { clear(); setOpen((o) => !o); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && open) { clear(); setOpen(false); } };
    const onDown = (e: PointerEvent) => { if (open && root.current && !root.current.contains(e.target as Node)) { clear(); setOpen(false); } };
    addEventListener(SB_OPEN, onOpen); addEventListener(SB_TOGGLE, onToggle);
    addEventListener("keydown", onKey); addEventListener("pointerdown", onDown, true);
    return () => { removeEventListener(SB_OPEN, onOpen); removeEventListener(SB_TOGGLE, onToggle); removeEventListener("keydown", onKey); removeEventListener("pointerdown", onDown, true); clear(); };
  }, [open]);

  const w = open ? (tablet ? 232 : p.width) : 56;
  return (
    <div className="relative z-30 h-full w-14 shrink-0">
      <div ref={root} data-sidebar-auto className={open ? "absolute inset-y-0 start-0 shadow-[0_0_28px_rgba(0,0,0,.35)]" : "absolute inset-y-0 start-0"}
        style={{ width: w, transition: reduced() ? "none" : `width ${MS}ms ease-out`, overflow: open && !full ? "hidden" : undefined }}
        onPointerEnter={(e) => { inside.current = true; if (mode === "hover" && e.pointerType !== "touch" && !open) schedule(true, 150); }}
        onPointerLeave={() => { inside.current = false; if (mode === "hover") schedule(false, 300); else clear(); }}
        onClick={() => { if (!open) { clear(); setOpen(true); } }}
        onFocus={(e) => { if (!open && (e.target as HTMLElement).matches(":focus-visible")) { clear(); setOpen(true); } }}
        onBlur={(e) => { if (mode === "hover" && open && !e.currentTarget.contains(e.relatedTarget as Node | null)) schedule(false, 300); }}
        onKeyDown={(e) => { if (e.key === "Escape" && open) { e.stopPropagation(); clear(); setOpen(false); } }}>
        <Sidebar rail={!(open || full)} />
      </div>
    </div>
  );
}
