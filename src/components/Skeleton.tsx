import { useEffect, useState } from "react";

/** Loading skeletons (design: Lumen 12 · R3·6). Shown only if loading takes > 300 ms; shapes mirror the real layout. */
export function Skeleton({ kind = "note" }: { kind?: "list" | "note" | "board" | "graph" }) {
  const [show, setShow] = useState(false);
  useEffect(() => { const t = setTimeout(() => setShow(true), 300); return () => clearTimeout(t); }, []);
  if (!show) return null;
  const bar = (w: string, h: number, c = "var(--surface)", r = 4) => <span style={{ display: "block", width: w, height: h, borderRadius: r, background: c }} />;
  if (kind === "list") {
    return (
      <div className="skel-pulse flex flex-col gap-3.5 p-3.5" aria-busy="true" data-skel>
        {["62%", "48%", "70%", "40%", "56%"].map((a, i) => (
          <div key={i} className="flex items-start gap-2.5">
            <span className="mt-1 size-2 rounded-full bg-surface-2" />
            <div className="flex flex-1 flex-col gap-[7px]">{bar(a, 11, "var(--surface-2)")}{bar(["90%", "84%", "92%", "76%", "88%"][i], 8)}{bar("55%", 8)}</div>
          </div>
        ))}
      </div>
    );
  }
  if (kind === "board") {
    return (
      <div className="skel-pulse relative h-full overflow-hidden" aria-busy="true" data-skel style={{ backgroundImage: "radial-gradient(var(--border) 1px, transparent 1.2px)", backgroundSize: "22px 22px" }}>
        <span className="absolute left-1/2 top-3.5 h-9 w-[260px] -translate-x-1/2 rounded-[10px] border border-line bg-surface" />
        {[[60, 90, 150, 96, 2], [250, 110, 170, 110, 2], [120, 230, 180, 70, 1], [330, 250, 150, 60, 1]].map(([x, y, w, h, l], i) => (
          <span key={i} className="absolute rounded-[10px]" style={{ left: `calc(50% - 270px + ${x}px)`, top: y, width: w, height: h, background: l === 2 ? "var(--surface-2)" : "var(--surface)" }} />
        ))}
      </div>
    );
  }
  if (kind === "graph") {
    const pts = [[22, 30, 18], [40, 22, 12], [55, 40, 22], [35, 55, 14], [62, 62, 10], [74, 32, 16], [18, 62, 10], [48, 72, 12], [80, 52, 9], [30, 42, 8], [66, 22, 9], [58, 52, 8]];
    return (
      <div className="skel-pulse relative h-full overflow-hidden" aria-busy="true" data-skel>
        {pts.map(([x, y, d], i) => <span key={i} className="absolute rounded-full bg-surface-2" style={{ left: `${x}%`, top: `${y}%`, width: d, height: d }} />)}
        <span className="absolute right-3.5 top-3.5 h-[120px] w-[180px] rounded-[12px] border border-line bg-surface" />
      </div>
    );
  }
  return (
    <div className="skel-pulse mx-auto flex max-w-[var(--measure)] flex-col gap-3 px-10 py-7" aria-busy="true" data-skel>
      {bar("30%", 10)}{bar("72%", 24, "var(--surface-2)", 6)}
      <span className="h-2" />{bar("100%", 9)}{bar("94%", 9)}{bar("97%", 9)}{bar("60%", 9)}
      <span className="mt-1.5 block h-16 w-full rounded-[10px] bg-surface" />{bar("88%", 9)}
    </div>
  );
}
