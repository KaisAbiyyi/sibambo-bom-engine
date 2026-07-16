# Iteration 2B — Geometry Loading, Logical Walls, Rooms, and Inspection Modes

## Result

Iteration 2B complete for both SMBOOST target fixtures.

- Geometry ingestion now registers every valid source mesh before semantic classification.
- Door, door-frame, window, window-frame, glass, leaf, trim, and unresolved child meshes remain independent render objects.
- Wall checker uses logical walls assembled from coplanar groups, opposite surface pairs, and attached cap/side faces.
- Room list is deterministic `Ruang 1..N`; room hover/selection uses separate analytical overlay state.
- Solid, X-Ray, and Wireframe reuse one scene graph, cached derived materials, and cached edge geometry.
- Development diagnostics are exposed through `ParsedBuildingModel.inspectionDiagnostics`.

## Root cause

Source ingestion was not deleting opening geometry. Both target files already produced complete runtime groups: 70/70 source mesh definitions for Model 1 and 66/66 for Model 2.

Opening geometry disappeared at visibility application:

1. compact semantic `partStats` only exposed `roof`, `walls`, `floor`, and `ceiling`;
2. runtime grouping correctly reassigned opening child faces to `doors`, `windows`, `structure`, or `foundation`;
3. centralized visibility built its category map only from `partStats`;
4. absent categories resolved to `false`, hiding every mesh, child, outline, and fallback in those categories.

Specific causes:

- Door leaves: registered, then hidden because `doors` was absent from visibility map.
- Door frames: registered as nested child meshes; inherited hidden door category. Duplicate removal did not delete them.
- Window/glass geometry: registered, then hidden because `windows` was absent from visibility map.
- Window frames: registered as nested child meshes; inherited hidden window category.

Transforms, index conversion, front/back culling, duplicate-removal, and parent-only registration were not root causes. Surface materials already used `DoubleSide`.

## Rules introduced

### Geometry registry

- Raw source nodes and distinct source meshes have stable IDs.
- Mesh buffers remain definition-local; every occurrence retains local/world transforms and hierarchy path.
- Invalid mesh payloads receive explicit reasons.
- Unresolved semantic state never removes renderability.
- Render coverage compares registry mesh IDs against runtime scene groups.

### Opening assemblies

- Logical opening references child meshes without merging buffers or materials.
- Child roles: leaf/panel, frame/mullion/sash, glass, and trim/sill/threshold/handle.
- Per-occurrence child mesh IDs include hierarchy-derived stable hashes.
- Every accepted opening retains nearest logical wall relationship.

### Logical walls

- Major vertical surface candidates require meaningful height, length, and area.
- Coplanar continuous surfaces group within angle, plane-distance, connectivity, hierarchy, and storey tolerances.
- Opposite surfaces pair at plausible 0.03–0.60 m thickness with projected overlap.
- Perpendicular faces and different storeys remain separate.
- Opening-frame and glass surfaces are excluded.
- Same-source cap/side faces attach after main wall construction.
- Gross, opening, and net area remain separate.

### Room interaction

- Ordering: elevation, X, Z, stable room ID.
- Display names: `Ruang 1..N`.
- No room visibility checkbox.
- Selected room outranks hovered room.
- Hover never changes camera state.
- Valid height creates volume prism; uncertain height keeps footprint/boundary only.

### View modes

- Solid restores original material object.
- X-Ray uses category-aware opacity, `depthWrite=false`, normal depth test, double-sided surfaces, and cached semantic edges.
- Wireframe uses cached derived wireframe materials and preserves picking geometry.
- Derived materials and edge buffers dispose on model unload.

## Regression results

### PROJECT SBOOST 1

| Metric | Before | After |
| --- | ---: | ---: |
| Source mesh definitions | 70 | 70 |
| Visible/render-enabled mesh definitions | 40 | 70 |
| Valid meshes excluded by visibility state | 30 | 0 |
| Raw major wall surfaces | 46 | 46 |
| Logical wall checker entries | 46 | 28 |
| Paired opposite wall groups | 0 | 18 |
| Attached wall side/cap faces | 0 | 34 |
| Rooms | 7 | 7 |
| Room footprint area | 208.00 m² | 208.00 m² |
| Room volume | 555.97 m³ | 555.97 m³ |
| Doors | 4 | 4 |
| Door-frame mesh instances visible | 0 | 9 |
| Windows | 8 | 8 |
| Window-frame mesh instances visible | 0 | 8 |
| Unresolved opening components | 0 | 0 |

### PROJECT SBOOST 2

| Metric | Before | After |
| --- | ---: | ---: |
| Source mesh definitions | 66 | 66 |
| Visible/render-enabled mesh definitions | 39 | 66 |
| Valid meshes excluded by visibility state | 27 | 0 |
| Raw major wall surfaces | 48 | 48 |
| Logical wall checker entries | 48 | 30 |
| Paired opposite wall groups | 0 | 18 |
| Attached wall side/cap faces | 0 | 35 |
| Rooms | 6 | 6 |
| Room footprint area | 115.76 m² | 115.76 m² |
| Room volume | 307.17 m³ | 307.17 m³ |
| Doors | 4 | 4 |
| Door-frame mesh instances visible | 0 | 8 |
| Windows | 9 | 9 |
| Window-frame mesh instances visible | 0 | 9 |
| Unresolved opening components | 0 | 0 |

Both models: invalid meshes 0, missing logical source meshes 0, orphaned frames 0, rooms without ceiling 0, incomplete final rooms 0.

## Files changed

- `src/lib/geometry-registry.ts`
- `src/lib/geometry-registry.test.ts`
- `src/lib/logical-walls.ts`
- `src/lib/logical-walls.test.ts`
- `src/lib/room-interaction.ts`
- `src/lib/room-interaction.test.ts`
- `src/lib/render/material-state.ts`
- `src/lib/render/material-state.test.ts`
- `src/lib/render/build-runtime-scene.ts`
- `src/lib/render/build-runtime-scene.test.ts`
- `src/lib/render/visibility.test.ts`
- `src/lib/smboost-analysis.ts`
- `src/lib/smboost-analysis.test.ts`
- `src/lib/model.ts`
- `src/lib/model-regression.test.ts`
- `src/lib/ModelCanvas.svelte`
- `src/routes/+page.svelte`
- `src/routes/api/debug-model/smboost/[id]/+server.ts`

## Verification

- `bun test src/`: 448 passed, 0 failed, 2,035 assertions.
- `bun run check`: 0 errors, 0 warnings.
- `bun run build`: passed.
- Browser console: 0 errors, 0 warnings during Solid/X-Ray/Wireframe, room selection, door selection, and wall-list checks.
- Production build retains existing advisory for client chunk above 500 kB; build completes successfully.

## Performance impact

- Registry references existing typed arrays; it does not clone source buffers per instance.
- Wall pairing is quadratic only over filtered wall surface groups (46 and 48 in target fixtures).
- Mode switching changes cached material/render state; it does not parse model data or rebuild scene geometry.
- Edges are created once per runtime group and reused across mode changes.
- Room hover rebuilds one small analytical overlay only; source scene remains unchanged.

## Known limitations

- Unpaired wall surfaces remain individual logical walls when opposite-side evidence is absent or outside tolerance.
- J0006 windows in Model 1 contain five preserved child meshes but no child names matching explicit glass/leaf aliases. Geometry is rendered; glass/leaf semantic role remains source-model metadata limitation.
- Edge cache uses `EdgesGeometry`; full triangle topology appears only in Wireframe mode.
- Existing client bundle-size advisory remains. No optimization, lighting, thermal, AC, OTTV, or ventilation formulas changed.

## Screenshots

Captured artifacts:

- `solid.png`
- `xray.png`
- `wireframe.png`
- `room-highlight.png`
- `openings-restored.png`
- `logical-wall-list.png`

Artifact directory: `C:/Users/kaisa/.codex/visualizations/2026/07/16/019f6a10-097e-7c01-a3c0-51530479bff3/iteration-2b`.
