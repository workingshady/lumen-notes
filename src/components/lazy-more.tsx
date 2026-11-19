// Lazy batches for long lists (Lumen 32 R6-32F: "Showing 12 of 47 · thumbnails load as you scroll"). `useBatch`
// returns how many items to render; <LazyMore> is the sentinel that grows it by one batch when scrolled into view.
import { useCallback, useEffect, useRef, useState } from "react";
import { t } from "../lib/i18n";
import { useScale } from "../lib/scale-prefs";

export function useBatch(total: number, key: unknown) {
  const { mediaBatch } = useScale();
  const [n, setN] = useState(mediaBatch);
  useEffect(() => setN(mediaBatch), [key, mediaBatch]);
  const more = useCallback(() => setN((x) => x + mediaBatch), [mediaBatch]);
  return { shown: Math.min(total, n), more, total };
}

export function LazyMore({ shown, total, more }: { shown: number; total: number; more: () => void }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || shown >= total) return;
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) more(); }, { rootMargin: "200px" });
    io.observe(el);
    return () => io.disconnect();
  }, [shown, total, more]);
  if (total <= shown && total < 13) return null;
  return <span ref={ref} className="py-1 text-[12px] text-muted" data-lazy-more>{shown < total ? t("Showing {shown} of {total} · thumbnails load as you scroll · players load only when played", { shown, total }) : t("All {n} shown · players load only when played", { n: total })}</span>;
}
