# BOM Engine v3 End-to-End Corpus Results

Date: 2026-07-13  
Branch: `feature/bom-v3-e2e-regression`  
Status: **ACCEPTANCE PASS**

## Outcome

Five source SKP files were opened directly in SketchUp 2026. Each model was inventoried, captured from six matched cameras, exported through the installed BOM Engine 3.0.0 plugin, schema/container validated, loaded in browser model-eval, and visually compared.

- Export success: 10/10 outputs, 100%.
- Browser load success: 30/30 matched views, 100%.
- Visual result: 5/5 `PASS_WITH_RENDERING_DIFFERENCE`.
- Source SKP modifications: 0.
- SketchUp references: 30 screenshots.
- model-eval captures: 30 screenshots.
- Comparison outputs: 90 side-by-side/overlay/difference images and 5 reports.

Machine-readable aggregate: `artifacts/_workflow/final-regression-summary.json`.

## Format result

Canonical JSON v3 is the authoritative analysis/interchange format. BOME2 is the production Three.js runtime. Legacy v2.1 JSON and BOME1 remain readable during migration. GLB is an optional derived visual format; it does not replace canonical semantics.

| Aggregate | Baseline | v3 | Change |
| --- | ---: | ---: | ---: |
| Full JSON / Canonical gzip | 526,468,965 B raw JSON | 4,383,267 B gzip | -99.17% transferred bytes |
| BOME1 / BOME2 gzip | 2,453,265 B | 1,127,707 B | -54.03% |
| Runtime decode/build | 8,347.22 ms | 596.71 ms | 13.99x faster |
| Maximum measured quantization error | n/a | 0.3350 mm | inside 1 mm budget |

BOME2 can be larger than BOME1 on small or low-reuse models because it retains hierarchy, source references, polygon loops, materials, checksums, and progressive sections. Corpus aggregate is smaller because the component-heavy model benefits strongly from definition reuse and instancing.

## Per-model runtime

| Model | SKP | BOME1 gzip | BOME2 gzip | BOME2 export | BOME1 runtime | BOME2 runtime | Browser cold load | JS heap at first frame | Visible groups | Visual |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| house2 | 440,016 B | 102,744 B | 98,366 B | 0.915 s | 471.43 ms | 59.98 ms | 1.05 s | 62.3 MB | 88/88 | PASS_WITH_RENDERING_DIFFERENCE |
| presentation20 | 2,155,445 B | 2,201,139 B | 380,049 B | 38.939 s | 6,857.42 ms | 299.34 ms | 137.93 s | 2,563.4 MB | 294/294 | PASS_WITH_RENDERING_DIFFERENCE |
| project-sboost | 3,548,875 B | 70,200 B | 308,707 B | 2.507 s | 532.74 ms | 116.30 ms | 3.57 s | 187.1 MB | 117/117 | PASS_WITH_RENDERING_DIFFERENCE |
| project-sboost-2 | 3,363,219 B | 68,529 B | 307,978 B | 3.238 s | 415.53 ms | 101.30 ms | 5.48 s | 266.1 MB | 105/105 | PASS_WITH_RENDERING_DIFFERENCE |
| test | 163,941 B | 10,653 B | 32,607 B | 0.242 s | 70.10 ms | 19.79 ms | 0.43 s | 40.6 MB | 22/22 | PASS_WITH_RENDERING_DIFFERENCE |

Runtime benchmark measures gzip decode, checksum/container validation, indexed buffer construction, axis conversion, and instance grouping in one Bun process. Browser cold load additionally performs compatibility expansion and adaptive classification.

## Classifier regression

Ground truth is **silver explicit metadata, not human-verified labels**. Only faces with unambiguous multilingual category tokens are scored. Geometry-only predictions remain in whole-model unknown/ambiguous statistics but do not inflate precision or recall.

| Metric | Result |
| --- | ---: |
| Labelled silver faces | 43,473 / 496,862 |
| Silver coverage | 8.75% |
| Accuracy on labelled subset | 99.89% |
| Macro F1, categories with silver support | 0.996852 |
| Whole-corpus unknown rate | 9.44% |
| Whole-corpus ambiguous rate | 9.38% |

Supported-category F1:

- roof: 1.000000, support 428;
- floor: 0.989540, support 483;
- door: 1.000000, support 38,060;
- window: 0.994722, support 3,619;
- furniture: 1.000000, support 883.

Unsupported categories are reported with support 0, not treated as validated. Full per-category precision/recall/F1 and confusion matrix are stored in the aggregate JSON. `test.skp` intentionally demonstrates unknown fallback: no explicit silver labels, 99.10% unknown/ambiguous, and no forced classification.

## Visual verification

All comparisons use exact captured SketchUp projection, position, target, up vector, orthographic height/FOV, aspect ratio, viewport 1982 x 1170, background, and visibility state.

Pass/fail uses multiple signals:

- BOME2 rendered bounds versus canonical visible bounds;
- full runtime-group visibility;
- silhouette area, normalized bounds, centroid, and tolerant boundary F1;
- manual inspection of handedness, axes, origin, scale, hierarchy, transforms, instances, holes, materials, and representative facade/top views.

Pixel difference is never the sole gate. Expected rendering differences are SketchUp edge outlines, absent embedded texture bitmaps, lighting, shadows, antialiasing, and material shading. Model `test` exposed a real regression: adaptive classifier category and BOME2 `surface_hint` disagreed, hiding the default figure. Source-face identity mapping now applies classifier categories to runtime groups; regression tests cover the fix.

## Remaining bottleneck

`presentation20` contains 452,937 expanded faces from 18,414 runtime group instances. BOME2 runtime-only decode/build takes 299.34 ms, but browser compatibility analysis expands and classifies every occurrence, producing 137.93 s cold load and 2.69 GB observed peak heap during QA.

Next performance work should classify definition-local faces once, cache context-independent evidence, and apply only elevation/host/context deltas per occurrence. This is a documented performance limitation, not an export/load failure. Rendering geometry remains indexed and instanced.

## Verification commands

```powershell
cd model-eval
bun test
bun run check
bun run build

cd ..
bun scripts/benchmarks/benchmark-runtime-formats.ts --slug=<model>
bun run benchmark:final
python scripts/visual/compare_views.py
```

Latest results:

- model-eval tests: 57 passed, 0 failed;
- Svelte check: 0 errors, 0 warnings;
- production build: passed;
- canonical schema validation: 5/5;
- installed SketchUp plugin suites: classifier 21/21, traversal 9/9, integration 12/12, canonical/BOME2 suites passed;
- browser console: 0 errors in final QA; only Vite connect debug entries.

## Evidence map

- Architecture: `docs/adr/0001-canonical-json-and-bome2-runtime.md`
- Canonical contract: `bom_engine_plugin/FORMAT_V3.md`
- BOME2 contract: `bom_engine_plugin/BOME2_FORMAT.md`
- JSON Schema: `bom_engine_plugin/schema/bom-engine-3.0.schema.json`
- Canonical example: `bom_engine_plugin/examples/canonical-v3-small.json`
- GLB evaluation: `docs/benchmarks/glb-evaluation.md`
- Plugin installation: `docs/audits/2026-07-13-plugin-install-verification.md`
- Per-model visual reports: `artifacts/<model>/comparisons/report.md`
- Per-model raw metrics: `artifacts/<model>/metrics/`

