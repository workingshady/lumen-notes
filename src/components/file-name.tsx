// File names keep their extension visible (Lumen 22 truncation rules): "vaswani-shazeer-…-attention.pdf" truncates in
// the middle as start…end.pdf. Plain titles render unchanged. Full name on hover.
import type { ReactNode } from "react";

const EXT = /^(.*?)(.{0,6}\.[A-Za-z0-9]{1,5})$/;
export const isFileName = (s: string) => /\.[A-Za-z0-9]{1,5}$/.test(s) && !/\s/.test(s.slice(-8));

export function FileName({ name, children, className }: { name: string; children?: ReactNode; className?: string }) {
  const m = isFileName(name) ? EXT.exec(name) : null;
  if (!m || !m[1]) return <span className={"min-w-0 truncate " + (className ?? "")} title={name} dir="auto">{children ?? name}</span>;
  return (
    <span className={"flex min-w-0 " + (className ?? "")} title={name} dir="ltr">
      <span className="min-w-0 truncate">{m[1]}</span><span className="shrink-0 whitespace-pre">{m[2]}</span>
    </span>
  );
}
