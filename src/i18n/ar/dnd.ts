import type { Catalog } from "../../lib/i18n";

/** Arabic: drag and drop (round 7, W2-C): ghost, hints, reasons, undo chip, duplicate file, Send to…, keyboard announcements. */
export const ar: Catalog = {
  "{n} note|{n} notes": { zero: "لا ملاحظات", one: "ملاحظة واحدة", two: "ملاحظتان", few: "{n} ملاحظات", many: "{n} ملاحظة", other: "{n} ملاحظة" },
  "{n} file|{n} files": { zero: "لا ملفات", one: "ملف واحد", two: "ملفان", few: "{n} ملفات", many: "{n} ملفاً", other: "{n} ملف" },
  "draggable item": "عنصر قابل للسحب",
  "{item}, picked up. Not over a drop target.": "{item}، تم الالتقاط. ليس فوق هدف إفلات.",
  "{item}, picked up. Over {target}.{hint}": "{item}، تم الالتقاط. فوق {target}.{hint}",
  "{item}: {reason}": "{item}: {reason}", "can't drop here": "لا يمكن الإفلات هنا",
  "{item}, picked up. Arrow keys move, Tab changes target, Enter drops, Escape cancels.": "{item}، تم الالتقاط. مفاتيح الأسهم للتحريك، Tab لتغيير الهدف، Enter للإفلات، Escape للإلغاء.",
  "Cancelled": "أُلغي", "Drop into {name}": "أفلت داخل {name}", "Shapes can’t drop onto a node": "لا يمكن إفلات الأشكال على عقدة",
  "Add as a node": "أضِف كعقدة", "+ Link to {name}": "+ ربط بـ {name}", "Append to {name}": "إلحاق بـ {name}", "+ Add as {name}’s link": "+ إضافة كرابط لـ {name}", "Attach to {name}": "إرفاق بـ {name}",
  "Added {name} · Undo": "أُضيف {name} · تراجع", "Linked {name} to {node} · Undo": "رُبط {name} بـ {node} · تراجع", "Appended to {name} · Undo": "أُلحق بـ {name} · تراجع",
  "Added link to {name} · Undo": "أُضيف رابط إلى {name} · تراجع", "Attached {name} · Undo": "أُرفق {name} · تراجع", "Attached to {name} · Undo": "أُرفق بـ {name} · تراجع",
  "Node": "عقدة", "text": "نص", "Architecture {name}": "معمارية {name}", "Canvas {name}": "لوحة {name}", "group": "مجموعة",
  "Shapes can’t drop onto a card": "لا يمكن إفلات الأشكال على بطاقة", "A canvas can’t contain itself": "لا يمكن للوحة أن تحتوي نفسها",
  "this card": "هذه البطاقة", "Add as a card": "أضِف كبطاقة", "This note is the canvas itself": "هذه الملاحظة هي اللوحة نفسها", "Alt: link instead of card": "Alt: رابط بدل بطاقة",
  "Linked {name} · Undo": "رُبط {name} · تراجع", "Appended to card · Undo": "أُلحق بالبطاقة · تراجع", "Added link · Undo": "أُضيف رابط · تراجع",
  "Added {n} cards · Undo": "أُضيفت {n} بطاقات · تراجع", "contents of {name}": "محتويات {name}", "from": "من", "Imported {name} · Undo": "استُورد {name} · تراجع",
  "adding…": "جارٍ الإضافة…", "Diagram file attached": "أُرفق ملف المخطط", "Undone": "تم التراجع", "Undo": "تراجع",
  "Use the existing attachment?": "استخدام المرفق الموجود؟", "{name} is already in this vault.": "{name} موجود بالفعل في هذه الخزنة.", "Upload again": "رفع من جديد", "Use it": "استخدمه",
  "← → ↑ ↓ move · Enter drop · Esc cancel": "← → ↑ ↓ تحريك · Enter إفلات · Esc إلغاء",
  "Send to. {n} places.": "إرسال إلى. {n} وجهات.", "Send to…": "إرسال إلى…", "Send {what} to…": "إرسال {what} إلى…", "Open here": "مفتوحة هنا",
  "That can’t be sent there": "لا يمكن الإرسال إلى هناك", "Board": "لوحة", "Canvas": "كانفاس", "Whiteboard": "سبورة",
  "No boards or canvases yet. Create one from New…": "لا توجد لوحات بعد. أنشئ واحدة من «جديد…»", "Cancel": "إلغاء",
  "Sent {name} to {board} · Undo": "أُرسل {name} إلى {board} · تراجع", "Import": "استيراد", "Added {n} items · Undo": "أُضيف {n} عناصر · تراجع",
  "Linked · Undo": "تم الربط · تراجع", "+ Link to this shape": "+ ربط بهذا الشكل", "Shape": "الشكل", "Untitled": "بلا عنوان",
};
