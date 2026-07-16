# KP User Workflow

## Run locally or open staging

From `model-eval/`:

```powershell
bun install --frozen-lockfile
bun run dev
```

Open the local URL printed by Vite. Use the current staging URL recorded in the release notes for KP review. A WebGL-capable browser is required.

## Normal review flow

1. Select **Upload JSON** and choose supported BOM JSON/BOME2 input (maximum 80 MB source; 120 MB decompressed).
2. Confirm model face count and preview render. Invalid files show a specific parse, size, or unsupported-schema message.
3. Open **Room Debug** when room intelligence review is needed. Select a detected room from its list or directly in 3D; inspect evidence, topology, semantics, and analysis overlays.
4. Review thermal comfort, human flow, natural ventilation, cooling capacity, illuminance, artificial lighting, and OTTV.
5. Change **Project calibration** values. Select **Apply calibration** and read default-to-calibrated deltas. Reset a field/all to return to defaults.
6. Open **Design Recommendations**. Select a recommendation; apply supported proposed overrides. Confirmation states that the default baseline is retained.
7. In **Optimization**, choose objectives and a bounded evaluation/time budget. Run it, inspect Pareto alternatives, then select **Apply to Design** if appropriate. Cancel to stop safely and retain diagnostics.
8. Use **Export JSON** for project configuration and **Export report** for printable HTML. Keep exported files with the model for review traceability.

## Import and export configuration

Project configuration JSON has schema `model-eval-project-configuration`, version 1. Import validates before changing active settings. Valid imports request an explicit recalculation; invalid/unsupported JSON reports actionable issues and does not alter active settings.

## Large-model safety

Use PROJECT SBOOST 2 only for a bounded smoke run. Use PROJECT SBOOST 1 only to press Stop/cancel and verify partial diagnostics. Do not wait for an unbounded full run and do not use presentation20. If processing reaches a budget, retain the diagnostic and export available review state.
