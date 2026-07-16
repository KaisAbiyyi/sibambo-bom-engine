# KP Demo Script and Fallback Plan

Target duration: 8–12 minutes.

## Live sequence

1. **0:00–0:30 — Context.** Open staging. State that this is early-stage decision support from SketchUp/BOM exports, not certified simulation.
2. **0:30–1:30 — Ingest house2.** Upload `static/dev-models/house2_model-eval.json`; show face count, 3D render, and processing completion.
3. **1:30–3:00 — Room intelligence.** Open Room Debug, select the accepted room from list and 3D, then show evidence, topology/semantics, confidence, and complete/partial diagnostics.
4. **3:00–4:30 — Seven analyses.** Show thermal, human flow, ventilation, cooling, illuminance, lighting, and OTTV results/overlays. State units and estimate limitation.
5. **4:30–5:30 — Calibration.** Change one valid value, apply calibration, and show default-versus-calibrated comparison. Reset if needed.
6. **5:30–6:30 — Recommendation and scenario.** Open a recommendation, show evidence/limitations, apply a supported proposed scenario, and call out baseline-retained confirmation.
7. **6:30–8:00 — Optimization.** Run bounded optimization, inspect Pareto frontier, and apply recommended balance. Demonstrate cancel if the run is still in progress.
8. **8:00–8:45 — Export.** Export configuration JSON and printable HTML report; explain source geometry remains unchanged.
9. **8:45–10:00 — Scale safeguard.** Upload PROJECT SBOOST 2 in bounded annotation mode and show progress/completion. Use PROJECT SBOOST 1 only to press Stop and show retained partial diagnostics.

## Fallback package

Do not commit regenerated large artifacts. Use repository-controlled inputs and release evidence:

- Known-good house2 input: `static/dev-models/house2_model-eval.json`.
- Known-good SBOOST 2 runtime input: `../artifacts/project-sboost-2/exported/project-sboost-2_runtime.bome2.gz`.
- SBOOST 1 cancellation input: `../artifacts/project-sboost/exported/project-sboost_runtime.bome2.gz`.
- Technical methods: `docs/KP_TECHNICAL_GUIDE.md`.
- Local instructions: `docs/KP_USER_WORKFLOW.md`.
- Release validation summary: `docs/KP_RESULT_SUMMARY.md`.
- Live staging URL: use final URL from release tag/PR record.

If live upload fails, present the known-good house2 input locally, show the recorded release smoke metrics in the result summary, and explain cancellation behavior from the documented SBOOST 1 check. Generate a fresh small configuration JSON/HTML report during rehearsal rather than committing generated reports.
