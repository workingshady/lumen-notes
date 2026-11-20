import type { Catalog } from "../../lib/i18n";

/** Arabic: round-7 fix wave for the architecture studio, canvas and export (docs/audit/r7-arch-canvas-export.md). */
export const ar: Catalog = {
  // export dialog: architecture formats
  "Lumen code": "كود Lumen", "from ERD": "من مخطط الكيانات", "MD + table": "MD + جدول", components: "المكوّنات",
  "Groups become groups, junctions stay. Positions are not kept; Mermaid lays out by itself.": "تبقى المجموعات مجموعات والوصلات كما هي. لا تُحفظ المواضع؛ يرتّب Mermaid المخطط بنفسه.",
  "Show in Files": "عرض في الملفات", "1 page": "صفحة واحدة",
  // data-loss guard
  "1 item couldn't be read": "تعذّرت قراءة عنصر واحد", "{n} items couldn't be read": "تعذّرت قراءة {n} من العناصر",
  "Restore from History": "استعادة من السجل",
  "This canvas couldn't be read, so nothing is saved until you edit it.": "تعذّرت قراءة هذا الكانفاس، لذا لن يُحفظ شيء حتى تعدّله.",
  "This diagram couldn't be read.": "تعذّرت قراءة هذا المخطط.",
  "Nothing is saved over it. Restore an earlier version from History.": "لن يُحفظ شيء فوقه. استعد نسخة سابقة من السجل.",
  // C4, AI, library, properties
  "Double-click a container to go one level deeper": "انقر مرتين على حاوية للنزول مستوى أعمق",
  "The AI needs sync unlocked: open Settings → Sync and sign in. Your diagram is unchanged.": "يحتاج الذكاء الاصطناعي إلى فتح المزامنة: افتح الإعدادات ← المزامنة وسجّل الدخول. لم يتغيّر مخططك.",
  "The AI is turned off for this account (Settings → AI).": "الذكاء الاصطناعي متوقف لهذا الحساب (الإعدادات ← الذكاء الاصطناعي).",
  "Library: shapes, node kinds, stamps, icons": "المكتبة: أشكال وأنواع عُقد وأختام وأيقونات",
  "Cards + node kinds": "بطاقات + أنواع العُقد",
  "Collapsed · {n} inside": "مطويّة · {n} بداخلها",
};
