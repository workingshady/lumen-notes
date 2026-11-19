// Dev simulator scenario "r5-chat": Ask as a chat + AI tutor (round 5). Builds on "Organize & connect (round 4)" (its
// CS231n / CS224n / Karpathy lessons and the "AI Engineer path") and adds chat threads + tutor sessions (kind "chat").
// Turn Dev panel › AI to "mock" (or stay signed out in demo: the mock answers too) to try new turns.
import type { ChatMessage, ChatThread } from "../../../shared/types";
import { emptyVault, MIN, type Vault } from "./kit";
import { seedR4Organize } from "./scenarios-r4-organize";

let seq = 0;
const m = (role: ChatMessage["role"], text: string, at: number, p: Partial<ChatMessage> = {}): ChatMessage => ({ id: `r5c-m${++seq}`, role, text, at, ...p });
const src = (n: number, noteId: string, title: string, text: string, heading?: string) => ({ n, noteId, title, text, ...(heading ? { heading } : {}) });

export async function seedR5Chat(v: Vault = emptyVault()): Promise<Vault> {
  await seedR4Organize(v);
  const now = Date.now();
  const ago = (min: number) => now - min * MIN;
  const thread = (p: Partial<ChatThread> & { id: string; title: string; messages: ChatMessage[] }): ChatThread => ({
    mode: "ask", scope: { kind: "vault" }, pinned: 0, createdAt: p.messages[0]?.at ?? now, updatedAt: p.messages[p.messages.length - 1]?.at ?? now, deleted: 0, dirty: 0, ...p,
  });
  const att = src(1, "r4o-l-att", "Attention", "Attention lets each token look at every other token and weigh them by relevance: softmax(QK^T/sqrt(d))V.");
  const tb = src(2, "r4o-l-tb", "Transformer block", "A transformer block = multi-head self-attention + MLP, each with a residual connection and layer norm.");
  const adamw = src(1, "r4o-l-adamw", "AdamW", "Adam with decoupled weight decay. Compare [[Gradient descent]].");
  const gd = src(2, "r4o-l-gd", "Gradient descent", "Step against the gradient of the loss; the learning rate sets the step size.");

  // A long thread whose older turns are already summarized ("Earlier messages summarized").
  const long: ChatMessage[] = [];
  const qs = ["What is attention?", "Why divide by sqrt(d)?", "And multi-head?", "How does it fit in a transformer block?", "What does the residual do there?", "Compare that to ResNet"];
  qs.forEach((q, i) => {
    long.push(m("user", q, ago(300 - i * 20)));
    long.push(m("assistant", i % 2 ? `Your notes say the residual path keeps gradients flowing [2]; attention mixes information across tokens [1].` : `Attention weighs every token by relevance [1]. In a transformer block it sits before the MLP [2].`, ago(299 - i * 20), {
      sources: [att, tb], ...(i > 0 ? { rewrite: `${q.replace(/[?]$/, "")} · attention transformer` } : {}), ...(i === qs.length - 1 ? { followups: ["How do skip connections help optimization?", "Where is layer norm applied?", "What breaks without residuals?"] } : {}),
    }));
  });

  v.chats = [
    thread({ id: "r5c-t-adamw", title: "AdamW vs Adam", pinned: 1, scope: { kind: "path", pathId: "r4o-path" }, messages: [
      m("user", "What is AdamW?", ago(90)),
      m("assistant", "AdamW is Adam with **decoupled weight decay** [1]: the decay is applied to the weights directly instead of being folded into the gradient. Plain gradient descent just steps against the gradient [2].", ago(89), { sources: [adamw, gd], feedback: 1 }),
      m("user", "And how does that compare to Adam?", ago(80)),
      m("assistant", "Your notes only say AdamW decouples weight decay from the gradient step [1]; they don't describe Adam's own L2 behaviour.", ago(79), { sources: [adamw, gd], rewrite: "AdamW vs Adam weight decay", followups: ["Why does decoupling weight decay matter?", "Which learning rate works for AdamW?", "Compare AdamW with SGD + momentum"] }),
    ] }),
    thread({ id: "r5c-t-long", title: "Attention, step by step", messages: long, summary: "- Asked what attention is and why scores are divided by sqrt(d)\n- Covered multi-head attention and where it sits in a transformer block", summarized: 6 }),
    thread({ id: "r5c-t-none", title: "Who invented the Transformer?", messages: [
      m("user", "Who invented the Transformer?", ago(40)),
      m("assistant", "", ago(40), { empty: "none" }),
    ] }),
    thread({ id: "r5c-t-general", title: "Kernel trick", messages: [
      m("user", "Explain the kernel trick", ago(30)),
      m("assistant", "In general terms, the kernel trick computes inner products in a high-dimensional feature space without building that space.", ago(29), { general: 1, feedback: -1 }),
    ] }),
    thread({ id: "r5c-t-ar", title: "اشرح آلية الانتباه", scope: { kind: "vault" }, messages: [
      m("user", "اشرح آلية الانتباه باختصار", ago(20)),
      m("assistant", "آلية الانتباه (attention) تجعل كل رمز ينظر إلى بقية الرموز ويزنها حسب الصلة [1]، وتأتي داخل transformer block قبل الـ MLP [2].", ago(19), { sources: [att, tb] }),
    ] }),
    // tutor sessions (history in the Attention concept sheet)
    thread({ id: "r5c-tu-explain", title: "Attention", mode: "explain", scope: { kind: "path", pathId: "r4o-path" }, pathId: "r4o-path", conceptKey: "attention", messages: [
      m("assistant", "**The idea**\n\nEach token looks at every other token and weighs them by relevance [1].", ago(600), { tutor: { kind: "step", i: 1, of: 2 } }),
      m("assistant", "**How it fits**\n\nAttention is the first half of a transformer block [2].", ago(598), { tutor: { kind: "step", i: 2, of: 2 } }),
      m("assistant", "What does attention compute for each token?", ago(597), { tutor: { kind: "question", i: 1, of: 1 } }),
      m("user", "a weighted mix of the other tokens by relevance", ago(596)),
      m("assistant", "Right: that matches your notes [1].", ago(595), { tutor: { kind: "feedback", verdict: "correct" } }),
      m("assistant", "", ago(594), { tutor: { kind: "summary" } }),
    ], tutor: { v: 1, mode: "explain", phase: "summary", steps: [{ title: "The idea", text: "…" }, { title: "How it fits", text: "…" }], step: 1, retries: 0, checks: [{ q: "What does attention compute for each token?", answer: "A weighted mix of other tokens by relevance." }], check: 0, q: null, asked: 0, hint: 0, tries: 0, reviews: [], results: [1],
      summary: { right: ["You can say what attention computes."], gaps: ["Why scores are scaled by sqrt(d)."], cards: [{ q: "What does attention compute?", a: "A relevance-weighted mix of the other tokens." }, { q: "Why scale by sqrt(d)?", a: "To keep softmax inputs from growing with dimension." }, { q: "Where is attention in a transformer block?", a: "Before the MLP, with a residual + layer norm." }], score: 1, passed: true } } }),
    thread({ id: "r5c-tu-socratic", title: "Attention", mode: "socratic", scope: { kind: "path", pathId: "r4o-path" }, pathId: "r4o-path", conceptKey: "attention", messages: [
      m("assistant", "If every token could look at every other token, what would it need to decide?", ago(200), { tutor: { kind: "question", i: 1, of: 4 } }),
      m("user", "which ones to copy", ago(199)),
      m("assistant", "You're close: what's missing?", ago(198), { tutor: { kind: "feedback", verdict: "partly" } }),
      m("assistant", "Look at Attention.", ago(197), { tutor: { kind: "hint", i: 1 } }),
    ], tutor: { v: 1, mode: "socratic", phase: "question", steps: [], step: 0, retries: 0, checks: [], check: 0, q: { q: "If every token could look at every other token, what would it need to decide?", hints: ["Look at Attention.", "It's about relevance weights."], answer: "How relevant each other token is (the attention weights) [1]." }, asked: 1, hint: 1, tries: 1, reviews: [], results: [], summary: null } }),
    thread({ id: "r5c-tu-feynman", title: "Backpropagation", mode: "feynman", scope: { kind: "path", pathId: "r4o-path" }, pathId: "r4o-path", conceptKey: "backpropagation", messages: [
      m("assistant", "Explain **Backpropagation** in your own words, as if to a friend who has never heard of it.", ago(1500), { tutor: { kind: "step" } }),
      m("user", "Backprop uses the Jacobian to push the loss backwards so each weight gets its gradient.", ago(1490)),
      m("assistant", "Fix the quoted parts and explain it again.", ago(1489), { tutor: { kind: "review", score: 62, reasons: [{ label: "Accuracy", score: 80, note: "Nothing contradicts your notes." }, { label: "Completeness", score: 45, note: "The chain rule isn't mentioned." }, { label: "Clarity", score: 60, note: "One undefined term." }], issues: [{ quote: "Jacobian", kind: "jargon", comment: "You use “Jacobian” without saying what it means." }, { quote: "push the loss backwards", kind: "gap", comment: "Say how: the chain rule multiplies local derivatives layer by layer [1]." }] } }),
    ], tutor: { v: 1, mode: "feynman", phase: "explain", steps: [], step: 0, retries: 0, checks: [], check: 0, q: null, asked: 0, hint: 0, tries: 0, reviews: [62], results: [], summary: null } }),
  ];
  return v;
}
