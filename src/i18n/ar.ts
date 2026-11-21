import type { Catalog } from "../lib/i18n";
import { ar as shell } from "./ar/shell";
import { ar as home } from "./ar/home";
import { ar as workspace } from "./ar/workspace";
import { ar as editor } from "./ar/editor";
import { ar as paths } from "./ar/paths";
import { ar as review } from "./ar/review";
import { ar as reviewR8 } from "./ar/review-r8"; // round 8 · Lumen 57 review hub + session (first, so existing keys win)
import { ar as settings } from "./ar/settings";
import { ar as data } from "./ar/data";
import { ar as dialogs } from "./ar/dialogs";
import { ar as imports } from "./ar/imports";
import { ar as accounts } from "./ar/accounts";
import { ar as sweep } from "./ar/sweep";
import { ar as askR8 } from "./ar/ask-r8"; // round 8 package 56: Ask enhanced
import { ar as r6a } from "./ar/chat-r6"; // round 6 part A: Ask, tutor, note tabs, Assistant
import { ar as common } from "./ar/common";
import { ar as scale } from "./ar/scale";
import { ar as r6b } from "./ar/r6b"; // round 6 part B: settings, sidebar, big data
import { ar as organize } from "./ar/organize";
import { ar as activity } from "./ar/activity"; // note activity log (History › Activity); first, so existing keys win
import { ar as exportAr } from "./ar/export";
import { ar as r7ArchFix } from "./ar/r7-arch-fix";
import { ar as canvas } from "./ar/canvas"; // canvas undo/redo, editing, shortcuts
import { ar as canvasOptions } from "./ar/canvas-options"; // canvas options (round 7)
import { ar as visualChooser } from "./ar/visual-chooser"; // round 7: New visual chooser + templates gallery
import { ar as aiVisual } from "./ar/ai-visual"; // round 7: AI review sheet + architecture AI
import { ar as archAiShare } from "./ar/arch-ai-share"; // round 7 W3-C
import { ar as whiteboard } from "./ar/whiteboard"; // round 7 whiteboard shell (W1-A)
import { ar as wbPens } from "./ar/wb-pens"; // round 7 pens, palettes, lasso (W2-A)
import { ar as wbFix } from "./ar/wb-fix"; // round 7 whiteboard fix wave
import { ar as wbW3a } from "./ar/wb-w3a"; // round 7 layers, frames, board settings, presentation (W3-A)
import { ar as convert } from "./ar/convert"; // mixed Board cards, Convert menu and matrix (round 7, W3-B)
import { ar as dnd } from "./ar/dnd"; // drag and drop (round 7, W2-C)
import { ar as library } from "./ar/library"; // shared library, connector / style popovers, stamps (round 7, W2-B)
import { ar as arch } from "./ar/arch"; // architecture studio (round 7)
import { ar as archEdges } from "./ar/arch-edges"; // architecture edge editing (round 7 W2-D)
import { ar as r7Consistency } from "./ar/r7-consistency"; // round 7 stage 4 consistency pass
import { ar as versioning } from "./ar/versioning"; // round 8 · versioning (R8-58)
import { ar as plansR8 } from "./ar/plans-r8"; // round 8: course timeline + plans (Lumen 53 / 54)
import { ar as api } from "./ar/api"; // Settings › Developer endpoints // round 6: note list filter/multi-select, tags, history panel
import { ar as r8WbCanvas } from "./ar/r8-wb-canvas"; // round 8 whiteboard / canvas / export wave
import { ar as r9Misc } from "./ar/r9-misc"; // round 9: Move to, confirms, publish, uploads, settings, legal
import { ar as todayCal } from "./ar/today-cal"; // round 8 · Today, Calendar, Tasks (R8-55)

/**
 * Arabic catalog (Modern Standard Arabic, concise UI wording). Keys = English source strings used in `t()`.
 * Split by area so several people can add strings without conflicts; later areas override earlier ones on a clash.
 * Product names (Lumen) and technical terms Arabic users expect in English (Markdown, PDF, FSRS, JSON, URL) stay as is.
 */
export const AR: Catalog = { ...r9Misc, ...plansR8, ...todayCal, ...versioning, ...reviewR8, ...askR8, ...convert, ...archAiShare, ...dnd, ...library, ...arch, ...archEdges, ...aiVisual, ...activity, ...scale, ...shell, ...home, ...workspace, ...editor, ...paths, ...review, ...settings, ...data, ...dialogs, ...imports, ...accounts, ...sweep, ...r6b, ...r6a, ...organize, ...api, ...canvas, ...wbFix, ...wbW3a, ...wbPens, ...whiteboard, ...canvasOptions, ...exportAr, ...r7ArchFix, ...common, ...visualChooser, ...r7Consistency, ...r8WbCanvas };
