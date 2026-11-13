import { Excalidraw, restore } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import { useMemo } from "react";
import { activeTheme } from "../lib/settings";
import { parseScene } from "../lib/whiteboard";

/** Read-only whiteboard (shared links): pan/zoom only, no editing. */
export default function WhiteboardView({ body }: { body: string }) {
  const initialData = useMemo(() => {
    const { scene } = parseScene(body);
    const r = restore({ elements: scene.elements as never, files: scene.files as never }, null, null);
    return { elements: r.elements, files: r.files, appState: { viewBackgroundColor: "transparent", viewModeEnabled: true }, scrollToContent: true };
  }, [body]);
  return <Excalidraw initialData={initialData as never} viewModeEnabled theme={activeTheme().dark ? "dark" : "light"} UIOptions={{ canvasActions: { loadScene: false, saveToActiveFile: false, export: false, toggleTheme: false } }} />;
}
