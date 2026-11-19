import { ChevronRight, Copy, Eye, EyeOff, KeyRound, Loader2, Plus, RotateCcw, Trash2, TriangleAlert, X } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { API_BASE, api, getToken } from "../lib/api";
import { toast } from "../lib/store";
import { cx, Sheet } from "../components/ui";
import { openDevPanel } from "./DevPanel";
import { fmtDate, fmtTime, t, tk } from "../lib/i18n";

/** Settings › Developer (design: Lumen 07b R2-1N) with real named API tokens (worker/ext/settings.ts). */
export type ApiToken = { id: string; name: string; last4: string; createdAt: number; lastUsedAt: number | null; lastIp: string | null };

const ENDPOINTS: { m: ("GET" | "PUT" | "POST")[]; p: string; d: string }[] = [
  { m: ["GET", "PUT"], p: "/api/notes/:id", d: tk("Markdown + front-matter") },
  { m: ["GET", "PUT"], p: "/api/canvas/:id", d: tk("JSON Canvas 1.0 body") },
  { m: ["GET", "PUT"], p: "/api/whiteboard/:id", d: tk("Excalidraw scene") },
  { m: ["POST"], p: "/api/whiteboard/:id/elements", d: tk("Append elements (stickies, shapes)") },
];
const METHOD_C = { GET: "var(--info)", PUT: "var(--warning)", POST: "var(--success)" };
const day = (at: number) => fmtDate(at, { day: "numeric", month: "short" });
function used(at: number) {
  const d = new Date(at), now = new Date();
  const hm = fmtTime(at);
  if (d.toDateString() === now.toDateString()) return t("today {time}", { time: hm });
  if (d.toDateString() === new Date(Date.now() - 864e5).toDateString()) return t("yesterday {time}", { time: hm });
  return t("{date} {time}", { date: day(at), time: hm });
}

function CopyIcon({ text }: { text: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button aria-label={t("Copy")} title={t("Copy")} onClick={async () => { await navigator.clipboard.writeText(text); setOk(true); setTimeout(() => setOk(false), 2000); }}
      className={cx("flex size-[34px] shrink-0 items-center justify-center rounded-[8px] border border-line", ok && "text-ok")}>
      <Copy size={14} />
    </button>
  );
}

type Prompt = { kind: "create" } | { kind: "regen"; tok: ApiToken } | { kind: "revoke"; tok: ApiToken };

export function DeveloperSection() {
  const owner = getToken();
  const base = API_BASE || location.origin;
  const [tokens, setTokens] = useState<ApiToken[] | null>(null);
  const [err, setErr] = useState("");
  const [sel, setSel] = useState<string | null>(null);
  /** Secrets this session just received (create/regenerate). The server keeps only hashes. */
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  const [shown, setShown] = useState<string | null>(null);
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const [ex, setEx] = useState(false);
  const [lang, setLang] = useState<"curl" | "fetch" | "python">("curl");

  const load = () => api<{ tokens: ApiToken[] }>("/tokens").then((r) => { setTokens(r.tokens); setErr(""); }).catch((e) => setErr((e as Error).message));
  useEffect(() => { if (owner) void load(); }, [owner]);
  useEffect(() => { if (!shown) return; const tm = setTimeout(() => setShown(null), 30_000); return () => clearTimeout(tm); }, [shown, secrets]);

  const cur = tokens?.find((x) => x.id === sel) ?? tokens?.[0] ?? null;
  const reveal = (x: ApiToken) => {
    if (shown === x.id) return setShown(null);
    if (secrets[x.id]) return setShown(x.id);
    setPrompt({ kind: "regen", tok: x });
  };
  const copyToken = async (x: ApiToken) => {
    const s = secrets[x.id];
    if (!s || shown !== x.id) return;
    await navigator.clipboard.writeText(s);
    toast(t("Copied — clears from clipboard in 60 s"));
    setTimeout(() => { navigator.clipboard.readText?.().then((x) => { if (x === s) void navigator.clipboard.writeText(""); }).catch(() => {}); }, 60_000);
  };
  const got = (r: ApiToken & { token: string }) => {
    setSecrets((m) => ({ ...m, [r.id]: r.token }));
    setSel(r.id);
    setShown(r.id);
    void load();
  };

  const box = "flex items-center gap-2.5 rounded-[8px] border border-line bg-surface";
  const small = "flex h-[34px] items-center gap-1.5 rounded-[8px] border border-line px-3 disabled:opacity-45";
  const examples = {
    curl: `curl ${base}/api/notes/<id> \\\n  -H "Authorization: Bearer $LUMEN_TOKEN"`,
    fetch: `await fetch("${base}/api/notes/<id>", {\n  method: "PUT",\n  headers: { Authorization: \`Bearer \${token}\`, "Content-Type": "application/json" },\n  body: JSON.stringify({ title: "Title", body: "New body" }),\n});`,
    python: `import os, requests\n\nr = requests.get(\n    "${base}/api/notes/<id>",\n    headers={"Authorization": f"Bearer {os.environ['LUMEN_TOKEN']}"},\n)\nprint(r.json()["body"])`,
  };
  return (
    <div className="flex max-w-[860px] flex-col gap-[22px]">
      <div className="flex flex-col gap-1"><span className="hidden text-[22px] font-[650] tracking-[-.02em] md:block">{t("Developer")}</span><span className="text-muted">{t("Read and write your notes, canvases and whiteboards from scripts and agents.")}</span></div>
      <div className="flex flex-col gap-2.5 rounded-[14px] border border-line bg-bg p-[18px]">
        <span className="text-[11px] font-semibold uppercase tracking-[.08em] text-muted">{t("Simulator")}</span>
        <span className="leading-[18px] text-muted">{t("Bottom drawer to test the app: fake date, offline, slow sync, big vault, RTL, Paper, plus dummy-data scenarios, AI and upload faults, and the clock. Also Ctrl+Shift+D.")}</span>
        <button onClick={openDevPanel} className="flex h-7 items-center self-start rounded-[7px] border border-line px-2.5 text-[12.5px] hover:bg-surface-2">{t("Open simulator")}</button>
      </div>
      <div className="flex flex-col gap-2"><span className="font-semibold">{t("Base URL")}</span>
        <div dir="ltr" className={cx(box, "h-[42px] pl-3 pr-1.5 font-mono")}><span className="flex-1 truncate">{base}</span>
          <button onClick={() => navigator.clipboard.writeText(base).then(() => toast(t("Copied")))} className="flex h-[30px] items-center gap-1.5 rounded-[6px] border border-line px-2.5 font-sans"><Copy size={13} />{t("Copy")}</button></div>
      </div>
      <div className="flex flex-col gap-2"><span className="font-semibold">{t("Endpoints")}</span>
        <div className="overflow-hidden rounded-[12px] border border-line">
          {ENDPOINTS.map((e, i) => (
            <div key={e.p} className={cx("flex min-h-[68px] flex-wrap items-center gap-x-3 gap-y-1 bg-surface py-2 ps-3.5 pe-2", i > 0 && "border-t border-line")}>
              <span className="flex w-[92px] gap-1">{e.m.map((m) => <span key={m} className="rounded-[5px] px-1.5 font-mono text-[11px] font-semibold leading-5" style={{ color: METHOD_C[m], background: `color-mix(in srgb, ${METHOD_C[m]} 14%, transparent)` }}>{m}</span>)}</span>
              <span dir="ltr" className="text-start font-mono md:w-[260px]">{e.p}</span>
              <span className="flex-1 text-muted max-md:order-last max-md:basis-full">{t(e.d)}</span>
              <span className="max-md:ms-auto"><CopyIcon text={base + e.p} /></span>
            </div>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-2"><span className="font-semibold">{tokens && tokens.length > 1 ? t("Access tokens") : t("Access token")}</span>
          {owner && tokens && tokens.length > 0 && <button onClick={() => setPrompt({ kind: "create" })} className="flex items-center gap-1 text-[12.5px] text-link"><Plus size={13} />{t("New token")}</button>}
        </div>
        {!owner ? <div className="rounded-[10px] bg-surface-2 px-3.5 py-3 text-muted">{t("Unlock sync (Settings › Sync) on this device to create API tokens.")}</div>
          : err ? <div className="rounded-[10px] bg-surface-2 px-3.5 py-3 text-muted">{err}</div>
          : !tokens ? <div className={cx(box, "h-11 px-3 text-muted")}><Loader2 size={14} className="animate-spin" />{t("Loading tokens…")}</div>
          : tokens.length === 0 ? (
            <div className={cx(box, "min-h-[46px] flex-wrap py-[5px] ps-3 pe-1.5")}>
              <KeyRound size={15} className="text-muted" /><span className="flex-1 text-muted">{t("No tokens yet. Scripts and agents use a token instead of your passcode.")}</span>
              <button onClick={() => setPrompt({ kind: "create" })} className="flex h-8 items-center gap-1.5 rounded-[8px] bg-accent px-3 font-semibold text-accent-fg"><Plus size={14} />{t("Create token")}</button>
            </div>
          ) : tokens.map((tok) => {
            const vis = shown === tok.id && secrets[tok.id];
            return (
              <div key={tok.id} onClick={() => setSel(tok.id)} className={cx(box, "min-h-[46px] flex-wrap py-[5px] ps-3 pe-1.5", tokens.length > 1 && cur?.id === tok.id && "border-accent")}>
                <KeyRound size={15} className="text-muted" />
                <span className={cx("min-w-0 flex-1 break-all text-start font-mono tracking-[.06em]", !vis && "text-muted")}>
                  <span dir="ltr">{vis ? secrets[tok.id] : `lmn_${"•".repeat(22)}${tok.last4}`}</span>
                  {tokens.length > 1 && <span dir="auto" className="ms-2 font-sans tracking-normal text-[12px] text-muted">{tok.name}</span>}
                </span>
                <button onClick={(e) => { e.stopPropagation(); reveal(tok); }} className={small}>{vis ? <EyeOff size={14} /> : <Eye size={14} />}{vis ? t("Hide") : t("Reveal")}</button>
                <button onClick={(e) => { e.stopPropagation(); void copyToken(tok); }} disabled={!vis} className={small}><Copy size={14} />{t("Copy token")}</button>
              </div>
            );
          })}
        {owner && cur && (
          <div className="flex gap-2.5 rounded-[10px] border px-3.5 py-3 leading-5" style={{ background: "color-mix(in srgb, var(--warning) 9%, transparent)", borderColor: "color-mix(in srgb, var(--warning) 30%, transparent)" }}>
            <TriangleAlert size={16} className="mt-0.5 shrink-0 text-warn" />
            <div className="flex flex-1 flex-col gap-1">
              <span><b className="font-semibold">{t("This token gives full access.")}</b> {t("Anyone with it can read, change and delete every note, canvas and whiteboard. Treat it like your passcode.")}</span>
              <span className="text-[12.5px] text-muted">{tokens!.length > 1 ? `${cur.name} · ` : ""}{t("Created {date}", { date: day(cur.createdAt) })} · {cur.lastUsedAt ? (cur.lastIp ? t("last used {when} from {ip}", { when: used(cur.lastUsedAt), ip: cur.lastIp }) : t("last used {when}", { when: used(cur.lastUsedAt) })) : t("never used")}</span>
            </div>
            <div className="flex flex-col items-end gap-1 self-start">
              <button onClick={() => setPrompt({ kind: "regen", tok: cur })} className="flex h-[30px] items-center gap-1.5 rounded-[8px] px-2.5 font-medium text-bad hover:bg-surface-2"><RotateCcw size={13} />{t("Regenerate")}</button>
              <button onClick={() => setPrompt({ kind: "revoke", tok: cur })} className="flex h-[26px] items-center gap-1.5 rounded-[8px] px-2.5 text-[12px] text-muted hover:text-bad"><Trash2 size={12} />{t("Revoke")}</button>
            </div>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <button onClick={() => setEx(!ex)} className="flex items-center gap-2 text-start text-muted"><ChevronRight size={14} className={cx("transition-transform", ex && "rotate-90")} /><span className="font-medium text-ink">{t("Example request")}</span><span className="text-[12px]">curl · fetch · Python</span></button>
        {ex && (
          <div className="flex flex-col gap-2">
            <div className="flex gap-0.5 self-start rounded-[8px] border border-line bg-surface p-[3px]">
              {(["curl", "fetch", "python"] as const).map((l) => <button key={l} onClick={() => setLang(l)} className={cx("h-[26px] rounded-[6px] px-3", lang === l ? "bg-surface-2 font-semibold" : "text-muted")}>{l === "python" ? "Python" : l}</button>)}
            </div>
            <div className="relative" dir="ltr"><pre className="overflow-x-auto rounded-[10px] border border-line bg-surface p-3.5 pr-12 font-mono text-[12.5px] leading-[20px]">{examples[lang]}</pre><span className="absolute right-2 top-2"><CopyIcon text={examples[lang]} /></span></div>
          </div>
        )}
      </div>
      {prompt && <PasscodePrompt prompt={prompt} onClose={() => setPrompt(null)} onToken={got} onRevoked={(id) => { setSecrets((m) => { const n = { ...m }; delete n[id]; return n; }); if (shown === id) setShown(null); void load(); }} />}
    </div>
  );
}

function PasscodePrompt({ prompt, onClose, onToken, onRevoked }: { prompt: Prompt; onClose: () => void; onToken: (r: ApiToken & { token: string }) => void; onRevoked: (id: string) => void }) {
  const [name, setName] = useState("");
  const [pass, setPass] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const run = async () => {
    setBusy(true); setErr("");
    try {
      if (prompt.kind === "create") onToken(await api<ApiToken & { token: string }>("/tokens", { method: "POST", json: { name: name || "API token", passcode: pass } }));
      else if (prompt.kind === "regen") onToken(await api<ApiToken & { token: string }>(`/tokens/${prompt.tok.id}/regenerate`, { method: "POST", json: { passcode: pass } }));
      else { await api(`/tokens/${prompt.tok.id}`, { method: "DELETE" }); onRevoked(prompt.tok.id); toast(t("Token “{name}” revoked. Scripts using it stop working now.", { name: prompt.tok.name })); }
      if (prompt.kind !== "revoke") toast(t("Copy it now — Lumen keeps only a fingerprint and can't show it again."));
      onClose();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const title: ReactNode = prompt.kind === "create" ? t("New API token") : prompt.kind === "regen" ? t("Regenerate “{name}”?", { name: prompt.tok.name }) : t("Revoke “{name}”?", { name: prompt.tok.name });
  const field = "h-11 w-full rounded-[8px] border border-line bg-bg px-3 focus:border-accent focus:outline-none md:h-9";
  return (
    <Sheet open onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); void run(); }} className="-m-4 flex flex-col gap-3.5 bg-surface p-5 text-[14px] md:p-[22px] md:text-[13px]">
        <div className="flex items-center gap-2.5"><span className="flex-1 text-[17px] font-[650]">{title}</span><button type="button" aria-label={t("Close")} onClick={onClose} className="hidden text-muted hover:text-ink md:block"><X size={18} /></button></div>
        <span className="leading-5 text-muted">
          {prompt.kind === "create" ? t("Give it a name you'll recognise (the script or agent that uses it). You'll see the token once.")
            : prompt.kind === "regen" ? t("Lumen keeps only a fingerprint of each token, so it can't be shown again. Regenerating issues a new token and the old one stops working immediately.")
            : t("Scripts and agents using this token lose access immediately. This can't be undone.")}
        </span>
        {prompt.kind === "create" && <label className="flex flex-col gap-1.5"><span className="text-[12px] font-medium text-muted">{t("Name")}</span><input autoFocus dir="auto" className={field} value={name} maxLength={60} placeholder={t("e.g. Obsidian sync script")} onChange={(e) => setName(e.target.value)} /></label>}
        {prompt.kind !== "revoke" && <label className="flex flex-col gap-1.5"><span className="text-[12px] font-medium text-muted">{t("Passcode")}</span><input autoFocus={prompt.kind === "regen"} type="password" autoComplete="current-password" className={field} value={pass} onChange={(e) => setPass(e.target.value)} /></label>}
        {err && <span className="text-[12.5px] text-bad">{err}</span>}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="flex h-11 items-center rounded-[10px] px-3.5 text-muted hover:text-ink md:h-9">{t("Cancel")}</button>
          <button disabled={busy || (prompt.kind !== "revoke" && !pass)} className={cx("flex h-11 items-center gap-1.5 rounded-[10px] px-4 font-semibold disabled:opacity-50 md:h-9", prompt.kind === "create" ? "bg-accent text-accent-fg" : "bg-bad text-white")}>
            {busy && <Loader2 size={14} className="animate-spin" />}{prompt.kind === "create" ? t("Create token") : prompt.kind === "regen" ? t("Regenerate") : t("Revoke")}
          </button>
        </div>
      </form>
    </Sheet>
  );
}
