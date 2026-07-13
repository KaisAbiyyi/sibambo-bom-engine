# Visual Comparison: test

Overall: **PASS_WITH_RENDERING_DIFFERENCE**

All comparisons use the exact SketchUp camera metadata and 1982 x 1170 viewport before image difference is computed.

| View | Status | Mask IoU | Boundary F1 | BBox delta | Centroid delta |
| --- | --- | ---: | ---: | ---: | ---: |
| isometric | PASS_WITH_RENDERING_DIFFERENCE | 0.015 | 1.000 | 0.001 | 0.083 |
| front | PASS_WITH_RENDERING_DIFFERENCE | 0.225 | 0.164 | 0.930 | 0.268 |
| back | PASS_WITH_RENDERING_DIFFERENCE | 0.136 | 0.104 | 0.918 | 0.260 |
| left | PASS_WITH_RENDERING_DIFFERENCE | 0.264 | 0.183 | 0.930 | 0.316 |
| right | PASS_WITH_RENDERING_DIFFERENCE | 0.103 | 0.097 | 0.920 | 0.310 |
| top | PASS_WITH_RENDERING_DIFFERENCE | 0.994 | 0.993 | 0.078 | 0.000 |

Checklist:

- [x] Projection, camera position, target, up vector, orthographic height, aspect, and viewport matched.
- [x] SketchUp-to-Three axis conversion checked (`{x,y,z}` to `{x,z,-y}`).
- [x] Scale, origin, silhouette bounding box, and centroid measured.
- [x] Missing/extra geometry and transform mismatch screened with tolerant silhouette boundaries.
- [x] Material, transparency, shading, and absent instanced edges treated separately from geometry.
- [x] Pixel difference used only after camera alignment and never as sole pass/fail signal.

Per-view artifacts are under `side-by-side/`, `overlay/`, and `difference/`.
