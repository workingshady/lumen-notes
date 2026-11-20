// Handwriting search (design 34H): ink is read by the vision model in small clusters; the text is stored invisibly in
// customData.lumenText of the cluster's first stroke (others get "" so they are not read again), and sceneText()
// indexes it, so search finds handwritten words. The board header then shows "Searchable".
import { exportToBlob } from "@excalidraw/excalidraw";
import { t } from "../../../lib/i18n";
import { convertImage, isOnline } from "../../../lib/ai-convert";
import { Glyph } from "../../Glyph";
import { PanelShell, Tog } from "../panel";
import type { WbAPI, WbCtx } from "../hooks";
import { bump, commit, type El } from "./engine";
import { live, setLive, useLive } from "./live";

const unread = (e: El) => e.type === "freedraw" && !e.isDeleted && typeof e.customData?.lumenText !== "string" && (e.customData?.lumenPen as { type?: string } | undefined)?.type !== "highlighter";

/** Strokes near each other (40 px gap) form one cluster, like a word or a line of writing. */
function clusters(strokes: El[]): El[][] {
  const pad = 40, box = (e: El) => [e.x - pad, e.y - pad, e.x + e.width + pad, e.y + e.height + pad];
  const parent = strokes.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < strokes.length; i++) for (let j = i + 1; j < strokes.length; j++) {
    const a = box(strokes[i]), b = box(strokes[j]);
    if (a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3]) parent[find(i)] = find(j);
  }
  const m = new Map<number, El[]>();
  strokes.forEach((s, i) => { const r = find(i); m.set(r, [...(m.get(r) ?? []), s]); });
  return [...m.values()];
}

export const countInk = (api: WbAPI) => { const s = (api.getSceneElements() as El[]).filter((e) => e.type === "freedraw" && !e.isDeleted && (e.customData?.lumenPen as { type?: string } | undefined)?.type !== "highlighter"); return { total: s.length, done: s.filter((e) => typeof e.customData?.lumenText === "string").length }; };

let running = false;
/** Read every unread cluster. Returns the number of clusters stored. */
export async function recogniseInk(api: WbAPI, onSaved: () => void): Promise<number> {
  if (running || !isOnline()) return 0;
  running = true;
  setLive({ hwBusy: true });
  let n = 0;
  try {
    const groups = clusters((api.getSceneElements() as El[]).filter(unread)).slice(0, 12);
    for (const g of groups) {
      const blob = await exportToBlob({ elements: g as never, files: api.getFiles() as never, mimeType: "image/png", exportPadding: 16, appState: { exportBackground: true, viewBackgroundColor: "#ffffff", exportWithDarkMode: false } as never });
      let text = "";
      try { text = (await convertImage(blob, "text")).text.trim(); } catch (e) { if ((e as { code?: string }).code === "offline" || (e as { code?: string }).code === "limit") break; }
      const ids = new Map(g.map((e, i) => [e.id, i === 0 ? text : ""]));
      const all = api.getSceneElementsIncludingDeleted() as El[];
      commit(api, all.map((e) => (ids.has(e.id) ? bump({ ...e, customData: { ...(e.customData ?? {}), lumenText: ids.get(e.id) } }) : e)), "NEVER");
      n++;
      const c = countInk(api);
      setLive({ hwDone: c.done, hwTotal: c.total });
    }
  } finally { running = false; setLive({ hwBusy: false }); if (n) onSaved(); }
  return n;
}

export function HandwritingPanel({ ctx }: { ctx: WbCtx }) {
  const lv = useLive();
  return (
    <PanelShell glyph="searchable" title={t("Handwriting search")} sub={lv.hw ? t("On") : t("Off")} onClose={ctx.close} sheet={!!ctx.phone} className={ctx.phone ? "z-50" : "end-[14px] top-[60px] w-[320px]"}>
      <div className="flex min-h-[34px] items-center gap-2 px-2 text-[12.5px]"><Glyph name="searchable" size={18} /><span className="flex-1">{t("Make my ink searchable")}</span><Tog on={lv.hw} onChange={(v) => live.setHandwriting(v)} label={t("Make my ink searchable")} /></div>
      <div className="flex min-h-[34px] items-center gap-2 px-2 text-[12.5px]">
        <span className="flex-1">{t("Recognised")}</span>
        <span className="text-[11px] text-muted">{t("{done} of {total} strokes", { done: lv.hwDone, total: lv.hwTotal })}</span>
      </div>
      <button type="button" disabled={!lv.hw || lv.hwBusy || lv.hwDone >= lv.hwTotal} onClick={() => void live.recognise()}
        className="flex h-8 items-center justify-center gap-1.5 rounded-[8px] border border-line text-[12.5px] font-medium hover:bg-surface-2 disabled:opacity-40">
        {lv.hwBusy ? <><span className="size-3.5 animate-spin rounded-full border-2 border-line border-t-accent" />{t("Reading your handwriting…")}</> : t("Recognise now")}
      </button>
      <div className="rounded-[8px] bg-surface-2 px-2.5 py-2 text-[11.5px] leading-[17px] text-muted">{t("Recognised text is stored invisibly in the board, so search finds your handwritten words. Ink is read by Workers AI in small groups after you stop writing.")}</div>
    </PanelShell>
  );
}
