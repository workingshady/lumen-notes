// Leading controls of the full-height readers that hide the note header (PDF · PdfDesk, base · BaseDesk,
// dashboard · DashDesk): desktop = history Back / Forward (nav-buttons, Lumen 20 · A13); phone = a 44px Back arrow.
// Edit (Markdown / YAML source) lives in each reader's own menu or button and switches the note to Edit mode; the
// regular note header comes back there, so Read returns to the reader.
import { ArrowLeft } from "lucide-react";
import { canGoBack } from "../lib/nav-history";
import { back } from "../lib/store";
import { NavButtons } from "./nav-buttons";

export function ReaderBack({ phone }: { phone: boolean }) {
  if (!phone) return <NavButtons />;
  return (
    <button aria-label="Back" className="-my-2.5 -ms-2 flex size-11 shrink-0 items-center justify-center" onClick={() => (canGoBack() ? history.back() : back())}>
      <ArrowLeft size={20} className="rtl:rotate-180" />
    </button>
  );
}
