// R8-56 empty-state suggestions built from real activity: notes edited this week, cards due, linked notes, today's
// tasks (or the next open plan). Each says which notes it uses and carries the scope it should search.
import { useMemo } from "react";
import { isWbType, type Note } from "../../../shared/types";
import type { Scope } from "../../lib/ask-retrieve";
import { useDueCards } from "../../lib/due-cards";
import { t } from "../../lib/i18n";
import { tasks } from "../../lib/parse";
import { useVault } from "../../lib/store";

export interface Pin { noteId: string; title: string; heading?: string; text: string }
/** `pins` = the passages the question is about (an activity question has no keywords to retrieve by). */
export interface Suggestion { id: string; glyph: string; kind: string; color: string; text: string; src: string; scope: Scope; pins: Pin[] }
const FM = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/;
const pinOf = (n: Note, max = 700): Pin => ({ noteId: n.id, title: n.title, text: n.body.replace(FM, "").replace(/^#\s.*\n/, "").replace(/\s+/g, " ").trim().slice(0, max) });
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export function useSuggestions(max = 4): Suggestion[] {
  const v = useVault();
  const due = useDueCards(v.notes);
  return useMemo(() => {
    const out: Suggestion[] = [];
    const live = v.notes.filter((n) => !n.deleted && !isWbType(n.type) && n.type !== "pdf" && n.type !== "canvas");
    // SUMMARISE: what changed since Monday (else the last few notes)
    const mon = new Date(); mon.setHours(0, 0, 0, 0); mon.setDate(mon.getDate() - ((mon.getDay() + 6) % 7));
    const week = live.filter((n) => n.updatedAt >= mon.getTime()).sort((a, b) => b.updatedAt - a.updatedAt);
    const recent = week.length ? week : [...live].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 5);
    if (recent.length) out.push({ id: "sum", glyph: "note", kind: t("SUMMARISE"), color: "var(--link)", text: week.length ? t("Summarise what I wrote this week") : t("Summarise my latest notes"),
      src: week.length ? t("From {n} notes edited since Mon", { n: week.length }) : t("From the last {n} notes", { n: recent.length }), scope: { kind: "vault", noteIds: recent.slice(0, 14).map((n) => n.id) }, pins: recent.slice(0, 6).map((n) => pinOf(n)) });
    // QUIZ ME: the space with the most cards due
    const by = new Map<string, number>();
    for (const d of due ?? []) by.set(d.note.spaceId, (by.get(d.note.spaceId) ?? 0) + 1);
    const top = [...by].sort((a, b) => b[1] - a[1])[0];
    const sp = top ? v.spaceMap.get(top[0]) : undefined;
    if (sp && top) out.push({ id: "quiz", glyph: "flashcards", kind: t("QUIZ ME"), color: "var(--warning)", text: t("Quiz me on {space}, {n} questions", { space: sp.name, n: Math.min(10, top[1]) }), src: t("{space} · {n} cards due", { space: sp.name, n: top[1] }), scope: { kind: "space", spaceId: sp.id }, pins: [...new Set((due ?? []).filter((d) => d.note.spaceId === sp.id).map((d) => d.note))].slice(0, 5).map((n) => pinOf(n, 900)) });
    // CONNECT: the most linked note and its best-linked neighbour
    const deg = (id: string) => (v.outlinks.get(id)?.length ?? 0) + (v.backlinks.get(id)?.length ?? 0);
    const plainTitle = (n: Note) => n.type !== "moc" && !/map of content|moc/i.test(n.title);
    const hub = [...live].filter(plainTitle).sort((a, b) => deg(b.id) - deg(a.id))[0];
    if (hub && deg(hub.id) > 0) {
      const nb = [...new Set([...(v.outlinks.get(hub.id) ?? []), ...(v.backlinks.get(hub.id) ?? [])])].map((id) => v.byId.get(id)).filter((n) => n && !n.deleted && n.id !== hub.id && !isWbType(n.type) && plainTitle(n))
        .sort((a, b) => deg(b!.id) - deg(a!.id))[0];
      if (nb) out.push({ id: "con", glyph: "graph", kind: t("CONNECT"), color: "var(--learn)", text: t("How does {a} relate to {b}?", { a: hub.title, b: nb.title }), src: t("{space} · these notes link each other", { space: v.spaceMap.get(hub.spaceId)?.name ?? "" }), scope: { kind: "vault", noteIds: [hub.id, nb.id] }, pins: [pinOf(hub, 1200), pinOf(nb!, 1200)] });
    }
    // PLAN: today's tasks, else the next open learning path
    const today = ymd(new Date());
    let open = 0, overdue = 0, dueToday = 0;
    const todayPins: Pin[] = [];
    for (const n of live) {
      if (!n.body.includes("[")) continue;
      const lines: string[] = [];
      for (const k of tasks(n.body)) {
        if (k.done) continue;
        open++;
        if (k.due && k.due < today) overdue++; else if (k.due === today) dueToday++;
        if (lines.length < 8) lines.push(`- ${k.text}${k.due ? ` (due ${k.due})` : ""}`);
      }
      if (lines.length && todayPins.length < 6) todayPins.push({ noteId: n.id, title: n.title, text: `Open tasks: ${lines.join(" ")}` });
    }
    if (dueToday + overdue > 0) out.push({ id: "plan", glyph: "task", kind: t("PLAN"), color: "var(--accent)", text: t("What should I do first today?"), src: t("Today · {n} tasks, {o} overdue", { n: dueToday + overdue, o: overdue }), scope: { kind: "vault" }, pins: todayPins });
    else {
      const path = v.notes.find((n) => n.type === "path" && !n.deleted);
      if (path) out.push({ id: "plan", glyph: "timeline", kind: t("PLAN"), color: "var(--accent)", text: t("What should I study next in {path}?", { path: path.title }), src: t("Plan · {path}", { path: path.title }), scope: { kind: "path", pathId: path.id }, pins: [pinOf(path, 1500)] });
      else if (open) out.push({ id: "plan", glyph: "task", kind: t("PLAN"), color: "var(--accent)", text: t("What should I do first today?"), src: t("{n} open tasks", { n: open }), scope: { kind: "vault" }, pins: todayPins });
    }
    return out.slice(0, max);
  }, [v, due, max]);
}
