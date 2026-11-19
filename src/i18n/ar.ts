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
import { ar as common } from "./ar/common";

/**
 * Arabic catalog (Modern Standard Arabic, concise UI wording). Keys = English source strings used in `t()`.
 * Split by area so several people can add strings without conflicts; later areas override earlier ones on a clash.
 * Product names (Lumen) and technical terms Arabic users expect in English (Markdown, PDF, FSRS, JSON, URL) stay as is.
 */
export const AR: Catalog = { ...shell, ...home, ...workspace, ...editor, ...paths, ...review, ...settings, ...data, ...dialogs, ...common };
