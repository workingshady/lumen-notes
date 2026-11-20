// Presenting a whiteboard / Board (design 41A–41D): frames in Frames-panel order are the slides (hidden ones skipped);
// the camera flies between them over one SVG of the board. Notes = the frame's description (customData.lumenNotes).
import { exportToSvg, getCommonBounds } from "@excalidraw/excalidraw";
import { useEffect, useMemo, useState } from "react";
import { t } from "../../../lib/i18n";
import type { WbAPI } from "../hooks";
import { boardColor, lineColor, patternCss, type LumenBoard } from "../settings/model";
import { frameName, isHidden, notesOf, orderedFrames, setFrameNotes } from "./frames";
import { Presenter, type PresenterStep } from "./Presenter";

export function BoardPresenter({ api, board, dark, phone, title, noteId, spaceId, onExit, onSaved, penColor, start }: {
  api: WbAPI; board: LumenBoard; dark: boolean; phone: boolean; title: string; noteId: string; spaceId: string; onExit: () => void; onSaved: () => void; penColor?: string; start?: string;
}) {
  const [svg, setSvg] = useState<{ html: string; x0: number; y0: number; w: number; h: number } | null>(null);
  const [rev, setRev] = useState(0);
  const steps: PresenterStep[] = useMemo(() => {
    const fr = orderedFrames(api);
    const all = fr.map((f, i) => ({ f, i })).filter(({ f }) => !isHidden(f));
    if (all.length) return all.map(({ f, i }) => ({ id: f.id, label: frameName(f, i), notes: notesOf(f), rect: { x: f.x, y: f.y, w: f.width, h: f.height } }));
    const els = api.getSceneElements();
    if (!els.length) return [];
    const [x0, y0, x1, y1] = getCommonBounds(els as never);
    return [{ id: "board", label: title, rect: { x: x0 - 24, y: y0 - 24, w: x1 - x0 + 48, h: y1 - y0 + 48 } }];
  }, [api, title, rev]);
  useEffect(() => {
    let live = true;
    void (async () => {
      const els = api.getSceneElements().filter((e) => !e.isDeleted);
      if (!els.length) return;
      const [x0, y0, x1, y1] = getCommonBounds(els as never);
      const out = await exportToSvg({ elements: els as never, files: api.getFiles() as never, exportPadding: 0, appState: { exportBackground: false, exportWithDarkMode: false, viewBackgroundColor: "transparent", frameRendering: { enabled: true, name: false, outline: false, clip: true } } as never });
      out.setAttribute("width", String(x1 - x0)); out.setAttribute("height", String(y1 - y0));
      out.style.display = "block";
      if (live) setSvg({ html: out.outerHTML, x0, y0, w: x1 - x0, h: y1 - y0 });
    })();
    return () => { live = false; };
  }, [api, dark]);
  const lc = lineColor(board, dark), pat = patternCss(board.pattern, lc, board.density, 1);
  const bg = board.bg === "transparent" ? { color: "var(--bg)" } : { color: boardColor(board), image: pat.image === "none" ? undefined : pat.image, size: pat.size };
  const startIdx = Math.max(0, steps.findIndex((s) => s.id === start));
  if (!steps.length) return null;
  return (
    <Presenter steps={steps} start={startIdx} phone={phone} penColor={penColor} background={bg}
      counter={(i, n) => (steps[0].id === "board" ? title : t("Frame {n} of {total}", { n: i + 1, total: n }))}
      notesHead={(i) => t("PRESENTER NOTES · FRAME {n}", { n: i + 1 })}
      scene={svg ? { node: <div style={dark ? { filter: "url(#lumen-wb-ink)" } : undefined} dangerouslySetInnerHTML={{ __html: svg.html }} />, x0: svg.x0, y0: svg.y0, w: svg.w, h: svg.h } : undefined}
      renderStep={svg ? undefined : () => null}
      onNotes={(i, text) => { const s = steps[i]; if (s.id !== "board" && text !== (s.notes ?? "")) { setFrameNotes(api, s.id, text); setRev((r) => r + 1); onSaved(); } }}
      remote={{ noteId, spaceId, title }} onExit={onExit} />
  );
}
