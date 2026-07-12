# BOM Engine v3: Baseline Audit

Date: 2026-07-13 (Asia/Jakarta)  
Branch: `feature/bom-v3-e2e-regression`  
Baseline commit: `48d7c2d`

## Workspace

```text
.
├── bom_engine_plugin/       SketchUp Ruby exporter
├── model-eval/              SvelteKit + Three.js evaluator
├── skps/                    five source SketchUp models; never modified
├── scripts/benchmarks/      reproducible parser/render benchmarks
├── scripts/sketchup/        read-only SketchUp capture/export harness
└── artifacts/<model>/
    ├── sketchup/            six reference views
    ├── exported/            legacy full JSON and BOME v1 gzip
    ├── model-eval/
    ├── comparisons/
    ├── logs/
    └── metrics/
```

## Method

- Every `.skp` was opened directly through SketchUp 2026 UI.
- Each model was zoomed to extents and captured in orthographic isometric, front, back, left, right, and top views.
- Camera position, target, up vector, projection, orthographic height, effective viewport aspect ratio, viewport size, style, hidden state, and timestamp were saved with every image.
- Source model modified state remained `false`; no source `.skp` was saved or overwritten.
- Legacy full and visual exports used the currently installed plugin before v3 implementation.
- Export timing below uses the plugin's measured export duration. UI/message-box wait is recorded separately in artifact metrics.
- Model-eval timing uses its real `readBomModelData`, `parseBomModelJson`, and Three.js `ShapeUtils.triangulateShape` paths. Each visual benchmark ran in a fresh Bun process.
- Browser baseline loaded the repository sample at 1982×1170. Browser console had zero warning/error entries.

## Source and export baseline

| Model | SKP | Units | Bounds X×Y×Z (m) | Source faces | Groups | Definitions | Instances | Materials | Full JSON | Full export | BOME gzip | Visual export |
| --- | ---: | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| house2 | 440,016 B | Inches | 7.347×15.581×6.566 | 3,661 | 4 | 40 | 97 | 19 | 6.79 MB | 1.18 s | 102,744 B | 0.88 s |
| presentation20 | 2,155,445 B | Inches | 30.480×32.004×16.813 | 457,982 | 5,537 | 85 | 8,977 | 31 | 466.93 MB | 132.76 s | 2.20 MB | 59.00 s |
| project-sboost | 3,548,875 B | Millimeters | 14.000×29.716×8.609 | 14,444 | 144 | 150 | 85 | 51 | 20.39 MB | 4.52 s | 70,200 B | 1.99 s |
| project-sboost-2 | 3,363,219 B | Millimeters | 13.559×29.710×8.517 | 25,865 | 126 | 154 | 107 | 48 | 31.32 MB | 10.16 s | 68,529 B | 3.58 s |
| test | 163,941 B | Meters | 20.536×27.198×1.593 | 111 | 0 | 1 | 1 | 21 | 1.04 MB | 0.27 s | 10,653 B | 0.21 s |

All models have zero scenes. Tag counts are 5, 5, 22, 19, and 1 respectively. Texture source paths reported missing where SketchUp material bitmaps were embedded or no longer present on disk; no model-open blocking warning appeared.

## Model-eval load baseline

| Model | Input | Decompressed | Faces | Vertices | Triangles | Pipeline | Heap Δ | RSS Δ | Result |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| house2 | 102,744 B | 686,492 B | 9,490 | 28,470 | 9,490 | 87.84 ms | 13.5 MB | 39.6 MB | PASS |
| presentation20 | 2.20 MB | 10.47 MB | 145,338 | 436,014 | 145,338 | 1,273.30 ms | 105.6 MB | 272.2 MB | PASS |
| project-sboost | 70,200 B | 510,852 B | 7,002 | 21,006 | 7,002 | 114.25 ms | 2.7 MB | 42.0 MB | PASS |
| project-sboost-2 | 68,529 B | 479,940 B | 6,579 | 19,737 | 6,579 | 112.51 ms | 2.6 MB | 41.9 MB | PASS |
| test | 10,653 B | 69,376 B | 932 | 2,796 | 932 | 19.66 ms | 0.0 MB | 8.1 MB | PASS |

The 466.93 MB `presentation20` full JSON is rejected by model-eval's 80 MiB upload limit. Other full JSON files load, but use 2–12× more pipeline time and up to 191.3 MB additional heap. Per-model raw measurements are in `artifacts/<model>/metrics/baseline-model-eval.json`.

## Old classifier output

Counts below come from the visual BOME path actually intended for production loading.

| Model | Largest old categories | Clear failure signal |
| --- | --- | --- |
| house2 | other 5,101; roof 1,462; floor 1,202; ceiling 987 | More than half the triangles become `other`; openings depend on flattened surface heuristics. |
| presentation20 | roof 92,012; floor 17,336; other 14,627; walls 14,447 | 63% of all triangles become roof despite a multi-storey flat-roof building. |
| project-sboost | other 2,616; roof 870; doors 840; windows 760 | Door/window counts are dominated by false positives. |
| project-sboost-2 | other 2,386; roof 894; windows 764; floor 727 | Same false-positive pattern; rules do not exploit hierarchy or host relationships. |
| test | furniture 930; floor 2 | Default person component is reasonably furniture-like, but no confidence/alternative trace exists. |

Old classifier cannot emit a true `unknown`. It forces every face into a coarse `PartKey`, exposes only aggregate confidence, and does not record candidate scores, positive/negative evidence, rule IDs, or conflict resolution.

## Current exporter format audit

### Legacy full JSON (`schema_version: "2.1"`)

- Geometry is recursively expanded into world-space entity trees.
- Faces carry explicit vertices, holes, material, color, area, layer, and hierarchy path.
- Component definitions contain descriptive metadata and bounds only; definition-local geometry is not referenced by instances.
- Reused components therefore duplicate faces, vertices, materials, names, and transforms.
- No checked-in JSON Schema or normative field documentation exists.
- Source identity is inconsistent: IDs exist on entities but there is no stable node/definition/mesh identity model.

### BOME v1 / compact mesh v1

- `BOME1\n` container: JSON header, one `Int32` position block, one `Int32` face table.
- Fixed 1 mm position quantization, 0.0001 m² area quantization, and 0.0001 normal quantization.
- Streaming writer avoids holding the final arrays in Ruby memory.
- Every component instance is still recursively expanded to world-space polygons.
- `Sketchup::Face#mesh.polygons` becomes triangles. Original outer loops, holes, hierarchy, definitions, transforms, instances, source IDs, and room relationships are lost.
- No per-mesh quantization error bound, chunk directory, random-access section, progressive manifest, or indexed vertex reuse exists.

## Current model-eval audit

- Supports legacy entity JSON and BOME v1.
- SketchUp `{x,y,z}` maps to Three.js `{x,z,-y}`.
- Full JSON faces use dominant-plane triangulation with holes. BOME v1 faces arrive already triangulated and cannot recover holes.
- Classification starts with regex/name/material/surface heuristics, then elevation and bounding-box refinements. It does not have a versioned rule bank or reusable evidence graph.
- Renderer builds non-indexed category geometry. One source vertex is repeated for every triangle corner; normals are recomputed client-side.
- Initial production bundle contains a 564.72 kB Three.js chunk.
- UI hard limits are 80 MiB compressed input and 120 MiB decompressed input.

## Root causes

1. Component instancing discarded at export. High-reuse models pay repeated traversal, serialization, parse, and render-buffer cost.
2. Canonical and runtime requirements mixed. Full JSON is semantically rich but huge; BOME v1 is small but destroys semantics needed by classifier and visual parity.
3. BOME v1 records triangles rather than indexed definition-local meshes. Geometry deduplication is effectively zero.
4. Flattened BOME path removes names, definition identity, transforms, holes, adjacency, and opening-host relationships. Classifier falls back to weak geometric evidence.
5. Classifier has forced coarse categories and no unknown threshold. Weak evidence becomes confident-looking output.
6. Renderer duplicates triangle vertices and builds all geometry eagerly. `presentation20` reaches 272.2 MB RSS growth from a 2.20 MB gzip file.
7. Camera metadata previously treated SketchUp's `camera.aspect_ratio == 0` as literal zero. Baseline harness now records the effective viewport ratio instead.

## Baseline evidence

- SketchUp evidence: `artifacts/<model>/sketchup/*.png`
- Camera and inventory: `artifacts/<model>/metrics/baseline-sketchup.json`
- Export timing: `artifacts/<model>/metrics/baseline-export-{full,visual}.json`
- Parser/render metrics: `artifacts/<model>/metrics/baseline-model-eval.json`
- Browser screenshot: `artifacts/_workflow/model-eval-baseline-sample.png`
- Browser console: `artifacts/_workflow/logs/baseline-browser-console.json`

## Existing verification

- `bun test`: 21 passed, 0 failed.
- `bun run check`: 0 errors, 0 warnings.
- `bun run build`: passed; warned about the 564.72 kB Three.js chunk and adapter-auto deployment selection.
- Ruby CLI is absent. SketchUp-dependent syntax/runtime tests must run inside SketchUp 2026 Ruby.

## Open acceptance items after baseline

- Implement schema v3 and compatibility layer.
- Implement BOME v2 instancing/indexing/progressive sections and quantify visual error.
- Add adaptive classifier, trace inspector, labels/ground truth, and regression metrics.
- Install backed-up plugin build into SketchUp 2026 and rerun full corpus.
- Load every new export in browser model-eval, capture matched views, create overlays/diffs, and issue per-model verdicts.
