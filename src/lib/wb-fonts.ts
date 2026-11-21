// Serif and Arabic board fonts. Excalidraw 0.18 has no API to add a font family, but it resolves a family id to a CSS name
// through the exported FONT_FAMILY table, so two extra ids (20, 21) map to fonts the app already loads. Canvas and the text
// editor then draw them natively. Other Excalidraw apps do not know these ids and show their default font instead.
import { FONT_FAMILY } from "@excalidraw/excalidraw";

export const FONT_SERIF = 20;
export const FONT_ARABIC = 21;
const table = FONT_FAMILY as unknown as Record<string, number>;
// quoted: "Source Serif 4" would not parse as an unquoted CSS family (a name part cannot start with a digit)
table['"Source Serif 4"'] = FONT_SERIF;
table['"IBM Plex Sans Arabic"'] = FONT_ARABIC;
try {
  void document.fonts?.load('16px "Source Serif 4"');
  void document.fonts?.load('16px "IBM Plex Sans Arabic"', "ينكسر الضوء");
} catch { /* fonts still load when first used */ }
