// Starter content for each diagram type (46A–46B) and the "Payments platform" demo diagram (46C).
import type { Note } from "../../shared/types";
import { applyDsl, parseDsl } from "./arch-dsl";
import { stringifyArch, type ArchCanvas, type ArchKind, type C4Level } from "./arch-model";
import { tk } from "./i18n";

export const DIAGRAM_TYPES: [kind: ArchKind, label: string, sub: string, glyph: string][] = [
  ["architecture", tk("Architecture"), tk("Drag"), "service"], ["flowchart", tk("Flowchart"), tk("Drag or code"), "process"], ["sequence", tk("Sequence"), tk("Code-first"), "actor"],
  ["erd", tk("ERD"), tk("Tables"), "crowfoot-many"], ["c4", tk("C4"), tk("Levels"), "c4-level"], ["network", tk("Network"), tk("Nested groups"), "subnet"],
  ["pipeline", tk("Data / ML pipeline"), tk("Drag"), "etl"], ["state", tk("State"), tk("Drag + code"), "s-learning"], ["class", tk("Class"), tk("Code-first"), "uml-class"],
  ["bpmn", tk("BPMN-lite"), tk("Swimlanes"), "kanban"], ["threat", tk("Threat model"), tk("STRIDE tags"), "threat"],
];

export const STARTER_DSL: Record<ArchKind, string> = {
  architecture: `direction right
// A starter: edit the code or drag on the canvas
Cloud [icon: region] {
  API [icon: service, tech: "FastAPI"]
  DB [icon: database, tech: "Postgres 16"]
  Queue [icon: queue]
  Worker [icon: function]
}
User [icon: user]
User > API: HTTPS
API > DB: SQL (data)
API > Queue: enqueue (async)
Queue > Worker (async)
`,
  flowchart: `direction down
Start [icon: terminator]
Input [icon: process, label: "Read input"]
Valid [icon: decision, label: "Valid?"]
Save [icon: process]
Error [icon: process, label: "Show error"]
Start > Input
Input > Valid
Valid > Save: yes
Valid > Error: no
`,
  sequence: `direction right
User [icon: user]
App [icon: browser]
API [icon: service]
DB [icon: database]
User > App: click Pay
App > API: POST /charge
API > DB: insert payment (data)
API > App: 201 Created
`,
  erd: `direction right
users [icon: database] {
  id int pk
  email text
  created_at timestamp
}
orders [icon: database] {
  id int pk
  user_id int fk
  total numeric
}
users > orders: user_id
`,
  c4: `direction down
Customer [icon: user, tech: "Person"]
Shop [icon: service, label: "Online shop", tech: "Software system"]
Payments [icon: external-system, tech: "External system"]
Customer > Shop: browses and buys
Shop > Payments: charges cards
`,
  network: `direction right
Region [icon: region, label: "eu-west-1"] {
  VPC [icon: vpc] {
    Public [icon: subnet] {
      LB [icon: load-balancer]
    }
    Private [icon: subnet] {
      App [icon: server]
      DB [icon: database]
    }
  }
}
Internet [icon: internet]
Internet > LB: HTTPS
LB > App
App > DB: SQL (data)
`,
  pipeline: `direction right
Sources [icon: file, label: "Raw data"]
ETL [icon: etl]
Features [icon: feature-store, label: "Feature store"]
Train [icon: gpu, label: "Training"]
Registry [icon: registry, label: "Model registry"]
Serve [icon: model, label: "Serving"]
Monitor [icon: monitoring]
Sources > ETL (data)
ETL > Features (data)
Features > Train (data)
Train > Registry
Registry > Serve
Serve > Monitor (async)
`,
  state: `direction right
Idle [icon: terminator]
Loading [icon: process]
Ready [icon: process]
Failed [icon: process]
Idle > Loading: fetch
Loading > Ready: ok
Loading > Failed: error
Failed > Loading: retry
`,
  class: `direction down
Animal [icon: uml-class] {
  name string
  speak() void
}
Dog [icon: uml-class] {
  breed string
}
Dog > Animal: extends
`,
  bpmn: `direction right
Customer [icon: team] {
  Order [icon: process, label: "Place order"]
}
Shop [icon: team] {
  Check [icon: decision, label: "In stock?"]
  Ship [icon: process]
}
Order > Check
Check > Ship: yes
`,
  threat: `direction right
Internet [icon: trust-boundary] {
  Browser [icon: browser]
}
App [icon: trust-boundary] {
  API [icon: service]
  DB [icon: database]
}
Browser > API: HTTPS
API > DB: SQL (data)
`,
};

export function emptyArch(kind: ArchKind, c4?: { level: C4Level; parent?: string; parentNode?: string }): ArchCanvas {
  return { nodes: [], edges: [], lumenArch: { kind, direction: "right", layout: "elk-layered", split: "50", ...(c4 ? { c4 } : kind === "c4" ? { c4: { level: "context" } } : {}) } };
}
export function archFromDsl(kind: ArchKind, dsl: string, base?: ArchCanvas): ArchCanvas {
  const c = base ?? emptyArch(kind);
  const { doc } = parseDsl(dsl, kind);
  return applyDsl(c, doc, dsl);
}

/** Create a diagram note with the type's starter content (auto-laid out with ELK when it loads), and return it. */
export async function createArchNote(kind: ArchKind, where: Pick<Note, "spaceId" | "folderId">, opts: { title?: string; dsl?: string; c4?: ArchCanvas["lumenArch"]["c4"] } = {}): Promise<Note> {
  const { createNote } = await import("./actions");
  let c = archFromDsl(kind, opts.dsl ?? STARTER_DSL[kind], emptyArch(kind, opts.c4));
  try { const { elkLayout } = await import("./arch-layout"); c = await elkLayout(c, { direction: c.lumenArch.direction, spacing: "roomy", keep: false, scope: "all" }); } catch { /* placement is fine without ELK */ }
  const label = DIAGRAM_TYPES.find((d) => d[0] === kind)?.[1] ?? "Diagram";
  return createNote({ type: "canvas", title: opts.title ?? `${label} diagram`, body: stringifyArch(c), spaceId: where.spaceId, folderId: where.folderId });
}

// ------------------------------------------------------------------ demo: "Payments platform" (frames 46C…)
export const PAYMENTS_DSL = `direction right
// Payments platform
AWS [icon: region, label: "eu-west-1"] {
  VPC [icon: vpc] {
    Private [icon: subnet] {
      API [icon: service, label: "Payments API", tech: "FastAPI · Python 3.12", status: live]
      Queue [icon: queue, tech: "SQS", status: live]
      Worker [icon: function, tech: "Lambda", status: building]
      DB [icon: database, tech: "Postgres 16", status: live]
      Files [icon: bucket, tech: "S3", status: planned]
    }
    Gateway [icon: gateway, label: "API Gateway", tech: "HTTP API", status: live]
  }
}
User [icon: user, tech: "Web + mobile", status: live]
Stripe [icon: external-system, tech: "External", status: live]
User > Gateway: HTTPS
Gateway > API: gRPC
API > Queue: enqueue (async)
Queue > Worker (async)
API > DB: SQL (data)
Worker > Files: put (data)
Stripe > API: webhook (async)
`;
/** The design's positions (ArchStudio.dc.html), so the demo board matches the frames. */
export function paymentsCanvas(): string {
  const c = archFromDsl("architecture", PAYMENTS_DSL);
  const P: Record<string, [number, number, number]> = { Gateway: [225, 130, 150], API: [225, 290, 150], Queue: [420, 290, 110], Worker: [595, 290, 120], Files: [595, 410, 120], User: [20, 138, 120], Stripe: [20, 560, 120] };
  const G: Record<string, [number, number, number, number]> = { AWS: [170, 40, 590, 620], VPC: [195, 90, 545, 430], Private: [210, 255, 520, 245] };
  c.nodes = c.nodes.map((n) => {
    const nm = n.type === "group" ? n.lumenGroup?.name ?? "" : n.lumenNode?.name ?? "";
    if (P[nm]) return { ...n, x: P[nm][0], y: P[nm][1], width: P[nm][2], height: 60 };
    if (nm === "DB") return { ...n, x: 225, y: 410, width: 150, height: 60, lumenNode: { ...n.lumenNode, cost: "$180/mo", sla: "99.95%" } };
    if (G[nm]) return { ...n, x: G[nm][0], y: G[nm][1], width: G[nm][2], height: G[nm][3] };
    return n;
  });
  c.nodes = c.nodes.map((n) => (n.type !== "group" && n.lumenNode?.name === "API" ? { ...n, lumenNode: { ...n.lumenNode, ref: "obj-payments-api", owner: "Sara K.", description: "Takes card payments from the web and mobile apps, writes the ledger, enqueues receipts.", links: ["[[RFC 012 · Payments]]", "REQ-4 · Refunds in 24 h", "github.com/acme/payments"], tags: ["#pci", "#core"], cost: "$420 / mo", sla: "99.9%" } } : n));
  c.lumenArch.dsl = PAYMENTS_DSL;
  return stringifyArch(c);
}
