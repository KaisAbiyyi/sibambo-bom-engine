# Visual Comparison: house2

Overall: **PASS_WITH_RENDERING_DIFFERENCE**

All comparisons use the exact SketchUp camera metadata and 1982 x 1170 viewport before image difference is computed.

| View | Status | Mask IoU | Boundary F1 | BBox delta | Centroid delta |
| --- | --- | ---: | ---: | ---: | ---: |
| isometric | PASS_WITH_RENDERING_DIFFERENCE | 0.877 | 0.352 | 0.001 | 0.024 |
| front | PASS_WITH_RENDERING_DIFFERENCE | 0.772 | 0.249 | 0.061 | 0.038 |
| back | PASS_WITH_RENDERING_DIFFERENCE | 0.737 | 0.316 | 0.061 | 0.040 |
| left | PASS_WITH_RENDERING_DIFFERENCE | 0.952 | 0.597 | 0.032 | 0.009 |
| right | PASS_WITH_RENDERING_DIFFERENCE | 0.970 | 0.668 | 0.031 | 0.006 |
| top | PASS_WITH_RENDERING_DIFFERENCE | 0.578 | 0.110 | 0.001 | 0.004 |

Checklist:

- [x] Projection, camera position, target, up vector, orthographic height, aspect, and viewport matched.
- [x] SketchUp-to-Three axis conversion checked (`{x,y,z}` to `{x,z,-y}`).
- [x] Scale, origin, silhouette bounding box, and centroid measured.
- [x] Missing/extra geometry and transform mismatch screened with tolerant silhouette boundaries.
- [x] Material, transparency, shading, and absent instanced edges treated separately from geometry.
- [x] Pixel difference used only after camera alignment and never as sole pass/fail signal.

Per-view artifacts are under `side-by-side/`, `overlay/`, and `difference/`.
