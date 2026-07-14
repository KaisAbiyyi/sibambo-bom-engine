# Headless E2E Verification Report

This document records the Playwright E2E headless verification procedure and results.

## 1. devModel Loader Behavior
The devModel loader is implemented in `model-eval/src/routes/+page.svelte`. When `devModel` query parameter is present:
1. It validates that the application is running in development mode (`import.meta.env.DEV`).
2. It fetches the model from `/dev-models/<filename>`.
3. If it detects `model_eval_json_v1` format using `isModelEvalJsonV1`, it parses the model via `parseModelEvalJsonV1` and wraps it in a `{ __modelEvalRuntime }` property to allow compatibility parsing.
4. It calls `acceptModel` to load it into Svelte state and trigger 3D rendering and annotation index generation.

## 2. Playwright Headless Flows

Two E2E headless test cases are defined in `model-eval/tests/tier1-annotation-smoke.spec.ts`:

### house2 functional flow
This test verifies the entire interactive annotation pipeline:
1. Navigates to `/?annotate=tier1&devModel=house2_model-eval.json`.
2. Waits for Svelte annotation panel to mount and the first selectable unit (`unit:cluster:logical:node:root:component:0:0`) to appear.
3. Selects the unit, clicks **1 Wall** role button, and verifies the button enters the active state.
4. Clicks **Save unit** to commit the role.
5. Clicks **Show JSON** to populate the copy/paste textarea.
6. Parses the JSON textarea value to verify that the first annotation unit is correctly written as a `"wall"`.
7. Captures a verification screenshot at `artifacts/tier1-annotation-smoke/house2_smoke.png`.

### presentation20 scalability flow
1. Navigates to `/?annotate=tier1&devModel=presentation20_model-eval.json`.
2. Waits for Svelte annotation panel to mount and the first selectable unit to appear (validating the Performance Gate time-to-first-unit of < 3s).
3. Captures a verification screenshot at `artifacts/tier1-annotation-smoke/presentation20_smoke.png`.

## 3. Playwright Verification Commands & Status

Run command:
```bash
bun run prepare:annotation-smoke C:\projects\sibambo-bom-engine-iteration-3a5\skps\model-eval-exports\house2_model-eval.json
bun run prepare:annotation-smoke C:\projects\sibambo-bom-engine-iteration-3a5\skps\model-eval-exports\presentation20_model-eval.json
bunx playwright test
```

Status: **PASS**
Both flows executed successfully with zero application console errors.

Screenshots recorded at:
- `C:\projects\sibambo-bom-engine-iteration-3a5\artifacts\tier1-annotation-smoke\house2_smoke.png`
- `C:\projects\sibambo-bom-engine-iteration-3a5\artifacts\tier1-annotation-smoke\presentation20_smoke.png`
