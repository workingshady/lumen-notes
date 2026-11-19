import type { Catalog } from "../../lib/i18n";

/** Arabic: review (see docs/I18N.md). Keys are the English source strings. */
export const ar: Catalog = {
  // Grades and intervals (lib/fsrs.ts fmtInterval)
  Again: "مجددًا", Hard: "صعب", Good: "جيد", Easy: "سهل",
  "{n}m": "{n} د", "{n}h": "{n} س", "{n}d": "{n} ي", "{n}mo": "{n} ش", "{n}y": "{n} سنة",
  // Review session (components/Review.tsx)
  "{key} to show answer": "{key} لإظهار الإجابة",
  "Tap to show answer": "اضغط لإظهار الإجابة",
  "Show answer": "إظهار الإجابة",
  "Answer shown": "الإجابة ظاهرة",
  "Card {n} of {total} from this sentence": "البطاقة {n} من {total} من هذه الجملة",
  "No cards due. Next ones later today.": "لا بطاقات مستحقة. التالية في وقت لاحق اليوم.",
  "No cards due. Next ones tomorrow.": "لا بطاقات مستحقة. التالية غدًا.",
  "No cards due. Next ones in {n} day.|No cards due. Next ones in {n} days.": {
    one: "لا بطاقات مستحقة. التالية بعد يوم.", two: "لا بطاقات مستحقة. التالية بعد يومين.",
    few: "لا بطاقات مستحقة. التالية بعد {n} أيام.", many: "لا بطاقات مستحقة. التالية بعد {n} يومًا.", other: "لا بطاقات مستحقة. التالية بعد {n} يوم.",
  },
  "Card suspended · U to undo": "عُلّقت البطاقة · U للتراجع",
  "Close review": "إغلاق المراجعة",
  "Practice anyway": "تدرّب رغم ذلك",
  "No cards yet. Write Question :: Answer in any note.": "لا بطاقات بعد. اكتب سؤال :: إجابة في أي ملاحظة.",
  "Back to Home": "العودة إلى الرئيسية",
  "Session complete": "اكتملت الجلسة",
  "{n} card in {mins} min|{n} cards in {mins} min": {
    zero: "لا بطاقات في {mins} د", one: "بطاقة واحدة في {mins} د", two: "بطاقتان في {mins} د",
    few: "{n} بطاقات في {mins} د", many: "{n} بطاقة في {mins} د", other: "{n} بطاقة في {mins} د",
  },
  "streak now {n} day|streak now {n} days": {
    one: "سلسلة الأيام الآن يوم واحد", two: "سلسلة الأيام الآن يومان", few: "سلسلة الأيام الآن {n} أيام", many: "سلسلة الأيام الآن {n} يومًا", other: "سلسلة الأيام الآن {n} يوم",
  },
  "Hardest card": "أصعب بطاقة",
  "Next review": "المراجعة التالية",
  "Tomorrow · {n} card|Tomorrow · {n} cards": {
    one: "غدًا · بطاقة واحدة", two: "غدًا · بطاقتان", few: "غدًا · {n} بطاقات", many: "غدًا · {n} بطاقة", other: "غدًا · {n} بطاقة",
  },
  "Nothing due tomorrow": "لا شيء مستحق غدًا",
  "Redo {n} “Again” card|Redo {n} “Again” cards": {
    one: "إعادة بطاقة «مجددًا» واحدة", two: "إعادة بطاقتَي «مجددًا»", few: "إعادة {n} بطاقات «مجددًا»", many: "إعادة {n} بطاقة «مجددًا»", other: "إعادة {n} بطاقة «مجددًا»",
  },
  "Open note": "فتح الملاحظة",
  New: "جديدة",
  "{n} left in this deck · about {mins} min": "{n} متبقية في هذه المجموعة · نحو {mins} د",
  "{n} left in this session · about {mins} min": "{n} متبقية في هذه الجلسة · نحو {mins} د",
  "E edit card": "E تحرير البطاقة",
  "S suspend": "S تعليق",
  "U undo": "U تراجع",
  // lib/devices.ts, lib/native-biometric.ts
  "This device was signed out from another device. Unlock again to sync.": "سُجّل خروج هذا الجهاز من جهاز آخر. افتح القفل مجددًا للمزامنة.",
  "Unlock Lumen": "فتح قفل Lumen",
  "Use passcode": "استخدام رمز المرور",
};
