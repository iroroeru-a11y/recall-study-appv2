import { openDB } from "idb";
const DB_NAME = "recall-local-v1";
const STORE_NAMES = ["decks", "cards", "sources", "logs", "settings"];
let dbPromise;
export function getDB() {
  if (!dbPromise) dbPromise = openDB(DB_NAME, 1, {
    upgrade(db) {
      for (const name of STORE_NAMES) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: "id" });
      }
    }
  });
  return dbPromise;
}
export const repo = {
  async all(store) { return (await getDB()).getAll(store); },
  async get(store, id) { return (await getDB()).get(store, id); },
  async put(store, value) { return (await getDB()).put(store, value); },
  async remove(store, id) { return (await getDB()).delete(store, id); },
  async clear(store) { return (await getDB()).clear(store); },
  async bulkPut(store, values) {
    const db = await getDB(); const tx = db.transaction(store, "readwrite");
    for (const value of values) await tx.store.put(value);
    await tx.done;
  }
};
export const uid = () => crypto.randomUUID();
export const todayStart = () => { const d = new Date(); d.setHours(0,0,0,0); return d; };
