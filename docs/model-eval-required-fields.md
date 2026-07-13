# Model-Eval exporter field usage

Audit date: 2026-07-13. Scope: `model-eval/src/lib/model.ts`, `ModelCanvas.svelte`, indexed runtime renderer, analysis and inspector flow.

| Canonical v3 field | Classification | Current consumer / compact mapping |
| --- | --- | --- |
| `format.name`, `format.version` | REQUIRED_FROM_EXPORTER | Format dispatch and compatibility gate. Compact `format` includes name, version, identifier, schema URI. |
| `source.file_name`, `source.model_name`, `source.scope`, `source.exported_at` | REQUIRED_FROM_EXPORTER | Upload label, provenance, diagnostic timestamp. Compact `source` is four string-table indexes. |
| `source.file_path`, `source.identity`, SketchUp version/locale/description | OPTIONAL_DEBUG | No render, analysis, selection, or classifier consumer. Excluded. |
| `units.geometry_length_unit`, coordinate axes/mapping | REQUIRED_FROM_EXPORTER | Position reconstruction and SketchUp-to-Three.js axis contract. Compact uses `units: "m"` and one coordinate-system object. |
| `metadata.model_bounds_m` | RECOMPUTABLE_IN_MODEL_EVAL | Computed from mesh positions and node transforms. Excluded. |
| remaining `metadata`, settings, attributes | UNUSED_BY_MODEL_EVAL | Excluded. |
| `materials[].id/name/color.hex/opacity` | REQUIRED_FROM_EXPORTER | Material lookup and Three.js color/opacity. Compact table indexes id/name/color, opacity. |
| material display name, type, texture bitmap/path, attributes | OPTIONAL_DEBUG | Texture metadata only drove decorative pattern names; no bitmap renderer consumer. Excluded. |
| `tags[].id/name/visible` | REQUIRED_FROM_EXPORTER | Node/face visibility and classifier/inspection context. Compact tag table. |
| tag source identity/color | OPTIONAL_DEBUG | Excluded. |
| `transforms` | REQUIRED_FROM_EXPORTER | Instance hierarchy world transform. Compact flat 16-number transform table. |
| `meshes[].positions_m` | REQUIRED_FROM_EXPORTER | Indexed renderer, bounds, face materialization. Compact quantized integer arrays plus declared reconstruction metadata. |
| `meshes[].faces.outer/holes/triangles` | REQUIRED_FROM_EXPORTER | Direct triangle render; outer/holes retained for deferred room detection and detailed inspection. Compact index ranges. |
| face id/source persistent id/material/tag/surface hint/area | REQUIRED_FROM_EXPORTER | Selection source mapping, materials, category fallback, classifier and analysis input. Compact face rows. |
| face normals/UV/attributes/hidden | RECOMPUTABLE_IN_MODEL_EVAL / OPTIONAL_DEBUG | Normals recomputed by Three.js; UV is unused; attributes and hidden not consumed. Excluded. |
| `definitions` and `nodes` | REQUIRED_FROM_EXPORTER | Component reuse, hierarchy, transform traversal, object selection identity. Compact integer rows. |
| definition/node name and persistent ID | REQUIRED_FROM_EXPORTER | Component evidence and stable source mapping. Stored through string table. |
| node owner definition and dynamic attributes | RECOMPUTABLE_IN_MODEL_EVAL / UNUSED_BY_MODEL_EVAL | Child links live on definition rows; dynamic data unused. Excluded. |
| `scenes`, camera records | UNUSED_BY_MODEL_EVAL | QA camera is external capture metadata. Excluded. |
| `spaces`, `relationships`, `analysis` | RECOMPUTABLE_IN_MODEL_EVAL | Model-eval derives rooms, openings, and analysis from indexed loops/triangles. Excluded. |
| `statistics` | OPTIONAL_DEBUG | Small compact totals retained for diagnostics; renderer computes authoritative bounds. |

Initial compact load validates and renders typed indexed buffers. It does not invoke Canonical-to-legacy conversion or allocate `FaceRecord` objects. Deferred inspector/classifier/room work consumes retained compact face loop/source/material fields when requested.
