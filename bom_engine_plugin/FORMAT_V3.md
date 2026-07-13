# BOM Engine Canonical JSON 3.0

Canonical JSON v3 is the lossless, readable interchange and analysis source for BOM Engine. It preserves SketchUp semantics without expanding repeated component geometry. Runtime formats such as BOME2 or GLB are derived artifacts, not authoritative analysis data.

Normative schema: [`schema/bom-engine-3.0.schema.json`](schema/bom-engine-3.0.schema.json)  
Small valid file: [`examples/canonical-v3-small.json`](examples/canonical-v3-small.json)

## Compatibility contract

- Format identity is `format.name = "BOM Engine Canonical"`.
- Semantic version is `format.version`. A reader may accept compatible `3.x` files, but must reject unknown major versions.
- Legacy schema `2.x` JSON and BOME1 remain readable by `model-eval`. Existing legacy export behavior remains available when `output_format` is absent or is not `canonical_v3`.
- `model-eval/src/lib/formats/canonical-v3.ts` validates references and adapts v3 to the existing render pipeline during migration.
- Canonical export uses `output_format: "canonical_v3"` and writes `*_canonical.json` or `*_canonical.json.gz`.

## Coordinate and transform contract

- Geometry positions and transform translations use meters.
- Definition geometry stays in SketchUp definition-local coordinates.
- Matrices are 16-number, column-major affine transforms compatible with `THREE.Matrix4.fromArray`.
- Node world transform is `parentWorld * nodeLocal`. Root transform carries active-context transform for selection exports.
- SketchUp axes remain right-handed `+X`, `+Y`, `+Z` with `+Z` up. Three.js mapping is `{x, y, z} -> {x, z, -y}`.
- Face loops reference `positions_m` by zero-based index. `outer` is the exterior loop; every entry in `holes` is a void and must be passed to polygon triangulation.
- `normal` and `area_m2` on a face are definition-local facts. Consumers requiring world values must apply the full transform; non-uniform scale requires recomputation from transformed vertices.

## Top-level fields

| Field | Meaning |
| --- | --- |
| `format` | Family name, semantic version, normative schema URI, generator identity/version. |
| `source` | SketchUp model identity, path/name/description, SketchUp version/locale, timestamp, export scope, modified state. |
| `units` | Source display unit plus canonical geometry, area, and angle units. |
| `coordinate_system` | Handedness, axes, storage-space statement, Three.js mapping. |
| `metadata` | Model timestamps, geolocation, statistics supplied by SketchUp, and serializable export settings. |
| `tags` | Deduplicated SketchUp tag/layer table. |
| `materials` | Deduplicated material table including color, opacity, attributes, and optional texture metadata. |
| `transforms` | Deduplicated matrix table. Nodes reference matrices by integer index. |
| `meshes` | Definition-local indexed geometry. One mesh belongs to one definition. |
| `definitions` | Reusable root, component, and group definitions. |
| `nodes` | Root and instance graph. A node references a definition and transform. |
| `scenes` | SketchUp pages/scenes with visibility/style/camera data when available. |
| `spaces` | Room-related records inferred or supplied by the spatial analyzer. Empty is explicit, not missing. |
| `relationships` | Indexed parent/child and definition/instance relationships for analysis without graph reconstruction. |
| `analysis` | Full spatial-analysis payload retained as canonical source data. |
| `statistics` | Counts of unique definitions, meshes, nodes, instances, faces, vertices, materials, tags, transforms, and skipped entities. |

The JSON Schema contains a `description` for every structured field and is normative for required fields, types, ranges, and allowed values.

## Tag fields

- `id`: stable file-local reference key.
- `name`: SketchUp tag/layer name.
- `display_name`: UI display name when SketchUp exposes it.
- `visible`: tag visibility during export.
- `color`: optional RGBA and hex color.
- `folder`: optional tag-folder name.
- `attributes`: SketchUp attribute dictionaries.

## Material fields

- `id`, `name`, `display_name`: file-local identity and labels.
- `color`: RGBA byte channels and RGB hex string.
- `opacity`: normalized material opacity.
- `material_type`: SketchUp material type.
- `texture`: optional source filename/path, physical width/height in meters, pixel width/height.
- `attributes`: SketchUp attribute dictionaries.

## Mesh and face fields

- `mesh.id`: unique mesh ID.
- `mesh.definition_id`: owning definition ID.
- `coordinate_space`: currently `definition_local`.
- `positions_m`: flat `[x0,y0,z0,x1,y1,z1,...]` indexed position buffer.
- `faces`: polygon records. Canonical files retain polygons instead of prematurely triangulating them.
- `edges`: optional indexed edge records controlled by `include_edges`.
- `bounds_m`: local axis-aligned minimum/maximum/size.
- `face.id`, `source_identity`: file-local face key and SketchUp persistent identity.
- `face.outer`, `face.holes`: exterior and void loops.
- `face.triangles`: SketchUp-derived indexed runtime triangulation; loops remain authoritative.
- `front_material_id`, `back_material_id`, `tag_id`: table references or `null`.
- `normal`, `area_m2`, `area_space`: local normal and area provenance.
- `surface_hint`: exporter orientation hint; not an authoritative building-part classification.
- `hidden`, `attributes`: SketchUp state and dictionaries.
- `uv`: optional front/back UV loops aligned with outer/hole loop ordering.

## Definition and node fields

- A definition owns zero or one mesh and ordered child `node_ids`.
- Component definitions reuse the same geometry for every instance.
- Group definitions use the same graph mechanism but preserve group identity.
- `bounds_m` is definition-local.
- A node records `kind`, `name`, owner definition, referenced definition, transform-table index, optional material override/tag, visibility, source identity, and attributes.
- Component nodes also retain definition name and dynamic attributes.
- Exactly one node has `kind: "root"`.

## Validation

From `model-eval`:

```powershell
bun run validate:v3 ../bom_engine_plugin/examples/canonical-v3-small.json
bun run validate:v3 path/to/model_canonical.json.gz
```

Validation has two layers:

1. Draft 2020-12 JSON Schema validates required fields, types, numeric ranges, and local structure.
2. Reference validation checks unique IDs, transform references, definition/mesh/node/material/tag links, vertex-index bounds, one root, and recursive-definition safety during adaptation.

## Migration from 2.x

| 2.x concept | 3.0 canonical concept |
| --- | --- |
| Recursive world-space `entities` | Local `meshes` + reusable `definitions` + instance `nodes` |
| Per-face repeated vertices | Definition-local indexed `positions_m` and loop indices |
| Inline transform data | Deduplicated `transforms` table and `transform_id` |
| Expanded component copies | One component definition referenced by all instances |
| `material_front` objects on faces | Deduplicated `materials` and material IDs |
| Outer vertices plus optional `holes` | Mandatory `outer` and `holes` arrays |
| Heuristic `surface_type` | Non-authoritative `surface_hint`; adaptive classifier runs in consumer |
| Mixed semantic/runtime payload | Canonical semantic JSON plus separately derived runtime artifact |

Do not rewrite a 2.x file by renaming fields. Parse legacy data with the compatibility reader, then construct definitions, local meshes, node transforms, and valid table references. Preserve source IDs whenever present. If local geometry cannot be recovered from an expanded legacy instance, create an explicit unique definition rather than guessing that two geometries are identical.

## Size and precision policy

Canonical readable JSON favors auditability. Pretty printing is intended for examples and diagnostics; production canonical files should use minified JSON plus gzip. Canonical coordinates retain meter values rounded to 1 nanometer in the exporter. Runtime quantization belongs in BOME2/GLB derivation and must declare its scale/error budget.
