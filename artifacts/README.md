# End-to-End Artifacts

Each model uses this layout:

```text
artifacts/<model>/
├── sketchup/       source-reference screenshots
├── exported/       generated JSON/BOME/GLB files
├── model-eval/     evaluator screenshots
├── comparisons/    side-by-side, overlay, diff, and report
├── logs/           SketchUp/browser/validator logs
└── metrics/        machine-readable inventory and benchmark results
```

Large exports and images are intentionally ignored by Git but remain in the local workspace. Metrics and Markdown reports are tracked.

Baseline files:

- `metrics/baseline-sketchup.json`: source inventory and camera metadata.
- `metrics/baseline-export-full.json`: legacy full JSON timing and result.
- `metrics/baseline-export-visual.json`: legacy BOME v1 timing and result.
- `metrics/baseline-model-eval.json`: parser, triangulation, memory, and old-classifier results.

Workflow-wide logs and screenshots live in `artifacts/_workflow/`.
