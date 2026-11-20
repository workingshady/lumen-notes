// Drag and drop feedback + the shared dialogs (brief §12.2): ghost preview, nest highlight, not-allowed reason, alignment guides,
// auto-scroll hint, count badge, 3 s Undo chip, "Use the existing attachment?", "Send to…", keyboard live region.
// Mount once near the app root (<DndHost/>); extra instances render nothing, so workspaces may mount it defensively.
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { registerWb } from "../wb/hooks";
import { Glyph } from "../Glyph";
import { cx } from "../ui";
import { t } from "../../lib/i18n";
import { useUI, useVault } from "../../lib/store";
import {
  allZones, announce, closeSendTo, describe, dismissChip, endDrag, engine, isLumenDrag, markNest, MIME, notesOf, peekDrag, readDrop, registerZone, setDrag, startKeyboardDrag, startPointerDrag, zoneAt, zoneEl,
  useDndChip, useDndDup, useDndLive, useDndSend, useDndState, type DndPayload,
} from "../../lib/dnd";
import { wbDrop, whiteboardZone } from "./wb-drop";
import { sendToNote } from "./send";

const CSS = `
html.ldnd-active, html.ldnd-active * { cursor: grabbing !important; }
.ldnd-nest { outline: 2px solid var(--accent) !important; outline-offset: 0; background-color: color-mix(in srgb, var(--accent) 8%, transparent) !important; transition: background-color .12s, outline-color .12s; }
@keyframes ldnd-in { from { opacity: 0; transform: translateY(6px) scale(.98) } to { opacity: 1; transform: none } }
@keyframes ldnd-pulse { 0%,100% { opacity: .55 } 50% { opacity: 1 } }
.ldnd-chip { animation: ldnd-in .16s ease-out; }
@media (prefers-reduced-motion: reduce) { .ldnd-chip { animation: none; } }
`;

let hostCount = 0;
const idsOf = (el: HTMLElement) => (el.dataset.dndGroup ? el.dataset.dndGroup.split(",") : [el.dataset.dndNote!]);
const notePayload = (ids: string[]): DndPayload => (ids.length > 1 ? { kind: "notes", ids } : { kind: "note", id: ids[0] });

export function DndHost() {
  const [primary, setPrimary] = useState(false);
  useEffect(() => { if (hostCount === 0) { hostCount++; setPrimary(true); return () => { hostCount--; }; } }, []);
  return primary ? <Host /> : null;
}

function Host() {
  const st = useDndState(), chip = useDndChip(), dup = useDndDup(), send = useDndSend(), live = useDndLive();
  const ui = useUI();
  const noteIdRef = useRef<string | null>(null);
  noteIdRef.current = ui.noteId ?? null;
  const stRef = useRef(st);
  stRef.current = st;
  const touchT = useRef(0);

  useEffect(() => {
    const un = [registerZone(whiteboardZone), registerWb("drop" as never, wbDrop as never)];
    const dragstart = (e: DragEvent) => {
      const dt = e.dataTransfer;
      if (!dt || dt.types.includes(MIME)) return;
      const el = (e.target as Element | null)?.closest?.<HTMLElement>("[data-dnd-note]");
      if (el?.dataset.dndNote) { setDrag(e, notePayload(idsOf(el))); return; }
      const text = window.getSelection()?.toString().trim();
      if (text && text.length > 1 && !(e.target as Element | null)?.closest?.("input,textarea")) {
        const id = noteIdRef.current;
        const n = id ? notesOf({ kind: "note", id })[0] : null;
        setDrag(e, { kind: "text", text, ...(n ? { from: { id: n.id, title: n.title } } : {}) });
      }
    };
    const over = (e: DragEvent) => {
      const dt = e.dataTransfer;
      if (!dt || !isLumenDrag(dt)) return;
      const z = zoneAt(e.clientX, e.clientY);
      if (!z) { if (stRef.current) engine.leave(); return; }
      const p = peekDrag(dt);
      if (!p) return;
      const probe = engine.over(e.clientX, e.clientY, e.altKey, p);
      if (probe && !z.ignore?.(dt)) { e.preventDefault(); dt.dropEffect = probe.ok ? (e.altKey ? "link" : "copy") : "none"; }
    };
    const leave = (e: DragEvent) => { if (!e.relatedTarget) engine.leave(); };
    const drop = (e: DragEvent) => {
      const dt = e.dataTransfer;
      const z = dt && zoneAt(e.clientX, e.clientY);
      if (!dt || !z) return;
      if (z.external || z.ignore?.(dt)) { engine.end(); return; }
      const p = readDrop(dt);
      if (!p) return;
      e.preventDefault(); e.stopPropagation();
      void engine.drop(e.clientX, e.clientY, e.altKey, p);
    };
    const end = () => endDrag();
    // touch / pen long-press on any [data-dnd-note]; Space picks up with the keyboard
    const down = (e: PointerEvent) => {
      if (e.pointerType === "mouse") return;
      const el = (e.target as Element | null)?.closest?.<HTMLElement>("[data-dnd-note]");
      if (!el) return;
      const x = e.clientX, y = e.clientY, id = e.pointerId;
      clearTimeout(touchT.current);
      const mv = (m: PointerEvent) => { if (Math.hypot(m.clientX - x, m.clientY - y) > 8) cancel(); };
      const cancel = () => { clearTimeout(touchT.current); touchT.current = 0; window.removeEventListener("pointermove", mv); window.removeEventListener("pointerup", cancel); window.removeEventListener("pointercancel", cancel); };
      window.addEventListener("pointermove", mv); window.addEventListener("pointerup", cancel); window.addEventListener("pointercancel", cancel);
      touchT.current = window.setTimeout(() => {
        cancel();
        startPointerDrag(notePayload(idsOf(el)), { clientX: x, clientY: y, pointerId: id });
      }, 450);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key !== " " || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      const el = document.activeElement as HTMLElement | null;
      if (!el?.dataset?.dndNote || el.matches("input,textarea,[contenteditable=true]")) return;
      e.preventDefault(); e.stopPropagation();
      startKeyboardDrag(notePayload(idsOf(el)), el);
    };
    const noCtx = (e: Event) => { if (touchT.current && (e.target as Element | null)?.closest?.("[data-dnd-note]")) e.preventDefault(); };
    document.addEventListener("dragstart", dragstart);
    document.addEventListener("dragover", over, true);
    document.addEventListener("dragleave", leave, true);
    document.addEventListener("drop", drop, true);
    document.addEventListener("dragend", end, true);
    document.addEventListener("pointerdown", down, true);
    document.addEventListener("keydown", key, true);
    document.addEventListener("contextmenu", noCtx, true);
    return () => {
      un.forEach((f) => f());
      document.removeEventListener("dragstart", dragstart);
      document.removeEventListener("dragover", over, true);
      document.removeEventListener("dragleave", leave, true);
      document.removeEventListener("drop", drop, true);
      document.removeEventListener("dragend", end, true);
      document.removeEventListener("pointerdown", down, true);
      document.removeEventListener("keydown", key, true);
      document.removeEventListener("contextmenu", noCtx, true);
    };
  }, []);

  useEffect(() => { markNest(st?.probe?.nest ?? null); }, [st?.probe?.nest]);

  return createPortal(
    <>
      <style>{CSS}</style>
      <div aria-live="polite" role="status" className="sr-only">{live}</div>
      {st && <Overlay />}
      {chip && (
        <div key={chip.id} role="status" className="ldnd-chip fixed bottom-6 left-1/2 z-[400] flex h-[34px] -translate-x-1/2 items-center gap-2.5 rounded-full border border-line bg-surface-2 ps-4 pe-2 text-[11.5px] text-ink shadow-[0_10px_28px_rgba(0,0,0,.3)]">
          <span dir="auto" className="max-w-[320px] truncate">{chip.text.replace(/\s*·\s*(Undo|تراجع)$/, "")}{chip.undo && " ·"}</span>
          {chip.undo && <button type="button" onClick={() => { chip.undo!(); dismissChip(); announce(t("Undone")); }} className="-ms-1.5 h-6 rounded-full px-2 text-[11.5px] hover:bg-bg">{t("Undo")}</button>}
        </div>
      )}
      {dup && (
        <div className="fixed inset-0 z-[410] flex items-center justify-center bg-black/40" onKeyDown={(e) => { if (e.key === "Escape") dup.resolve(null); }}>
          <div role="alertdialog" aria-modal aria-label={t("Use the existing attachment?")} className="ldnd-chip w-[min(320px,calc(100vw-32px))] rounded-[12px] border border-line bg-surface-2 p-4 shadow-[0_20px_50px_rgba(0,0,0,.4)]">
            <div className="text-[13px] font-semibold">{t("Use the existing attachment?")}</div>
            <div dir="auto" className="mt-1 text-[11.5px] text-muted">{t("{name} is already in this vault.", { name: dup.name })}</div>
            <div className="mt-3.5 flex justify-end gap-2">
              <button type="button" onClick={() => dup.resolve(false)} className="h-[30px] rounded-[8px] border border-line px-3 text-[11.5px] hover:bg-bg">{t("Upload again")}</button>
              <button type="button" autoFocus onClick={() => dup.resolve(true)} className="h-[30px] rounded-[8px] bg-accent px-3.5 text-[11.5px] font-semibold text-accent-ink">{t("Use it")}</button>
            </div>
          </div>
        </div>
      )}
      {send && <SendMenu payload={send.payload} />}
    </>,
    document.body,
  );
}

function Overlay() {
  const st = useDndState()!;
  const p = st.probe;
  const ok = !p || p.ok;
  const at = p?.snap ?? { x: st.x, y: st.y };
  const zone = st.zone;
  const z = zone ? zoneEl(zone).getBoundingClientRect() : null;
  const col = ok ? "var(--accent)" : "var(--danger, #EF6B6B)";
  const ghostW = 150;
  const stack = Math.min(3, st.count);
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-[390]">
      {p?.guides && p.guides.length > 0 && (
        <svg className="absolute inset-0" width="100%" height="100%">
          {p.guides.map((g, i) => <line key={i} x1={g.x1} y1={g.y1} x2={g.x2} y2={g.y2} stroke="#EF6B6B" strokeWidth={1} strokeDasharray={g.gap ? undefined : "3 3"} />)}
        </svg>
      )}
      {z && (st.edge.x !== 0 || st.edge.y !== 0) && (
        <>
          {st.edge.x > 0.01 && <div className="absolute" style={{ left: z.right - 70, top: z.top, width: 70, height: z.height, background: "linear-gradient(90deg,transparent,color-mix(in srgb,var(--accent) 18%,transparent))" }}><span className="absolute end-1 top-1/2 -translate-y-1/2 text-[22px] leading-none text-accent" style={{ animation: "ldnd-pulse .8s infinite" }}>›</span></div>}
          {st.edge.x < -0.01 && <div className="absolute" style={{ left: z.left, top: z.top, width: 70, height: z.height, background: "linear-gradient(270deg,transparent,color-mix(in srgb,var(--accent) 18%,transparent))" }}><span className="absolute start-1 top-1/2 -translate-y-1/2 text-[22px] leading-none text-accent" style={{ animation: "ldnd-pulse .8s infinite" }}>‹</span></div>}
          {st.edge.y > 0.01 && <div className="absolute" style={{ left: z.left, top: z.bottom - 70, width: z.width, height: 70, background: "linear-gradient(180deg,transparent,color-mix(in srgb,var(--accent) 18%,transparent))" }} />}
          {st.edge.y < -0.01 && <div className="absolute" style={{ left: z.left, top: z.top, width: z.width, height: 70, background: "linear-gradient(0deg,transparent,color-mix(in srgb,var(--accent) 18%,transparent))" }} />}
        </>
      )}
      {/* ghost preview: what will be created (a stack with a count badge for several items) */}
      {(zone || st.mode !== "native") && (
        <div className="absolute" style={{ left: at.x - ghostW / 2, top: at.y - 20, width: ghostW }}>
          {Array.from({ length: stack }).map((_, i) => {
            const top = i === stack - 1;
            return (
              <div key={i} className="absolute flex h-10 items-center gap-2 rounded-[8px] border bg-surface px-2.5 text-[12px] font-medium text-ink"
                style={{ left: (stack - 1 - i) * -5, top: (stack - 1 - i) * -6, width: ghostW, opacity: top ? 0.75 : 0.5 + i * 0.12, transform: `rotate(${top ? -2 : i % 2 ? 4 : -4}deg)`, borderColor: col, borderWidth: 1.5, boxShadow: top ? "0 16px 32px rgba(0,0,0,.35)" : undefined }}>
                {top && <><Glyph name={st.glyph} size={15} color="var(--muted)" /><span dir="auto" className="min-w-0 flex-1 truncate">{st.label}</span></>}
              </div>
            );
          })}
          {st.count > 1 && <span className="absolute -end-3 -top-4 flex h-[22px] items-center rounded-full bg-accent px-2 text-[11px] font-bold text-accent-ink">{describe(st.payload).label}</span>}
        </div>
      )}
      {/* one-line state under the pointer */}
      {zone && p && (p.hint || !p.ok) && (
        <div className="absolute flex h-[26px] items-center gap-1.5 whitespace-nowrap" style={{ left: Math.max(8, at.x - (p.ok ? 40 : 115)), top: at.y + 30 }}>
          {p.ok
            ? <><Glyph name="drop-into" size={14} color="var(--accent)" /><span dir="auto" className="text-[11px] text-accent">{p.hint}</span></>
            : <span className="flex h-[26px] items-center gap-1.5 rounded-full border border-line bg-surface-2 px-3 text-[11.5px] text-ink"><Glyph name="not-allowed" size={14} color="var(--danger, #EF6B6B)" />{p.reason}</span>}
        </div>
      )}
      {st.mode === "keyboard" && (
        <div className="absolute bottom-20 left-1/2 flex w-[min(360px,calc(100vw-24px))] -translate-x-1/2 flex-col gap-1.5">
          <span className="text-center text-[11px] text-muted">{t("← → ↑ ↓ move · Enter drop · Esc cancel")}</span>
          <Announced />
        </div>
      )}
    </div>
  );
}
function Announced() {
  const live = useDndLive();
  return <div className="flex min-h-[44px] items-center rounded-[10px] border border-line bg-surface-2 px-3 font-mono text-[11.5px]">“{live}”</div>;
}

// ------------------------------------------------------------------ Send to…
function SendMenu({ payload }: { payload: DndPayload }) {
  const v = useVault();
  const ui = useUI();
  const zones = allZones();
  const targets = useMemo(() => v.notes.filter((n) => !n.deleted && (n.type === "canvas" || n.type === "whiteboard" || n.type === "board") && n.id !== ui.noteId).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 12), [v.notes, ui.noteId]);
  const [busy, setBusy] = useState(false);
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => { first.current?.focus(); announce(t("Send to. {n} places.", { n: zones.length + targets.length })); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const d = describe(payload);
  const row = "flex h-[40px] w-full items-center gap-2.5 rounded-[8px] px-2.5 text-start text-[13px] hover:bg-bg focus-visible:bg-bg";
  return (
    <div className="fixed inset-0 z-[410] flex items-end justify-center bg-black/40 md:items-center" onClick={closeSendTo} onKeyDown={(e) => { if (e.key === "Escape") closeSendTo(); }}>
      <div role="dialog" aria-modal aria-label={t("Send to…")} onClick={(e) => e.stopPropagation()} className="ldnd-chip max-h-[70vh] w-full overflow-y-auto rounded-t-[16px] border border-line bg-surface-2 p-2.5 pb-[calc(10px+env(safe-area-inset-bottom))] shadow-[0_20px_50px_rgba(0,0,0,.4)] md:w-[340px] md:rounded-[14px]">
        <div className="flex items-center gap-2 px-2.5 pb-2 pt-1 text-[12px] text-muted"><Glyph name="send-to" size={14} /><span className="truncate" dir="auto">{t("Send {what} to…", { what: d.label })}</span></div>
        {zones.map((z, i) => (
          <button key={i} ref={i === 0 ? first : undefined} type="button" className={row} onClick={() => { closeSendTo(); const b = zoneEl(z).getBoundingClientRect(); void engine.drop(b.left + b.width / 2, b.top + b.height / 2, false, payload); }}>
            <Glyph name="drop-into" size={16} color="var(--muted)" /><span className="min-w-0 flex-1 truncate">{z.name}</span><span className="text-[11px] text-muted">{t("Open here")}</span>
          </button>
        ))}
        {targets.map((n, i) => (
          <button key={n.id} ref={!zones.length && i === 0 ? first : undefined} type="button" disabled={busy} className={row} onClick={async () => { setBusy(true); const ok = await sendToNote(payload, n); closeSendTo(); if (!ok) announce(t("That can’t be sent there")); }}>
            <Glyph name={n.type === "canvas" ? "canvas" : "whiteboard"} size={16} color="var(--muted)" /><span dir="auto" className="min-w-0 flex-1 truncate">{n.title}</span><span className="text-[11px] text-muted">{n.type === "board" ? t("Board") : n.type === "canvas" ? t("Canvas") : t("Whiteboard")}</span>
          </button>
        ))}
        {!zones.length && !targets.length && <div className="px-3 py-4 text-[12.5px] text-muted">{t("No boards or canvases yet. Create one from New…")}</div>}
        <button type="button" className={cx(row, "mt-1 text-muted")} onClick={closeSendTo}>{t("Cancel")}</button>
      </div>
    </div>
  );
}
