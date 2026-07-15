# Sibambo Model Eval

Sibambo Model Eval is a SvelteKit app for early-stage building analysis from SketchUp/BOM JSON exports.

Framework status: SvelteKit owns routing, build output, app structure, and diagnostics. This project is not a React app.

It turns raw model geometry into a guided evaluation workflow: upload JSON, inspect detected building data, complete missing inputs with presets, run deterministic estimates, preview overlays, and export an HTML report.

## Scope

Model Eval focuses on first-pass decision support, not final engineering certification.

Included:

- JSON upload and sample loading.
- Automatic face, surface, part, room, and component detection.
- Readiness checks for each analysis mode.
- Progressive inputs with human-readable presets.
- Analysis results as tables, recommendations, before/after hints, and 3D overlays.
- HTML report export.
- Parser unit tests for room detection and height inference.

Out of scope:

- CFD simulation.
- Full energy modeling.
- Structural validation.
- Legal compliance certification.
- Automatic mutation of source JSON.

## Analysis Modes

| Mode | Output |
| --- | --- |
| Lighting | Lamp count and wattage per detected zone. |
| AC | Cooling capacity estimate in BTU/h and PK. |
| OTTV | Envelope heat-transfer estimate with glass ratio and orientation inputs. |
| Thermal | Comfort score based on roof and wall material presets. |
| People flow | Occupancy capacity and circulation score. |
| Wind flow | Ventilation-crossflow score from dominant wind and openings. |

Room Debug also exposes seven room/building analysis modules: thermal comfort, human flow,
natural ventilation, cooling capacity, illuminance requirement, artificial lighting, and OTTV.

## Calibration workflow

Open Room Debug after loading a model, then use **Project calibration** to edit project north,
indoor/outdoor temperature, humidity, wind, envelope U-values, SHGC/shading, lighting CU/LLF/
flux, AC margin, and OTTV threshold. Every value records unit, source, and validation state.
Invalid values block recalculation. Reset field/all restores default profile.

Calibration recalculates analysis only. It does not reparse model geometry or rerun room detection,
topology, or semantic inference. Default-versus-calibrated values show deltas for thermal state,
ACH, cooling, luminaires, and OTTV. Configuration JSON uses schema
`model-eval-project-configuration`, version 1; invalid or unsupported files are rejected before
they change active settings.

Exports: configuration JSON, scenario JSON, and printable HTML analysis reports. Reports retain
units, calculation traces, and degraded/insufficient-data warnings.

## Bounded benchmarking

Use `bun run benchmark:profile -- --phase fingerprint --max-candidates 5000 --time-budget-ms 30000`.
Default benchmark uses safe house2 input and bounded candidates. `--full` is explicit. Do not use
`presentation20_model-eval.json` as a normal validation fixture. Large source extraction remains
uninterruptible before evidence setup, so do not run it until pre-phase cancellation is available.

## Project Structure

```text
model-eval/
  docs/prd.md                         Product requirements and UX scope
  src/lib/model.ts                    Parser, readiness engine, analysis engine
  src/lib/model.test.ts               Bun tests for geometry parsing
  src/lib/ModelCanvas.svelte          Three.js model preview and overlays
  src/routes/+page.svelte             Main analysis workspace
  static/Model_SBMBOOST_bom_visual_nonPretty-print.json
```

## Requirements

- Node.js 20+
- Bun for the current test runner
- Browser with WebGL support

Install:

```powershell
npm install
```

## Development

Start dev server:

```powershell
npm run dev
```

From repository root:

```powershell
npm run dev:model-eval
```

Default root script serves the app at:

```text
http://127.0.0.1:5300
```

## Quality Gates

Type and Svelte check:

```powershell
npm run check
```

Run tests:

```powershell
npm run test
```

Build production bundle:

```powershell
npm run build
```

Preview production bundle:

```powershell
npm run preview
```

## Data Contract

Expected JSON shape:

- `entities`: nested model entities.
- `Face` entities with `vertices`, `area_m2`, optional `surface_type`, optional material data.
- Optional metadata fields such as `schema_version`, `export_level`, and `exported_at`.

The parser tolerates partial metadata but requires renderable faces. If no faces exist, parsing fails with an explicit error.

## Analysis Philosophy

- Auto-detect before asking user input.
- Use presets for domain values such as room function, wall material, glass type, roof material, and lamps.
- Mark results as estimates when defaults are still being used.
- Keep formulas transparent in `src/lib/model.ts`.
- Preserve original JSON; analysis state lives in browser memory/local storage and exported reports.

## Design Recommendations

The recommendation engine (`src/lib/rooms/analysis/recommendations.ts`) generates prioritised, evidence-backed design actions from the current building analysis result.

**Scope:**

| Scope | Trigger |
|-------|---------|
| `building` | OTTV non-compliance, missing project north, building-wide poor ventilation |
| `room` | Per-room thermal comfort failure, AC oversize, inaccessible room |

**Categories:** `envelope insulation`, `glazing performance`, `solar shading`, `natural ventilation`, `AC capacity`, `lighting quantity`, `circulation/access`, `missing project data`.

**Ranking:** `critical` → `warning` → `info`, then by confidence, then by affected room count, then alphabetically by title.

**Deduplication:** Recommendations with identical category and title are merged. Room IDs from merged sources are combined.

**Conflict detection:** If a recommendation increases window area while OTTV is non-compliant, a conflict note is appended to `limitations`.

**Applying a recommendation:** Each recommendation exposes `suggestedOverrides` (`DesignScenarioOverrides`). Pass these directly to `runScenarioAnalysis` to create a proposed scenario for comparison.

## Multi-Variable Scenario Optimization

The optimization engine (`src/lib/rooms/analysis/optimization.ts`) performs a bounded, deterministic pseudo-random search across user-defined variable ranges to find Pareto-optimal design configurations.

### Optimization Variables

| Variable path | Unit | Description |
|---------------|------|-------------|
| `wallUValueMultiplier` | multiplier | Scale default wall U-value (insulation improvement) |
| `glazingUValueMultiplier` | multiplier | Scale glazing U-value |
| `shadingCoefficientMultiplier` | multiplier | Scale shading coefficient |
| `solarFactorMultiplier` | multiplier | Scale solar heat gain factor |
| `windowAreaMultiplier` | multiplier | Scale all exterior window areas |
| `exteriorOpeningAreaMultiplier` | multiplier | Scale all exterior openings (ventilation) |
| `defaultLuminaireFluxLm` | lm | Override lamp efficacy |
| `acSafetyMargin` | fraction | Override AC safety factor |
| `indoorDesignTempC` | °C | Override indoor design temperature |

Each variable requires `min`, `max`, and `step`.

### Objectives

| Objective | Direction |
|-----------|-----------|
| `reduce_cooling_load` | lower is better (kW) |
| `reduce_ottv` | lower is better (W/m²) |
| `improve_ach` | higher is better (ACH) |
| `improve_thermal_comfort` | higher compliance rate is better |
| `reduce_luminaires` | lower count is better |
| `minimize_changes` | minimize deviation from baseline |

### Pareto Interpretation

The Pareto frontier contains only **non-dominated** scenarios. A scenario A dominates B if A is no worse on all objectives and strictly better on at least one. Dominated scenarios are excluded from the frontier.

The **recommended (balanced) scenario** is selected using normalized min-sum across all objectives. It minimises the sum of per-objective distances from the best frontier values.

### Scenario Application

After optimization, apply the result:

```typescript
const scenario: DesignScenario = {
  id: 'opt-applied',
  name: 'Optimized Design',
  description: 'From Pareto optimizer',
  isBaseline: false,
  overrides: result.recommendedScenario.scenario.overrides
};
const proposed = runScenarioAnalysis(scenario, rooms, topology, semantics, config);
const comparison = compareScenarios(baseline, proposed);
```

### Cancellation and Budget Behavior

- `timeBudgetMs`: hard wall-clock limit. Stops evaluation loop and reports `Time budget of Xms exceeded.` in diagnostics.
- `AbortController.signal`: stops after the current evaluation completes. Reports `Optimization cancelled by user.` in diagnostics.
- Partial results from cancelled runs are always returned. `totalEvaluated`, `feasibleCount`, `paretoFrontier`, and `diagnostics` are always populated.

## Supported Models

| Model | Use |
|-------|-----|
| `house2` | Full end-to-end acceptance testing |
| `PROJECT SBOOST 2` | Bounded end-to-end smoke run |
| `PROJECT SBOOST 1` | Cancellation and resource-limit verification only |

Do not use `presentation20` for room analysis; it is a legacy fixture not aligned with the current export schema.

## Known Limitations

- **Room detection is heuristic.** Closed-room detection uses planar graph cycle analysis. Open plans or non-standard geometry may produce zero or incorrect rooms.
- **Analysis results are engineering estimates.** Thermal comfort, OTTV, cooling capacity, and illuminance calculations use simplified methods (ISO 7730 PMV approximation, simplified solar heat gain, lumen method). Results are not suitable for regulatory submission.
- **OTTV is approximate.** Facade orientation is inferred from geometry, not surveyed. Non-orthogonal facades may have incorrect compass assignments.
- **Ventilation type is inferred.** Cross-ventilation vs single-sided is determined from topology, not CFD.
- **No dynamic simulation.** All analysis is steady-state and design-day based.
- **Optimization is a random search.** The Pareto frontier is not exhaustive. Larger `maxEvaluations` budgets and finer `step` sizes improve quality at the cost of runtime.
- **Scenario overrides are building-wide.** Room-specific geometric multipliers (e.g., `windowAreaMultiplier`) apply uniformly to all rooms. Per-room geometry editing is not supported.

## Engineering-Estimate Disclaimer

All results produced by Sibambo Model Eval are preliminary engineering estimates based on simplified first-principle methods and assumed default values. They are intended for early-stage decision support only. Results must not be used for regulatory compliance, structural design, energy certification, or any purpose requiring certified engineering calculations. Always verify critical decisions with a licensed engineer using appropriate simulation tools.

## License

GPL-3.0-only. See repository root `LICENSE`.
