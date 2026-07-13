# World geometry contract

`model_eval_json_v1` retains definition-local, quantized positions in SketchUp meters. They are decoded before any metric. A node occurrence carries a local SketchUp transform. The geometry layer converts the matrix basis once to Three.js coordinates (`{x,y,z} -> {x,z,-y}`), then composes `worldTransform = parentWorldTransform * localTransform`.

Three.js `Y` is vertical. Bounds, centroids, normals, triangle area, elevation, and orientation ratios are all measured after that composition. Normals are rebuilt from transformed triangle vertices. This handles rotation, mirroring, and non-uniform scale; it does not apply a direction-only normal transform.

Definition-local typed arrays remain shared. Instance records retain matrices and derived scalar facts only; they do not retain per-instance world-position buffers. Holes remain in the compact mesh loop table and are not expanded by this layer.

`GeometryFoundation` caches world records by instance path. Construction is lazy: compact load does not build an instance graph, logical-object index, clusters, or classifier traces.
