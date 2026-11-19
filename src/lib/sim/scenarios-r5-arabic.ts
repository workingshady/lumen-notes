// Dev simulator scenario "r5-arabic": the Arabic interface artboards (design R5-25). Builds on "Organize & connect
// (round 4)" (AI Engineer path, lessons, cards) and adds an Arabic course space with mixed Arabic / English notes:
// «الانتشار العكسي» (callout, formula, table with numeric cells), "Backprop, by hand" (English + code in Split),
// Arabic flashcards. Switch Settings › Appearance › Language to العربية (and Numbers to ٠١٢٣) to check mirroring.
import { cardsFor, clock, emptyVault, folder, HOUR, DAY, note, space, type Vault } from "./kit";
import { seedR4Organize } from "./scenarios-r4-organize";

export async function seedR5Arabic(v: Vault = emptyVault()): Promise<Vault> {
  await seedR4Organize(v);
  const c = clock();
  const now = Date.now();
  const S = "r5a-s";
  v.spaces.push(space({ id: S, name: "مهندس ذكاء اصطناعي", kind: "course", icon: "glyph:path", color: "#B48EF0", sort: 0, description: "مسار تعلّم" }));
  const F = ["٠١ أسس الرياضيات", "٠٢ أساسيات التعلّم الآلي", "٠٣ التعلّم العميق", "٠٤ معالجة اللغة"];
  const colors = ["#5CC8C2", "#F2A93B", "#B48EF0", "#6BCB8B"];
  F.forEach((name, i) => v.folders.push(folder({ id: `r5a-f${i + 1}`, spaceId: S, name, color: colors[i], sort: i + 1 })));
  const dl = "r5a-f3";
  const notes = [
    note({ id: "r5a-backprop", title: "الانتشار العكسي", space: S, folder: dl, type: "lesson", status: "learning", updated: now - HOUR, text:
`الانتشار العكسي (backpropagation) هو تطبيق قاعدة السلسلة من الخسارة رجوعًا إلى كل وزن. كل عقدة تحتاج فقط إلى تدرّجها المحلي والتدرّج القادم من الأعلى.

> [!tip] نصيحة
> خزّن التنشيطات في الانتشار الأمامي.

$$\\partial L/\\partial w = \\partial L/\\partial a \\cdot \\partial a/\\partial z \\cdot \\partial z/\\partial w$$

| دالة التنشيط | المشتقة | النطاق |
|---|---|---|
| سيغمويد | \`σ(1-σ)\` | (0, 1) |
| ReLU | \`0 or 1\` | [0, ∞) |
| GELU | \`≈ smooth\` | ≈[-0.17, ∞) |

ما الذي يحتاجه كل عقدة؟ :: تدرّجها المحلي والتدرّج القادم من الأعلى.
` }),
    note({ id: "r5a-byhand", title: "Backprop, by hand", space: S, folder: dl, type: "lesson", status: "review", updated: now - DAY, text:
`Backpropagation is the chain rule applied from the loss back to every weight.

\`\`\`python
dw = dz * x
\`\`\`
` }),
    note({ id: "r5a-adamw", title: "AdamW", space: S, folder: dl, type: "lesson", status: "mastered", updated: now - 2 * DAY, text: "Decoupled weight decay: the decay is applied to the weights, not folded into the gradient.\n" }),
    note({ id: "r5a-bn", title: "التطبيع الدفعي", space: S, folder: dl, type: "lesson", status: "todo", updated: now - 3 * DAY, text: "يثبّت توزيع التنشيطات بين الطبقات.\n" }),
    note({ id: "r5a-dropout", title: "Dropout in practice", space: S, folder: dl, type: "lesson", updated: now - 7 * DAY, text: "Randomly zero activations at train time.\n" }),
    note({ id: "r5a-init", title: "تهيئة الأوزان", space: S, folder: dl, type: "lesson", updated: now - 10 * DAY, text: "لماذا لا نبدأ بأصفار؟ لأن كل الوحدات ستتعلّم الشيء نفسه.\n" }),
    note({ id: "r5a-bpe", title: "Tokenization (BPE)", space: S, folder: "r5a-f4", type: "lesson", status: "learning", updated: now - DAY - HOUR, text: "Merge the most frequent pair of symbols, repeat.\n" }),
    note({ id: "r5a-idafa", title: "الإضافة في اللغة العربية", space: S, folder: "r5a-f4", type: "lesson", status: "review", updated: now - 4 * DAY, text:
`الإضافة: اسمان متتاليان، الثاني يحدّد الأول.

المضاف إليه دائمًا :: مجرور.
ما مثال الإضافة؟ :: كتابُ الطالبِ.
` }),
    note({ id: "r5a-linalg", title: "المتجهات والمعايير", space: S, folder: "r5a-f1", type: "lesson", status: "mastered", updated: now - 12 * DAY, text: "المعيار يقيس طول المتجه.\n" }),
    note({ id: "r5a-loss", title: "دوال الخسارة", space: S, folder: "r5a-f2", type: "lesson", status: "learning", updated: now - 6 * DAY, text: "الخسارة تقيس بُعد التوقّع عن الحقيقة.\n" }),
  ];
  v.notes.push(...notes);
  v.cards.push(...cardsFor(notes, c, (i) => (i % 3 === 2 ? "later" : "due")));
  return v;
}
