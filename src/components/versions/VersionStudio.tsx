// Version studio (design Lumen 58 · VersionStudio.dc.html, screens "history", "compare", "name" and "doc"): a full-screen
// layer over a note with the word-level diff of any version against now (Inline / Side by side / Preview), compare of any two
// versions, naming a version, restore (all, or only the lines you pick) and, for PDF notes, the page-by-page comparison.
// Opened from the History panel (Versions tab: Diff, Compare) — see HistoryPanel.tsx.
import { useLiveQuery } from "dexie-react-hooks";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Note, Version } from "../../../shared/types";
import { createNote, snapshot, updateNote } from "../../lib/actions";
import { thisDevice } from "../../lib/activity";
import { storeBlob } from "../../lib/attachments";
import { db, save } from "../../lib/db";
import { fmtDate, fmtNum, t } from "../../lib/i18n";
import { download } from "../../lib/io";
import { pdfMeta, setPdfMeta } from "../../lib/pdf-format";
import { openNote, toast, useVault } from "../../lib/store";
import { diffLines, inlineRows, newSide, oldSide, restoreRows, statOf } from "../../lib/versions-diff";
import { splitFront } from "../../lib/versions-text";
import { Glyph } from "../Glyph";
import { PdfCompare, type PdfMode } from "./PdfCompare";
import { Pill, DRow, SideList, Seg3, VBtn, dayLabel, rowLabels, usePopClose, type SideItem } from "./vs-ui";
import { dayStart, hm, historyRows, isNamed, restoreFromVersion, whenLong } from "./vs-util";

const Preview = lazy(() => import("../Preview").then((m) => ({ default: m.Preview })));
const usePhone = () => { const [p, setP] = useState(() => innerWidth < 768); useEffect(() => { const f = () => setP(innerWidth < 768); addEventListener("resize", f); return () => removeEventListener("resize", f); }, []); return p; };
type DMode = "inline" | "side" | "preview";
type Filter = "all" | "named" | "me" | "ai" | "sync";
const CUR = "cur";
const FILTERS: { v: Filter; l: string }[] = [{ v: "all", l: "All" }, { v: "named", l: "Named" }, { v: "me", l: "By me" }, { v: "ai", l: "AI edits" }, { v: "sync", l: "Synced" }];

export function VersionStudio({ note, initialId, compare, onClose }: { note: Note; initialId?: string | null; compare?: boolean; onClose: () => void }) {
  const phone = usePhone();
  const vault = useVault();
  const all = useLiveQuery(() => db.versions.where("noteId").equals(note.id).reverse().sortBy("createdAt"), [note.id]);
  const live = useMemo(() => (all ?? []).filter((v) => !v.deleted), [all]);
  const device = thisDevice();
  const rows = useMemo(() => historyRows(live, device), [live, device]);
  const isPdf = note.type === "pdf";
  const [from, setFrom] = useState<string>(initialId ?? "");
  const [to, setTo] = useState<string>(CUR);
  const [mode, setMode] = useState<DMode>(() => (compare ? "side" : ((localStorage.getItem("lumen.diffMode") === "side" ? "side" : "inline") as DMode)));
  const [view, setView] = useState<"rendered" | "source">(() => { try { return localStorage.getItem("lumen.diffView") === "source" ? "source" : "rendered"; } catch { return "rendered"; } });
  const rendered = view === "rendered";
  const [pdfMode, setPdfMode] = useState<PdfMode>("pages");
  const [filter, setFilter] = useState<Filter>("all");
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [menu, setMenu] = useState<"from" | "to" | "more" | null>(null);
  const [naming, setNaming] = useState<string | null>(null);
  const [comparing, setComparing] = useState(!!compare);
  const [pdfStat, setPdfStat] = useState("");
  const fileIn = useRef<HTMLInputElement>(null);
  const popRef = usePopClose(menu !== null, useCallback(() => setMenu(null), []));
  const cardRef = useRef<HTMLDivElement>(null);

  // Default selection: the version asked for, else the newest saved one.
  useEffect(() => { if (!from && live.length) setFrom(initialId && live.some((v) => v.id === initialId) ? initialId : live[0].id); }, [live, from, initialId]);
  useEffect(() => { cardRef.current?.focus(); }, []);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (naming !== null) return;
      if (e.key === "Escape") { e.stopPropagation(); onClose(); }
    };
    addEventListener("keydown", k);
    return () => removeEventListener("keydown", k);
  }, [onClose, naming]);

  const byId = useMemo(() => new Map(live.map((v) => [v.id, v])), [live]);
  const noOf = useMemo(() => new Map(live.map((v, i) => [v.id, live.length - i])), [live]);
  const fromV = byId.get(from) ?? null;
  const toV = to === CUR ? null : byId.get(to) ?? null;
  const fromBody = fromV?.body ?? "", toBody = to === CUR ? note.body : toV?.body ?? "";
  const diff = useMemo(() => (rendered ? diffLines(splitFront(fromBody).body, splitFront(toBody).body, true) : diffLines(fromBody, toBody)), [fromBody, toBody, rendered]);
  const propsChanged = rendered && splitFront(fromBody).fm !== splitFront(toBody).fm;
  const st = useMemo(() => statOf(diff), [diff]);
  useEffect(() => setPicked(new Set()), [from, to]);

  const label = (id: string) => { const v = byId.get(id); return id === CUR ? t("Current") : v ? `${isNamed(v) ? "★ " : ""}v${noOf.get(id)} · ${whenLong(v.createdAt)}` : "—"; };
  const fromL = fromV ? label(from) : "—", toL = label(to);

  // History list
  const shown = rows.filter((r) => filter === "all" || (filter === "named" ? r.kind === "named" : filter === "ai" ? r.kind === "ai" : filter === "sync" ? r.kind === "sync" : r.mine && r.kind !== "sync"));
  const items: SideItem[] = [];
  items.push({ key: "now", head: t("Now"), label: t("Current"), sub: `${t("You")} · ${device} · ${t("editing")}`, time: "", kind: "cur", second: to === CUR && comparing, onClick: () => { setTo(CUR); setComparing(false); } });
  let lastHead = "";
  for (const r of shown) {
    const v = r.v!;
    const h = dayLabel(r.to);
    const head = h !== lastHead ? h : undefined;
    lastHead = h;
    const l = rowLabels(r, device);
    items.push({
      key: v.id, head, label: l.label, sub: l.sub, time: l.time, add: r.add, del: r.del, tag: l.tag, tagKind: r.kind === "auto" ? undefined : r.kind, kind: r.kind,
      selected: from === v.id, second: to === v.id, title: t("Double-click to name this version"),
      onClick: (e) => {
        if (e.shiftKey || e.ctrlKey || e.metaKey) { if (from && from !== v.id) { setTo(v.id); setComparing(true); setMode("side"); } return; }
        setFrom(v.id); if (to === v.id) { setTo(CUR); setComparing(false); }
      },
      onDouble: () => setNaming(v.id),
    });
  }

  // Actions
  const restoreAll = async () => { if (!fromV) return; await restoreFromVersion(note, fromV, live[0]?.body); onClose(); };
  const restoreSelection = async () => {
    if (!fromV || to !== CUR || !picked.size) return;
    const before = { title: note.title, body: note.body };
    const body = (rendered ? splitFront(note.body).fm : "") + restoreRows(diff, picked);
    if (live[0]?.body !== note.body) await snapshot(note, "");
    await updateNote(note.id, { body });
    await snapshot({ ...note, body }, `Restored from ${fmtDate(fromV.createdAt, { day: "numeric", month: "short" })}`);
    toast(t("Restored {n} line|Restored {n} lines", { n: picked.size }), { label: t("Undo"), run: () => void updateNote(note.id, before) });
    setPicked(new Set());
  };
  const openCopy = async () => {
    if (!fromV) return;
    const copy = await createNote({ title: `${fromV.title} (v${noOf.get(fromV.id)})`, body: fromV.body, type: note.type, spaceId: note.spaceId, folderId: note.folderId });
    onClose();
    openNote(copy.id);
  };
  const saveName = async (id: string, name: string, extra: string, alsoLinked: boolean) => {
    const label = name.trim() || "Manual save";
    if (id === CUR) await snapshot(note, label);
    else { const v = byId.get(id); if (v) await save("version", { ...v, label, ...(extra.trim() ? { lumenNote: extra.trim() } : {}) } as Version); }
    if (alsoLinked) for (const nid of vault.outlinks.get(note.id) ?? []) { const n = vault.byId.get(nid); if (n && !n.deleted) await snapshot(n, label); }
    setNaming(null);
    toast(t("Version saved"));
  };
  const uploadPdf = async (file: File) => {
    try {
      const { id } = await storeBlob(file, file.name, { shrink: false });
      if (live[0]?.body !== note.body || !live.length) await snapshot(note, "");
      await updateNote(note.id, { body: setPdfMeta(note.body, { file: `att:${id}`, page: 1, pages: 0, progress: 0 }) });
      toast(t("Uploaded {name} as a new version", { name: file.name }));
      setFrom(""); setTo(CUR);
    } catch (e) { toast((e as Error).message); }
  };
  const downloadFrom = async () => {
    if (!fromV) return;
    const f = pdfMeta(fromV.body).file;
    const id = f.startsWith("att:") ? f.slice(4) : "";
    const meta = id ? await db.attachments.get(id) : undefined;
    const blob = id ? await (await import("../../lib/attachments")).attBlob(id) : null;
    if (!blob) { toast(t("The file isn't on this device or the server yet.")); return; }
    download(meta?.name ?? `${note.title}-v${noOf.get(fromV.id)}.pdf`, blob, "application/pdf");
  };

  // PDF sizes for the list sub-line
  const attIds = useMemo(() => [...new Set([note.body, ...live.map((v) => v.body)].map((b) => pdfMeta(b).file).filter((f) => f.startsWith("att:")).map((f) => f.slice(4)))], [note.body, live]);
  const atts = useLiveQuery(() => (isPdf ? db.attachments.bulkGet(attIds) : []), [isPdf, attIds.join()]);
  const sizeOf = (body: string) => { const id = pdfMeta(body).file.slice(4); const a = (atts ?? []).find((x) => x?.id === id); return a ? `${(a.size / 1048576).toFixed(1)} MB` : ""; };
  const totalSize = (atts ?? []).reduce((n, a) => n + (a?.size ?? 0), 0);

  const folder = note.folderId ? vault.folderMap.get(note.folderId)?.name : vault.spaceMap.get(note.spaceId)?.name;
  const noFrom = fromV ? noOf.get(fromV.id) : 0;
  const modeL = isPdf ? (to === CUR ? t("Compare v{a} → current", { a: noFrom ?? 0 }) : t("Compare v{a} → v{b}", { a: noFrom ?? 0, b: noOf.get(to) ?? 0 })) : comparing && to !== CUR ? t("Comparing 2 versions") : fromV ? t("Viewing v{n} · {when}", { n: noFrom ?? 0, when: fmtDate(fromV.createdAt, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }) }) : t("History");
  const stat = isPdf ? pdfStat : comparing && to !== CUR && !phone ? t("Pick any two in History") : [st.added ? t("+{n} line|+{n} lines", { n: st.added }) : "", st.removed ? t("−{n} line|−{n} lines", { n: st.removed }) : "", st.changed ? t("{n} changed", { n: st.changed }) : ""].concat(propsChanged ? [t("Properties changed")] : []).filter(Boolean).join(" · ") || t("No differences");
  const pad = phone ? "14px" : "24px";
  const docPad = phone ? "12px 14px" : "22px 40px";
  const dmodes: { v: DMode; l: string }[] = [{ v: "inline", l: t("Inline") }, { v: "side", l: t("Side by side") }, { v: "preview", l: t("Preview") }];
  const setDV = (v: "rendered" | "source") => { setView(v); try { localStorage.setItem("lumen.diffView", v); } catch { /* ignore */ } };
  const setDM = (m: DMode) => { setMode(m); if (m !== "preview") try { localStorage.setItem("lumen.diffMode", m); } catch { /* ignore */ } };
  const hint = isPdf ? (phone ? t("{n} versions · {size}", { n: live.length + 1, size: `${(totalSize / 1048576).toFixed(1)} MB` }) : t("Older versions stay in the vault; links always open the newest."))
    : phone ? t("Restoring keeps the current text as a version.") : t("Restoring makes a new version; nothing is lost. Select lines to restore only those.");
  const picker = (which: "from" | "to") => menu === which && (
    <div ref={popRef} role="listbox" style={{ position: "absolute", top: 34, insetInlineStart: 0, zIndex: 5, minWidth: 260, maxHeight: 320, overflowY: "auto", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, boxShadow: "0 12px 32px rgba(0,0,0,.35)", padding: 4 }}>
      {(which === "to" ? [{ id: CUR, l: t("Current"), s: "" }] : []).concat(live.map((v) => ({ id: v.id, l: label(v.id), s: v.label && !v.label.startsWith("Restored") ? v.label : "" }))).map((o) => (
        <button key={o.id} role="option" aria-selected={(which === "from" ? from : to) === o.id} onClick={() => { if (which === "from") { setFrom(o.id); } else { setTo(o.id); setComparing(o.id !== CUR); if (o.id !== CUR) setMode("side"); } setMenu(null); }}
          style={{ display: "flex", width: "100%", justifyContent: "space-between", gap: 12, padding: "7px 10px", borderRadius: 7, fontSize: 12.5, background: (which === "from" ? from : to) === o.id ? "var(--surface-2)" : "transparent", textAlign: "start" }}>
          <span dir="auto">{o.l}</span><span style={{ color: "var(--muted)" }}>{o.s}</span>
        </button>
      ))}
    </div>
  );

  const side = mode === "side";
  const oldLines = oldSide(diff), newLines = newSide(diff);
  const pick = (i: number) => setPicked((p) => { const n = new Set(p); if (n.has(i)) n.delete(i); else n.add(i); return n; });
  const pane = (h: string, hc: string, ls: typeof oldLines, bl: boolean, strike: boolean) => (
    <div key={h || "one"} style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2, padding: docPad, borderInlineStart: bl ? "1px solid var(--border)" : "none", overflow: "auto" }}>
      {h && <span style={{ fontSize: 11, fontWeight: 650, letterSpacing: ".06em", color: hc, paddingBottom: 8 }}>{h}</span>}
      {ls.map((l) => <DRow key={l.i} l={l} phone={phone} strike={strike} picked={picked.has(l.i)} mono={!rendered} onClick={to === CUR ? () => pick(l.i) : undefined} />)}
      {!ls.length && <span style={{ color: "var(--muted)" }}>{t("Empty")}</span>}
    </div>
  );

  return (
    <div ref={cardRef} tabIndex={-1} role="dialog" aria-label={t("Version history")} className="fixed inset-0 z-[80] fade-in" dir={undefined}
      style={{ background: "var(--bg)", fontFamily: "Inter, system-ui, sans-serif", fontSize: 13, color: "var(--text)", display: "flex", flexDirection: "column", outline: "none" }}>
      {phone && <div className="safe-t" style={{ flexShrink: 0 }} />}
      <div style={{ height: 52, flexShrink: 0, display: "flex", alignItems: "center", gap: 10, padding: `0 ${pad}`, borderBottom: "1px solid var(--border)" }}>
        {phone && <button type="button" aria-label={t("Back")} onClick={onClose} style={{ width: 40, height: 40, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, marginInlineStart: -8 }} className="rtl:-scale-x-100">‹</button>}
        <Glyph name={isPdf ? "pdf" : "note"} size={18} color="var(--muted)" />
        {!phone && folder && <span dir="auto" style={{ color: "var(--muted)", fontSize: 12.5, whiteSpace: "nowrap" }}>{folder} /</span>}
        <span dir="auto" style={{ fontWeight: 650, fontSize: 14, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0 }}>{note.title || t("Untitled")}{isPdf ? ".pdf" : ""}</span>
        <span style={{ height: 24, padding: "0 10px", borderRadius: 999, background: "color-mix(in srgb,var(--accent) 16%,transparent)", color: "var(--accent)", fontSize: 11.5, fontWeight: 650, display: "flex", alignItems: "center", whiteSpace: "nowrap" }}>{modeL}</span>
        <span style={{ flex: 1 }} />
        {isPdf ? (
          <>
            <VBtn l={t("Upload new version")} g="export" pri={!phone} onClick={() => fileIn.current?.click()} />
            <input ref={fileIn} type="file" accept="application/pdf,.pdf" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void uploadPdf(f); }} />
            <VBtn g="more" title={t("More")} onClick={() => setMenu(menu === "more" ? null : "more")} />
            {menu === "more" && (
              <div ref={popRef} style={{ position: "absolute", top: 46, insetInlineEnd: pad, zIndex: 5, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, boxShadow: "0 12px 32px rgba(0,0,0,.35)", padding: 4, minWidth: 200 }}>
                <button onClick={() => { setMenu(null); onClose(); }} style={menuItem}>{t("Close")}</button>
              </div>
            )}
          </>
        ) : (
          <>
            <VBtn l={phone ? undefined : t("Name this version")} title={t("Name this version")} g="star" disabled={!fromV} onClick={() => fromV && setNaming(fromV.id)} />
            <VBtn l={t("Close")} g="x" onClick={onClose} />
          </>
        )}
      </div>

      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: phone ? "column" : "row" }}>
        <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: `10px ${pad}`, borderBottom: "1px solid var(--border)", flexWrap: "wrap" }}>
            <Pill dot="var(--danger)" open={menu === "from"} onClick={() => setMenu(menu === "from" ? null : "from")} menu={picker("from")}>{fromL}</Pill>
            <span style={{ color: "var(--muted)" }} className="rtl:-scale-x-100">→</span>
            <Pill dot="var(--success)" open={menu === "to"} onClick={() => setMenu(menu === "to" ? null : "to")} menu={picker("to")}>{toL}</Pill>
            <span style={{ fontSize: 12, color: "var(--muted)", whiteSpace: "nowrap" }}>{stat}</span>
            <span style={{ flex: 1 }} />
            {isPdf
              ? <Seg3<PdfMode> value={pdfMode} onChange={setPdfMode} options={[{ v: "pages", l: t("Pages") }, { v: "overlay", l: t("Overlay") }, { v: "text", l: t("Text") }]} />
              : <>{mode !== "preview" && <Seg3<"rendered" | "source"> value={view} onChange={setDV} options={[{ v: "rendered", l: t("Rendered") }, { v: "source", l: t("Source") }]} />}<Seg3<DMode> value={mode} onChange={setDM} options={dmodes} /></>}
          </div>
          <div style={{ flex: 1, minHeight: 0, display: "flex", overflow: "hidden" }}>
            {!fromV ? (
              <p style={{ padding: 24, color: "var(--muted)" }}>{t("Versions are saved automatically while you write (every 2 min at most), and whenever you click Save. Restoring never overwrites: it adds a new version on top.")}</p>
            ) : isPdf ? (
              <PdfCompare fromFile={pdfMeta(fromV.body).file} toFile={pdfMeta(to === CUR ? note.body : toV?.body ?? "").file} mode={pdfMode} phone={phone} onStat={setPdfStat}
                fromLabel={`V${noFrom} · ${fmtDate(fromV.createdAt, { day: "numeric", month: "short" }).toUpperCase()}`} toLabel={to === CUR ? `V${(live.length || 0) + 1} · ${t("TODAY")}` : `V${noOf.get(to)}`} />
            ) : mode === "preview" ? (
              <div style={{ flex: 1, minWidth: 0, overflow: "auto", padding: docPad }}><Suspense fallback={null}><Preview note={{ id: note.id, body: toBody, spaceId: note.spaceId }} className="reading" /></Suspense></div>
            ) : phone ? pane("", "", inlineRows(diff), false, true)
              : side ? <>
                {pane(`${fromL.toUpperCase()}`, "var(--danger)", oldLines, false, false)}
                {pane(to === CUR ? t("CURRENT") : toL.toUpperCase(), "var(--success)", newLines, true, true)}
              </> : pane("", "", inlineRows(diff), false, true)}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: `12px ${pad} ${phone ? 28 : 12}px`, borderTop: "1px solid var(--border)", background: "var(--surface)", flexWrap: "wrap" }}>
            <span style={{ flex: 1, minWidth: 180, fontSize: 12.5, color: "var(--muted)" }}>{hint}</span>
            {isPdf ? (
              <>
                <VBtn l={t("Download v{n}", { n: noFrom ?? 0 })} h={36} hide={phone} disabled={!fromV} onClick={() => void downloadFrom()} />
                <VBtn l={t("Make v{n} current", { n: noFrom ?? 0 })} h={36} disabled={!fromV} onClick={() => void restoreAll()} />
              </>
            ) : (
              <>
                <VBtn l={t("Open as copy")} h={36} hide={phone} disabled={!fromV} onClick={() => void openCopy()} />
                <VBtn l={picked.size ? t("Restore selection ({n})", { n: fmtNum(picked.size) }) : t("Restore selection")} h={36} disabled={!picked.size || to !== CUR} onClick={() => void restoreSelection()} title={to !== CUR ? t("Compare with Current to restore lines") : t("Click changed lines to select them")} />
                <VBtn l={t("Restore v{n}", { n: noFrom ?? 0 })} h={36} pri disabled={!fromV} onClick={() => void restoreAll()} />
              </>
            )}
          </div>
        </div>
        {!(comparing && phone) && (
          <div style={{ width: phone ? "auto" : 340, flexShrink: 0, display: "flex", flexDirection: "column", borderInlineStart: phone ? "none" : "1px solid var(--border)", borderTop: phone ? "1px solid var(--border)" : "none", background: "var(--surface)", overflow: "hidden", maxHeight: phone ? (isPdf ? 290 : 300) : "none" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "14px 14px 8px" }}>
              <span style={{ fontWeight: 650, fontSize: 14, flex: 1 }}>{isPdf ? t("Versions") : t("History")}</span>
              {!phone && <span style={{ fontSize: 11.5, color: "var(--muted)" }}>{isPdf ? t("{n} · {size}", { n: live.length + 1, size: `${(totalSize / 1048576).toFixed(1)} MB` }) : t("{n} versions · {days} days", { n: fmtNum(live.length), days: fmtNum(live.length ? Math.max(1, Math.ceil((Date.now() - dayStart(live[live.length - 1].createdAt)) / 86400000)) : 0) })}</span>}
            </div>
            {!isPdf && (
              <div style={{ display: "flex", gap: 4, padding: "0 14px 8px", flexWrap: "wrap" }}>
                {FILTERS.map((f) => (
                  <button key={f.v} type="button" aria-pressed={filter === f.v} onClick={() => setFilter(f.v)}
                    style={{ height: 26, padding: "0 9px", borderRadius: 999, fontSize: 11.5, display: "flex", alignItems: "center", border: `1px solid ${filter === f.v ? "var(--accent)" : "var(--border)"}`, background: filter === f.v ? "color-mix(in srgb,var(--accent) 16%,transparent)" : "transparent", whiteSpace: "nowrap" }}>{t(f.l)}</button>
                ))}
              </div>
            )}
            <div style={{ flex: 1, minHeight: 0, overflowY: "auto", paddingBottom: 10 }}>
              <SideList items={isPdf ? pdfItems() : items} empty={t("No versions match this filter yet.")} />
            </div>
          </div>
        )}
      </div>

      {naming !== null && <NameDialog phone={phone} title={t("Name this version")} initial={naming === CUR ? "" : (() => { const v = byId.get(naming); return v && v.label !== "Manual save" && !/^(Restored|Before|Other|AI)/.test(v.label) ? v.label : ""; })()} initialNote={(byId.get(naming) as (Version & { lumenNote?: string }) | undefined)?.lumenNote ?? ""}
        linked={(vault.outlinks.get(note.id) ?? []).filter((id) => vault.byId.get(id) && !vault.byId.get(id)!.deleted).length} onCancel={() => setNaming(null)} onSave={(n, x, l) => void saveName(naming, n, x, l)} />}
    </div>
  );

  // PDF versions: v5 · Current, v4 …; tags are the version names ("Sent to supervisor").
  function pdfItems(): SideItem[] {
    const out: SideItem[] = [{ key: CUR, label: t("v{n} · Current", { n: live.length + 1 }), sub: `${t("You")} · ${t("today")} ${hm(note.updatedAt)}${sizeOf(note.body) ? ` · ${sizeOf(note.body)}` : ""}`, time: "", tag: t("Current"), kind: "cur", selected: false, second: to === CUR, onClick: () => setTo(CUR) }];
    for (const v of live) {
      const named = !!v.label && !/^(Restored|Before|Other|AI)/.test(v.label);
      out.push({ key: v.id, label: `v${noOf.get(v.id)}`, sub: `${v.device || t("You")} · ${whenLong(v.createdAt)}${sizeOf(v.body) ? ` · ${sizeOf(v.body)}` : ""}`, time: "", tag: named ? v.label : undefined, tagKind: named ? "named" : undefined, kind: named ? "named" : "auto", selected: from === v.id, second: to === v.id,
        onClick: (e) => { if (e.shiftKey || e.ctrlKey || e.metaKey) { if (from && from !== v.id) { setTo(v.id); setComparing(true); } } else { setFrom(v.id); if (to === v.id) { setTo(CUR); setComparing(false); } } }, onDouble: () => setNaming(v.id) });
    }
    return out;
  }
}

const menuItem = { display: "flex", width: "100%", padding: "7px 10px", borderRadius: 7, fontSize: 12.5, textAlign: "start" } as const;

/** Design 58D: name this version (kept forever; also names the notes it links to). */
function NameDialog({ phone, title, initial, initialNote, linked, onCancel, onSave }: { phone: boolean; title: string; initial: string; initialNote: string; linked: number; onCancel: () => void; onSave: (name: string, note: string, linked: boolean) => void }) {
  const [name, setName] = useState(initial), [note, setNote] = useState(initialNote), [alsoLinked, setAlsoLinked] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { ref.current?.focus(); ref.current?.select(); }, []);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onCancel(); } };
    addEventListener("keydown", k, true);
    return () => removeEventListener("keydown", k, true);
  }, [onCancel]);
  const field = (k: string, el: React.ReactNode) => <div style={{ display: "flex", flexDirection: "column", gap: 6 }}><span style={{ fontSize: 12, color: "var(--muted)" }}>{k}</span>{el}</div>;
  const box = { padding: "9px 12px", borderRadius: 9, background: "var(--bg)", fontSize: 13.5, color: "var(--text)", outline: "none", width: "100%", fontFamily: "inherit" } as const;
  const tog = (on: boolean, set: (v: boolean) => void, disabled?: boolean) => (
    <button type="button" role="switch" aria-checked={on} disabled={disabled} onClick={() => set(!on)} style={{ position: "relative", width: 34, height: 20, borderRadius: 10, background: on ? "var(--accent)" : "var(--border)", flexShrink: 0, opacity: disabled ? 0.8 : 1 }}>
      <span style={{ position: "absolute", top: 3, insetInlineStart: on ? 17 : 3, width: 14, height: 14, borderRadius: "50%", background: on ? "var(--accent-fg)" : "var(--muted)", transition: "inset-inline-start .15s" }} />
    </button>
  );
  const opt = (l: string, sub: string, el: React.ReactNode) => <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 0" }}><div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 1 }}><span style={{ fontSize: 13 }}>{l}</span><span style={{ fontSize: 11.5, color: "var(--muted)" }}>{sub}</span></div>{el}</div>;
  return (
    <>
      <div onClick={onCancel} style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,.5)" }} />
      <form onSubmit={(e) => { e.preventDefault(); onSave(name, note, alsoLinked); }} role="dialog" aria-label={title}
        style={{ position: "absolute", insetInline: phone ? 0 : "calc(50% - 230px)", top: phone ? "auto" : 170, bottom: phone ? 0 : "auto", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: phone ? "20px 20px 0 0" : 16, boxShadow: "0 30px 80px rgba(0,0,0,.45)", display: "flex", flexDirection: "column", gap: 14, padding: 20 }}>
        <div style={{ display: "flex", alignItems: "center" }}><span style={{ fontWeight: 650, fontSize: 16, flex: 1 }}>{title}</span><button type="button" aria-label={t("Close")} onClick={onCancel} style={{ color: "var(--muted)", fontSize: 18 }}>×</button></div>
        {field(t("Name"), <input ref={ref} dir="auto" value={name} onChange={(e) => setName(e.target.value)} placeholder={t("Version name")} style={{ ...box, border: "1px solid var(--accent)", minHeight: 20 }} />)}
        {field(t("Note (optional)"), <textarea dir="auto" value={note} onChange={(e) => setNote(e.target.value)} rows={2} style={{ ...box, border: "1px solid var(--border)", minHeight: 44, resize: "none" }} />)}
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {opt(t("Keep forever"), t("named versions are never pruned"), tog(true, () => {}, true))}
          {opt(t("Also name linked notes"), t("{n} notes", { n: linked }), tog(alsoLinked, setAlsoLinked, !linked))}
        </div>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 4 }}>
          <VBtn l={t("Cancel")} h={38} onClick={onCancel} />
          <button type="submit" style={{ height: 38, padding: "0 16px", borderRadius: 10, background: "var(--accent)", color: "var(--accent-fg)", fontSize: 13, fontWeight: 650, whiteSpace: "nowrap" }}>{t("Save version")}</button>
        </div>
      </form>
    </>
  );
}
