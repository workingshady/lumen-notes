// i18n tests (src/lib/i18n.ts + src/i18n/ar.ts). Run: npx tsx scripts/i18n.test.ts
// Plural forms, interpolation, missing-key fallback, and a catalog coverage report:
// every literal key used with t() / tx() / tk() / tr() in src must have an Arabic entry (count must be 0).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { catalog, loadCatalog, fmtDate, fmtNum, fmtRelative, locale, resolveLang, tIn, type PluralForms } from "../src/lib/i18n";

await loadCatalog("ar"); // the Arabic catalog is a lazy chunk in the app
let failed = 0, passed = 0;
function ok(cond: unknown, msg: string) { if (cond) passed++; else { failed++; console.error("FAIL:", msg); } }
function eq<T>(a: T, b: T, msg: string) { const A = JSON.stringify(a), B = JSON.stringify(b); ok(A === B, `${msg}\n   got:      ${A}\n   expected: ${B}`); }

// ------------------------------------------------------------------ language resolution
eq(resolveLang("auto", "ar-EG"), "ar", "auto + ar-EG → ar");
eq(resolveLang("auto", "en-US"), "en", "auto + en-US → en");
eq(resolveLang("auto", "fa-IR"), "en", "auto + unsupported language → en");
eq(resolveLang("ar", "en-US"), "ar", "explicit ar wins");

// ------------------------------------------------------------------ English source, interpolation, fallback
eq(tIn("en", "Settings"), "Settings", "en returns the key");
eq(tIn("en", "Hello {name}", { name: "Sara" }), "Hello Sara", "interpolation");
eq(tIn("en", "{a} of {b}", { a: 3, b: 7 }), "3 of 7", "number interpolation");
eq(tIn("en", "Keep {x}", {}), "Keep {x}", "missing var stays visible");
eq(tIn("en", "{n} note|{n} notes", { n: 1 }), "1 note", "English plural one");
eq(tIn("en", "{n} note|{n} notes", { n: 0 }), "0 notes", "English plural zero → other");
eq(tIn("en", "{n} note|{n} notes", { n: 5 }), "5 notes", "English plural other");
eq(tIn("ar", "A string nobody translated (test)"), "A string nobody translated (test)", "missing key → English");
eq(tIn("ar", "{n} widget|{n} widgets", { n: 2 }), "2 widgets", "missing plural key → English plural");
eq(tIn("ar", "Settings"), "الإعدادات", "Arabic entry");

// ------------------------------------------------------------------ Arabic plural categories
const AR = catalog("ar");
const forms = AR["{n} note|{n} notes"] as PluralForms | undefined;
ok(forms && typeof forms === "object", "catalog has the plural entry {n} note|{n} notes");
const cats = (n: number) => new Intl.PluralRules("ar").select(n);
eq([0, 1, 2, 3, 11, 100].map(cats), ["zero", "one", "two", "few", "many", "other"], "Intl.PluralRules(ar) categories");
if (forms) {
  eq(tIn("ar", "{n} note|{n} notes", { n: 0 }), forms.zero!.replace("{n}", "0"), "ar zero");
  eq(tIn("ar", "{n} note|{n} notes", { n: 1 }), forms.one!.replace("{n}", "1"), "ar one");
  eq(tIn("ar", "{n} note|{n} notes", { n: 2 }), forms.two!.replace("{n}", "2"), "ar two");
  eq(tIn("ar", "{n} note|{n} notes", { n: 5 }), forms.few!.replace("{n}", "5"), "ar few (3–10)");
  eq(tIn("ar", "{n} note|{n} notes", { n: 11 }), forms.many!.replace("{n}", "11"), "ar many (11–99)");
  eq(tIn("ar", "{n} note|{n} notes", { n: 100 }), forms.other.replace("{n}", "100"), "ar other (100)");
}

// ------------------------------------------------------------------ formatting (lang = en in Node unless navigator says otherwise)
eq(fmtNum(1234), "1,234", "grouped from 1,000");
eq(fmtNum(3142), fmtNum(3142), "cached formatter is stable");
eq(fmtNum(999), "999", "below 1,000 ungrouped");
eq(fmtNum(2026, { useGrouping: false }), "2026", "years / ids opt out");
eq(new Intl.NumberFormat(locale("ar", "arab"), { useGrouping: true }).format(3142), "٣٬١٤٢", "Arabic-Indic grouped");
ok(/Nov/.test(fmtDate(new Date(2026, 10, 19))), "English date has the month name");
eq(new Intl.DateTimeFormat(locale("ar", "latn"), { month: "long" }).format(new Date(2026, 10, 19)), "نوفمبر", "Arabic month name (Gregorian)");
eq(new Intl.NumberFormat(locale("ar", "arab")).format(42), "٤٢", "Arabic-Indic digits");
eq(new Intl.NumberFormat(locale("ar", "latn")).format(42), "42", "Western digits in Arabic");
ok(new Intl.RelativeTimeFormat(locale("ar", "latn"), { numeric: "auto" }).format(-2, "minute").includes("دقيقتين"), "Arabic relative time uses the dual");
eq(fmtRelative(Date.now() - 10_000), "just now", "relative: just now");
ok(/minutes? ago/.test(fmtRelative(Date.now() - 5 * 60_000)), "relative: minutes ago");

// ------------------------------------------------------------------ placeholders in Arabic entries
for (const [k, v] of Object.entries(AR)) {
  const want = new Set([...k.matchAll(/\{(\w+)\}/g)].map((m) => m[1]));
  const vals = typeof v === "string" ? [v] : Object.entries(v).filter(([c]) => c === "other" || c === "few" || c === "many").map(([, s]) => s!);
  for (const s of vals) for (const m of s.matchAll(/\{(\w+)\}/g)) ok(want.has(m[1]), `Arabic entry for "${k}" uses unknown placeholder {${m[1]}}`);
  if (typeof v === "string" && /\|/.test(k)) ok(false, `plural key "${k}" should have an object of plural forms`);
}

// ------------------------------------------------------------------ coverage report
const ROOT = join(import.meta.dirname, "..");
const files: string[] = [];
(function walk(d: string) {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) { if (f !== "i18n") walk(p); }
    else if (/\.(tsx?|mts)$/.test(f) && !/i18n\.ts$/.test(f)) files.push(p);
  }
})(join(ROOT, "src"));
const CALL = /(?<![\w.$])(t|tx|tk|tr)\(\s*(["'`])((?:\\.|(?!\2)[^\\])*)\2\s*[,)]/g;
const used = new Map<string, string>();
for (const f of files) {
  const src = readFileSync(f, "utf8");
  if (!/from "[./]*(lib\/)?i18n"|from "[./]*(components\/)?ws-dir"|from "\.\/ws-dir"/.test(src)) continue;
  for (const m of src.matchAll(CALL)) {
    if (m[2] === "`" && m[3].includes("${")) continue; // template with expressions: not a literal key
    const key = m[3].replace(/\\(["'`\\])/g, "$1").replace(/\\n/g, "\n");
    if (!used.has(key)) used.set(key, relative(ROOT, f));
  }
}
const missing = [...used].filter(([k]) => !(k in AR) && !/^[\s\d\W]*$/.test(k));
console.log(`coverage: ${used.size} keys used in ${files.length} files, ${Object.keys(AR).length} Arabic entries, ${missing.length} without an Arabic entry`);
for (const [k, f] of missing.slice(0, 200)) console.log(`  missing: ${JSON.stringify(k)}  (${f})`);
eq(missing.length, 0, "every t() key has an Arabic entry");

console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
