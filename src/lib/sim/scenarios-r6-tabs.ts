// Round 6 part A demo content (added to scenario "r5-chat"): the note tabs + Assistant (Lumen 31 · NoteTabsDesk).
// "Attention, explained" has 4 Mermaid diagrams + 1 graph-style map + a diagram image (Diagrams 6), videos / audio /
// a plain video link (Media 5), and web / video / PDF / note / broken links (Links); "Reading list · attention" has only
// links (R6-31L: only the Note + Links tabs). One Assistant conversation about √d (R6-31M).
import type { ChatMessage, ChatThread } from "../../../shared/types";
import { MIN, note, space, type Vault } from "./kit";

const HEADS = `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="480" height="300" viewBox="0 0 480 300"><rect width="480" height="300" fill="#f4f2ec"/>${Array.from({ length: 4 }, (_, h) => Array.from({ length: 6 }, (_, i) => Array.from({ length: 6 }, (_, j) => `<rect x="${20 + h * 115 + j * 16}" y="${60 + i * 16}" width="15" height="15" fill="#F2A93B" fill-opacity="${(((h + 1) * (i + 2) * (j + 3)) % 10) / 10 + 0.05}"/>`).join("")).join("")).join("")}<text x="240" y="40" font-family="Inter" font-size="16" text-anchor="middle" fill="#1f1d1a">Attention heads · layer 5</text><text x="240" y="230" font-family="Inter" font-size="12" text-anchor="middle" fill="#6a655c">head 1 · head 2 · head 3 · head 4</text></svg>`)}`;

export const R6_ATT = `---
tags: [nlp, llm]
---
# Attention, explained

Attention lets every token look at every other token and decide how much each one matters. The √d scaling keeps the softmax from saturating when vectors are long.

https://www.youtube.com/watch?v=eMlx5fFNoYc
[03:10] Why attention, not RNNs
[08:42] The √d trick
[15:20] Multi-head
[21:05] Masking for decoding

Multi-head attention runs h of these in parallel with different projections, then concatenates them. See [[Softmax]] and [[Transformer block]], and the original paper [Attention is all you need](https://arxiv.org/abs/1706.03762) ([PDF](https://arxiv.org/pdf/1706.03762.pdf)).

## Encoder stack
\`\`\`mermaid
flowchart TD
  I[Input] --> E[Embedding]
  E --> P[+ Positional]
  P --> B[N× block]
  B --> O([Output])
\`\`\`

## Scaled dot-product attention
\`\`\`mermaid
flowchart LR
  Q[Q] --> M[MatMul]
  K[Kᵀ] --> M
  M --> S[Scale ÷ √d]
  S --> X[Softmax]
  X --> O[MatMul]
  V[V] --> O
\`\`\`

## Concept map · attention
\`\`\`mermaid
graph LR
  A((Attention)) --- S((Softmax))
  A --- E((Embeddings))
  A --- T((Transformer))
  A --- R((RAG))
\`\`\`

## Multi-head
\`\`\`mermaid
flowchart LR
  X[Input] --> H1[Head 1] & H2[Head 2] & H3[Head h]
  H1 & H2 & H3 --> C[Concat] --> W[Linear]
\`\`\`

## Masked decoding
\`\`\`mermaid
sequenceDiagram
  participant D as Decoder
  participant M as Mask
  D->>M: scores
  M-->>D: −∞ above the diagonal
\`\`\`

![Heads visualised · fig 3](${HEADS})

## Watch and listen

https://www.youtube.com/watch?v=kCc8FmEb1nY

![lecture-07-attention.m4a](https://upload.wikimedia.org/wikipedia/commons/4/40/Toreador_song_cleaned.ogg)

![entropy-per-layer.mp4](https://upload.wikimedia.org/wikipedia/commons/transcoded/c/c0/Big_Buck_Bunny_4K.webm/Big_Buck_Bunny_4K.webm.160p.webm)

A shorter take on the same idea: https://vimeo.com/76979871

## Reading

- [The Illustrated Transformer](https://jalammar.github.io/illustrated-transformer/), read it twice: https://jalammar.github.io/illustrated-transformer/
- [Lil'Log · Attention? Attention!](https://lilianweng.github.io/posts/2018-06-24-attention/)
- [Papers with Code · Scaled dot-product](https://paperswithcode.com/method/404-scaled-dot-product)
- Related notes: [[Embeddings]], [[Attention]], [[RAG]], [[Positional encoding]]
`;

export function seedR6Tabs(v: Vault) {
  const now = Date.now();
  v.spaces.push(space({ id: "r6a-s-ai", name: "AI Engineer", kind: "course", icon: "glyph:neural", color: "4", sort: 2, description: "Course" }));
  v.notes.push(
    note({ id: "r6a-n-att", title: "Attention, explained", space: "r6a-s-ai", body: R6_ATT, tags: ["nlp", "llm"], updated: now - 5 * MIN, pinned: 1 }),
    note({ id: "r6a-n-reading", title: "Reading list · attention", space: "r6a-s-ai", updated: now - 50 * MIN,
      text: "Papers and posts to read next.\n\n- [The Illustrated Transformer](https://jalammar.github.io/illustrated-transformer/)\n- [Attention is all you need](https://arxiv.org/abs/1706.03762)\n- [Lil'Log · Attention? Attention!](https://lilianweng.github.io/posts/2018-06-24-attention/)\n- Notes: [[Attention, explained]], [[Softmax]]\n" }),
    note({ id: "r6a-n-softmax", title: "Softmax", space: "r6a-s-ai", updated: now - 3 * 60 * MIN, text: "Softmax turns scores into probabilities: exp(x_i) / Σ exp(x_j). Large inputs saturate it: one value takes almost all the weight.\n" }),
    note({ id: "r6a-n-emb", title: "Embeddings", space: "r6a-s-ai", updated: now - 4 * 60 * MIN, text: "A learned vector per token.\n" }),
    note({ id: "r6a-n-vas", title: "Vaswani 2017 PDF", space: "r6a-s-ai", updated: now - 6 * 60 * MIN, text: "p. 4: “We suspect that for large values of d_k, the dot products grow large in magnitude, pushing the softmax function into regions where it has extremely small gradients. To counteract this effect, we scale the dot products by 1/√d_k.”\n" }),
  );
  let seq = 0;
  const m = (role: ChatMessage["role"], text: string, at: number, p: Partial<ChatMessage> = {}): ChatMessage => ({ id: `r6a-m${++seq}`, role, text, at, ...p });
  const th: ChatThread = {
    id: "r6a-t-sqrt", title: "Why divide by √d here?", mode: "ask", scope: { kind: "note", noteId: "r6a-n-att" }, noteId: "r6a-n-att", assistant: 1, pinned: 0,
    createdAt: now - 3 * MIN, updatedAt: now - 2 * MIN, deleted: 0, dirty: 0,
    messages: [
      m("user", "Why divide by √d here?", now - 3 * MIN),
      m("assistant", "Without it, dot products grow with the vector length d, so softmax pushes almost all weight onto one token and gradients vanish [1]. Dividing by √d keeps their variance near 1 [2].", now - 2 * MIN, {
        sources: [
          { n: 1, noteId: "r6a-n-att", title: "This note", heading: "“The √d scaling…”", text: "The √d scaling keeps the softmax from saturating when vectors are long." },
          { n: 2, noteId: "r6a-n-vas", title: "Vaswani 2017 PDF", heading: "p. 4", text: "we scale the dot products by 1/√d_k" },
        ],
      }),
    ],
  };
  v.chats = [...(v.chats ?? []), th];
  // the dead link, as a link check would have recorded it (2 Nov)
  try {
    const c = JSON.parse(localStorage.getItem("lumen.linkcheck") ?? "{}") as Record<string, { status: number; since: number }>;
    c["https://paperswithcode.com/method/404-scaled-dot-product"] = { status: 404, since: new Date(new Date().getFullYear(), 10, 2).getTime() };
    localStorage.setItem("lumen.linkcheck", JSON.stringify(c));
    localStorage.setItem("lumen.linkcheck.at.r6a-n-att", String(now));
    localStorage.setItem("lumen.linkcheck.at.r6a-n-reading", String(now));
  } catch { /* no storage (tests) */ }
  return v;
}
