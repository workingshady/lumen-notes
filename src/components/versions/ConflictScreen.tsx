// Sync conflict screen (design 58E / 58J): the same note was edited on two devices before either was pushed. This device's
// text and the other device's text side by side; blocks that are the same on both are shown once, blocks that differ get a
// choice (this device / both / other device). "Keep this device", "Keep <other>", "Keep both lines" resolve every block at
// once; "Merge selection" applies the per-block choices. Both texts are kept in the note's History whatever you pick.
// Logic and storage: lib/conflicts.ts (sync.ts apply() calls its noteConflict hook).
import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useMemo, useRef, useState } from "react";
import { watchVersions } from "../../lib/auto-versions";
import { db } from "../../lib/db";
import { blocksDiffer, mergeBlocks, onOpenConflict, openConflict, resolve, segments, useConflicts, type Choice, type ConflictRec } from "../../lib/conflicts";
import { fmtDate, fmtNum, t } from "../../lib/i18n";
import { toast, useVault } from "../../lib/store";
import type { DLine } from "../../lib/versions-diff";
import { Glyph } from "../Glyph";
import { DRow, Seg3, VBtn } from "./vs-ui";

const usePhone = () => { const [p, setP] = useState(() => innerWidth < 768); useEffect(() => { const f = () => setP(innerWidth < 768); addEventListener("resize", f); return () => removeEventListener("resize", f); }, []); return p; };
const hm = (ts: number) => fmtDate(ts, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const line = (s: string, m: DLine["m"], i: number): DLine => {
  const h = /^(#{1,6})\s+(.*)$/.exec(s);
  return { m, h: h ? (h[1].length === 1 ? 1 : 2) : 0, toks: [{ s: h ? h[2] : s, k: "=" }], i };
};

/** Mounted once (inside ws-conflict.tsx's ConflictSheet, which App already renders): shows the screen when asked to. */
export function ConflictHost() {
  const [id, setId] = useState<string | null>(null);
  useEffect(() => { watchVersions(); return onOpenConflict(setId); }, []);
  const list = useConflicts();
  const c = list.find((x) => x.id === id);
  if (!id || !c) return null;
  return <ConflictScreen key={c.id} c={c} index={list.indexOf(c)} total={list.length} onClose={() => openConflict(null)} />;
}

export function ConflictScreen({ c, index, total, onClose }: { c: ConflictRec; index: number; total: number; onClose: () => void }) {
  const phone = usePhone();
  const vault = useVault();
  const note = useLiveQuery(() => db.notes.get(c.noteId), [c.noteId]);
  const segs = useMemo(() => segments(c.mine.body, c.theirs.body), [c.mine.body, c.theirs.body]);
  const n = blocksDiffer(segs);
  const [choices, setChoices] = useState<Record<number, Choice>>({});
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    addEventListener("keydown", k);
    return () => removeEventListener("keydown", k);
  }, [onClose]);

  const folder = note?.folderId ? vault.folderMap.get(note.folderId)?.name : note ? vault.spaceMap.get(note.spaceId)?.name : "";
  const done = async (r: Parameters<typeof resolve>[1], msg: string) => {
    if (busy) return;
    setBusy(true);
    const before = note ? { title: note.title, body: note.body } : null;
    await resolve(c.id, r);
    toast(msg, before ? { label: t("Undo"), run: () => void (async () => { const { updateNote } = await import("../../lib/actions"); await updateNote(c.noteId, before); })() } : undefined);
    onClose();
  };
  const picked = Object.keys(choices).length;
  const mergedText = () => { let k = 0; return mergeBlocks(segs, segs.filter((s) => s.kind === "diff").map(() => choices[k++] ?? "theirs")); };
  const other = c.theirs.device;
  const pad = phone ? "14px" : "24px";
  const docPad = phone ? "12px 14px" : "22px 40px";

  let k = -1;
  const chip = (b: number, v: Choice, l: string) => {
    const on = (choices[b] ?? "") === v;
    return <button key={v} type="button" aria-pressed={on} onClick={() => setChoices((x) => (x[b] === v ? Object.fromEntries(Object.entries(x).filter(([i]) => Number(i) !== b)) : { ...x, [b]: v }))}
      style={{ height: 26, padding: "0 10px", borderRadius: 999, fontSize: 11.5, border: `1px solid ${on ? "var(--accent)" : "var(--border)"}`, background: on ? "color-mix(in srgb,var(--accent) 16%,transparent)" : "transparent", fontWeight: on ? 650 : 400, whiteSpace: "nowrap" }}>{l}</button>;
  };
  const head = (h: string, col: string) => <span style={{ fontSize: 11, fontWeight: 650, letterSpacing: ".06em", color: col, paddingBottom: 8 }}>{h}</span>;
  const device = (d: string) => d.toUpperCase();
  return (
    <div ref={ref} tabIndex={-1} role="dialog" aria-label={t("Sync conflict")} className="fixed inset-0 z-[85] fade-in"
      style={{ background: "var(--bg)", fontFamily: "Inter, system-ui, sans-serif", fontSize: 13, color: "var(--text)", display: "flex", flexDirection: "column", outline: "none" }}>
      {phone && <div className="safe-t" style={{ flexShrink: 0 }} />}
      <div style={{ height: 52, flexShrink: 0, display: "flex", alignItems: "center", gap: 10, padding: `0 ${pad}`, borderBottom: "1px solid var(--border)" }}>
        {phone && <button type="button" aria-label={t("Back")} onClick={onClose} style={{ width: 40, height: 40, fontSize: 22, marginInlineStart: -8 }} className="rtl:-scale-x-100">‹</button>}
        <Glyph name="note" size={18} color="var(--muted)" />
        {!phone && folder && <span dir="auto" style={{ color: "var(--muted)", fontSize: 12.5, whiteSpace: "nowrap" }}>{folder} /</span>}
        <span dir="auto" style={{ fontWeight: 650, fontSize: 14, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0 }}>{c.theirs.title || c.mine.title || t("Untitled")}</span>
        <span style={{ height: 24, padding: "0 10px", borderRadius: 999, background: "color-mix(in srgb,var(--accent) 16%,transparent)", color: "var(--accent)", fontSize: 11.5, fontWeight: 650, display: "flex", alignItems: "center", whiteSpace: "nowrap" }}>{total > 1 ? t("Sync conflict {n} of {total}", { n: index + 1, total }) : t("Sync conflict")}</span>
        <span style={{ flex: 1 }} />
        <VBtn l={t("Decide later")} hide={phone} onClick={onClose} />
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: `10px ${pad}`, borderBottom: "1px solid var(--border)", flexWrap: "wrap" }}>
        <span style={{ display: "flex", alignItems: "center", gap: 8, height: 30, padding: "0 10px", borderRadius: 8, background: "var(--surface-2)", fontSize: 12.5, whiteSpace: "nowrap" }}><span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--danger)" }} />{c.mine.device} · {hm(c.mine.at)}</span>
        <span style={{ color: "var(--muted)" }} className="rtl:-scale-x-100">→</span>
        <span style={{ display: "flex", alignItems: "center", gap: 8, height: 30, padding: "0 10px", borderRadius: 8, background: "var(--surface-2)", fontSize: 12.5, whiteSpace: "nowrap" }}><span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--success)" }} />{other} · {hm(c.theirs.at)} ({t("edited offline")})</span>
        <span style={{ fontSize: 12, color: "var(--muted)" }}>{n === 0 ? t("The texts are identical") : t("{n} blocks differ · the rest is the same on both", { n: fmtNum(n) })}</span>
        <span style={{ flex: 1 }} />
        <Seg3<"side"> value="side" onChange={() => {}} options={[{ v: "side", l: t("Side by side") }]} />
      </div>
      <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: docPad }}>
        {!phone && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 0, position: "sticky", top: -22, background: "var(--bg)", zIndex: 1, paddingTop: 2 }}>
            <div style={{ paddingInlineEnd: 16 }}>{head(`${t("THIS DEVICE")} · ${device(c.mine.device)}`, "var(--accent)")}</div>
            <div style={{ paddingInlineStart: 16, borderInlineStart: "1px solid var(--border)" }}>{head(`${device(other)} · ${t("EDITED OFFLINE")}`, "var(--link)")}</div>
          </div>
        )}
        {segs.map((s, si) => {
          if (s.kind === "same") {
            const rows = s.lines.filter((l) => l.trim());
            if (!rows.length) return null;
            return phone
              ? <div key={si} style={{ display: "flex", flexDirection: "column", gap: 2 }}>{rows.map((l, i) => <DRow key={i} l={line(l, "", i)} phone />)}</div>
              : <div key={si} style={{ display: "grid", gridTemplateColumns: "1fr 1fr" }}>
                {[0, 1].map((col) => <div key={col} style={{ display: "flex", flexDirection: "column", gap: 2, paddingInlineEnd: col ? 0 : 16, paddingInlineStart: col ? 16 : 0, borderInlineStart: col ? "1px solid var(--border)" : "none" }}>{rows.map((l, i) => <DRow key={i} l={line(l, "", i)} phone={false} />)}</div>)}
              </div>;
          }
          const b = ++k;
          const mine = s.mine.filter((l) => l.trim()), theirs = s.theirs.filter((l) => l.trim());
          const sel = choices[b];
          return (
            <div key={si} style={{ margin: "8px 0", padding: 8, borderRadius: 10, border: `1px solid ${sel ? "color-mix(in srgb,var(--accent) 50%,transparent)" : "var(--border)"}` }} data-block={b}>
              <div style={{ display: phone ? "flex" : "grid", flexDirection: "column", gridTemplateColumns: "1fr 1fr", gap: phone ? 8 : 0 }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 2, paddingInlineEnd: phone ? 0 : 16, opacity: sel === "theirs" ? 0.45 : 1 }}>
                  {phone && head(t("THIS DEVICE"), "var(--accent)")}
                  {mine.map((l, i) => <DRow key={i} l={line(l, "+", i)} phone={phone} />)}
                  {!mine.length && <span style={{ color: "var(--muted)", padding: "3px 8px" }}>{t("Nothing here on this device")}</span>}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 2, paddingInlineStart: phone ? 0 : 16, borderInlineStart: phone ? "none" : "1px solid var(--border)", opacity: sel === "mine" ? 0.45 : 1 }}>
                  {phone && head(device(other), "var(--link)")}
                  {theirs.map((l, i) => <DRow key={i} l={line(l, "+", i)} phone={phone} />)}
                  {!theirs.length && <span style={{ color: "var(--muted)", padding: "3px 8px" }}>{t("Nothing here on {device}", { device: other })}</span>}
                </div>
              </div>
              <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap", alignItems: "center" }}>
                <span style={{ fontSize: 11.5, color: "var(--muted)", marginInlineEnd: 4 }}>{t("Block {n}", { n: b + 1 })}</span>
                {chip(b, "mine", t("This device"))}{chip(b, "both", t("Both"))}{chip(b, "theirs", other)}
              </div>
            </div>
          );
        })}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: `12px ${pad} ${phone ? 28 : 12}px`, borderTop: "1px solid var(--border)", background: "var(--surface)", flexWrap: "wrap" }}>
        <span style={{ flex: 1, minWidth: 180, fontSize: 12.5, color: "var(--muted)" }}>{t("Both versions are kept in History whatever you pick.")}</span>
        {picked > 0 && <VBtn l={t("Merge selection ({n})", { n: picked })} h={36} onClick={() => void done({ merged: mergedText() }, t("Merged"))} />}
        <VBtn l={t("Keep this device")} h={36} onClick={() => void done("mine", t("Kept this device’s version"))} />
        <VBtn l={t("Keep {device}", { device: other })} h={36} hide={phone} onClick={() => void done("theirs", t("Kept {device}’s version", { device: other }))} />
        <VBtn l={t("Keep both lines")} h={36} pri onClick={() => void done("both", t("Kept both versions"))} />
      </div>
    </div>
  );
}
