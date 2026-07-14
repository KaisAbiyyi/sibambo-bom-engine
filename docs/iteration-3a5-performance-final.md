# Iteration 3A.5 Performance Final Report

This document records the final performance benchmark methodology, results, and gate statuses.

## 1. Methodology

The performance verification uses a bounded benchmark executing:
- **1 Cold Run**: A fresh process execution to capture cold JIT/process initialization and initial memory cache states.
- **3 Warm Runs**: Sequential process executions sharing operating-system file caches.

Input model:
- `presentation20_model-eval.json` (large scalability model, 256,788 units).
- SHA-256: `c896f681bc3b3ce9fdbaf8ebfcd5f0a8b59f287704898bdc26af6a4e7cfd58e4`

Environment:
- OS: Microsoft Windows 11 Home Single Language (Version 10.0.26200)
- CPU: 12th Gen Intel(R) Core(TM) i5-12450H
- RAM: 16 GB
- Bun Version: 1.3.14
- Node Version: v22.23.1

Benchmark command:
```bash
bun.cmd run scripts/profile-stages.ts C:\projects\sibambo-bom-engine-iteration-3a5\skps\model-eval-exports\presentation20_model-eval.json
```

## 2. Benchmark Results

| Timing (ms) | Cold Run | Warm Run 1 | Warm Run 2 | Warm Run 3 | Warm Median |
| --- | --- | --- | --- | --- | --- |
| **File read** | 18.579 | 2.633 | 3.735 | 2.329 | 2.633 |
| **JSON.parse** | 11.059 | 9.904 | 10.329 | 10.983 | 10.329 |
| **Compact construction** | 16.582 | 11.682 | 12.488 | 11.975 | 11.975 |
| **Instance graph** | 39.955 | 33.659 | 30.084 | 30.517 | 30.517 |
| **Logical object indexing**| 1653.038 | 1701.355 | 1695.955 | 1593.672 | 1695.955 |
| **Index initialization** | 4.033 | 3.941 | 6.902 | 3.622 | 3.941 |
| **Clustering** | 42346.142 | 40607.374 | 39850.233 | 40505.932 | 40505.932 |
| **Grouping & Adjacency** | 29857.296 | 28828.829 | 28710.445 | 29108.294 | 28828.829 |
| **Required Processing Total**| **73946.684 ms**| **71199.377 ms**| **70319.987 ms**| **71267.324 ms**| **71199.377 ms**|
| **Semantic fingerprinting**| 1140.961 | 1061.314 | 1118.778 | 1090.565 | 1090.565 |
| **Serialization (est)** | 1487.111 | 1433.956 | 1687.559 | 1637.999 | 1637.999 |
| **Total time** | **75093.495 ms**| **72266.326 ms**| **71445.562 ms**| **72364.317 ms**| **72266.326 ms**|

*Note: serialization timings are labeled as `estimatedSerializationMs` and are estimated from a sample of 1,000 units.*

## 3. Semantic Preservation

- **house2**: 2,843 units. Fingerprint: `200341556e59c20009a50508292ab41e25f8e508b162d7daa5f6a670675988f2`
- **presentation20**: 256,788 units. Fingerprint: `6da1922ff79d22e6e0acaf144d710c04e9e7848ae18c4e450b56897c1d51a562`

All semantic invariants tests pass successfully:
- `incremental equals full`
- `forward order equals reverse order`
- `lazy equals eager`
- `cold cache equals warm cache`
- `cancellation and restart produce the same final result`

Initial `FaceRecord` expansion remains exactly **zero**.

## 4. Limitations
- Runs are performed in headless CLI mode.
- Desktop SketchUp environment constraints prevent running SketchUp API directly on this system.

## 5. Gate Statuses
- **CODE_GATE**: PASS (All required full-processing runs are well below the 120-second timeout limit)
- **HEADLESS_GATE**: PASS
- **MANUAL_VISUAL_GATE**: PENDING (Visual validation to be performed on the repository owner's machine)
