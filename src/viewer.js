import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { TransformControls } from "three/addons/controls/TransformControls.js";
import {
  SparkRenderer,
  SplatMesh,
  SplatEdit,
  SplatEditSdf,
  SplatEditSdfType,
  SplatEditRgbaBlendMode,
} from "@sparkjsdev/spark";

// Postshot and Brush export in COLMAP axes (Y down, Z forward); this turns them Y up.
const UPRIGHT = new THREE.Quaternion(1, 0, 0, 0);
const CLICK_SLOP_PX = 5;

// Splat colours are stored as plain sRGB values, so a picked colour goes in as is
// instead of being converted to linear the way three.js does for materials.
const splatColor = (hex) => new THREE.Color().setStyle(hex, THREE.LinearSRGBColorSpace);

export class Viewer extends EventTarget {
  constructor(container) {
    super();
    this.container = container;

    this.renderer = new THREE.WebGLRenderer({ antialias: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x1b1a18);
    this.camera = new THREE.PerspectiveCamera(65, 1, 0.01, 500);

    this.spark = new SparkRenderer({ renderer: this.renderer });
    this.scene.add(this.spark);

    // Everything that belongs to the captured room hangs off this group, so the
    // upright flip and the real-world scale move zones along with the splats.
    this.root = new THREE.Group();
    this.scene.add(this.root);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;

    this.gizmo = new TransformControls(this.camera, this.renderer.domElement);
    this.gizmo.setSize(0.8);
    this.gizmo.addEventListener("dragging-changed", (e) => {
      this.controls.enabled = !e.value;
      if (!e.value) this.emit("zoneschange");
    });
    this.scene.add(this.gizmo.getHelper());

    this.mesh = null;
    this.zones = [];
    this.selected = null;
    this.mode = null; // null | "measure"
    this.measurePoints = [];
    this.markers = new THREE.Group();
    this.scene.add(this.markers);
    this.settings = null;

    this.raycaster = new THREE.Raycaster();
    this.pointerDown = null;
    const el = this.renderer.domElement;
    el.addEventListener("pointerdown", (e) => (this.pointerDown = { x: e.clientX, y: e.clientY }));
    el.addEventListener("pointerup", (e) => this.onPointerUp(e));

    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
    this.renderer.setAnimationLoop(() => {
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
    });
  }

  emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  resize() {
    const { clientWidth: w, clientHeight: h } = this.container;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  async load(bytes, fileName, settings) {
    this.unload();
    this.settings = settings;
    const mesh = new SplatMesh({ fileBytes: bytes, fileName, raycastable: true });
    this.root.add(mesh);
    await mesh.initialized;
    this.mesh = mesh;
    this.applyTransform();
    for (const z of settings.zones) this.createZone(z);
    this.frame();
    return mesh;
  }

  unload() {
    this.selectZone(null);
    for (const z of this.zones) z.edit.removeFromParent();
    this.zones = [];
    this.clearMeasure();
    if (this.mesh) {
      this.mesh.removeFromParent();
      this.mesh.dispose();
      this.mesh = null;
    }
  }

  applyTransform() {
    this.root.quaternion.copy(this.settings.upright ? UPRIGHT : new THREE.Quaternion());
    this.root.scale.setScalar(this.settings.scale);
    this.root.updateMatrixWorld(true);
  }

  setUpright(on) {
    this.settings.upright = on;
    this.applyTransform();
    this.frame();
  }

  worldBox() {
    const box = this.mesh.getBoundingBox(true).clone();
    return box.applyMatrix4(this.mesh.matrixWorld);
  }

  // Stand in the middle of the room, a little back from the centre, looking in.
  frame() {
    if (!this.mesh) return;
    const box = this.worldBox();
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const span = Math.max(size.x, size.y, size.z) || 1;
    this.controls.target.copy(center);
    this.camera.position.copy(center).add(new THREE.Vector3(0, 0, span * 0.35));
    this.camera.near = span / 2000;
    this.camera.far = span * 20;
    this.camera.updateProjectionMatrix();
    this.controls.update();
  }

  // ---- Zones: boxes that recolour or hide the splats inside them ----

  addZone(kind) {
    const span = this.mesh ? this.worldBox().getSize(new THREE.Vector3()).length() : 4;
    const half = (span * 0.06) / this.settings.scale;
    // Drop the zone on whatever surface is in the middle of the view.
    this.raycaster.setFromCamera(new THREE.Vector2(0, 0), this.camera);
    const hit = this.mesh && this.raycaster.intersectObject(this.mesh, false)[0];
    const local = this.root.worldToLocal((hit ? hit.point : this.controls.target).clone());
    const data = {
      id: crypto.randomUUID(),
      kind,
      color: kind === "paint" ? "#c8b8a6" : null,
      position: local.toArray(),
      quaternion: [0, 0, 0, 1],
      scale: [half, half, half],
    };
    this.settings.zones.push(data);
    const zone = this.createZone(data);
    this.selectZone(zone);
    this.emit("zoneschange");
    return zone;
  }

  createZone(data) {
    const paint = data.kind === "paint";
    const edit = new SplatEdit({
      rgbaBlendMode: paint ? SplatEditRgbaBlendMode.SET_RGB : SplatEditRgbaBlendMode.MULTIPLY,
      softEdge: 0.01,
    });
    const sdf = new SplatEditSdf({
      type: SplatEditSdfType.BOX,
      color: paint ? splatColor(data.color) : new THREE.Color(1, 1, 1),
      opacity: paint ? 1 : 0,
    });
    // A box SDF's scale is its half size, so a 2x2x2 outline matches it exactly.
    const outline = new THREE.Mesh(
      new THREE.BoxGeometry(2, 2, 2),
      new THREE.MeshBasicMaterial({
        color: paint ? 0xd27a4e : 0x6aa0ff,
        transparent: true,
        opacity: 0.08,
        depthWrite: false,
      }),
    );
    outline.add(new THREE.LineSegments(
      new THREE.EdgesGeometry(outline.geometry),
      new THREE.LineBasicMaterial({ color: paint ? 0xd27a4e : 0x6aa0ff }),
    ));
    sdf.add(outline);
    sdf.position.fromArray(data.position);
    sdf.quaternion.fromArray(data.quaternion);
    sdf.scale.fromArray(data.scale);
    edit.add(sdf);
    this.root.add(edit);

    const zone = { data, edit, sdf, outline };
    outline.userData.zone = zone;
    this.zones.push(zone);
    return zone;
  }

  selectZone(zone) {
    this.selected = zone;
    if (zone) this.gizmo.attach(zone.sdf);
    else this.gizmo.detach();
    for (const z of this.zones) z.outline.material.opacity = z === zone ? 0.16 : 0.08;
    this.emit("select", zone);
  }

  setGizmoMode(mode) {
    this.gizmo.setMode(mode);
  }

  setZoneColor(zone, hex) {
    zone.data.color = hex;
    zone.sdf.color.copy(splatColor(hex));
    this.emit("zoneschange");
  }

  deleteZone(zone) {
    this.selectZone(null);
    zone.edit.removeFromParent();
    this.zones = this.zones.filter((z) => z !== zone);
    this.settings.zones = this.settings.zones.filter((d) => d !== zone.data);
    this.emit("zoneschange");
  }

  syncZoneData() {
    for (const z of this.zones) {
      z.data.position = z.sdf.position.toArray();
      z.data.quaternion = z.sdf.quaternion.toArray();
      z.data.scale = z.sdf.scale.toArray().map(Math.abs);
    }
  }

  // ---- Measuring: two clicks on the room, then the real distance ----

  startMeasure() {
    this.selectZone(null);
    this.clearMeasure();
    this.mode = "measure";
  }

  clearMeasure() {
    this.mode = null;
    this.measurePoints = [];
    this.markers.clear();
  }

  // Distance between the two picked points in the file's own units.
  measuredUnits() {
    const [a, b] = this.measurePoints;
    return a.distanceTo(b) / this.settings.scale;
  }

  applyScale(metres) {
    const units = this.measuredUnits();
    this.settings.scale = metres / units;
    this.settings.metresPerUnit = this.settings.scale;
    this.clearMeasure();
    this.applyTransform();
    this.frame();
  }

  addMarker(point) {
    const span = this.worldBox().getSize(new THREE.Vector3()).length();
    const dot = new THREE.Mesh(
      new THREE.SphereGeometry(span * 0.004, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0xffd25e, depthTest: false }),
    );
    dot.renderOrder = 10;
    dot.position.copy(point);
    this.markers.add(dot);
    if (this.measurePoints.length === 2) {
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(this.measurePoints),
        new THREE.LineBasicMaterial({ color: 0xffd25e, depthTest: false }),
      );
      line.renderOrder = 10;
      this.markers.add(line);
    }
  }

  pick(e) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.camera);
  }

  onPointerUp(e) {
    const down = this.pointerDown;
    this.pointerDown = null;
    if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > CLICK_SLOP_PX) return;
    if (this.gizmo.dragging || !this.mesh) return;
    this.pick(e);

    if (this.mode === "measure") {
      const hit = this.raycaster.intersectObject(this.mesh, false)[0];
      if (!hit) return;
      this.measurePoints.push(hit.point.clone());
      this.addMarker(hit.point);
      if (this.measurePoints.length === 2) this.emit("measured", this.measuredUnits());
      return;
    }

    const outlines = this.zones.map((z) => z.outline);
    const hit = this.raycaster.intersectObjects(outlines, false)[0];
    this.selectZone(hit ? hit.object.userData.zone : null);
  }
}
