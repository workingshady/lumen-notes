import type { Catalog } from "../../lib/i18n";

/** Arabic: shared library, connector / shape-style / text / sticky popovers, stamps and icon insert (round 7, W2-B). */
export const ar: Catalog = {
  // tabs, header
  Library: "المكتبة", Drawing: "الرسم", Stamps: "الأختام", Icons: "الأيقونات", Architecture: "المعمارية", "Architecture first": "المعمارية أولاً", "Drawing first": "الرسم أولاً", All: "الكل", Customise: "تخصيص",
  "Search {n} shapes…": "ابحث في {n} شكلاً…", "Search shapes, stamps, icons…": "ابحث عن أشكال وأختام وأيقونات…", "Search the library": "البحث في المكتبة", Clear: "مسح",
  "Results · {n}": "النتائج · {n}", "Nothing matches “{q}”.": "لا شيء يطابق «{q}».", Recent: "الأخيرة", Favourites: "المفضلة", "drag to reorder": "اسحب لإعادة الترتيب",
  // drawing items and categories
  Rectangle: "مستطيل", Rounded: "مستدير", Ellipse: "بيضاوي", Diamond: "معيّن", Triangle: "مثلث", Hexagon: "سداسي", Star: "نجمة", "Parallel.": "متوازي", Trapezoid: "شبه منحرف", Cylinder: "أسطوانة", Cloud: "سحابة", Heart: "قلب", Speech: "فقاعة", Callout: "تعليق",
  Process: "عملية", Decision: "قرار", Terminator: "بداية/نهاية", Data: "بيانات", Document: "مستند", "Multi-doc": "مستندات", Database: "قاعدة بيانات", Manual: "إدخال يدوي", Delay: "تأخير", Class: "صنف", Actor: "فاعل", Package: "حزمة", "Mind map": "خريطة ذهنية", Frame: "إطار", Section: "قسم",
  Axes: "محاور", Venn: "فن", "Number line": "خط الأعداد", Timeline: "خط زمني", "Cornell notes": "ملاحظات كورنيل", Table: "جدول",
  Basic: "أساسية", Flowchart: "مخطط انسيابي", UML: "UML", Containers: "حاويات", "Math & study templates": "قوالب الرياضيات والدراسة",
  Generic: "عام", Compute: "حوسبة", Network: "شبكة", Messaging: "مراسلة", "AI / ML": "ذكاء اصطناعي", Security: "أمان", Clients: "عملاء", Kubernetes: "كوبرنتس", SaaS: "SaaS", Boundaries: "حدود",
  // architecture items
  Service: "خدمة", Server: "خادم", Function: "دالة", Container: "حاوية", Pod: "Pod", Worker: "عامل", Scheduler: "مجدول", Desktop: "سطح المكتب", Cache: "ذاكرة مؤقتة", Bucket: "سلة", Warehouse: "مستودع", Lake: "بحيرة", "Vector DB": "قاعدة متجهات", Search: "بحث", File: "ملف", Logs: "سجلات", Metrics: "مقاييس",
  Gateway: "بوابة", "Load balancer": "موازن حمل", CDN: "CDN", DNS: "DNS", API: "API", Firewall: "جدار ناري", Internet: "الإنترنت", "On-prem": "محلي", Webhook: "ويب هوك", Queue: "طابور", Topic: "موضوع", Stream: "تدفق", Email: "بريد", SMS: "رسائل",
  Model: "نموذج", GPU: "GPU", LLM: "LLM", Embedding: "تضمين", Notebook: "دفتر", Registry: "سجل", "Feature store": "مخزن الميزات", Etl: "ETL", Monitoring: "مراقبة", Key: "مفتاح", Shield: "درع", Vault: "خزنة", Identity: "هوية", Alert: "تنبيه", Trust: "ثقة",
  Browser: "متصفح", Mobile: "جوال", User: "مستخدم", Team: "فريق", Cluster: "عنقود", Namespace: "مساحة أسماء", CI: "CI", Payment: "دفع", Repo: "مستودع", Text: "نص", Note: "ملاحظة", Image: "صورة", "Note card": "بطاقة ملاحظة", "Diagram card": "بطاقة مخطط",
  "User / actor": "مستخدم / فاعل", External: "خارجي", "Web client": "عميل ويب", "Mobile client": "عميل جوال", Junction: "تقاطع", Region: "منطقة", VPC: "VPC", Subnet: "شبكة فرعية", Zone: "نطاق", Account: "حساب",
  // stamps and icon insert
  Check: "صح", Cross: "خطأ", Question: "سؤال", Important: "مهم", Idea: "فكرة", Warning: "تحذير", Flag: "علم", Pin: "دبوس", Pointer: "مؤشر", "See note": "انظر الملاحظة",
  "Insert icon": "إدراج أيقونة", "Search {n} glyphs…": "ابحث في {n} رمزاً…", "Search glyphs": "البحث في الرموز",
  Preparation: "تحضير", Connector: "موصل",
  Redis: "Redis", "Read replica": "نسخة قراءة",
  Study: "دراسة", Tools: "أدوات", Status: "الحالة", "Stamps and icons": "الأختام والأيقونات", Stamp: "ختم",
  "Vendor icons (AWS · Azure · GCP)": "أيقونات الموردين (AWS · Azure · GCP)", "Vendor packs load on demand and are shown unmodified, never recoloured.": "تُحمَّل حزم الموردين عند الطلب وتظهر دون تعديل ولا إعادة تلوين.",
  "No vendor pack is loaded yet. Pick one under Customise › Vendor icons.": "لم تُحمَّل أي حزمة بعد. اختر واحدة من تخصيص › أيقونات الموردين.",
  Numbered: "مرقّمة", "next: {n}": "التالي: {n}", "Numbers auto-increment as you stamp. See note links the stamp to a note.": "تزداد الأرقام تلقائياً مع كل ختم. «انظر الملاحظة» تربط الختم بملاحظة.",
  "Link the stamp to a note": "اربط الختم بملاحظة", Cancel: "إلغاء", "Find a note…": "ابحث عن ملاحظة…", "No notes match.": "لا ملاحظات مطابقة.", "{n} glyphs": "{n} رمزاً", "Show more · {n} left": "عرض المزيد · بقي {n}",
  Colour: "اللون", "applies to the selected icon": "يطبَّق على الأيقونة المحددة", "Text colour": "لون النص", "Icons stay editable: select one and pick a colour to recolour it.": "تبقى الأيقونات قابلة للتعديل: حدد واحدة واختر لوناً لإعادة تلوينها.",
  "Categories, order, vendor packs": "الفئات والترتيب وحزم الموردين", "{n} icons loaded, unmodified.": "تم تحميل {n} أيقونة دون تعديل.", "No .svg files found.": "لم يُعثر على ملفات ‎.svg.",
  Categories: "الفئات", "drag to reorder · click to hide": "اسحب لإعادة الترتيب · انقر للإخفاء", "Star a shape in the library to keep it here.": "ضع نجمة على شكل في المكتبة ليبقى هنا.",
  "Order per workspace": "الترتيب لكل مساحة عمل", "{tab} first": "{tab} أولاً", "Click to change which tab opens first": "انقر لتغيير التبويب الذي يفتح أولاً", "Every category is reachable from every workspace.": "كل فئة متاحة من كل مساحة عمل.",
  Whiteboard: "السبورة", Board: "اللوحة", Canvas: "الكانفاس",
  "Vendor icons": "أيقونات الموردين", "Show vendor icon packs": "إظهار حزم أيقونات الموردين", "Loaded · {n}": "محمّلة · {n}", "Load .svg files…": "تحميل ملفات ‎.svg…",
  "Loaded on demand and shown exactly as published: never recoloured or edited, per each vendor’s terms. Pick the pack’s own .svg files; they stay on this device.": "تُحمَّل عند الطلب وتظهر كما نُشرت تماماً: دون إعادة تلوين أو تعديل وفق شروط كل مورد. اختر ملفات ‎.svg الخاصة بالحزمة؛ تبقى على هذا الجهاز.",
  "Back to library": "العودة إلى المكتبة", "Pack removed.": "أُزيلت الحزمة.", "Remove {name}": "إزالة {name}",
  // connector
  Path: "المسار", Style: "النمط", Width: "السماكة", Thin: "رفيع", Regular: "عادي", Bold: "عريض", Custom: "مخصص", Label: "تسمية", "“refracts”": "«ينكسر»", "Bound to shapes": "مرتبط بالأشكال", "Bound arrows follow their shapes when they move.": "تتبع الأسهم المرتبطة أشكالها عند تحريكها.",
  "Start head": "رأس البداية", "End head": "رأس النهاية", "Crow’s-foot heads are for ERDs (one, many, one-or-many).": "رؤوس قدم الغراب لمخططات ERD (واحد، متعدد، واحد أو أكثر).", Line: "خط", "Path · heads · style": "المسار · الرؤوس · النمط",
  Straight: "مستقيم", Curved: "منحنٍ", Elbow: "مرفقي", Solid: "متصل", Dashed: "متقطع", Dotted: "منقط", None: "بلا", Arrow: "سهم", "Tri. outline": "مثلث مفرغ", Bar: "شريط", Dot: "نقطة", "Dot outline": "نقطة مفرغة", "Dia. outline": "معيّن مفرغ", One: "واحد", Many: "متعدد", "One or many": "واحد أو أكثر",
  // shape style
  Fill: "التعبئة", Stroke: "الحد", "Fill & stroke": "التعبئة والحد", Hachure: "تظليل", Zigzag: "متعرج", Dots: "نقاط", Later: "لاحقاً", Sloppiness: "الخشونة", Architect: "مهندس", Artist: "فنان", Cartoonist: "كرتوني", Edges: "الحواف", Sharp: "حادة", Round: "مستديرة", Opacity: "الشفافية", Look: "المظهر",
  // text, sticky
  Font: "الخط", Size: "الحجم", "Font size": "حجم الخط", Hand: "يد", Sans: "سانس", Serif: "سيريف", Code: "كود", Arabic: "عربي", left: "يسار", center: "وسط", right: "يمين", top: "أعلى", middle: "منتصف", bottom: "أسفل",
  "Background highlight": "تمييز الخلفية", Link: "رابط", "Remove link": "إزالة الرابط", Paper: "الورق", "Palette colours": "ألوان اللوحة", "Lumen ink": "حبر لومن", "Stack stickies": "تكديس الملاحظات اللاصقة", "{n} in pile": "{n} في الكومة",
  "Show author and device": "إظهار الكاتب والجهاز", Sticky: "ملاحظة لاصقة", "Drawn as Lumen glyphs; recolourable": "تُرسم برموز لومن؛ قابلة لإعادة التلوين",
};
