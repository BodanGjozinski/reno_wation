// Writes public/sample-room.ply: a small synthetic room as a 3D Gaussian splat,
// in the same layout Postshot exports (COLMAP axes, Y down), so the app's
// "upright" flip applies to it like a real capture.
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const out = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "sample-room.ply");

const W = 4.0; // x, metres
const D = 3.2; // z
const H = 2.6; // y
const STEP = 0.035;
const SH_C0 = 0.28209479177387814;

const splats = [];
let seed = 7;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

function add(x, y, z, [r, g, b], size = STEP * 0.75) {
  const n = (rand() - 0.5) * 0.06;
  splats.push({ x, y, z, r: r + n, g: g + n, b: b + n, s: size });
}

function plane(origin, u, v, nu, nv, colorAt) {
  for (let i = 0; i <= nu; i++) {
    for (let j = 0; j <= nv; j++) {
      const a = i / nu;
      const c = j / nv;
      const p = origin.map((o, k) => o + u[k] * a + v[k] * c);
      add(p[0], p[1], p[2], colorAt(a, c));
    }
  }
}

function box(cx, cy, cz, sx, sy, sz, color) {
  const x0 = cx - sx / 2, y0 = cy, z0 = cz - sz / 2;
  const n = (len) => Math.max(2, Math.round(len / STEP));
  plane([x0, y0 + sy, z0], [sx, 0, 0], [0, 0, sz], n(sx), n(sz), () => color.map((c) => c * 1.08));
  plane([x0, y0, z0], [sx, 0, 0], [0, sy, 0], n(sx), n(sy), () => color);
  plane([x0, y0, z0 + sz], [sx, 0, 0], [0, sy, 0], n(sx), n(sy), () => color);
  plane([x0, y0, z0], [0, 0, sz], [0, sy, 0], n(sz), n(sy), () => color.map((c) => c * 0.9));
  plane([x0 + sx, y0, z0], [0, 0, sz], [0, sy, 0], n(sz), n(sy), () => color.map((c) => c * 0.9));
}

const nW = Math.round(W / STEP), nD = Math.round(D / STEP), nH = Math.round(H / STEP);
const wall = [0.86, 0.83, 0.78];

// Floor: oak boards.
plane([-W / 2, 0, -D / 2], [W, 0, 0], [0, 0, D], nW, nD, (a, c) => {
  const board = Math.floor(a * 18) % 3;
  const t = [0.0, 0.05, -0.04][board];
  return [0.62 + t, 0.45 + t, 0.29 + t];
});
// Ceiling.
plane([-W / 2, H, -D / 2], [W, 0, 0], [0, 0, D], nW, nD, () => [0.95, 0.95, 0.93]);
// Back wall with a window.
plane([-W / 2, 0, -D / 2], [W, 0, 0], [0, H, 0], nW, nH, (a, c) =>
  a > 0.35 && a < 0.65 && c > 0.35 && c < 0.8 ? [0.75, 0.88, 1.0] : wall);
// Front wall with a door.
plane([-W / 2, 0, D / 2], [W, 0, 0], [0, H, 0], nW, nH, (a, c) =>
  a > 0.7 && a < 0.9 && c < 0.78 ? [0.55, 0.4, 0.3] : wall);
// Side walls, one accent.
plane([-W / 2, 0, -D / 2], [0, 0, D], [0, H, 0], nD, nH, () => [0.42, 0.55, 0.52]);
plane([W / 2, 0, -D / 2], [0, 0, D], [0, H, 0], nD, nH, () => wall);

// Furniture.
box(-1.2, 0, 0.2, 0.9, 0.45, 2.0, [0.25, 0.3, 0.45]); // sofa seat
box(-1.55, 0.45, 0.2, 0.2, 0.4, 2.0, [0.22, 0.27, 0.42]); // sofa back
box(0.4, 0, 0.1, 1.0, 0.42, 0.6, [0.35, 0.22, 0.14]); // coffee table
box(1.6, 0, -1.2, 0.6, 1.8, 0.4, [0.9, 0.9, 0.88]); // cabinet
box(0.0, 0.0, -1.3, 1.6, 0.02, 1.0, [0.7, 0.2, 0.2]); // rug

const header = [
  "ply",
  "format binary_little_endian 1.0",
  `element vertex ${splats.length}`,
  ...["x", "y", "z", "nx", "ny", "nz", "f_dc_0", "f_dc_1", "f_dc_2", "opacity",
    "scale_0", "scale_1", "scale_2", "rot_0", "rot_1", "rot_2", "rot_3"].map((p) => `property float ${p}`),
  "end_header",
  "",
].join("\n");

const FLOATS = 17;
const body = new Float32Array(splats.length * FLOATS);
splats.forEach((s, i) => {
  const o = i * FLOATS;
  const clamp = (v) => Math.min(1, Math.max(0, v));
  // Room axes are Y up; Postshot/COLMAP files are Y down, Z flipped.
  body.set([
    s.x, -s.y, -s.z, 0, 0, 0,
    (clamp(s.r) - 0.5) / SH_C0, (clamp(s.g) - 0.5) / SH_C0, (clamp(s.b) - 0.5) / SH_C0,
    4.0, // logit opacity, about 0.98
    Math.log(s.s), Math.log(s.s), Math.log(s.s),
    1, 0, 0, 0,
  ], o);
});

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, Buffer.concat([Buffer.from(header, "ascii"), Buffer.from(body.buffer)]));
console.log(`Wrote ${splats.length} splats to ${out}`);
