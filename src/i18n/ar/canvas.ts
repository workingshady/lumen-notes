import type { Catalog } from "../../lib/i18n";

/** Arabic: canvas editor undo/redo, editing, toolbar overflow and shortcuts sheet (components/CanvasEditor.tsx, CanvasKeys.tsx). */
export const ar: Catalog = {
  Undo: "تراجع", Redo: "إعادة", "Undo ({keys})": "تراجع ({keys})", "Redo ({keys})": "إعادة ({keys})",
  Lock: "قفل", Align: "محاذاة", Unlocked: "أُلغي القفل",
  "Locked: can't be moved, resized or deleted": "مقفلة: لا يمكن نقلها أو تغيير حجمها أو حذفها",
  "Select the cards to lock first": "حدّد البطاقات المراد قفلها أولًا",
  "Locked {n} card|Locked {n} cards": { zero: "لم تُقفل أي بطاقة", one: "قُفلت بطاقة واحدة", two: "قُفلت بطاقتان", few: "قُفلت {n} بطاقات", many: "قُفلت {n} بطاقة", other: "قُفلت {n} بطاقة" },
  "Unlock selected cards ({keys})": "إلغاء قفل البطاقات المحددة ({keys})",
  "Lock selected cards: no moving, resizing or deleting ({keys})": "قفل البطاقات المحددة: بلا نقل أو تغيير حجم أو حذف ({keys})",
  "Align, distribute and order the selection": "محاذاة التحديد وتوزيعه وترتيب طبقاته",
  "Align left": "محاذاة لليسار", "Align centres (horizontal)": "محاذاة المراكز (أفقيًا)", "Align right": "محاذاة لليمين",
  "Align top": "محاذاة للأعلى", "Align middles (vertical)": "محاذاة المنتصف (عموديًا)", "Align bottom": "محاذاة للأسفل",
  "Distribute horizontally": "توزيع أفقي", "Distribute vertically": "توزيع عمودي",
  "Bring to front": "إحضار إلى الأمام", "Send to back": "إرسال إلى الخلف",
  "Select 2 or more cards to align": "حدّد بطاقتين أو أكثر للمحاذاة", "Select 3 or more cards to distribute": "حدّد ثلاث بطاقات أو أكثر للتوزيع",
  Edit: "تحرير", Copy: "نسخ", Cut: "قص", Paste: "لصق", "Duplicate cards": "تكرار البطاقات", "Duplicate canvas": "تكرار اللوحة",
  "Zoom to selection": "تكبير إلى التحديد", View: "عرض", "Snap to grid": "الالتقاط إلى الشبكة", Minimap: "خريطة مصغّرة",
  "Keyboard shortcuts": "اختصارات لوحة المفاتيح", "Canvas shortcuts": "اختصارات اللوحة",
  "Nothing to paste": "لا شيء للصقه", "Select cards first": "حدّد بطاقات أولًا",
  "Copied {n} card|Copied {n} cards": { zero: "لم تُنسخ أي بطاقة", one: "نُسخت بطاقة واحدة", two: "نُسخت بطاقتان", few: "نُسخت {n} بطاقات", many: "نُسخت {n} بطاقة", other: "نُسخت {n} بطاقة" },
  "More: tools, edit, view, convert, export": "المزيد: أدوات، تحرير، عرض، تحويل، تصدير",
  "More: edit, view, convert, export": "المزيد: تحرير، عرض، تحويل، تصدير",
  "Copy / cut / paste cards": "نسخ البطاقات / قصّها / لصقها", "Select all": "تحديد الكل", "Delete selected": "حذف المحدد",
  "Nudge (bigger step with Shift)": "تحريك بسيط (خطوة أكبر مع Shift)", "Lock / unlock": "قفل / إلغاء القفل",
  "Fit the board": "ملاءمة اللوحة", "Script console": "وحدة السكربت", "New text card": "بطاقة نص جديدة", "Double-click": "نقر مزدوج",
  "Select several": "تحديد عدة عناصر", "Shift click · Shift drag": "Shift مع النقر · Shift مع السحب",
};
