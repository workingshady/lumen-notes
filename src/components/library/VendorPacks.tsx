// Vendor pack cards (design 49C / 49F): name, version, licence + terms link, icon count, size, Download / Remove with progress.
// Used in the library's Customise view and (mount it in Settings > Diagrams) as <VendorPackCards />.
import { useRef } from "react";
import { t } from "../../lib/i18n";
import { PACKS, downloadPack, importAzureFiles, removePack, useVendorPacks, type PackDef } from "../../lib/vendor-icons";
import { Glyph } from "../Glyph";

const mb = (b: number) => (b >= 1e6 ? (b / 1e6).toFixed(1) + " MB" : Math.max(1, Math.round(b / 1e3)) + " KB");
const btn = (danger?: boolean) => ({ height: 28, padding: "0 12px", borderRadius: 8, border: `1px solid ${danger ? "var(--da)" : "var(--bd)"}`, background: "transparent", color: danger ? "var(--da)" : "var(--tx)", fontSize: 12, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" as const });

function Card({ p }: { p: PackDef }) {
  const st = useVendorPacks()[p.id];
  const file = useRef<HTMLInputElement>(null);
  const m = st.meta;
  const sub = m ? t("v{v} · {n} icons · {size}", { v: m.version, n: m.count, size: mb(m.bytes) }) : p.source === "zip" ? t("Not imported") : t("{v} · about {size}", { v: p.version, size: mb(p.bytes) });
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: "8px 10px", borderRadius: 8, border: "1px solid var(--bd)", boxSizing: "border-box" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ width: 26, height: 26, flexShrink: 0, borderRadius: 4, background: "var(--sf2)", border: "1px solid var(--bd)", boxSizing: "border-box", display: "flex", alignItems: "center", justifyContent: "center" }}><Glyph name="cloud" size={14} color="var(--mu)" /></span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: "12.5px", fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.name}</div>
          <div style={{ fontSize: 11, color: "var(--mu)" }}>{sub}</div>
        </div>
        {st.busy ? <span style={{ fontSize: 11, color: "var(--mu)" }}>{st.pct}%</span> : m ? (
          <span style={{ display: "flex", gap: 6 }}>
            {p.source === "zip" && <button type="button" style={btn()} onClick={() => file.current?.click()}>{t("Replace")}</button>}
            <button type="button" style={btn(true)} onClick={() => void removePack(p.id)}>{t("Remove")}</button>
          </span>
        ) : p.source === "zip" ? <button type="button" style={btn()} onClick={() => file.current?.click()}>{t("Import ZIP…")}</button>
          : <button type="button" style={btn()} onClick={() => void downloadPack(p.id)}>{t("Download")}</button>}
      </div>
      {st.busy && (
        <div role="progressbar" aria-valuenow={st.pct} aria-valuemin={0} aria-valuemax={100} aria-label={st.msg} style={{ height: 4, borderRadius: 2, background: "var(--bd)", overflow: "hidden" }}>
          <div style={{ width: `${st.pct}%`, height: "100%", background: "var(--ac)", transition: "width .2s" }} />
        </div>
      )}
      <div style={{ fontSize: 11, lineHeight: "16px", color: "var(--mu)" }}>
        {st.busy ? st.msg : p.blurb} {t("Licence")}: {p.license}.{" "}
        <a href={p.termsUrl} target="_blank" rel="noreferrer noopener" style={{ color: "var(--ln)" }}>{t(p.termsLabel)}</a>
      </div>
      {st.error && <div style={{ fontSize: 11, color: "var(--da)" }}>{st.error}</div>}
      {p.source === "zip" && <input ref={file} type="file" accept=".zip,.svg,application/zip,image/svg+xml" multiple hidden onChange={(e) => { const f = Array.from(e.target.files ?? []); e.target.value = ""; if (f.length) void importAzureFiles(f); }} />}
    </div>
  );
}

/** All vendor packs, grouped (Cloud, Brands & tech). Downloaded on demand from jsDelivr at a pinned version, integrity-checked, cached offline. */
export function VendorPackCards() {
  const groups = [...new Set(PACKS.map((p) => p.group))];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {groups.map((g) => (
        <div key={g} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--mu)" }}>{t(g)}</div>
          {PACKS.filter((p) => p.group === g).map((p) => <Card key={p.id} p={p} />)}
        </div>
      ))}
      <div style={{ fontSize: "11.5px", lineHeight: "17px", color: "var(--mu)", background: "var(--sf2)", padding: "8px 10px", borderRadius: 8 }}>
        {t("Downloaded once, checked against a recorded SHA-256, sanitised and kept on this device for offline use. Shown exactly as published: never recoloured or edited, per each vendor’s terms.")}
      </div>
    </div>
  );
}
