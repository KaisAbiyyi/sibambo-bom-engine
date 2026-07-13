# Visual Comparison: project-sboost

Overall: **PASS_WITH_RENDERING_DIFFERENCE**

All comparisons use the exact SketchUp camera metadata and 1982 x 1170 viewport before image difference is computed.

| View | Status | Mask IoU | Boundary F1 | BBox delta | Centroid delta |
| --- | --- | ---: | ---: | ---: | ---: |
| isometric | PASS_WITH_RENDERING_DIFFERENCE | 0.607 | 0.160 | 0.035 | 0.066 |
| front | PASS_WITH_RENDERING_DIFFERENCE | 0.727 | 0.622 | 0.006 | 0.084 |
| back | PASS_WITH_RENDERING_DIFFERENCE | 0.737 | 0.705 | 0.009 | 0.080 |
| left | PASS_WITH_RENDERING_DIFFERENCE | 0.980 | 0.574 | 0.009 | 0.002 |
| right | PASS_WITH_RENDERING_DIFFERENCE | 0.963 | 0.610 | 0.015 | 0.005 |
| top | PASS_WITH_RENDERING_DIFFERENCE | 0.472 | 0.140 | 0.179 | 0.008 |

Checklist:

- [x] Projection, camera position, target, up vector, orthographic height, aspect, and viewport matched.
- [x] SketchUp-to-Three axis conversion checked (`{x,y,z}` to `{x,z,-y}`).
- [x] Scale, origin, silhouette bounding box, and centroid measured.
- [x] Missing/extra geometry and transform mismatch screened with tolerant silhouette boundaries.
- [x] Material, transparency, shading, and absent instanced edges treated separately from geometry.
- [x] Pixel difference used only after camera alignment and never as sole pass/fail signal.

Per-view artifacts are under `side-by-side/`, `overlay/`, and `difference/`.
