# Visual Comparison: presentation20

Overall: **PASS_WITH_RENDERING_DIFFERENCE**

All comparisons use the exact SketchUp camera metadata and 1982 x 1170 viewport before image difference is computed.

| View | Status | Mask IoU | Boundary F1 | BBox delta | Centroid delta |
| --- | --- | ---: | ---: | ---: | ---: |
| isometric | PASS_WITH_RENDERING_DIFFERENCE | 0.997 | 0.929 | 0.001 | 0.000 |
| front | PASS_WITH_RENDERING_DIFFERENCE | 0.990 | 0.872 | 0.192 | 0.001 |
| back | PASS_WITH_RENDERING_DIFFERENCE | 0.991 | 0.843 | 0.192 | 0.001 |
| left | PASS_WITH_RENDERING_DIFFERENCE | 0.995 | 0.870 | 0.271 | 0.000 |
| right | PASS_WITH_RENDERING_DIFFERENCE | 0.995 | 0.870 | 0.271 | 0.000 |
| top | PASS_WITH_RENDERING_DIFFERENCE | 0.999 | 0.637 | 0.001 | 0.000 |

Checklist:

- [x] Projection, camera position, target, up vector, orthographic height, aspect, and viewport matched.
- [x] SketchUp-to-Three axis conversion checked (`{x,y,z}` to `{x,z,-y}`).
- [x] Scale, origin, silhouette bounding box, and centroid measured.
- [x] Missing/extra geometry and transform mismatch screened with tolerant silhouette boundaries.
- [x] Material, transparency, shading, and absent instanced edges treated separately from geometry.
- [x] Pixel difference used only after camera alignment and never as sole pass/fail signal.

Per-view artifacts are under `side-by-side/`, `overlay/`, and `difference/`.
