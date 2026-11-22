import { lazy, Suspense, useEffect, useState } from "react";
import { NOTE_EXPORT_EVENT, type NoteExportJob } from "../lib/note-export";

// The dialog (and Paged.js, KaTeX fonts, the print builder) load only when something opens it.
const NoteExport = lazy(() => import("./NoteExport"));

export function NoteExportHost() {
  const [job, setJob] = useState<NoteExportJob | null>(null);
  useEffect(() => {
    const on = (e: Event) => setJob((e as CustomEvent<NoteExportJob>).detail);
    addEventListener(NOTE_EXPORT_EVENT, on);
    return () => removeEventListener(NOTE_EXPORT_EVENT, on);
  }, []);
  if (!job) return null;
  return <Suspense fallback={null}><NoteExport key={JSON.stringify(job)} job={job} onClose={() => setJob(null)} /></Suspense>;
}
