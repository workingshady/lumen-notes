import type { Catalog } from "../../lib/i18n";

/** Arabic: round 6 note list (filter chips, multi-select), tags (tag page, ⋯ menu, picker) and the history panel. */
export const ar: Catalog = {
  // ---- note list (NoteList.tsx, note-list-desk.tsx)
  "Sort:": "الترتيب:", "Group:": "التجميع:", "This month": "هذا الشهر", "all spaces": "كل المساحات", "Back to the whole space": "العودة إلى المساحة كلها",
  "Leave select mode (Esc)": "إنهاء وضع التحديد (Esc)", "Select notes (or shift-click a note)": "تحديد ملاحظات (أو Shift مع النقر على ملاحظة)",
  "Remove filter {f}": "إزالة التصفية {f}", "Nothing matches {filter} in {where} yet.": "لا شيء يطابق {filter} في {where} بعد.", "Search all spaces": "البحث في كل المساحات",
  "{n} selected": "{n} محددة", "Delete selected notes": "حذف الملاحظات المحددة", "Add a tag to {n} notes": "إضافة وسم إلى {n} ملاحظات", "Tag name": "اسم الوسم",
  "Move {n} notes to": "نقل {n} ملاحظات إلى", "Tagged {n} notes #{tag}": "وُسمت {n} ملاحظات بـ ‎#{tag}", "Moved {n} notes to {name}": "نُقلت {n} ملاحظات إلى {name}",
  "Moved {n} notes to Trash": "نُقلت {n} ملاحظات إلى سلة المهملات",
  // ---- tags (TagPage.tsx, TagPicker.tsx)
  "Rename…": "إعادة تسمية…", "Merge into…": "دمج في…", "Move under…": "نقل تحت…", "Save as smart folder": "حفظ كمجلد ذكي", "Delete tag": "حذف الوسم",
  "Merged #{from} into #{to} · {n} notes": "دُمج ‎#{from} في ‎#{to} · {n} ملاحظات", "Moved #{from} to #{to} · {n} notes": "نُقل ‎#{from} إلى ‎#{to} · {n} ملاحظات",
  "Renamed #{from} to #{to} · {n} notes": "أُعيدت تسمية ‎#{from} إلى ‎#{to} · {n} ملاحظات", "Deleted #{tag} from {n} notes": "حُذف ‎#{tag} من {n} ملاحظات",
  "A tag can't move under itself": "لا يمكن نقل وسم تحت نفسه", "Rename #{tag}": "إعادة تسمية ‎#{tag}", "Merge #{tag} into…": "دمج ‎#{tag} في…", "Move #{tag} under…": "نقل ‎#{tag} تحت…",
  "Search tags": "البحث في الوسوم", "Every note that uses the tag is rewritten (body and front-matter). You can undo it.": "تُعاد كتابة كل ملاحظة تستخدم الوسم (النص والبيانات الأمامية). يمكنك التراجع.",
  "{n} child tag|{n} child tags": { zero: "بلا وسوم فرعية", one: "وسم فرعي واحد", two: "وسمان فرعيان", few: "{n} وسوم فرعية", many: "{n} وسمًا فرعيًا", other: "{n} وسم فرعي" },
  "used in {n} space|used in {n} spaces": { zero: "غير مستخدم في أي مساحة", one: "مستخدم في مساحة واحدة", two: "مستخدم في مساحتين", few: "مستخدم في {n} مساحات", many: "مستخدم في {n} مساحة", other: "مستخدم في {n} مساحة" },
  "More tag actions": "إجراءات أخرى للوسم", "Child tags": "الوسوم الفرعية", "No notes use #{tag} yet.": "لا توجد ملاحظات تستخدم ‎#{tag} بعد.",
  "Often used together": "يُستخدم معه غالبًا", "No other tags on these notes yet.": "لا وسوم أخرى على هذه الملاحظات بعد.",
  "Remove #{tag}": "إزالة ‎#{tag}", "Add tag": "إضافة وسم",
  // ---- history panel (HistoryPanel.tsx)
  "auto-save": "حفظ تلقائي", "Recently opened": "فُتحت مؤخرًا", "Save a named version now": "حفظ نسخة مسمّاة الآن", "Name this version": "تسمية هذه النسخة",
  Diff: "الفروق", "Version name": "اسم النسخة", "Notes you open on this device show up here.": "تظهر هنا الملاحظات التي تفتحها على هذا الجهاز.",
};
