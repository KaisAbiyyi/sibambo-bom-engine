# Surface clustering contract

Clusters are built lazily per logical object. Faces merge only when they share an edge within position tolerance, are nearly coplanar, have similar normals, and do not cross a material boundary. Sharp architectural edges, disconnected faces, and configured material boundaries remain separate.

Configuration lives in `src/lib/geometry/index.ts`:

- position tolerance: 0.001 m;
- normal-angle tolerance: 8 degrees;
- coplanarity tolerance: 0.002 m;
- level-band tolerance: 0.15 m;
- orientation bands: 15 degrees from horizontal/vertical.

Position comparison is quantization-aware and measured in decoded world meters. Clusters report boundary edge count, dominant normal, ratios, area, material IDs, and primitive ranges. They do not report a building category.
