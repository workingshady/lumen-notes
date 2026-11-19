import { Loader2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { API_BASE, api, getToken } from "../lib/api";
import { DEMO } from "../lib/db";
import { toast } from "../lib/store";
import { cx, Sheet } from "../components/ui";
import { Glyph } from "../components/Glyph";
import { openDevPanel } from "./DevPanel";
import { fmtDate, fmtRelative, t, tk } from "../lib/i18n";
import { SBtn, SGroup, SHead, SPage, SRow } from "./settings-kit";

/**
 * Settings › Developer (Lumen 29 · R6-29F–K): simulator card, Base URL, endpoints with Copy, access tokens (empty state →
 * create dialog with access + expiry → shown-once card → list with Revoke), example request tabs.
 * Tokens: worker/ext/settings.ts (`access` r|rw and `expires_at`, enforced by auth in worker/index.ts).
 * Demo mode keeps tokens in localStorage so every state can be tried without a server.
 */
export type ApiToken = { id: string; name: string; last4: string; createdAt: number; lastUsedAt: number | null; lastIp: string | null; access?: "r" | "rw"; expiresAt?: number | null };

const ENDPOINTS: { m: string; p: string; d: string }[] = [
  { m: "GET  POST  ", p: "/api/notes", d: tk("List (q, type, space, folder, tag, since, limit) · create") },
  { m: "GET PUT DEL", p: "/api/notes/:id", d: tk("Note JSON · create or update · move to Trash") },
  { m: "GET  ", p: "/api/notes/:id/markdown", d: tk("Markdown + front-matter") },
  { m: "POST  ", p: "/api/notes/:id/append", d: tk("Append text, optionally under a heading") },
  { m: "GET  ", p: "/api/search", d: tk("Search titles and text, with snippets") },
  { m: "GET  POST  ", p: "/api/spaces", d: tk("List and create spaces") },
  { m: "GET  POST  ", p: "/api/folders", d: tk("List (by space) and create folders") },
  { m: "GET  ", p: "/api/tags", d: tk("Tags with counts") },
  { m: "GET  ", p: "/api/cards/due", d: tk("Flashcards due now") },
  { m: "GET  PUT   ", p: "/api/canvas/:id", d: tk("JSON Canvas 1.0 body") },
  { m: "GET  PUT   ", p: "/api/whiteboard/:id", d: tk("Excalidraw scene") },
  { m: "POST  ", p: "/api/whiteboard/:id/elements", d: tk("Append stickies and shapes") },
  { m: "GET  PUT   ", p: "/api/att/:id", d: tk("Download or upload an attachment") },
  { m: "GET  ", p: "/api/openapi.json", d: tk("OpenAPI description for agents and API tools") },
];
const EXPIRY = [{ d: 30, l: tk("30 days") }, { d: 90, l: tk("90 days") }, { d: 365, l: tk("1 year") }, { d: 0, l: tk("Never") }];
const day = (at: number) => fmtDate(at, { day: "numeric", month: "short", year: "numeric" });

// ------------------------------------------------------------------ demo token store
const DKEY = "lumen.demo.tokens";
const demoList = (): ApiToken[] => { try { return JSON.parse(localStorage.getItem(DKEY) ?? "[]"); } catch { return []; } };
const demoSave = (l: ApiToken[]) => { try { localStorage.setItem(DKEY, JSON.stringify(l)); } catch { /* ignore */ } };
function demoCreate(name: string, access: "r" | "rw", days: number): ApiToken & { token: string } {
  const B = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const token = "lmn_" + Array.from(crypto.getRandomValues(new Uint8Array(32)), (x) => B[x % 62]).join("");
  const row: ApiToken = { id: crypto.randomUUID(), name, last4: token.slice(-4), createdAt: Date.now(), lastUsedAt: null, lastIp: null, access, expiresAt: days ? Date.now() + days * 864e5 : null };
  demoSave([row, ...demoList()]);
  return { ...row, token };
}

const tokensApi = {
  list: async () => (DEMO ? demoList() : (await api<{ tokens: ApiToken[] }>("/tokens")).tokens),
  create: async (name: string, access: "r" | "rw", days: number, passcode: string) => (DEMO ? demoCreate(name, access, days) : api<ApiToken & { token: string }>("/tokens", { method: "POST", json: { name, access, days, passcode } })),
  revoke: async (id: string) => { if (DEMO) demoSave(demoList().filter((x) => x.id !== id)); else await api(`/tokens/${id}`, { method: "DELETE" }); },
};

function copy(text: string, what = t("Copied")) { void navigator.clipboard.writeText(text).then(() => toast(what)).catch(() => toast(t("Couldn't copy"))); }

export function DeveloperSection() {
  const owner = DEMO || !!getToken();
  const base = API_BASE || location.origin;
  const host = base.replace(/^https?:\/\//, "");
  const [tokens, setTokens] = useState<ApiToken[] | null>(null);
  const [err, setErr] = useState("");
  const [fresh, setFresh] = useState<(ApiToken & { token: string }) | null>(null);
  const [dlg, setDlg] = useState(false);
  const [revoke, setRevoke] = useState<ApiToken | null>(null);
  const [lang, setLang] = useState<"curl" | "fetch" | "python">("curl");
  const load = () => tokensApi.list().then((l) => { setTokens(l); setErr(""); }).catch((e) => setErr((e as Error).message));
  useEffect(() => { if (owner) void load(); }, [owner]);

  const examples = {
    curl: `curl ${base}/api/notes/<id> \\\n  -H "Authorization: Bearer $LUMEN_TOKEN"`,
    fetch: `await fetch("${base}/api/notes/<id>", {\n  headers: { Authorization: \`Bearer \${process.env.LUMEN_TOKEN}\` },\n}).then((r) => r.json());`,
    python: `import os, requests\n\nr = requests.get(\n    "${base}/api/notes/<id>",\n    headers={"Authorization": f"Bearer {os.environ['LUMEN_TOKEN']}"},\n)\nprint(r.json()["body"])`,
  };
  const desc = (x: ApiToken) => [x.access === "r" ? t("Read only") : t("Read + write"), x.lastUsedAt ? t("used {ago}", { ago: fmtRelative(x.lastUsedAt) }) : t("never used"), x.expiresAt ? (x.expiresAt < Date.now() ? t("expired") : t("expires {date}", { date: fmtDate(x.expiresAt, { day: "numeric", month: "short" }) })) : t("never expires")].join(" · ");

  return (
    <SPage title={t("Developer")} sub={t("Read and write your notes, canvases and whiteboards from scripts and agents.")}>
      <SGroup>
        <SRow label={t("Simulator")} glyph="simulator" glyphColor="var(--accent)" tile="#F2A93B"
          desc={t("Bottom drawer: fake date, offline, slow sync, big vault, RTL, Paper, dummy data, AI and upload faults. Ctrl+Shift+D.")}
          control={<SBtn onClick={openDevPanel}>{t("Open simulator")}</SBtn>} />
      </SGroup>
      <SGroup>
        <SRow label={t("Base URL")} value={<span dir="ltr">{host}</span>} mono valueColor="var(--text)" control={<SBtn onClick={() => copy(base)}>{t("Copy")}</SBtn>} />
      </SGroup>
      <SGroup title={t("Endpoints")}>
        {ENDPOINTS.map((e) => (
          <SRow key={e.p} label={<span dir="ltr">{e.m.trim().replace(/\s+/g, " ")} {e.p}</span>} desc={t(e.d)} control={<SBtn onClick={() => copy(base + e.p)}>{t("Copy")}</SBtn>} />
        ))}
      </SGroup>

      {!owner ? (
        <><SHead title={t("Access tokens")} /><div className="rounded-[12px] border border-dashed border-line p-[18px] text-muted">{t("Unlock sync (Settings › Sync) on this device to create API tokens.")}</div></>
      ) : err ? (
        <><SHead title={t("Access tokens")} /><div className="rounded-[12px] border border-line bg-surface p-[18px] text-muted">{err}</div></>
      ) : !tokens ? (
        <><SHead title={t("Access tokens")} /><div className="flex h-[52px] items-center gap-2 rounded-[12px] border border-line bg-surface px-3.5 text-muted"><Loader2 size={14} className="animate-spin" />{t("Loading tokens…")}</div></>
      ) : tokens.length === 0 ? (
        <>
          <SHead title={t("Access tokens")} />
          <div className="flex flex-col items-start gap-2.5 rounded-[12px] border border-dashed border-line p-[18px]">
            <Glyph name="token" size={18} color="var(--muted)" tile="#9AA0AA" />
            <span className="font-semibold">{t("No tokens yet")}</span>
            <span className="leading-[18px] text-muted">{t("Scripts and agents use a token instead of your passcode. Each token can be revoked on its own.")}</span>
            <button onClick={() => setDlg(true)} className="flex h-8 items-center rounded-[8px] bg-accent px-3 font-semibold text-accent-fg">{t("Create token")}</button>
          </div>
        </>
      ) : (
        <SGroup title={t("Access tokens")}>
          {tokens.map((x) => <SRow key={x.id} label={x.name} desc={desc(x)} glyph="token" control={<SBtn danger onClick={() => setRevoke(x)}>{t("Revoke")}</SBtn>} />)}
          <SRow label={t("Create token")} glyph="plus" glyphColor="var(--accent)" onOpen={() => setDlg(true)} />
        </SGroup>
      )}

      {fresh && (
        <div className="flex flex-col gap-2.5 rounded-[12px] border border-accent p-3.5" style={{ background: "color-mix(in srgb, var(--accent) 6%, var(--surface))" }} data-token-fresh>
          <span className="font-semibold" dir="auto">{t("“{name}” created · copy it now", { name: fresh.name })}</span>
          <div className="flex h-10 items-center gap-2 rounded-[8px] border border-line bg-bg pe-1.5 ps-3" dir="ltr">
            <span className="flex-1 truncate font-mono text-[12.5px]">{fresh.token}</span>
            <button onClick={() => copy(fresh.token, t("Token copied"))} className="flex h-[30px] items-center gap-1.5 rounded-[7px] bg-accent px-2.5 font-semibold text-accent-fg"><Glyph name="copy" size={13} />{t("Copy")}</button>
          </div>
          <span className="text-[12.5px] text-muted">{t("You won't see this again.")} {fresh.access === "r" ? t("Read only") : t("Read + write")} · {fresh.expiresAt ? t("expires {date}.", { date: day(fresh.expiresAt) }) : t("never expires.")}</span>
        </div>
      )}


      <SHead title={t("Example request")} />
      <div className="flex flex-col overflow-hidden rounded-[12px] border border-line bg-surface">
        <div className="flex items-center border-b border-line px-2">
          {(["curl", "fetch", "python"] as const).map((l) => (
            <button key={l} onClick={() => setLang(l)} className={cx("px-2.5 py-[9px]", lang === l ? "font-semibold text-ink shadow-[inset_0_-2px_0_var(--accent)]" : "text-muted")}>{l === "python" ? "Python" : l}</button>
          ))}
          <span className="flex-1" />
          <button onClick={() => copy(examples[lang])} className="flex h-[26px] items-center gap-1.5 rounded-[6px] border border-line px-2 text-[12px]"><Glyph name="copy" size={12} />{t("Copy")}</button>
        </div>
        <pre dir="ltr" className="overflow-x-auto px-3.5 py-3 text-start font-mono text-[12.5px] leading-[21px]">{examples[lang]}</pre>
      </div>

      {dlg && <CreateTokenDialog onClose={() => setDlg(false)} onCreated={(r) => { setFresh(r); setDlg(false); void load(); }} />}
      {revoke && (
        <Sheet open onClose={() => setRevoke(null)}>
          <div className="-m-4 flex flex-col gap-3.5 bg-surface p-5">
            <span className="text-[16px] font-[650]" dir="auto">{t("Revoke “{name}”?", { name: revoke.name })}</span>
            <span className="leading-5 text-muted">{t("Scripts and agents using this token lose access immediately. This can't be undone.")}</span>
            <div className="flex justify-end gap-2">
              <button onClick={() => setRevoke(null)} className="h-[34px] px-3 text-muted">{t("Cancel")}</button>
              <button onClick={() => void tokensApi.revoke(revoke.id).then(() => { toast(t("Token “{name}” revoked. Scripts using it stop working now.", { name: revoke.name })); if (fresh?.id === revoke.id) setFresh(null); setRevoke(null); void load(); }).catch((e) => toast((e as Error).message))}
                className="h-[34px] rounded-[9px] border px-3.5 font-semibold text-bad" style={{ borderColor: "color-mix(in srgb, var(--danger) 40%, transparent)" }}>{t("Revoke")}</button>
            </div>
          </div>
        </Sheet>
      )}
    </SPage>
  );
}

/** Create access token (R6-29G): name, Read only vs Read + write, expiry (default 90 days). */
function CreateTokenDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (r: ApiToken & { token: string }) => void }) {
  const [name, setName] = useState("");
  const [access, setAccess] = useState<"r" | "rw">("rw");
  const [days, setDays] = useState(90);
  const [pass, setPass] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const run = async () => {
    setBusy(true); setErr("");
    try { onCreated(await tokensApi.create(name.trim() || t("API token"), access, days, pass)); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const opt = (on: boolean) => cx("flex h-14 flex-col justify-center rounded-[9px] px-3 text-start", on ? "border-[1.5px] border-accent" : "border border-line");
  const tint = { background: "color-mix(in srgb, var(--accent) 6%, transparent)" };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" role="dialog" aria-modal aria-label={t("Create access token")}>
      <div className="absolute inset-0 bg-[rgba(5,6,8,.55)]" onClick={onClose} />
      <form onSubmit={(e) => { e.preventDefault(); void run(); }} className="relative flex w-[460px] max-w-[92%] flex-col rounded-[14px] border border-line bg-surface">
        <div className="flex items-center gap-2.5 px-5 pb-1.5 pt-[18px]"><Glyph name="token" size={18} /><span className="flex-1 text-[16px] font-[650]">{t("Create access token")}</span><button type="button" aria-label={t("Close")} onClick={onClose} className="text-muted hover:text-ink"><X size={16} /></button></div>
        <div className="flex flex-col gap-3.5 px-5 py-2.5">
          <label className="flex flex-col gap-1.5"><span className="text-[12px] text-muted">{t("Name")}</span>
            <input autoFocus dir="auto" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} placeholder={t("Study agent")} className="h-[38px] rounded-[8px] border border-line bg-bg px-3 focus:border-accent focus:outline-none" /></label>
          <div className="flex flex-col gap-1.5"><span className="text-[12px] text-muted">{t("Access")}</span>
            <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label={t("Access")}>
              <button type="button" role="radio" aria-checked={access === "r"} onClick={() => setAccess("r")} className={opt(access === "r")} style={access === "r" ? tint : undefined}><b className="font-semibold">{t("Read only")}</b><span className="text-[12px] text-muted">{t("GET requests")}</span></button>
              <button type="button" role="radio" aria-checked={access === "rw"} onClick={() => setAccess("rw")} className={opt(access === "rw")} style={access === "rw" ? tint : undefined}><b className="font-semibold">{t("Read + write")}</b><span className="text-[12px] text-muted">{t("GET, PUT, POST")}</span></button>
            </div>
          </div>
          <div className="flex flex-col gap-1.5"><span className="text-[12px] text-muted">{t("Expires")}</span>
            <div className="flex gap-0.5 self-start rounded-[8px] border border-line bg-bg p-[3px]" role="radiogroup" aria-label={t("Expires")}>
              {EXPIRY.map((x) => <button type="button" role="radio" aria-checked={days === x.d} key={x.d} onClick={() => setDays(x.d)} className={cx("flex h-[26px] items-center rounded-[6px] px-2.5", days === x.d ? "bg-surface-2 font-semibold" : "text-muted")}>{t(x.l)}</button>)}
            </div>
          </div>
          {!DEMO && <label className="flex flex-col gap-1.5"><span className="text-[12px] text-muted">{t("Your passcode (to confirm)")}</span>
            <input type="password" autoComplete="current-password" value={pass} onChange={(e) => setPass(e.target.value)} className="h-[38px] rounded-[8px] border border-line bg-bg px-3 focus:border-accent focus:outline-none" /></label>}
          {err && <span className="text-[12.5px] text-bad">{err}</span>}
        </div>
        <div className="flex justify-end gap-2 border-t border-line px-5 py-3.5">
          <button type="button" onClick={onClose} className="flex h-[34px] items-center px-3 text-muted">{t("Cancel")}</button>
          <button disabled={busy || (!DEMO && !pass)} className="flex h-[34px] items-center gap-1.5 rounded-[9px] bg-accent px-3.5 font-semibold text-accent-fg disabled:opacity-50">{busy && <Loader2 size={14} className="animate-spin" />}{t("Create token")}</button>
        </div>
      </form>
    </div>
  );
}
