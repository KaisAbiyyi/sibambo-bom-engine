# Logical object contract

A logical object is normally one visible instance-graph node with a mesh. Reusing one definition creates separate objects because each occurrence has its own path, world transform, bounds, and stable ID.

IDs are deterministic: `logical:<instance-path>`, with `:component:<n>` only for loose root geometry. The path is built from stable node IDs, not model filename or traversal counter. Nested mesh nodes remain independently addressable; the nearest mesh-owning ancestor is the logical parent.

Root-definition loose geometry is split by deterministic connected face components using quantization-aware shared edges. Disconnected geometry is not merged into the whole model. Primitive references are compact face-table indexes/ranges and source IDs; no verbose `FaceRecord` objects are created.

Logical records contain geometric and source facts only. They contain no category, score, confidence, rule output, or classifier decision.
