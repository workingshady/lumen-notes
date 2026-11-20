import type { Catalog } from "../lib/i18n";
import { ar as shell } from "./ar/shell";
import { ar as home } from "./ar/home";
import { ar as workspace } from "./ar/workspace";
import { ar as editor } from "./ar/editor";
import { ar as paths } from "./ar/paths";
import { ar as review } from "./ar/review";
import { ar as settings } from "./ar/settings";
import { ar as data } from "./ar/data";
import { ar as dialogs } from "./ar/dialogs";
import { ar as imports } from "./ar/imports";
import { ar as accounts } from "./ar/accounts";
import { ar as sweep } from "./ar/sweep";
import { ar as r6a } from "./ar/chat-r6"; // round 6 part A: Ask, tutor, note tabs, Assistant
import { ar as common } from "./ar/common";
import { ar as scale } from "./ar/scale";
import { ar as r6b } from "./ar/r6b"; // round 6 part B: settings, sidebar, big data
import { ar as organize } from "./ar/organize";
import { ar as activity } from "./ar/activity"; // note activity log (History › Activity); first, so existing keys win
import { ar as exportAr } from "./ar/export";
import { ar as canvas } from "./ar/canvas"; // canvas undo/redo, editing, shortcuts
import { ar as canvasOptions } from "./ar/canvas-options"; // canvas options (round 7)
import { ar as visualChooser } from "./ar/visual-chooser"; // round 7: New visual chooser + templates gallery
import { ar as aiVisual } from "./ar/ai-visual"; // round 7: AI review sheet + architecture AI
import { ar as whiteboard } from "./ar/whiteboard"; // round 7 whiteboard shell (W1-A)
import { ar as arch } from "./ar/arch"; // architecture studio (round 7)
import { ar as api } from "./ar/api"; // Settings › Developer endpoints // round 6: note list filter/multi-select, tags, history panel

/**
 * Arabic catalog (Modern Standard Arabic, concise UI wording). Keys = English source strings used in `t()`.
 * Split by area so several people can add strings without conflicts; later areas override earlier ones on a clash.
 * Product names (Lumen) and technical terms Arabic users expect in English (Markdown, PDF, FSRS, JSON, URL) stay as is.
 */
export const AR: Catalog = { ...arch, ...aiVisual, ...activity, ...scale, ...shell, ...home, ...workspace, ...editor, ...paths, ...review, ...settings, ...data, ...dialogs, ...imports, ...accounts, ...sweep, ...r6b, ...r6a, ...organize, ...api, ...canvas, ...whiteboard, ...canvasOptions, ...exportAr, ...common, ...visualChooser };
