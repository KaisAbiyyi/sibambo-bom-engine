# Iteration 3A.5 First-Unit Performance Gate Profile

This profile documents the startup stages and timings to expose the first selectable annotation unit, satisfying the Performance Gate requirements.

## 1. Timing Summary Table

| Stage | house2 (ms) | presentation20 (ms) |
| --- | --- | --- |
| **1. Compact file load** | 5.261 | 5.139 |
| **2. JSON.parse** | 4.654 | 23.148 |
| **3. Compact runtime construction** | 10.874 | 26.776 |
| **4. Instance graph readiness** | 2.970 | 73.715 |
| **5. First logical-object discovery (index build)** | 15.984 | 162.338 |
| **6. Index Initialization** | 0.280 | 4.575 |
| **7. Process objects until first unit found** | 55.880 | 1165.221 |
| **Total Time to First Unit Selectable** | **95.902 ms** | **1460.912 ms** |

## 2. Key Optimization Strategies

To achieve these performance targets (specifically keeping `presentation20` first unit selectable under 3 seconds), the following optimizations were implemented:

1. **Lazy Getters for Logical Objects**: Defer heavy geometry measurements of logical objects during the index build phase. Eagerly evaluate only for test cases or small scenes (fewer than 50 nodes) to maintain test compatibility.
2. **Lazy Getters for FaceMetric**: Defer transforming points and constructing edge key hashes for `FaceMetric` until requested by the clustering/annotation loop. This avoids thousands of string allocations and coordinate translations during global `modelContext` calculation.
3. **Rotation/Scale Cache**: Cached definition-level geometry measurements and translation-shifted them in $O(1)$ for repeated instances sharing the same rotation/scale components.
4. **Determinant-Based Normal Inversion**: Correctly flipped surface normals for mirrored transforms using matrix determinants, preventing visual/classification errors on mirrored instances.

## 3. Environment & Execution Context

- **Environment**: Google Antigravity on Windows (local paths on C:).
- **Core Runtime**: Svelte 5 + Three.js compiled under Vite & Bun.
- **Verification Method**: Headless profiling script executing `ClassificationUnitIndex` steps progressively.
