# model_eval_json_v1 baseline benchmark

Fixture: `bom_engine_plugin/examples/canonical-v3-small.json` and equivalent `model-eval-json-v1-small.json`. Windows workstation, Bun 1.3.10, 1,000 in-process iterations.

| Representation | Bytes | JSON.parse ms (mean) | Adapter/load ms (mean) |
| --- | ---: | ---: | ---: |
| Canonical v3 pretty | 4,665 | 0.0176 | legacy expansion path, not measured here |
| Canonical v3 minified | 3,088 | 0.0176 | legacy expansion path, not measured here |
| Model-Eval JSON v1 | 1,376 | 0.0104 | 0.0345 typed indexed runtime validation/reconstruction |

Compact file is 29.50% of current readable Canonical sample, meeting 35% target. The adapter metric includes header/reference validation and typed array reconstruction; it deliberately excludes legacy `BomEntity` and `FaceRecord` expansion. Meshes: 1. Nodes: 2. Triangles: 2. Quantization max error: 0 m.

Peak browser heap requires fresh SketchUp export and browser smoke validation; it is not claimed by this fixture benchmark.

## Fresh SketchUp smoke — `skps/test.skp`

Measured after a full SketchUp 2026 restart and fresh exports on 2026-07-13.
Both exports contain 111 faces; compact runtime has 2 meshes, 2 nodes, and
3,010 indexed triangles. Timings are median in-process measurements on Bun
1.3.10 (15 JSON parses, 8 end-to-end loader runs).

| Representation | Bytes | SketchUp export | JSON.parse ms | model-eval load ms |
| --- | ---: | ---: | ---: | ---: |
| Canonical v3 pretty | 1,077,693 | 0.263 s | 2.484 | 8.876 |
| Model-Eval JSON v1 | 86,710 | 0.157 s | 0.657 | 1.668 |

Compact output is 8.05% of readable Canonical v3 for same source model.
Bounds match within floating-point/quantization tolerance (maximum observed
absolute bound delta: 0.00000095 m), well under 0.001 m position error budget.
Peak heap is intentionally not claimed: browser process-level peak measurement
is unavailable in this workflow.
