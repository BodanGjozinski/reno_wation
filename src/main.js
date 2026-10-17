import { Viewer } from "./viewer.js";
import { listScenes, getScene, addScene, saveSettings, removeScene } from "./library.js";

const $ = (id) => document.getElementById(id);
const SUPPORTED = /\.(ply|spz|splat|ksplat)$/i;

const viewer = new Viewer($("viewport"));
let currentId = null;

// ---- Library ----

function formatSize(bytes) {
  return bytes > 1e6 ? `${(bytes / 1e6).toFixed(1)} MB` : `${Math.round(bytes / 1e3)} KB`;
}

async function renderLibrary() {
  const scenes = await listScenes();
  const list = $("library");
  list.replaceChildren();
  $("library-empty").hidden = scenes.length > 0;
  for (const s of scenes) {
    const li = document.createElement("li");
    li.classList.toggle("active", s.id === currentId);
    li.innerHTML = `<span class="name"></span><span class="meta"></span>
      <button class="icon-btn remove" aria-label="Remove scene">×</button>`;
    li.querySelector(".name").textContent = s.name;
    li.querySelector(".meta").textContent = formatSize(s.size);
    li.addEventListener("click", () => openScene(s.id));
    li.querySelector(".remove").addEventListener("click", async (e) => {
      e.stopPropagation();
      if (!confirm(`Remove "${s.name}" from this browser?`)) return;
      await removeScene(s.id);
      if (s.id === currentId) closeScene();
      renderLibrary();
    });
    list.appendChild(li);
  }
}

async function importFile(file) {
  if (!SUPPORTED.test(file.name)) {
    toast("That file type isn't supported. Use PLY, SPZ, SPLAT or KSPLAT.");
    return;
  }
  const scene = await addScene(file);
  await renderLibrary();
  await openScene(scene.id);
}

async function openScene(id) {
  const scene = await getScene(id);
  if (!scene) return;
  currentId = id;
  renderLibrary();
  $("empty").hidden = true;
  $("loading").hidden = false;
  $("loading-text").textContent = `Loading ${scene.name}`;
  try {
    const bytes = await scene.blob.arrayBuffer();
    await viewer.load(bytes, scene.fileName, scene.settings);
    $("toolbar").hidden = false;
    syncToolbar();
  } catch (err) {
    console.error(err);
    toast("This file couldn't be opened as a splat scene.");
    closeScene();
  } finally {
    $("loading").hidden = true;
  }
}

function closeScene() {
  viewer.unload();
  currentId = null;
  $("toolbar").hidden = true;
  $("zone-panel").hidden = true;
  $("scale-badge").hidden = true;
  $("empty").hidden = false;
}

function persist() {
  if (!currentId) return;
  viewer.syncZoneData();
  saveSettings(currentId, viewer.settings);
}

// ---- Toolbar ----

function syncToolbar() {
  const s = viewer.settings;
  document.querySelector('[data-tool="upright"]').classList.toggle("active", s.upright);
  document.querySelector('[data-tool="measure"]').classList.toggle("active", viewer.mode === "measure");
  const badge = $("scale-badge");
  badge.hidden = !s.metresPerUnit;
  badge.textContent = "Real-world scale set";
}

function showHint(text) {
  $("hint").hidden = !text;
  $("hint").textContent = text || "";
}

$("toolbar").addEventListener("click", (e) => {
  const tool = e.target.closest("[data-tool]")?.dataset.tool;
  if (!tool) return;
  if (tool === "upright") {
    viewer.setUpright(!viewer.settings.upright);
    persist();
  } else if (tool === "measure") {
    if (viewer.mode === "measure") {
      viewer.clearMeasure();
      showHint(null);
    } else {
      viewer.startMeasure();
      showHint("Click two points you know the distance between, like both sides of a door.");
    }
  } else if (tool === "paint" || tool === "hide") {
    viewer.addZone(tool);
    showHint("Drag the arrows to place the zone. Use Size to fit it to the wall or object.");
    setTimeout(() => showHint(null), 4000);
  } else if (tool === "reset") {
    viewer.frame();
  }
  syncToolbar();
});

viewer.addEventListener("measured", (e) => {
  showHint(null);
  $("measure-current").textContent = `In the file these points are ${e.detail.toFixed(3)} units apart.`;
  $("measure-input").value = "";
  $("measure-dialog").showModal();
  $("measure-input").focus();
});

$("measure-dialog").addEventListener("close", () => {
  const value = parseFloat($("measure-input").value);
  if ($("measure-dialog").returnValue === "ok" && value > 0) {
    viewer.applyScale(value);
    persist();
    toast(`Scale set: those points are now ${value} m apart.`);
  } else {
    viewer.clearMeasure();
  }
  syncToolbar();
});

// ---- Zone panel ----

viewer.addEventListener("select", (e) => {
  const zone = e.detail;
  $("zone-panel").hidden = !zone;
  if (!zone) return;
  const paint = zone.data.kind === "paint";
  $("zone-title").textContent = paint ? "Paint zone" : "Hide zone";
  $("zone-color-field").hidden = !paint;
  if (paint) $("zone-color").value = zone.data.color;
});

viewer.addEventListener("zoneschange", persist);

$("zone-color").addEventListener("input", (e) => {
  if (viewer.selected) viewer.setZoneColor(viewer.selected, e.target.value);
});

$("zone-mode").addEventListener("click", (e) => {
  const mode = e.target.dataset.mode;
  if (!mode) return;
  viewer.setGizmoMode(mode);
  for (const b of $("zone-mode").children) b.classList.toggle("active", b === e.target);
});

$("zone-delete").addEventListener("click", () => {
  if (viewer.selected) viewer.deleteZone(viewer.selected);
});

$("zone-close").addEventListener("click", () => viewer.selectZone(null));

// ---- Adding files ----

const fileInput = $("file-input");
for (const id of ["add-scene", "empty-add"]) $(id).addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", () => {
  const file = fileInput.files[0];
  fileInput.value = "";
  if (file) importFile(file);
});

$("load-sample").addEventListener("click", async () => {
  const res = await fetch(`${import.meta.env.BASE_URL}sample-room.ply`);
  const blob = await res.blob();
  importFile(new File([blob], "Sample room.ply"));
});

let dragDepth = 0;
window.addEventListener("dragenter", (e) => {
  e.preventDefault();
  dragDepth++;
  $("drop-overlay").hidden = false;
});
window.addEventListener("dragleave", () => {
  if (--dragDepth <= 0) $("drop-overlay").hidden = true;
});
window.addEventListener("dragover", (e) => e.preventDefault());
window.addEventListener("drop", (e) => {
  e.preventDefault();
  dragDepth = 0;
  $("drop-overlay").hidden = true;
  const file = e.dataTransfer.files[0];
  if (file) importFile(file);
});

window.addEventListener("keydown", (e) => {
  if (e.target.closest("input, dialog")) return;
  if ((e.key === "Delete" || e.key === "Backspace") && viewer.selected) viewer.deleteZone(viewer.selected);
  if (e.key === "Escape") {
    viewer.selectZone(null);
    viewer.clearMeasure();
    showHint(null);
    syncToolbar();
  }
});

let toastTimer;
function toast(text) {
  $("toast").textContent = text;
  $("toast").hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($("toast").hidden = true), 3500);
}

renderLibrary();
