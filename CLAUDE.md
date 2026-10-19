# RenovateBySeeing

A personal web app for Bodan: upload photos, videos and floor plans of a property
(apartment, house, room, bathroom, land), see it in 3D in the browser, and try
renovations on it. The UI should stay simple and elegant. It is for personal use,
not a product, so prefer free tools and local-first storage.

## Where things stand

The first piece is built: a viewer for Gaussian splat scenes (`.ply`, `.spz`,
`.splat`, `.ksplat`) with upright flip, real-world scale from two clicks, paint
zones, hide zones, and a per-scene library in IndexedDB. See `README.md` for the
feature list and file map.

```bash
npm install
npm run dev     # http://localhost:5173, regenerates public/sample-room.ply first
npm run build
```

Stack: Vite 6, three.js 0.180, `@sparkjsdev/spark` 2.3.1 for splat rendering and
edits. Plain JS modules, no framework. Keep it that way unless a feature clearly
needs one.

## How scenes are made (outside the app)

Phone video of a room → processed on Bodan's Windows laptop (RTX 4070 Laptop,
8 GB VRAM) → one splat file → dropped into the app.

- **Postshot** (Jawset) does video to splat in one app. Exporting PLY/SPZ needs the
  Indie plan (€17/month or €204/year); the free plan only exports camera poses.
- **Brush** (open source, v0.3.0) trains splats for free from COLMAP poses and
  exports PLY only. It has a CLI, so it can be automated later.
- Free route: Postshot Free for camera poses, then Brush for the final scene.

## Gotchas already learned

- Postshot and Brush exports use COLMAP axes (Y down). The viewer flips them with
  quaternion `(1, 0, 0, 0)`; that is the "Upright" toggle.
- A Spark `SplatEditSdf` box uses its `scale` as half extents, so the outline mesh
  is a 2×2×2 box to match.
- Splat colours are raw sRGB. Feed picked colours in with
  `setStyle(hex, THREE.LinearSRGBColorSpace)` or they render too dark.
- Zones live under the `root` group, not the `SplatMesh`, so they follow the
  upright flip and scale.

## Roadmap (agreed direction, not yet built)

1. Test with a real capture of one room and fix whatever that shows.
2. Paint that keeps light and shadow (modulate by original luminance instead of
   setting a flat RGB).
3. Furniture: load glTF models into the same three.js scene, place and scale them.
4. Floor plans: trace walls on an uploaded plan image and extrude them into a 3D
   room that can be edited (walls moved or removed).
5. Optional helper on the laptop that runs Brush automatically from a video.

Removing walls or furniture from a splat leaves holes, since nothing was captured
behind them. Structural changes belong on the floor-plan side.

## Working conventions

- Match the existing style: small modules, short comments that explain why.
- Check UI changes in a real browser (Playwright with the bundled Chromium works
  with `--use-angle=swiftshader`), including phone width.
- Commit with clear messages; Bodan reviews on GitHub.
