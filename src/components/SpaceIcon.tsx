// Space icon (design round 4, Lumen 13): a glyph or two-letter initials in the space colour, never an emoji.
// <SpaceIcon space size /> draws the plain glyph (inline next to a name); `tile` adds the 14% tinted tile;
// <SpaceTile> is the bordered square used by the sidebar switcher, space header and shared pages.
// <SpaceIconPicker> = the picker: popover on desktop, bottom sheet on phone (search, colour row, subjects, shapes, initials).
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { isRtl, t } from "../lib/i18n";
import { createPortal } from "react-dom";
import type { Space } from "../../shared/types";
import { PRESETS } from "../lib/canvas";
import { avatarColor, avatarGlyph, iconValue, initialsChoices, resolveSpaceIcon, searchSpaceGlyphs, SPACE_SHAPES, spaceColor, type SpaceIconValue } from "../lib/space-icon";
import { Glyph } from "./Glyph";

type SpaceLike = Pick<Space, "icon" | "name" | "color"> & { kind?: string };

/** Plain glyph (or initials) in the space colour; `tile` draws the design's 14% tile behind it. */
export function SpaceIcon({ space, size = 15, tile, tileScale, color, fallback, className, style }: { space?: SpaceLike | null; size?: number; tile?: boolean; tileScale?: number; color?: string; fallback?: string; className?: string; style?: CSSProperties }) {
  const c = color ?? spaceColor(space, fallback);
  const v: SpaceIconValue = space ? resolveSpaceIcon(space.icon, space.name, space.kind as Space["kind"] | undefined) : { glyph: "folder" };
  const initialsFs = tile ? undefined : Math.round(size * 0.78);
  return <Glyph name={v.glyph ?? "note"} initials={v.initials} size={size} color={c} tile={tile ? c : undefined} tileScale={tileScale} className={className}
    style={{ ...(v.initials && initialsFs ? { fontSize: initialsFs, fontWeight: 650 } : null), ...style }} />;
}

/** Bordered tinted square (18–20% fill, 50% border) with the glyph in the space colour. */
export function SpaceTile({ space, size = 28, glyph, radius, fill = 20, fallback = "#A371F7", onClick, title, className }: { space?: SpaceLike | null; size?: number; glyph?: number; radius?: number; fill?: number; fallback?: string; onClick?: () => void; title?: string; className?: string }) {
  const c = spaceColor(space, fallback);
  const g = glyph ?? Math.round(size * 0.46);
  const Tag = onClick ? "button" : "div";
  return (
    <Tag type={onClick ? "button" : undefined} onClick={onClick} title={title} aria-label={title} className={"flex shrink-0 items-center justify-center " + (className ?? "")}
      style={{ width: size, height: size, borderRadius: radius ?? size / 4, background: `color-mix(in srgb, ${c} ${fill}%, transparent)`, border: `1px solid color-mix(in srgb, ${c} 50%, transparent)` }}>
      {space ? <SpaceIcon space={space} size={g} color={c} /> : <Glyph name="folder" size={g} color={c} />}
    </Tag>
  );
}

const PRESET_KEYS = Object.keys(PRESETS);

export interface SpaceIconPickerProps {
  open: boolean;
  onClose: () => void;
  /** Current stored icon + colour (legacy emoji allowed) and the space name (initials, preview). */
  icon: string;
  color: string | null;
  name: string;
  kind?: Space["kind"];
  /** Called on every pick with the new stored icon (`glyph:x` / `initials:AB`) and colour key. */
  onChange: (icon: string, color: string | null) => void;
  phone?: boolean;
  /** Desktop: the element the popover hangs under. */
  anchor?: HTMLElement | null;
}

/** Space icon picker. Desktop popover (380 px) under `anchor`; phone bottom sheet with a Done button. */
export function SpaceIconPicker({ open, onClose, icon, color, name, kind, onChange, phone, anchor }: SpaceIconPickerProps) {
  const [q, setQ] = useState("");
  const cur = resolveSpaceIcon(icon, name, kind);
  const c = color ? PRESETS[color] ?? color : "#A371F7";
  const list = useMemo(() => searchSpaceGlyphs(q), [q]);
  const inits = useMemo(() => initialsChoices(name || "Space"), [name]);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useEffect(() => { if (!open) setQ(""); }, [open]);
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    addEventListener("keydown", k, true);
    return () => removeEventListener("keydown", k, true);
  }, [open, onClose]);
  useEffect(() => {
    if (!open || phone || !anchor) return;
    const r = anchor.getBoundingClientRect();
    const w = 380, h = ref.current?.offsetHeight ?? 420;
    const left = Math.max(8, Math.min(isRtl() ? r.right - w : r.left, innerWidth - w - 8));
    const below = r.bottom + 6;
    setPos({ left, top: below + h > innerHeight - 8 ? Math.max(8, r.top - h - 6) : below });
  }, [open, phone, anchor, q]);
  if (!open) return null;

  const pickGlyph = (g: string) => onChange(iconValue({ glyph: g }), color);
  const pickInitials = (ini: string) => onChange(iconValue({ initials: ini }), color);
  const pickColor = (k: string) => onChange(iconValue(cur), k);
  const isSel = (g: string) => cur.glyph === g;
  const selStyle = (on: boolean): CSSProperties => ({ background: on ? `color-mix(in srgb, ${c} 18%, transparent)` : "transparent", boxShadow: on ? `inset 0 0 0 1.5px ${c}` : "none", color: on ? c : "var(--text)" });
  const swatch = (k: string, sz: number) => (
    <button key={k} type="button" aria-label={t("Colour {name}", { name: k })} aria-pressed={color === k} onClick={() => pickColor(k)} className="rounded-full"
      style={{ width: sz, height: sz, background: PRESETS[k], boxShadow: color === k ? `0 0 0 2px ${phone ? "var(--surface)" : "var(--surface-2)"}, 0 0 0 4px var(--text)` : "none" }} />
  );
  const label = "text-[11px] font-semibold uppercase tracking-[.06em] text-muted";
  const shapes = !q.trim();

  if (phone) {
    return createPortal(
      <div className="fade-in fixed inset-0 z-[70] flex items-end bg-[rgba(5,6,8,.6)]" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
        <div role="dialog" aria-label={t("Space icon")} className="sheet-in flex max-h-[92dvh] w-full flex-col gap-3.5 overflow-y-auto rounded-t-[14px] bg-surface px-4 pt-2.5 text-[14px] text-ink">
          <div className="flex justify-center"><span className="h-1 w-9 rounded-[2px] bg-line" /></div>
          <div className="flex items-center gap-3"><SpaceIcon space={{ icon, name, color, kind }} size={24} tile /><span className="flex-1 text-[18px] font-[650]">{t("Space icon")}</span></div>
          <label className="flex h-12 shrink-0 items-center gap-2 rounded-[10px] border border-line bg-bg px-3 text-muted focus-within:border-accent">
            <Glyph name="query" size={18} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Search icons")} className="min-w-0 flex-1 bg-transparent text-ink outline-none placeholder:text-muted" />
          </label>
          <div className="flex justify-between">{PRESET_KEYS.map((k) => <span key={k} className="flex size-11 items-center justify-center">{swatch(k, 28)}</span>)}</div>
          {/* one scrolling grid, 4 rows tall (design): subjects, then shapes, then "use initials" tiles */}
          <div className="-mx-1 grid max-h-[226px] shrink-0 grid-cols-6 gap-1.5 overflow-y-auto px-1">
            {list.map((g) => <button key={g} type="button" aria-label={g} aria-pressed={isSel(g)} onClick={() => pickGlyph(g)} className="flex h-[52px] items-center justify-center rounded-[10px]" style={selStyle(isSel(g))}><Glyph name={g} size={22} /></button>)}
            {!list.length && <span className="col-span-6 py-4 text-center text-muted">{t("No icon matches. Use initials.")}</span>}
            {shapes && SPACE_SHAPES.map((g) => <button key={g} type="button" aria-label={g} aria-pressed={isSel(g)} onClick={() => pickGlyph(g)} className="flex h-[52px] items-center justify-center rounded-[10px]" style={selStyle(isSel(g))}><Glyph name={g} size={22} /></button>)}
            {inits.map((ini) => { const on = cur.initials === ini; return <button key={ini} type="button" aria-label={t("Use initials {initials}", { initials: ini })} onClick={() => pickInitials(ini)} className="flex h-[52px] items-center justify-center rounded-[10px] text-[15px] font-[650]" style={{ ...selStyle(on), border: on ? "none" : "1px dashed var(--border)" }}>{ini}</button>; })}
          </div>
          <button type="button" onClick={onClose} className="flex h-[52px] shrink-0 items-center justify-center rounded-[12px] bg-accent font-semibold text-accent-fg">{t("Done")}</button>
          <div className="safe-b h-2 shrink-0" />
        </div>
      </div>, document.body);
  }

  return createPortal(
    <>
      <div className="fixed inset-0 z-[70]" onMouseDown={onClose} />
      <div ref={ref} role="dialog" aria-label={t("Space icon")} className="fade-in fixed z-[71] flex w-[380px] flex-col gap-3 rounded-[14px] border border-line bg-surface-2 p-3 text-[13px] text-ink shadow-[0_16px_40px_rgba(0,0,0,.45)]"
        style={{ left: pos?.left ?? -9999, top: pos?.top ?? 0 }}>
        <label className="flex h-[34px] items-center gap-2 rounded-[6px] border border-line bg-bg px-2.5 text-muted focus-within:border-accent">
          <Glyph name="query" size={16} /><input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Search icons")} aria-label={t("Search icons")} className="min-w-0 flex-1 bg-transparent text-ink outline-none placeholder:text-muted" />
        </label>
        <div className="flex items-center gap-2">{PRESET_KEYS.map((k) => swatch(k, 22))}<span className="flex-1" /><span className="text-[12px] text-muted">{t("Colour")}</span></div>
        <span className={label}>{t("Subjects")}</span>
        <div className="grid grid-cols-8 gap-1">
          {list.map((g) => <button key={g} type="button" title={g} aria-label={g} aria-pressed={isSel(g)} onClick={() => pickGlyph(g)} className="flex h-[38px] items-center justify-center rounded-[8px] hover:bg-bg" style={selStyle(isSel(g))}><Glyph name={g} size={20} /></button>)}
          {!list.length && <span className="col-span-8 py-3 text-center text-muted">{t("No icon matches. Use initials below.")}</span>}
        </div>
        <span className={label}>{t("Shapes · initials")}</span>
        <div className="grid grid-cols-8 gap-1">
          {shapes && SPACE_SHAPES.map((g) => <button key={g} type="button" title={g} aria-label={g} aria-pressed={isSel(g)} onClick={() => pickGlyph(g)} className="flex h-[38px] items-center justify-center rounded-[8px] hover:bg-bg" style={selStyle(isSel(g))}><Glyph name={g} size={20} /></button>)}
          {inits.map((ini) => { const on = cur.initials === ini; return <button key={ini} type="button" title={t("Use initials {initials}", { initials: ini })} onClick={() => pickInitials(ini)} className="flex h-[38px] items-center justify-center rounded-[8px] text-[13px] font-[650]" style={{ ...selStyle(on), border: on ? "none" : "1px dashed var(--border)" }}>{ini}</button>; })}
        </div>
        <div className="flex items-center gap-2.5 border-t border-line pt-2.5"><SpaceIcon space={{ icon, name, color, kind }} size={20} tile /><span dir="auto" className="flex-1 truncate font-semibold">{name || t("New space")}</span><span className="text-[12px] text-muted">{t("preview")}</span></div>
      </div>
    </>, document.body);
}

/** Profile / blog avatar glyph (the owl by default), in its design colour. */
export function AvatarGlyph({ value, size = 15, color, className, style }: { value?: string | null; size?: number; color?: string; className?: string; style?: CSSProperties }) {
  const g = avatarGlyph(value);
  return <Glyph name={g} size={size} color={color ?? avatarColor(g)} className={className} style={style} />;
}
