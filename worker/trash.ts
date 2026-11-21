import type { Env } from "./index";

/** Trash keeps a deleted note 30 days (src/lib/actions.ts purgeOldTrash does the same on a device). */
export const TRASH_DAYS = 30;
/** Notes purged per database per run: one atomic D1 batch of 3 statements each stays inside the Free plan's query budget. */
const PER_RUN = 15;

/**
 * Daily cron: a note in Trash (`deleted = 1`, title not yet "(deleted)") whose last change is older than 30 days becomes
 * the same purge tombstone a device writes (empty body, title "(deleted)", `deleted: 1`, fresh updatedAt) and its version
 * rows are tombstoned too. The rows are never removed: `rev` is bumped so every device pulls the tombstone, drops the
 * content and then compacts it (sync.ts compactTombstones), and a device that is offline for weeks cannot bring the note back.
 */
export async function purgeTrash(db: D1Database, now = Date.now()): Promise<number> {
  const cutoff = now - TRASH_DAYS * 86_400_000;
  const { results } = await db.prepare(
    `SELECT id FROM items WHERE kind = 'note' AND deleted = 1 AND updated_at < ?1 AND COALESCE(json_extract(data, '$.title'), '') <> '(deleted)' ORDER BY updated_at LIMIT ?2`,
  ).bind(cutoff, PER_RUN).all<{ id: string }>();
  if (!results.length) return 0;
  const bump = `UPDATE meta SET v = CAST(v AS INTEGER) + 1 WHERE k = 'rev'`;
  const rev = `(SELECT CAST(v AS INTEGER) FROM meta WHERE k = 'rev')`;
  const stmts: D1PreparedStatement[] = [];
  for (const { id } of results) {
    stmts.push(db.prepare(bump));
    stmts.push(db.prepare(
      `UPDATE items SET data = json_set(data, '$.body', '', '$.title', '(deleted)', '$.deleted', 1, '$.updatedAt', ?2), updated_at = ?2, deleted = 1, rev = ${rev} WHERE kind = 'note' AND id = ?1 AND deleted = 1`,
    ).bind(id, now));
    stmts.push(db.prepare(
      `UPDATE items SET data = json_set(data, '$.body', '', '$.deleted', 1, '$.updatedAt', ?2), updated_at = ?2, deleted = 1, rev = ${rev} WHERE kind = 'version' AND json_extract(data, '$.noteId') = ?1 AND (deleted = 0 OR json_extract(data, '$.body') <> '')`,
    ).bind(id, now));
  }
  await db.batch(stmts);
  return results.length;
}

/** Every account's database (main + the extra accounts that are bound). */
export async function purgeTrashAll(env: Env["Bindings"]): Promise<number> {
  let n = 0;
  for (const db of [env.DB, env.DB_ROADMAP, env.DB_LANGUAGES]) {
    if (!db) continue;
    try { n += await purgeTrash(db); } catch (e) { console.warn("trash purge failed", e); }
  }
  return n;
}
