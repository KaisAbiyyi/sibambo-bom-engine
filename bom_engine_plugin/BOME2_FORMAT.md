# BOME2 Runtime Container 2.0

BOME2 is the production Three.js transport derived from the same graph as Canonical JSON v3. It retains reusable definitions, instance transforms, indexed polygon loops, indexed triangles, material/tag references, and enough source identity for runtime inspection. Canonical JSON remains authoritative for analysis and interchange.

## Binary layout

All integers and floats are little-endian. Absolute offsets are measured from byte 0.

| Segment | Bytes | Content |
| --- | ---: | --- |
| Magic | 6 | ASCII `BOME2\n` |
| Fixed header | 24 | Six `uint32` fields |
| JSON manifest | variable | UTF-8 JSON, padded with spaces until next segment is 4-byte aligned |
| Section directory | `section_count * 32` | Eight `uint32` fields per section |
| Section data | variable | 4-byte aligned typed-array payloads |

Fixed-header fields:

1. `manifest_byte_length`, including space padding;
2. `directory_byte_length`;
3. `section_count`;
4. CRC32 of unpadded UTF-8 manifest JSON;
5. flags; bit 0 means little-endian;
6. reserved, currently zero.

Directory-entry fields:

1. section kind;
2. mesh index, or `0xffffffff` for a global section;
3. absolute byte offset;
4. byte length;
5. scalar element count;
6. component type;
7. CRC32 of section bytes;
8. reserved.

Section kinds:

| Code | Kind | Component |
| ---: | --- | --- |
| 1 | quantized mesh positions | `uint16` or `uint32` |
| 2 | concatenated polygon outer/hole indices | `uint32` |
| 3 | SketchUp-derived triangle indices | `uint32` |
| 4 | deduplicated column-major transforms | `float32` |

Component codes are 1=`uint16`, 2=`uint32`, 3=`float32`.

## Manifest

The manifest is readable before geometry sections are fetched. It contains:

- format/version/layout identity;
- source filename, model name, scope, and export timestamp through a deduplicated string table;
- material and tag tables;
- transform-section descriptor;
- mesh descriptors and per-face loop/triangle ranges;
- definition table;
- node/instance table;
- root node;
- unique geometry, triangle, definition, node, and instance counts.

IDs, names, material names, tag names, source persistent IDs, and surface hints are integer references into `strings`. `strings` must not contain duplicates.

Definitions reference one optional mesh and ordered child node indices. Nodes reference definitions and transforms. Component instances therefore reuse one definition-local position/index buffer.

## Quantization

Position quantization is per mesh and per axis.

```text
decoded[axis] = minimum_m[axis] + integer[axis] * scale_m[axis]
```

The exporter first evaluates `uint16`. It uses `uint32` only when the conservative half-step Euclidean error can exceed 1 mm. Every mesh stores:

- component type;
- minimum/maximum bounds in meters;
- scale per axis;
- measured maximum reconstruction error;
- error budget.

The writer measures actual error after quantize/dequantize and aborts if it exceeds 0.001 m. PROJECT SBOOST 2 measured 0.000104131587 m (0.104 mm).

## Polygon and triangle contract

Polygon loops remain available for analysis and debug:

- `outer_start` / `outer_count` address the loop-index section;
- every `[start,count]` in `holes` addresses an inner void;
- `triangle_start` / `triangle_count` address the triangle-index section.

Triangle buffers come from SketchUp `Face#mesh` and are ready for indexed `BufferGeometry`. Consumers must not reconstruct faces with a triangle fan.

## Progressive loading

For uncompressed `.bome2`:

1. fetch magic + fixed header;
2. fetch manifest and directory;
3. inspect hierarchy, counts, materials, bounds, and section offsets;
4. range-fetch required position/index sections;
5. validate CRC32 before typed-array allocation or GPU upload.

`.bome2.gz` is smallest for filesystem transfer but is not range-addressable inside gzip. Use uncompressed BOME2 with HTTP range/compression at transport level for progressive web delivery.

## Required validation

Readers reject:

- wrong magic/version/layout/endianness;
- manifest or section checksum mismatch;
- directory byte-count mismatch;
- out-of-file or overlapping section ranges;
- component byte-count mismatch;
- missing/wrong-kind section references;
- invalid transform, definition, node, material, tag, or string references;
- vertex indices outside a mesh;
- invalid polygon or triangle ranges;
- triangle counts not divisible by three;
- quantization error over declared or 1 mm budget;
- recursive definition cycles during scene construction.

## Runtime mapping

`model-eval/src/lib/formats/bome2.ts` validates and decodes typed arrays. `model-eval/src/lib/render/build-runtime-scene.ts`:

- maps SketchUp `{x,y,z}` to Three.js `{x,z,-y}`;
- conjugates instance matrices into Three.js axes;
- creates one indexed `BufferGeometry` per definition/part/material group;
- creates `InstancedMesh` matrices for repeated definitions;
- avoids per-instance edge draw calls.

Legacy BOME1 and JSON v2 readers remain available during migration.
