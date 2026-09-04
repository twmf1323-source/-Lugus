/**
 * 專案句子快照：localStorage → IndexedDB 遷移（假 IDB）
 */
import fs from "fs";
import vm from "vm";
import path from "path";
import { fileURLToPath } from "url";

const here = path.dirname(fileURLToPath(import.meta.url));
const code = fs.readFileSync(path.join(here, "storage.js"), "utf8");

function fail(msg) {
  console.error("FAIL", msg);
  process.exit(1);
}
function ok(msg) {
  console.log("ok", msg);
}

function createFakeIndexedDB() {
  const dbs = new Map();
  function ensure(name) {
    if (!dbs.has(name)) dbs.set(name, new Map());
    return dbs.get(name);
  }
  return {
    _dbs: dbs,
    open(name) {
      const req = { result: null, error: null, onupgradeneeded: null, onsuccess: null, onerror: null };
      queueMicrotask(() => {
        const stores = ensure(name);
        const db = {
          objectStoreNames: { contains: (n) => stores.has(n) },
          createObjectStore(n) {
            if (!stores.has(n)) stores.set(n, new Map());
          },
          transaction(storeName) {
            const store = stores.get(storeName) || new Map();
            const tx = {
              oncomplete: null,
              onabort: null,
              onerror: null,
              objectStore() {
                return {
                  get(key) {
                    const r = { result: store.has(key) ? store.get(key) : undefined, onsuccess: null, onerror: null };
                    queueMicrotask(() => r.onsuccess && r.onsuccess());
                    return r;
                  },
                  put(value, key) {
                    store.set(key, structuredClone(value));
                    const r = { onsuccess: null, onerror: null };
                    queueMicrotask(() => {
                      if (r.onsuccess) r.onsuccess();
                      if (tx.oncomplete) tx.oncomplete();
                    });
                    return r;
                  },
                };
              },
            };
            return tx;
          },
        };
        req.result = db;
        if (!stores.has("kv") && req.onupgradeneeded) req.onupgradeneeded();
        if (!stores.has("kv")) stores.set("kv", new Map());
        if (req.onsuccess) req.onsuccess();
      });
      return req;
    },
  };
}

function loadStorage(lsMap, indexedDB) {
  const localStorage = {
    getItem(k) {
      return lsMap.has(k) ? lsMap.get(k) : null;
    },
    setItem(k, v) {
      lsMap.set(String(k), String(v));
    },
    removeItem(k) {
      lsMap.delete(k);
    },
    get length() {
      return lsMap.size;
    },
    key(i) {
      return [...lsMap.keys()][i] ?? null;
    },
  };
  const ctx = {
    localStorage,
    indexedDB,
    document: { addEventListener() {} },
    window: { addEventListener() {} },
    console,
    crypto: { randomUUID: () => "id_test" },
    setTimeout,
    clearTimeout,
    queueMicrotask,
    structuredClone,
  };
  vm.createContext(ctx);
  vm.runInContext(`${code}\nthis.__Storage = Storage;`, ctx);
  return ctx.__Storage;
}

const payload = {
  collections: [{ id: "col_1", name: "專輯", createdAt: "t", updatedAt: "t", lastProjectId: "proj_1" }],
  projects: [
    {
      id: "proj_1",
      name: "Édith",
      collectionId: "col_1",
      createdAt: "t",
      updatedAt: "t",
      entries: [
        {
          id: "pe_1",
          seq: 1,
          query: "Non, je ne regrette rien",
          at: "t",
          summary: "否定",
          translation: "不，我一無所悔",
          items: [],
          vocab: [],
          tokens: [],
        },
      ],
    },
  ],
};

const ls = new Map();
ls.set("fvgn_projects_v1", JSON.stringify(payload));
const idb = createFakeIndexedDB();
const Storage = loadStorage(ls, idb);

const init = await Storage.initProjectsDb();
if (init.backend !== "idb") fail(`backend ${init.backend}`);
if (!init.migrated) fail("expected migrated: true");
const stub = JSON.parse(ls.get("fvgn_projects_v1"));
if (stub.__idb !== true) fail(`LS stub missing: ${ls.get("fvgn_projects_v1")}`);
const p = Storage.getProject("proj_1");
if (!p || p.name !== "Édith") fail("project missing after migrate");
if (p.entries[0].query !== "Non, je ne regrette rien") fail("entry query lost");
ok("migrate LS → IDB and stub localStorage");

Storage.upsertProjectEntry("proj_1", {
  query: "Je t'aime",
  summary: "第二句",
  translation: "",
  forceNew: true,
});
await Storage.flushProjects();
if (Storage.getProjectEntriesSorted("proj_1").length !== 2) fail("second entry not in cache");

const idbStore = idb._dbs.get("fvgn_idb_v1").get("kv").get("projects_v1");
if (!idbStore || idbStore.projects[0].entries.length !== 2) fail("IDB not flushed");
ok("flush writes new sentence to IndexedDB");

const ls2 = new Map();
ls2.set("fvgn_projects_v1", JSON.stringify({ __idb: true }));
const Storage2 = loadStorage(ls2, idb);
await Storage2.initProjectsDb();
const p2 = Storage2.getProject("proj_1");
if (!p2 || p2.entries.length !== 2) fail("reload from IDB lost entries");
if (Storage2.getProjectsBackend() !== "idb") fail("reload backend");
ok("second session loads from IndexedDB, not stub LS");

const u = Storage2.measureLocalStorageUsage();
if (u.backend !== "idb") fail("usage backend");
if (!(u.idbBytes > 0)) fail("usage idbBytes");
ok("usage reports IndexedDB size");

console.log("all ok");
