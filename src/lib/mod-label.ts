/** "⌘" on Apple platforms, "Ctrl" elsewhere. */
export const IS_MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
export const modLabel = IS_MAC ? "⌘" : "Ctrl";
