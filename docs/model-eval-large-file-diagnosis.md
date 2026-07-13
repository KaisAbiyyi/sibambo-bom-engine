# Model-eval large-file diagnosis

Previous path: Canonical v3 JSON was parsed, converted through `canonicalV3ToLegacyBom`, recursively expanded into `BomEntity` trees, then converted again to one `FaceRecord` object per expanded instance before Three.js triangulation. Reused component geometry therefore existed as source JSON, legacy objects, face records, and renderer buffers concurrently.

Cause classification: Canonical-to-legacy expansion followed by `FaceRecord` expansion. File-size guards and `JSON.parse` can reject very large inputs, but increasing the guard cannot remove this multi-copy heap pressure. Browser heap exhaustion can occur later during renderer construction.

`model_eval_json_v1` fixes the primary path: JSON parses once, validates indexed arrays, reconstructs typed mesh buffers, and renders shared mesh instances directly. Raw text is not retained by loader code. No worker was added because the compact path must be measured first; a worker would not remove legacy duplication.
