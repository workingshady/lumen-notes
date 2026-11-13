// "⋯ › Customize home": show/hide and reorder dashboard cards (saved on this device), plus the device app lock.
import { ArrowDown, ArrowUp, GripVertical, X } from "lucide-react";
import { useEffect, useState } from "react";
import { PHONE_DEFAULT, resetHomeLayout, SECTIONS, setHomeLayout, useHomeLayout, type SectionId } from "../lib/home-meta";
import { cx } from "../components/ui";
import { AppLockSetting } from "./Welcome";

export function CustomizeHome({ onClose }: { onClose: () => void }) {
  const l = useHomeLayout();
  const [drag, setDrag] = useState<SectionId | null>(null);
  useEffect(() => {
    const f = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    addEventListener("keydown", f);
    return () => removeEventListener("keydown", f);
  }, [onClose]);
  const order0 = !l.custom && innerWidth < 640 ? PHONE_DEFAULT : l.order;
  const move = (id: SectionId, to: number) => {
    const order = order0.filter((x) => x !== id);
    order.splice(Math.max(0, Math.min(order.length, to)), 0, id);
    setHomeLayout({ ...l, order, custom: true });
  };
  const toggle = (id: SectionId) => setHomeLayout({ ...l, hidden: l.hidden.includes(id) ? l.hidden.filter((x) => x !== id) : [...l.hidden, id] });
  const byId = new Map(SECTIONS.map((s) => [s.id, s]));

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 fade-in sm:items-center" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-label="Customize home" className="safe-b flex max-h-[90vh] w-full flex-col overflow-y-auto rounded-t-[18px] border border-line bg-surface text-[13px] text-ink shadow-[0_16px_40px_rgba(0,0,0,.45)] sm:w-[440px] sm:rounded-[14px]">
        <div className="flex items-start gap-3 px-5 pb-3 pt-[18px]">
          <div className="flex flex-1 flex-col gap-1">
            <span className="text-[16px] font-[650] tracking-[-0.01em]">Customize home</span>
            <span className="text-muted">Show, hide and reorder cards. Saved on this device.</span>
          </div>
          <button aria-label="Close" onClick={onClose} className="flex size-8 items-center justify-center rounded-[8px] text-muted hover:bg-surface-2 hover:text-ink"><X size={16} /></button>
        </div>
        <div className="flex flex-col px-3">
          {order0.map((id, i) => {
            const s = byId.get(id)!;
            const on = !l.hidden.includes(id);
            return (
              <div key={id} draggable onDragStart={() => setDrag(id)} onDragEnd={() => setDrag(null)}
                onDragOver={(e) => { e.preventDefault(); if (drag && drag !== id) move(drag, i); }}
                className={cx("flex items-center gap-2.5 rounded-[10px] px-2 py-2", drag === id ? "bg-surface-2 opacity-70" : "hover:bg-surface-2")}>
                <GripVertical size={16} className="shrink-0 cursor-grab text-muted" />
                <div className={cx("flex min-w-0 flex-1 flex-col gap-0.5", !on && "opacity-50")}>
                  <span className="text-[14px] font-medium">{s.name}</span>
                  <span className="truncate text-[12px] text-muted">{s.hint}</span>
                </div>
                <button aria-label={`Move ${s.name} up`} disabled={i === 0} onClick={() => move(id, i - 1)} className="flex size-7 items-center justify-center rounded-[6px] text-muted hover:bg-surface hover:text-ink disabled:opacity-30"><ArrowUp size={14} /></button>
                <button aria-label={`Move ${s.name} down`} disabled={i === order0.length - 1} onClick={() => move(id, i + 1)} className="flex size-7 items-center justify-center rounded-[6px] text-muted hover:bg-surface hover:text-ink disabled:opacity-30"><ArrowDown size={14} /></button>
                <button role="switch" aria-checked={on} aria-label={`Show ${s.name}`} onClick={() => toggle(id)}
                  className={cx("relative ml-1 h-[22px] w-[38px] shrink-0 rounded-full transition-colors", on ? "bg-accent" : "bg-line")}>
                  <span className="absolute top-[3px] size-4 rounded-full bg-white transition-all" style={{ left: on ? 19 : 3 }} />
                </button>
              </div>
            );
          })}
        </div>
        <div className="mx-5 mt-3 border-t border-line pt-4">
          <div className="mb-3 text-[12px] font-medium text-muted">This device</div>
          <AppLockSetting />
        </div>
        <div className="flex items-center justify-between px-5 pb-[18px] pt-5">
          <button onClick={resetHomeLayout} className="text-[13px] text-muted hover:text-ink">Reset to default</button>
          <button onClick={onClose} className="flex h-9 items-center rounded-[10px] bg-accent px-4 font-semibold text-accent-fg">Done</button>
        </div>
      </div>
    </div>
  );
}
