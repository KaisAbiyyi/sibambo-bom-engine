# GLB evaluation against Canonical JSON v3 and BOME2

Date: 2026-07-13  
Corpus model: `PROJECT SBOOST 2.skp`  
Runtime: Bun 1.3.10, Windows x64

## Result

| Format | File bytes | Measured pipeline | Time | RSS delta | Geometry | Semantic role |
| --- | ---: | --- | ---: | ---: | --- | --- |
| BOME1 gzip baseline | 68,529 | decompress + flat parse/classification | 130.97 ms | +67.3 MB | 6,579 expanded triangles | Legacy visual only; hierarchy/instances/holes lost |
| Canonical JSON v3 gzip | 825,111 | decompress + JSON + compatibility analysis | 406.67 ms | +128.8 MB | 7,319 unique vertices; polygon loops | Authoritative analysis/interchange |
| BOME2 gzip | 307,979 | decompress + CRC validation + indexed instanced group build | 129.34 ms | +14.2 MB | 66 meshes; 7,319 unique vertices; 13,842 unique triangles | Primary BOM Engine runtime |
| GLB 2 | 354,472 | file read + GLB header/JSON chunk parse | 4.53 ms | +0.7 MB observed | 66 meshes; 13,842 unique triangles | Optional interoperable visual runtime |

GLB timing is not directly equivalent to BOME2 timing. It excludes `GLTFLoader`, material construction, GPU buffer upload, shader compilation, and first frame. BOME2 timing includes checksum validation, position dequantization, graph traversal, axis conversion, indexed geometry creation, and instance grouping.

Raw measurements: `artifacts/project-sboost-2/metrics/phase2-runtime-benchmark.json`.

## Converter

Command:

```powershell
bun scripts/converters/bom-v3-to-glb.ts `
  --input=artifacts/project-sboost-2/exported/project-sboost-2_canonical.json.gz `
  --output=artifacts/project-sboost-2/exported/project-sboost-2.glb
```

The converter:

- maps SketchUp axes to glTF/Three.js axes;
- writes indexed `POSITION` and triangle accessors;
- groups primitives by material;
- reuses one glTF mesh per canonical mesh;
- expands node occurrences while reusing meshes;
- keeps canonical definition/material IDs in `extras`.

## Retained and omitted semantics

Retained:

- mesh/definition reuse;
- instance hierarchy and transforms;
- materials and transparency factors;
- canonical mesh, definition, and material IDs in `extras`.

Omitted from GLB runtime:

- authoritative polygon outer/hole loops;
- room/spatial analysis;
- full source identity on every face/entity;
- SketchUp attribute dictionaries and dynamic attributes;
- classifier evidence/rule traces;
- tag/scene semantics beyond minimal visual needs.

GLB has 221 instantiated nodes versus 117 canonical/BOME2 nodes because glTF scene nodes are occurrences; meshes remain shared.

## Decision

Keep GLB optional. It is valuable for generic viewers and asset pipelines. Do not replace Canonical JSON v3: GLB triangles and `extras` are less auditable for room/BOM/classifier analysis. Do not replace BOME2 as primary model-eval runtime: BOME2 keeps polygon loops, bounded quantization metadata, source/table references, strict section checksums, and progressive range descriptors while matching BOME1 end-to-end time on this model.
