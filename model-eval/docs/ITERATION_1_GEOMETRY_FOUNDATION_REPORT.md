# Iteration 1 — Geometry Foundation, Room Detection, and Visibility

## Files changed

- `src/lib/geometry-foundation.ts`: world-space face metrics, envelope roles, room states, room geometry, and disjoint final-part partition.
- `src/lib/model.ts`: legacy/runtime integration, stable face IDs, compact surface-cluster analysis, model validation, and downstream gate.
- `src/lib/render/visibility.ts`: centralized category visibility state and object tagging.
- `src/lib/ModelCanvas.svelte`: category tags for meshes/outlines and centralized visibility application.
- `src/lib/render/build-runtime-scene.ts`: source-face aliases for compact runtime category overrides.
- `src/routes/+page.svelte`: room validation message and disabled analysis action for invalid geometry.
- `src/lib/geometry-foundation.test.ts`, `src/lib/model-regression.test.ts`, `src/lib/render/visibility.test.ts`: Iteration 1 unit/regression coverage.
- `src/lib/model.test.ts`, `src/lib/formats/model-eval-json.test.ts`: updated parser/runtime regression contracts.

## Rules introduced

- Face facts: polygon normal, dominant orientation, centroid elevation, world bounds, plan span, and area.
- Wall: vertical, meaningful height/plan span, non-opening/non-glass, adjacent to room footprint boundary.
- Floor: horizontal and supported by upward normal, floor/material evidence, or wall-base relationship.
- Ceiling: horizontal and supported by downward normal, ceiling/material evidence, or wall-top relationship.
- Room: floor footprint + at least 90% wall-boundary coverage + overlapping upper boundary, with scale-relative tolerance.
- Room state: `valid`, `incomplete boundary`, `open geometry`, `insufficient surfaces`, or `invalid scale`.
- `Lainnya`: only null final assignments. Duplicate stable IDs rejected. Zero-count categories omitted.
- Visibility: explicit visible-category set. Empty set means no classified geometry. Helpers/debug roots remain independent.
- Downstream analysis: allowed only with valid non-zero room, wall/floor boundary, and valid metre scale.

## Regression results

| Model | Before | After |
| --- | --- | --- |
| Model_SBMBOOST_bom_visual_nonPretty-print.json | 3 heuristic floor-only zones; 149.7 m²; 466.9 m³; 20 walls | `incomplete boundary`; 0 valid rooms; 39 walls; analysis disabled |
| house2_model-eval.json | 0 rooms; 0 walls; wall faces reported as `Lainnya` | `incomplete boundary`; 0 valid rooms; 2,180 wall faces; analysis disabled |
| presentation20_model-eval.json | 0 rooms; 0 walls; 228,059 `Lainnya` faces | `valid`; 4 rooms; 204.1 m²; 622.9 m³; 228,059 wall faces; zero `Lainnya` |
| PROJECT SBOOST 1_model-eval.json | 0 rooms; 0 walls; 5,939 `Lainnya` faces | `valid`; 8 rooms; 144.0 m²; 403.1 m³; 5,939 wall faces; zero `Lainnya` |
| PROJECT SBOOST 2_model-eval.json | 0 rooms; 0 walls; 10,234 `Lainnya` faces | `valid`; 16 rooms; 279.4 m²; 761.4 m³; 10,234 wall faces; zero `Lainnya` |

`Model_SBMBOOST` and `house2` now fail explicitly because available boundary evidence does not satisfy both closure and ceiling requirements. Previous `Model_SBMBOOST` values came from floor polygons without a validated closed envelope.

## Known limitations

- Main upload path uses rectangular plan-boundary coverage for fast validation. Concave footprints retain polygon area, but closure uses their plan bounds.
- Compact Model-Eval JSON uses connected coplanar surface clusters instead of expanding every runtime face. This keeps large instanced models bounded but produces cluster-level inspection records.
- A missing ceiling is not inferred from roof height or user-entered room height. It returns `incomplete boundary`.
- Door/window, furniture, structure merging, confidence scoring, and manual overrides remain out of scope.

## Verification

- `bun test src/`: 417 passed, 0 failed.
- `bun run check`: 0 errors, 0 warnings.
- `bun run build`: passed. Existing bundle-size advisory remains for a 642.71 kB client chunk.
