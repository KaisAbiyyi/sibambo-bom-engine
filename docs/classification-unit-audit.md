# Classification-unit audit

Audit inputs are fresh compact exports. The unit builder was run without any
classifier prediction, name, tag, or surface-hint label.

| Model | Logical objects | Surface clusters | Classification units | Result |
| --- | ---: | ---: | ---: | --- |
| `test.skp` | 2 | 96 | 67 | One object has 95 clusters. Nineteen compatible adjacent clusters merge; 52 units remain below 0.01 m². |
| `house2.skp` | 108 | 3,122 | 2,843 | All 108 objects contain mixed orientation clusters. 146 compatible adjacent cluster sets merge; 1,957 small units remain, mostly detailed source geometry. |
| `presentation20.skp` | 9,200 logical objects / 14,480 expanded instance nodes | 334,753 | 256,788 | Full compact audit completed in 108.2 s with profiling. Largest object has 1,079 primitives and 684 clusters. |

`test.skp` has 418.394 m² unit area: 417.858 m² upward-horizontal and
0.536 m² vertical. `house2.skp` has 435.291 m²: 81.140 m² upward, 76.982 m²
downward, 213.117 m² vertical, and 64.052 m² sloped.

## Decision

Tier-1 default is a deterministic **ClassificationUnitRecord** built from a
coherent `SurfaceClusterRecord`, then unioned only with nearby compatible
clusters in the same logical object. It is neither a whole logical object nor
a triangle.

Merge requires shared logical-object ownership, bounds adjacency, normal
agreement within 8°, matching material when material boundaries are enabled,
and no elevation discontinuity above 0.15 m. Spatial lookup is a conservative
broad phase. It may leave a separated compatible surface as another unit; it
never merges a candidate that fails the exact checks.

Sharp wall/floor and wall/ceiling junctions differ in normal and remain split.
Disconnected surfaces and material boundaries remain split. Repeated
definition instances stay separate because each has a separate logical object
and instance path. This preserves reviewer-selectable source identity.

Small decorative units are not silently promoted to wall, floor, ceiling, or
roof. Annotators may mark them `unknown`, `ambiguous`, or `excluded`.

## Semantic fingerprints

Current exports retain prior recorded unit counts. Deterministic fingerprints
over sorted unit IDs, cluster IDs, primitive IDs, rounded bounds, and material
IDs are `test.skp`: `80221fe078f0a9c906236756a7d8729d87141e80b72bd7f873d10f7296fedc8c`
(67 units), and `house2.skp`:
`200341556e59c20009a50508292ab41e25f8e508b162d7daa5f6a670675988f2`
(2,843 units).
