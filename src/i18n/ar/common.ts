import type { Catalog } from "../../lib/i18n";

/**
 * Arabic: shared terms decided once for the whole app. Merged LAST in ../ar.ts, so these win over area files
 * (several areas translated the same English word). Homonyms use a "@@context" key: `t("Area@@chart")`.
 */
export const ar: Catalog = {
  Share: "مشاركة", "Share@@proportion": "النسبة",
  Area: "مجال", "Area@@chart": "مساحي", "Area@@region": "منطقة",
  Blank: "فارغة", "Blank@@screen": "تعتيم",
  Group: "تجميع", "Group@@noun": "مجموعة",
  Link: "رابط", "Link@@verb": "ربط",
  Format: "التنسيق", "Format@@file": "الصيغة",
  None: "لا شيء", "To do": "للإنجاز", Number: "عدد", Line: "خط", Present: "تقديم",
  Mastered: "متقَن", Learning: "قيد التعلّم", Updated: "آخر تعديل", Created: "تاريخ الإنشاء", Reset: "إعادة تعيين", "{pct}%": "{pct}٪",
  Course: "مقرّر", Space: "مساحة", Folder: "مجلد", Note: "ملاحظة", Title: "العنوان", Flashcards: "البطاقات", Cards: "البطاقات", cards: "بطاقات",
  "Map of content": "خريطة محتوى", Roadmap: "خريطة طريق", Base: "قاعدة", View: "عرض", Summarize: "لخّص", Summary: "الملخّص",
  "Live preview": "معاينة حية", "Pause timer": "إيقاف المؤقّت مؤقتًا", "Resume timer": "استئناف المؤقّت", Colour: "اللون",
  "{n} MB": "{n} ميغابايت", "{n} KB": "{n} كيلوبايت",
};
