// First sync on a new phone (Lumen 22 §5): "Syncing 1,240 notes · ~3 min left", notes first (readable at once), then
// flashcards, then files on demand; files wait for Wi-Fi unless "Sync files on mobile data" is switched on.
import { useEffect, useState } from "react";
import { fmtNum, t } from "../lib/i18n";
import { setSettings, useSettings } from "../lib/settings";
import { useSync } from "../lib/sync";

export function FirstSyncCard() {
  const s = useSync();
  const settings = useSettings() as unknown as { syncMobile?: boolean };
  const [, tick] = useState(0);
  useEffect(() => { if (!s.first) return; const i = setInterval(() => tick((x) => x + 1), 1000); return () => clearInterval(i); }, [s.first]);
  const f = s.first;
  if (!f) return null;
  const pct = f.total ? Math.min(100, (f.got / f.total) * 100) : 0;
  const el = (Date.now() - f.startedAt) / 1000;
  const left = f.got > 20 && f.total ? Math.max(0, (el / f.got) * (f.total - f.got)) : null;
  return (
    <div role="status" className="fixed bottom-20 end-4 z-40 flex w-[min(380px,calc(100vw-32px))] flex-col gap-2.5 rounded-[14px] border border-line bg-surface p-4 text-[13px] shadow-[0_16px_40px_rgba(0,0,0,.35)] md:bottom-4" data-first-sync>
      <div className="flex items-center gap-2">
        <span className="size-2 shrink-0 rounded-full bg-info" />
        <b className="flex-1 font-semibold">{f.notes ? t("Syncing {n} notes", { n: fmtNum(f.notes) }) : t("Syncing your notes")}</b>
        {left != null && <span className="text-[12px] text-muted">{left < 60 ? t("~{n} s left", { n: Math.max(1, Math.round(left)) }) : t("~{n} min left", { n: Math.round(left / 60) })}</span>}
      </div>
      <span className="h-1 overflow-hidden rounded-[2px] bg-surface-2"><span className="block h-full bg-info transition-[width]" style={{ width: `${pct || 8}%` }} /></span>
      <span className="leading-[19px] text-muted">{f.phase === "notes" ? t("Notes first (you can start reading now), then flashcards, then files on demand. Pauses on mobile data unless you allow it.") : t("Notes are in. Now flashcards and history; files load when you open them.")}</span>
      {!settings.syncMobile && <button onClick={() => setSettings({ syncMobile: true } as never)} className="flex h-8 items-center justify-center rounded-[8px] border border-line hover:bg-surface-2">{t("Sync files on mobile data")}</button>}
    </div>
  );
}
