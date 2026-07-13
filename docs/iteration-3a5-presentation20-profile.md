# Presentation20 Tier-1 profile

Input: `skps/model-eval-exports/presentation20_model-eval.json` (1,498,069
bytes). Compact manifest has 115 meshes, 187 definitions, 484 manifest nodes,
11,625 source primitives, 25,518 definition-local triangles, and 31 materials.
The expanded instance graph has 14,480 nodes and produces 9,200 logical
objects.

## Before

The old audit exceeded five minutes. Its dominant pathology was global unit
adjacency: each unit filtered every other unit, then repeated the same scan for
split diagnostics. With hundreds of thousands of expanded-instance units this
was quadratic and allocated transient peer arrays repeatedly.

## After

`ClassificationUnitIndex` processes one logical object at a time. Exact
adjacency uses an X-axis sweep-and-prune broad phase followed by the existing
`unitsTouch` predicate. There is no cross-logical-object comparison. Face
metrics, source face indexes, and surface clusters are cached by node/object.

Cold full audit with profiling completed in 108.2 s (under the 120 s gate):

- compact JSON parse: 19.0 ms
- runtime construction: 19.1 ms
- instance graph: 49.4 ms
- logical-object index: 2,276.4 ms
- surface clustering: 70,938.8 ms
- unit grouping and adjacency: 33,665.8 ms
- report serialization: 1.7 ms

Result: 334,753 surface clusters and 256,788 classification units. Largest
logical object has 1,079 source primitives and 684 clusters.

Counters: 10,738,831 shared-edge candidates, 2,416,453 shared-edge pairs,
13,900,859 compatible-cluster comparisons, 5,894,539 per-object adjacency
comparisons, and **zero global unit-pair scans**. Retained definition-local
geometry is 674,468 bytes; instance matrices use 926,720 bytes.

Known limitation: five-run warm benchmark did not finish before the local
command deadline. The completed cold profile is authoritative for the 120 s
gate; rerun `bun run benchmark:annotation-scale -- <path>` outside the command
deadline to collect all warm samples.
