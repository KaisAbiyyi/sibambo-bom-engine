# Model-Eval JSON v1

`model_eval_json_v1` is BOM Engine's compact, plain-JSON exchange for `model-eval`. It is the target of native **Quick Export for Model-Eval**. It is UTF-8, minified, uncompressed, and suitable for `JSON.parse`.

Canonical JSON v3 remains the readable full/debug interchange: it retains descriptions, attributes, scenes, spatial payload, texture metadata, and verbose object fields. BOME2 remains binary runtime export. Neither is renamed or removed by this format.

## Top level

```json
{"format":{"name":"BOM Engine Model-Eval JSON","version":"1.0.0","identifier":"model_eval_json_v1"},"units":"m","strings":[],"materials":[],"transforms":[],"meshes":[],"definitions":[],"nodes":[]}
```

`strings` deduplicates all names and stable IDs. `source` is `[fileName, modelName, scope, exportedAt]`, each a string index. `materials` rows are `[id,name,colorHex,opacity]`. `tags` rows are `[id,name,visible]`. A negative index means no reference.

Positions use SketchUp world contract: meters, right handed, `+Z` up, `+X` right, `-Y` forward. Model-eval maps SketchUp `{x,y,z}` to Three.js `{x,z,-y}`. `transforms` is a flat table of column-major 4×4 matrices. A child world matrix is parent matrix × child local matrix.

Each mesh has one reusable local geometry table. `positions` stores quantized unsigned integers. Reconstruct component `c` as `minimum_m[c] + positions[i] * scale_m[c]`. `quantization.measured_max_error_m` is measured by exporter and schema-limited to 0.001 m. `loops` and `triangles` index decoded positions. Each face row is:

```text
[id, sourcePersistentId, outerStart, outerCount, holeRanges,
 triangleStart, triangleCount, frontMaterial, backMaterial, tag,
 surfaceHint, areaM2]
```

`definitions` rows are `[id,name,kind,meshIndex,nodeIndexes]`; `nodes` rows are `[id,name,kind,definition,transform,materialOverride,tag,visible,sourcePersistentId]`. Definitions reference child nodes, so repeated component instances share exactly one mesh.

The direct loader validates header, table lengths, integer ranges, quantization bounds, loops, triangle indexes, references, root, and hierarchy before it constructs typed render buffers. It renders indexed meshes with instance matrices; it does not convert compact JSON to Canonical v3, `BomEntity`, or initial `FaceRecord` arrays.

Intentionally omitted: attribute dictionaries, descriptions, source absolute path, scenes/cameras, bitmap/UV paths, edges, dynamic attributes, full spatial analysis, duplicate bounds, and prose field descriptions. Room/classifier inputs retain face loops, tags, names, material references, surface hints, source IDs, and hierarchy.

Compatibility: readers must dispatch by `format.identifier`. Unknown major versions must fail safely. Existing readers retain Canonical v3, `.json.gz`, BOME2, BOME1, and legacy JSON paths.

Validate:

```powershell
ruby bom_engine_plugin/bom_engine/tests/test_model_eval_json_writer.rb
cd model-eval; bun test src/lib/formats/model-eval-json.test.ts; bun run check; bun run build
```

See [small example](bom_engine_plugin/examples/model-eval-json-v1-small.json) and [schema](bom_engine_plugin/schema/model-eval-json-1.0.schema.json).
