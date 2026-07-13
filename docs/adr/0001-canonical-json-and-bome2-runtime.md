# ADR 0001: Canonical JSON v3 plus BOME2 runtime

Date: 2026-07-13  
Status: Accepted

## Context

Legacy v2.1 JSON preserves useful face semantics but expands component instances and reaches 466.93 MB for a 2.16 MB SketchUp model. BOME v1 compresses the same model to 2.20 MB but flattens hierarchy, definitions, instances, holes, transforms, and source identity. The classifier needs those semantics; the renderer needs compact indexed buffers.

## Decision

Use two outputs produced from one shared v3 graph:

1. Canonical JSON v3 for analysis, interchange, validation, documentation, migration, and debugging.
2. BOME2 for production Three.js loading, using definition-local indexed geometry, instance references, deduplicated tables, bounded quantization, and a progressive section directory.

Keep v2.1 JSON and BOME v1 readers during migration.

Provide GLB as an optional derived runtime artifact. Do not use GLB as the canonical analysis format because triangulation and extension payloads cannot express the full polygon/room/source-evidence contract as clearly as canonical JSON.

## Consequences

Positive:

- Component-heavy models stop paying geometry cost per instance.
- Classifier and debug inspector retain source semantics.
- Runtime parser can load hierarchy first and upload indexed buffers directly.
- Canonical examples can be schema-validated and read without binary tooling.
- GLB interoperability remains available without making it authoritative.

Negative:

- Exporter and loader maintain two serializers.
- Compatibility code remains until v2 readers can be retired in a future major release.
- BOME2 needs strict binary validation and versioning.
- Visual and analytical data must be checked for shared-graph consistency.

## Rejected alternatives

- Full JSON only: unacceptable file size, parse time, and memory for repeated components.
- BOME v1 only: loses semantics required by classifier, holes, hierarchy, and source debugging.
- GLB only: good rendering transport, insufficient as the normative BOM/room/source-identity document without a large custom extension contract.
