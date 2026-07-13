# Iteration 2 benchmark

Run from `model-eval`:

```powershell
bun run benchmark:geometry -- D:\projects\sibambo-bom-engine\skps\model-eval-exports\test_model-eval.json 20
bun run inspect:geometry -- D:\projects\sibambo-bom-engine\skps\model-eval-exports\test_model-eval.json --json
```

The benchmark records medians over at least 20 iterations for JSON parsing, compact-runtime construction, instance graph, logical-object indexing, geometry evidence, and lazy surface clustering. It also reports retained definition-local bytes and confirms zero initial `FaceRecord` expansion.

Current `test_model-eval.json` result (20 iterations): JSON.parse 0.746 ms, compact runtime 0.387 ms, instance graph 0.059 ms, logical-object index 1.780 ms, evidence 1.576 ms, and lazy surface clustering 169.646 ms. Initial parse plus compact runtime is 1.133 ms and creates zero `FaceRecord`s. Retained definition-local geometry is 69,144 bytes; two instance matrices add 128 bytes. Clustering is intentionally separate and remains deferred.

Level bands are geometry context only. They need horizontally consistent support and at least 1 m² or 6% of plan bounds support, whichever is larger. This intentionally avoids treating small repeated furniture shelves as storeys. Plan-perimeter proximity is weak evidence because axis-aligned bounds are not an exterior-envelope solver.
