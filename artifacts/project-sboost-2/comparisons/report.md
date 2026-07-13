# Visual Comparison: project-sboost-2

Overall: **PASS_WITH_RENDERING_DIFFERENCE**

All comparisons use the exact SketchUp camera metadata and 1982 x 1170 viewport before image difference is computed.

| View | Status | Mask IoU | Boundary F1 | BBox delta | Centroid delta |
| --- | --- | ---: | ---: | ---: | ---: |
| isometric | PASS_WITH_RENDERING_DIFFERENCE | 0.693 | 0.166 | 0.010 | 0.050 |
| front | PASS_WITH_RENDERING_DIFFERENCE | 0.890 | 0.314 | 0.001 | 0.032 |
| back | PASS_WITH_RENDERING_DIFFERENCE | 0.854 | 0.407 | 0.009 | 0.028 |
| left | PASS_WITH_RENDERING_DIFFERENCE | 0.723 | 0.256 | 0.004 | 0.088 |
| right | PASS_WITH_RENDERING_DIFFERENCE | 0.958 | 0.833 | 0.013 | 0.004 |
| top | PASS_WITH_RENDERING_DIFFERENCE | 0.992 | 0.640 | 0.203 | 0.000 |

Checklist:

- [x] Projection, camera position, target, up vector, orthographic height, aspect, and viewport matched.
- [x] SketchUp-to-Three axis conversion checked (`{x,y,z}` to `{x,z,-y}`).
- [x] Scale, origin, silhouette bounding box, and centroid measured.
- [x] Missing/extra geometry and transform mismatch screened with tolerant silhouette boundaries.
- [x] Material, transparency, shading, and absent instanced edges treated separately from geometry.
- [x] Pixel difference used only after camera alignment and never as sole pass/fail signal.

Per-view artifacts are under `side-by-side/`, `overlay/`, and `difference/`.
