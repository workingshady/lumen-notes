// Dev simulator hooks that need the database. Imported from main.tsx (before App) only in demo mode, so the
// Dexie middleware is registered before the database opens.
import { db, now, save } from "../db";
import { getFaults, seeding, simLocalFileError, SIM_ON } from "./faults";

if (SIM_ON) {
  // Upload failure / file too big: reject new local attachment bytes (what addFile() writes first) so the app's
  // own error path (toast) runs exactly as for a real failure.
  db.use({
    stack: "dbcore",
    name: "lumenSimUploads",
    create(down) {
      return {
        ...down,
        table(name) {
          const t = down.table(name);
          if (name !== "blobs") return t;
          return {
            ...t,
            mutate(req) {
              if (!seeding.on && getFaults().upload !== "ok" && req.type === "put" && (req.values as { uploaded?: number }[]).some((v) => v?.uploaded === 0)) {
                return Promise.reject(new Error(simLocalFileError("This file") ?? "Upload failed (simulated)"));
              }
              return t.mutate(req);
            },
          };
        },
      };
    },
  });
}

/**
 * Fire a live sync conflict on `noteId` the way the conflict middleware (ws-conflict.tsx) sees one:
 * a local edit from this device, then a "remote" copy from another device that wasn't based on it.
 * `remoteNewer` = the remote copy wins (toast "Kept newer version · View other"); false = local wins.
 */
export async function simulateConflict(noteId: string, remoteNewer = true) {
  const cur = await db.notes.get(noteId);
  if (!cur) throw new Error(`Note ${noteId} not found`);
  // 1) Local edit (tagged with this device by the conflict middleware).
  const mine = await save("note", { ...cur, body: cur.body.replace(/\n*$/, "\n\nLocal edit on this device (simulated).\n") });
  // 2) Remote copy from another device, based on an older version.
  const t = remoteNewer ? now() + 60_000 : mine.updatedAt - 60_000;
  await db.notes.put({
    ...cur, body: cur.body.replace(/\n*$/, "\n\nRemote edit from the phone (simulated).\n"), updatedAt: t, dirty: 0,
    lumenDevice: "sim-remote-device", lumenDeviceName: "Pixel 8 (simulated)", lumenBase: 0,
  } as typeof cur);
}
