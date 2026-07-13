# Annotation performance contract

Normal compact loading does not construct classification units, surface
clusters, or FaceRecord objects. Annotation work starts only with
`?annotate=tier1`.

`ClassificationUnitIndex` owns deterministic per-logical-object caches. It can
process the next object, stop, resume, or reuse a completed object. Unit IDs are
derived only from sorted cluster IDs, so processing order has no semantic
effect. The UI starts with a small batch and exposes progress, stop, and
``Process next 20`` controls.

Queue filters are deterministic: logical object, orientation, area, elevation,
material, source presence, status, and confidence. Queue sorting supports area,
elevation, logical object, orientation consistency, source name, and unit ID.
No classifier output pre-fills a role.

Presentation20 measured 3,937 ms from completed compact runtime to first
annotatable unit in this shell benchmark. This narrowly misses the 3 s target;
the next optimization should make logical-object indexing incremental rather
than weakening surface-unit semantics.
