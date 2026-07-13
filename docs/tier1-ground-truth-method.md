# Tier-1 ground truth

Tier-1 labels describe a **surface role**, not an object category: `wall`,
`floor`, `ceiling`, `roof`, or `unknown`. Door, window, furniture, and other
object categories are reserved for a later layer.

Annotation begins with a deterministic classification unit. It contains one
coherent surface cluster, or adjacent coplanar compatible clusters from same
logical object. Sharp, disconnected, elevation-discontinuous, and material
boundaries remain separate. A reviewer may mark an uncertain record
`ambiguous` or use role `unknown`. Only `verified` records are eligible for
metrics. Source names, tags, surface hints, and existing classifier output are
context only, never ground truth.

Train and holdout split by model/definition family. Repeated definition
instances stay together. Export hash and unit/cluster references make stale
annotations rejectable.

The baseline adapter is measurement-only. It consumes existing primitive
predictions, area-weights votes within each classification unit, and returns
`unknown` for no evidence, a tie, or a leading role below 60% of predicted
area. Such mixed units are reported separately. This adapter does not call,
tune, or change classifier rules.
