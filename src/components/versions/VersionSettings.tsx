// Settings › Versions & history (design 58H): how long versions are kept (the thinning that lib/actions.pruneVersions runs
// after a good sync round: everything for 24 h, then hourly, daily, weekly; named versions always stay), automatic versions,
// a keep-policy per space and what the history uses. The ages are stored in the synced settings (lib/version-prefs.ts).
import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useState, type ReactNode } from "react";
import { pruneVersions } from "../../lib/actions";
import { db } from "../../lib/db";
import { fmtNum, t } from "../../lib/i18n";
import { toast, useVault } from "../../lib/store";
import { versionsToPrune } from "../../lib/sync-plan";
import { ALL_HOURS, AUTO_DEFAULT, DAILY_DAYS, HOURLY_DAYS, retentionMs, setVersionPrefs, useVersionPrefs, type SpaceKeep } from "../../lib/version-prefs";
import { Glyph } from "../Glyph";

const MB = (b: number) => (b >= 1e8 ? `${Math.round(b / 1048576)} MB` : b >= 1e5 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(0, Math.round(b / 1024))} KB`);
const usePhone = () => { const [p, setP] = useState(() => innerWidth < 768); useEffect(() => { const f = () => setP(innerWidth < 768); addEventListener("resize", f); return () => removeEventListener("resize", f); }, []); return p; };

const AUTO: { id: string; label: string; sub?: string }[] = [
  { id: "ai", label: "Before AI edits are applied" },
  { id: "restore", label: "Before a restore" },
  { id: "convert", label: "Before converting a visual" },
  { id: "plan", label: "When a plan topic is marked done" },
  { id: "paste", label: "Before a big paste (500+ words)" },
  { id: "daily", label: "Daily snapshot of the whole vault", sub: "03:00" },
];
const KEEP_LABEL: Record<SpaceKeep, string> = { default: "Default", all90: "Keep every save 90 days", daily: "One per day only" };
const KEEPS: SpaceKeep[] = ["default", "all90", "daily"];

function Block({ h, children, note }: { h: string; children: ReactNode; note?: string }) {
  return (
    <div style={{ padding: "0 14px 12px" }}>
      <div style={{ padding: "10px 2px 8px", fontSize: 11, fontWeight: 650, letterSpacing: ".06em", color: "var(--muted)", textTransform: "uppercase" }}>{h}</div>
      {children}
      {note && <div style={{ fontSize: 12, color: "var(--muted)", paddingTop: 8 }}>{note}</div>}
    </div>
  );
}
const tile = { display: "flex", alignItems: "center", gap: 10, minHeight: 52, padding: "8px 12px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--bg)" } as const;
const select = { height: 28, borderRadius: 7, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)", fontSize: 12.5, padding: "0 6px" } as const;

function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)} style={{ position: "relative", width: 34, height: 20, borderRadius: 10, background: on ? "var(--accent)" : "var(--border)", flexShrink: 0 }}>
      <span style={{ position: "absolute", top: 3, insetInlineStart: on ? 17 : 3, width: 14, height: 14, borderRadius: "50%", background: on ? "var(--accent-fg)" : "var(--muted)", transition: "inset-inline-start .15s" }} />
    </button>
  );
}

export function VersionSettings() {
  const phone = usePhone();
  const p = useVersionPrefs();
  const vault = useVault();
  const [busy, setBusy] = useState(false);
  const [freed, setFreed] = useState<number | null>(null);
  const sizes = useLiveQuery(async () => {
    let notes = 0, visuals = 0, versions = 0;
    await db.notes.filter((n) => !n.deleted).each((n) => { const b = (n.body ?? "").length; if (["canvas", "whiteboard", "board"].includes(n.type)) visuals += b; else notes += b; });
    await db.versions.filter((v) => !v.deleted).each((v) => { versions += (v.body ?? "").length; });
    const atts = (await db.attachments.filter((a) => !a.deleted).toArray()).reduce((s, a) => s + (a.size || 0), 0);
    return { notes, visuals, versions, atts };
  }, []);
  const used = sizes ? sizes.notes + sizes.visuals + sizes.versions + sizes.atts : 0;
  const pct = (n: number) => (used ? `${Math.max(2, Math.round((n / used) * 100))}%` : "0%");

  // What "Prune now" would free with the current ages (dry run, one note at a time).
  const [est, setEst] = useState<number | null>(null);
  useEffect(() => {
    let dead = false;
    setEst(null);
    const id = setTimeout(async () => {
      let bytes = 0;
      const prefs = p;
      for (const noteId of (await db.versions.orderBy("noteId").uniqueKeys()) as string[]) {
        const vs = await db.versions.where("noteId").equals(noteId).toArray();
        const sp = Object.keys(prefs.verSpace).length ? prefs.verSpace[(await db.notes.get(noteId))?.spaceId ?? ""] ?? "default" : "default";
        const drop = new Set(versionsToPrune(vs, Date.now(), retentionMs(prefs, sp)));
        for (const v of vs) if (drop.has(v.id)) bytes += (v.body ?? "").length;
        if (dead) return;
      }
      if (!dead) setEst(bytes);
    }, 300);
    return () => { dead = true; clearTimeout(id); };
  }, [p.verAllHours, p.verHourlyDays, p.verDailyDays, JSON.stringify(p.verSpace)]); // eslint-disable-line react-hooks/exhaustive-deps

  const prune = async () => {
    setBusy(true);
    try { const n = await pruneVersions(); setFreed(n); toast(n ? t("Removed {n} old versions", { n: fmtNum(n) }) : t("Nothing to prune yet")); }
    finally { setBusy(false); }
  };
  const hours = (h: number) => (h < 48 ? t("{n} hours", { n: h }) : t("{n} days", { n: h / 24 }));
  const days = (d: number) => (d === 365 ? t("1 year") : t("{n} days", { n: d }));
  const cols = phone ? "1fr" : "1fr 1fr 1fr";
  const allSpaces = [...vault.spaceMap.values()].filter((s) => !s.deleted);
  const [allShown, setAllShown] = useState(false);
  // A compact list: spaces with their own keep-policy first, then the rest on request.
  const sorted = [...allSpaces].sort((a, b) => Number(!!p.verSpace[b.id]) - Number(!!p.verSpace[a.id]));
  const spaces = allShown ? sorted : sorted.slice(0, 4);

  return (
    <div style={{ display: "flex", flexDirection: "column", width: "min(100%, 960px)", margin: "0 auto", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "14px 14px 8px" }}>
        <span style={{ fontWeight: 650, fontSize: 14, flex: 1 }}>{t("Keep versions")}</span>
        <span style={{ fontSize: 11.5, color: "var(--muted)" }}>{sizes ? t("Uses {size} for versions", { size: MB(sizes.versions) }) : ""}</span>
      </div>

      <Block h={t("How long")} note={t("Thinning happens on this device after each sync; the same history is kept on every device. Named versions and each note’s newest version are never removed.")}>
        <div style={{ display: "grid", gridTemplateColumns: cols, gap: 6 }}>
          <div style={tile}><div style={{ flex: 1 }}><div style={{ fontWeight: 500 }}>{t("Every save")}</div><div style={{ fontSize: 11.5, color: "var(--muted)" }}>{t("for")} {hours(p.verAllHours)}</div></div>
            <select aria-label={t("Every save")} value={p.verAllHours} onChange={(e) => setVersionPrefs({ verAllHours: Number(e.target.value) })} style={select}>{ALL_HOURS.map((h) => <option key={h} value={h}>{hours(h)}</option>)}</select></div>
          <div style={tile}><div style={{ flex: 1 }}><div style={{ fontWeight: 500 }}>{t("One per hour")}</div><div style={{ fontSize: 11.5, color: "var(--muted)" }}>{t("for")} {days(p.verHourlyDays)}</div></div>
            <select aria-label={t("One per hour")} value={p.verHourlyDays} onChange={(e) => setVersionPrefs({ verHourlyDays: Number(e.target.value) })} style={select}>{HOURLY_DAYS.map((d) => <option key={d} value={d}>{days(d)}</option>)}</select></div>
          <div style={tile}><div style={{ flex: 1 }}><div style={{ fontWeight: 500 }}>{t("One per day")}</div><div style={{ fontSize: 11.5, color: "var(--muted)" }}>{t("for")} {days(p.verDailyDays)}</div></div>
            <select aria-label={t("One per day")} value={p.verDailyDays} onChange={(e) => setVersionPrefs({ verDailyDays: Number(e.target.value) })} style={select}>{DAILY_DAYS.map((d) => <option key={d} value={d}>{days(d)}</option>)}</select></div>
          <div style={tile}><div style={{ flex: 1 }}><div style={{ fontWeight: 500 }}>{t("One per week")}</div><div style={{ fontSize: 11.5, color: "var(--muted)" }}>{t("after that")}</div></div></div>
          <div style={tile}><div style={{ flex: 1 }}><div style={{ fontWeight: 500 }}>{t("Named versions")}</div><div style={{ fontSize: 11.5, color: "var(--muted)" }}>{t("forever")}</div></div></div>
          <div style={tile}><div style={{ flex: 1 }}><div style={{ fontWeight: 500 }}>{t("Deleted notes")}</div><div style={{ fontSize: 11.5, color: "var(--muted)" }}>{t("Trash · until you empty it")}</div></div></div>
        </div>
      </Block>

      <Block h={t("Automatic named versions")}>
        <div style={{ display: "grid", gridTemplateColumns: phone ? "1fr" : "1fr 1fr", gap: "2px 16px" }}>
          {AUTO.map((a) => {
            const on = p.verAuto[a.id] ?? AUTO_DEFAULT[a.id] ?? false;
            return (
              <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 0" }}>
                <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 1 }}><span style={{ fontSize: 13 }}>{t(a.label)}</span>{a.sub && <span style={{ fontSize: 11.5, color: "var(--muted)" }}>{a.sub}</span>}</div>
                <Toggle on={on} label={t(a.label)} onChange={(v) => setVersionPrefs({ verAuto: { ...p.verAuto, [a.id]: v } })} />
              </div>
            );
          })}
        </div>
      </Block>

      <Block h={t("Per space")}>
        <div style={{ display: "grid", gridTemplateColumns: phone ? "1fr" : "1fr 1fr", gap: 6 }}>
          {spaces.map((s) => {
            const mode = p.verSpace[s.id] ?? "default";
            return (
              <div key={s.id} style={tile}>
                <Glyph name="folder" size={16} color="var(--muted)" />
                <div style={{ flex: 1, minWidth: 0 }}><div dir="auto" style={{ fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.name}</div><div style={{ fontSize: 11.5, color: "var(--muted)" }}>{t(KEEP_LABEL[mode])}</div></div>
                <select aria-label={s.name} value={mode} onChange={(e) => { const v = e.target.value as SpaceKeep; const next = { ...p.verSpace }; if (v === "default") delete next[s.id]; else next[s.id] = v; setVersionPrefs({ verSpace: next }); }} style={select}>
                  {KEEPS.map((k) => <option key={k} value={k}>{t(KEEP_LABEL[k])}</option>)}
                </select>
              </div>
            );
          })}
          {!spaces.length && <span style={{ color: "var(--muted)" }}>{t("No spaces yet.")}</span>}
          {allSpaces.length > 4 && <button type="button" onClick={() => setAllShown((x) => !x)} style={{ ...tile, minHeight: 44, color: "var(--muted)", justifyContent: "center" }}>{allShown ? t("Show fewer spaces") : t("Show all {n} spaces", { n: fmtNum(allSpaces.length) })}</button>}
        </div>
      </Block>

      <Block h={t("Storage")}>
        <div style={{ display: "grid", gridTemplateColumns: phone ? "1fr" : "1fr 1fr", gap: "6px 16px" }}>
          {([[t("Notes"), sizes?.notes ?? 0], [t("Attachments & PDFs"), sizes?.atts ?? 0], [t("Visuals"), sizes?.visuals ?? 0]] as [string, number][]).map(([l, b]) => (
            <div key={l} style={{ display: "flex", flexDirection: "column", gap: 6, padding: "6px 0" }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}><span>{l}</span><span style={{ color: "var(--muted)" }}>{MB(b)}</span></div>
              <div style={{ height: 6, borderRadius: 3, background: "var(--surface-2)" }}><div style={{ width: pct(b), height: "100%", borderRadius: 3, background: "var(--accent)" }} /></div>
            </div>
          ))}
          <button type="button" onClick={() => void prune()} disabled={busy} style={{ ...tile, textAlign: "start", opacity: busy ? 0.6 : 1 }}>
            <Glyph name="trash" size={16} color="var(--muted)" />
            <div style={{ flex: 1 }}><div style={{ fontWeight: 500 }}>{t("Prune now")}</div><div style={{ fontSize: 11.5, color: "var(--muted)" }}>{freed !== null ? t("removed {n} versions", { n: fmtNum(freed) }) : est === null ? t("working out what it frees…") : t("frees ~{size}", { size: MB(est) })}</div></div>
          </button>
        </div>
      </Block>
    </div>
  );
}
