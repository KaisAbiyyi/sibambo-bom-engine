# BOM Engine v3 End-to-End Design

Status: implementation authorized by user mandate  
Target canonical version: `3.0.0`  
Target runtime container: `BOME2`

## Goals

1. Preserve SketchUp semantics required for BOM analysis and diagnosis.
2. Make the canonical file readable, versioned, schema-valid, and migratable.
3. Make runtime loading small and fast without flattening component identity.
4. Preserve visual geometry: holes, winding, normals, materials, transparency, hierarchy, and transforms.
5. Classify only when evidence supports a category; otherwise return `unknown` with an explanation.
6. Prove behavior against every `.skp` in the repository corpus.

## Non-goals

- Replacing `.skp` as the authoring format.
- Inferring authoritative BIM semantics from geometry alone.
- Making pixel-identical SketchUp and Three.js shading. Geometry/transform parity is the primary visual contract.
- Removing v2.1 JSON or BOME v1 readers during this migration.

## Output family

### Canonical JSON v3

Canonical JSON is the source of truth for analysis and debugging. It is explicit rather than maximally compact.

Top-level sections:

```text
format              name, semantic version, schema URI, generator
source              file identity, SketchUp GUID/version, export scope/time
units               source display units; all stored geometry in meters
coordinate_system   handedness, axes, up/forward, origin, conversion contract
metadata            model attributes, geolocation, statistics
tags                stable tag IDs, visibility, color
materials           stable material IDs, RGBA, texture metadata
transforms          deduplicated 4×4 local transforms with identity at index 0
meshes              definition-local indexed polygon meshes
definitions         component/group definitions and local child graph
nodes               model hierarchy and component instances
scenes              full camera/projection/style/visibility state
spaces              explicit or detected room/space records
relationships       host/opening, adjacency, enclosure, room-boundary links
analysis            source-derived surface/opening/spatial facts
extensions          namespaced optional payloads
```

Canonical mesh contract:

- `positions_m`: flat numeric XYZ array in local definition coordinates.
- `faces`: stable face ID, `outer` vertex indices, zero or more `holes` index loops, front/back material IDs, source normal, area, tag, visibility, smoothing, and source persistent ID.
- Face loops preserve SketchUp winding. No triangle fan is stored.
- Reused definitions appear once. Instance nodes reference `definition_id` and `transform_id`.
- Groups use generated definitions so geometry has the same reuse/local-coordinate contract.
- Source identity includes SketchUp persistent ID where available plus a deterministic export ID.
- Explicit names remain strings in canonical JSON; runtime-only string tables do not leak into documentation-facing files.

Readable JSON defaults to two-space indentation for examples/debug exports. Production canonical JSON can be minified and gzip-compressed without changing semantics.

### BOME v2 runtime

BOME v2 is a binary companion optimized for Three.js. It is generated from the same canonical graph, not from a separate flattening traversal.

Container layout:

```text
magic/version
fixed header
UTF-8 manifest JSON
section directory
string table
material table
transform table
node/instance table
mesh descriptors
quantized position buffers
index/loop buffers
triangle buffers
optional UV/normal buffers
```

Properties:

- Definition-local geometry and component instancing.
- Indexed vertex and triangle buffers.
- Per-mesh position quantization. Chosen scale and maximum measured error are stored in every descriptor.
- Default position tolerance: 0.5 mm maximum error; export fails or widens representation instead of silently exceeding tolerance.
- Deduplicated strings, materials, transforms, and geometry references.
- Section offsets and lengths permit manifest-first/progressive parsing and future HTTP range loading.
- Gzip remains supported for filesystem delivery. Uncompressed BOME2 remains range-addressable.
- Holes remain available in polygon-loop sections even when the runtime triangle section is used for rendering.
- Parser validates magic, version, section bounds, counts, indices, quantization metadata, and checksums before allocation.

### GLB/glTF decision

GLB is useful for broad viewer interoperability and GPU-ready meshes, but it does not replace canonical JSON:

- Strengths: mature Three.js loader, compact indexed buffers, native scenes/materials/instancing extensions.
- Weaknesses: custom BOM, room, source-identity, evidence, and opening semantics require extensions; polygon holes are represented only after triangulation.

Decision: provide an evaluated canonical-to-GLB converter and benchmark artifact. Keep BOME2 as primary runtime because it can carry both polygon semantics and pre-triangulated buffers while retaining direct source IDs. GLB remains optional and must not become the analysis source of truth.

## Compatibility

- Readers dispatch by magic/version or `format.version`.
- Existing v2.0/v2.1 entity JSON and BOME v1 remain readable.
- A migration adapter converts legacy entities into an in-memory v3 graph, recording lost semantics such as missing definition-local identity.
- Export UI labels old modes clearly and adds v3 canonical/runtime choices without changing existing saved settings unexpectedly.
- JSON Schema uses semantic versioning. Additive optional fields are minor releases; incompatible contracts require a major version.

## Classifier architecture

Classifier output categories:

`roof`, `floor_slab`, `ceiling`, `exterior_wall`, `interior_wall`, `door`, `window_fenestration`, `column`, `beam`, `stair`, `railing`, `furniture`, `fixture`, `opening`, `room_boundary`, `unknown`.

Pipeline:

1. Normalize source labels with Unicode normalization, case folding, punctuation splitting, token aliases, and multilingual vocabulary.
2. Build an evidence graph per source node/face/instance.
3. Evaluate a versioned general rule bank.
4. Apply negative evidence and incompatibility constraints.
5. Add topology, adjacency, elevation, shape, repetition, host, room, and material evidence.
6. Resolve conflicts using specificity, evidence independence, and score margin.
7. Emit `unknown` when threshold or margin is not met.
8. Apply optional model-specific overrides from a separate configuration layer. Overrides never mutate the general rule bank.

Every result contains:

- final category and confidence;
- all candidates and scores;
- activated rule IDs;
- positive and negative evidence;
- conflict-resolution explanation;
- alternatives;
- unknown reason when applicable;
- rule-bank and override versions.

The UI inspector renders this trace and links it to the selected model node/face.

## Ground truth and regression metrics

Ground truth lives outside general rules. Corpus manifests map stable source IDs or explicit selection sets to expected categories. Unlabelled objects remain unscored rather than becoming assumed negatives.

Metrics:

- precision, recall, F1 per category;
- macro/micro F1;
- confusion matrix;
- unknown and ambiguous rates;
- export/load success rates;
- visual verdict rate;
- file size, export time, decode/parse/load/triangulation time, heap, and RSS deltas.

## Visual comparison contract

- SketchUp camera vectors are stored in SketchUp world axes and converted with the same `{x,y,z} → {x,z,-y}` mapping as geometry.
- Perspective/orthographic mode, FOV/height, viewport, target, up vector, background, and visibility state are matched before comparison.
- Outputs per view: SketchUp reference, model-eval render, side-by-side, 50% overlay, absolute image difference, and checklist.
- Verdicts: `PASS`, `PASS_WITH_RENDERING_DIFFERENCE`, `FAIL_GEOMETRY`, `FAIL_TRANSFORM`, `FAIL_MATERIAL`, `FAIL_CAMERA_ALIGNMENT`, `FAIL_EXPORT`, `FAIL_LOAD`.
- Pixel difference is diagnostic only. Bounding boxes, projected landmarks, missing/extra connected components, winding, and materials determine the verdict.

## Performance strategy

- Export each definition once; walk instance graph without expanding repeated geometry.
- Intern transforms/materials/strings during graph construction.
- Stream canonical JSON and BOME2 sections where practical.
- Parse BOME2 manifest and hierarchy before geometry.
- Create one shared Three.js `BufferGeometry` per mesh definition and render instances with `InstancedMesh` when material grouping permits.
- Keep CPU polygon loops for analysis/debugging; upload indexed triangle buffers directly for normal rendering.
- Lazy-load inspector and heavy analysis UI.

## Failure behavior

- Export, migration, schema validation, parser validation, and rendering return explicit structured errors.
- A failed model does not abort the corpus workflow.
- No silent face drop: skipped geometry increments reason-coded counters and appears in reports.
- Quantization error over tolerance is an export failure unless a wider representation is selected automatically and recorded.
- Weak classification remains `unknown`.

## Security and resource bounds

- Validate section offsets/counts before typed-array allocation.
- Preserve maximum file, decompressed size, entity, depth, coordinate, and vertex limits.
- Reject non-finite coordinates and transforms.
- Never interpret names/metadata as executable content.
- Texture paths are metadata only; browser loads only exported, explicitly available assets.

## Verification gates

1. Unit tests and schema examples.
2. SketchUp runtime tests.
3. Legacy compatibility fixtures.
4. All five source models exported in canonical and runtime formats.
5. All runtime exports loaded in browser with no console/network error.
6. Six matched views per model plus any source scenes.
7. Per-model visual report and corpus regression metrics.
8. Fresh `bun test`, `bun run check`, `bun run build`, Ruby runtime test, package build, installed-plugin smoke export.
