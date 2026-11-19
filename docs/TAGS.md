# Tags, note list filter and note history (design round 6 · "Lumen 30")

## Nested tags
- A tag is written `#a/b/c` in a note body or listed in front-matter `tags: [a/b/c]` (plain Markdown, Obsidian-compatible).
  `#a/b/c` is one tag; its parents `a` and `a/b` exist implicitly.
- Filtering by a tag includes its children everywhere: list scope (`ui.tag`, `lib/store.ts` `scoped`), search/smart
  folders (`tag:#a` matches `a/b`), the tag page.
- `src/lib/tag-tree.ts`: `tagTree(tags, colors?, pinned?)` → nested `TagNode { name, path, count, color, children, pinned }`
  with counts rolled up to parents (sum of the children's counts + the tag's own notes); `useTagMeta()`; `tagColor()`
  (own colour, else nearest coloured ancestor); `fuzzyTags()` (tag picker); `openTag(path)` opens the tag page.

## Tag colours and pins (synced)
JSON in the Inbox space record, `space.props.lumenTagMeta`:

```json
{"colors": {"ml": "6", "arabic": "5"}, "pinned": ["arabic"]}
```

Colours are the 6 presets `"1"`..`"6"` (red, orange, yellow, green, cyan, purple = JSON Canvas presets) or a CSS colour.
Written read-modify-write through `patch("space", "inbox", …)` (`src/lib/tag-ops.ts` `setTagColor`, `toggleTagPin`).

## Tag operations (`src/lib/tag-ops.ts`)
- `renameTag(from, to)`: rewrites `#from` and `#from/child` in every note body (outside fenced code) and in the
  front-matter list, then `updateNote()` re-derives the record's tags. Children follow (`#ml/llm/rag` → `#ai/llm/rag`).
  Colours/pins move with the tag. Used by Rename… (F2), Merge into… (`to` = an existing tag) and Move under…
  (`to` = `parent/leaf`).
- `deleteTag(tag)`: removes the tag and its children from every note.
- `addTagToNotes(ids, tag)` / `removeTagFromNote(id, tag)`: the bulk bar "Tag" and the tag picker.
- Every bulk operation returns `undo()` (restores the previous bodies + meta); the UI shows it as an Undo toast.

## UI
- Tag page (`src/components/TagPage.tsx`): shown in the main pane when `ui.tag` is set and no note is open (the list
  pane steps aside); child tags, notes with status, "Often used together" (co-occurrence counts on the tag's notes;
  bar = share of the tag's notes), colour, Rename / Merge into / ⋯.
- Tag ⋯ menu: `openTagMenu(tag, rectOrPoint)` or `dispatchEvent(new CustomEvent("lumen:tag-menu", { detail: { tag, x, y } }))`
  (add `dialog: "rename" | "merge" | "move"` to open a dialog directly). Mounted once by `TagMenuHost` (App).
- Tag picker (`src/components/TagPicker.tsx`): Properties › tags. Fuzzy match on the whole path, ↵ picks, ⇧↵ creates.

## Note list (desktop, `src/components/NoteList.tsx` + `note-list-desk.tsx`)
- Filter box: typed operators (`tag:#x`, `status:y`, any search operator, `"phrase"`, `#x`) become chips after a space,
  words on Enter; Backspace on an empty box removes the last chip. The sidebar tag (`ui.tag`) shows as the first chip.
- Sort (Updated / Created / Title, `localStorage lumen.sort`), Group (Date / Status / None, `lumen.group`). Pinned notes
  always group on top. Rows show at most 3 tag chips, then `+N` (hover lists all).
- Multi-select: Select / Done in the header (or shift-click a row); click toggles, shift-click selects a range,
  Ctrl/⌘ A selects all, Esc leaves. Bulk bar: Tag, Move (space/folder), Delete (Trash) — each with Undo.

## Note history (`src/components/HistoryPanel.tsx`)
- Versions | Recently opened. Versions grouped Today / Earlier; each shows the device and +/− characters against the
  previous version. A version can be named (double-click, F2 or the pin button; the Current row saves a named
  version now). "Restore as new version" never overwrites (current text saved as a version first, then a
  "Restored from …" version on top).
- `Version.device` (optional): the device name at save time (`lumen.deviceName`, else a guess). Older versions have none.
- Recently opened: per device, `localStorage lumen.recentOpened` = `[{ id, at }]` (max 60), `src/lib/recent-opened.ts`.
