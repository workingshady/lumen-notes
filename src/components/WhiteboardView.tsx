import { Excalidraw, restore } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import { useMemo } from "react";
import { attUrl } from "../lib/api";
import { activeTheme } from "../lib/settings";
import { parseScene } from "../lib/whiteboard";
import { hydrateFiles, serverSource, type SceneFile } from "../lib/wb-files";
import { embedProps } from "./wb-media";

const embeds = embedProps(async (id) => attUrl(id));

/** Read-only whiteboard (shared links): pan/zoom only, no editing. Images stored as attachments load after mount. */
export default function WhiteboardView({ body }: { body: string }) {
  const { initialData, files } = useMemo(() => {
    const { scene } = parseScene(body);
    const r = restore({ elements: scene.elements as never, files: scene.files as never }, null, null);
    return { initialData: { elements: r.elements, files: r.files, appState: { viewBackgroundColor: "transparent", viewModeEnabled: true }, scrollToContent: true }, files: scene.files as Record<string, SceneFile> };
  }, [body]);
  return <Excalidraw initialData={initialData as never} viewModeEnabled theme={activeTheme().dark ? "dark" : "light"} {...(embeds as object)}
    excalidrawAPI={(a) => { void hydrateFiles(files, serverSource(attUrl)).then((f) => { if (f.length) a.addFiles(f as never); }); }}
    UIOptions={{ canvasActions: { loadScene: false, saveToActiveFile: false, export: false, toggleTheme: false } }} />;
}
