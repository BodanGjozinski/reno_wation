// Scenes live in IndexedDB so they stay on this device between visits.
const DB_NAME = "renovatebyseeing";
const STORE = "scenes";

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run(mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = () => reject(tx.error);
  });
}

export const defaultSettings = () => ({ upright: true, scale: 1, metresPerUnit: null, zones: [] });

export async function listScenes() {
  const all = await run("readonly", (s) => s.getAll());
  // Leave the file bytes out of the list; they are read on open.
  return all
    .map(({ blob, ...meta }) => meta)
    .sort((a, b) => b.added - a.added);
}

export function getScene(id) {
  return run("readonly", (s) => s.get(id));
}

export async function addScene(file) {
  const scene = {
    id: crypto.randomUUID(),
    name: file.name.replace(/\.[^.]+$/, ""),
    fileName: file.name,
    size: file.size,
    added: Date.now(),
    blob: file,
    settings: defaultSettings(),
  };
  await run("readwrite", (s) => s.put(scene));
  return scene;
}

export async function saveSettings(id, settings) {
  const scene = await getScene(id);
  if (!scene) return;
  scene.settings = settings;
  await run("readwrite", (s) => s.put(scene));
}

export function removeScene(id) {
  return run("readwrite", (s) => s.delete(id));
}
